import { performance } from "node:perf_hooks";
import { createGameAudio, type SfxEventDefinition } from "../packages/audio-core/src";
import { createMemoryAudioBackend } from "../packages/audio-core/src/testing";
import {
  audioBenchmarkBudgetCount,
  checkAudioBenchmarkBudgets,
  type AudioBenchmarkCase,
  type AudioBenchmarkSuite
} from "./audio-benchmark-budget";

function main(): void {
  const suites: AudioBenchmarkSuite[] = [
    { suite: "audio-sfx-burst", cases: [runSfxBurst()] },
    { suite: "audio-spatial-update", cases: [runSpatialUpdate()] },
    { suite: "audio-stop-group", cases: [runStopGroup()] }
  ];
  const checkEnabled = process.argv.includes("--check");
  const failures = checkEnabled ? checkAudioBenchmarkBudgets(suites) : [];
  console.log(
    JSON.stringify(
      {
        benchmark: "audio",
        package: "@gamekits/audio-core",
        methodology: {
          reports: [
            "layered SFX burst",
            "playback instance concurrency",
            "emitter spatial batch",
            "targeted instance stop",
            "retained-after-dispose"
          ]
        },
        suites,
        ...(checkEnabled
          ? {
              budgetCheck: {
                budgets: audioBenchmarkBudgetCount(),
                passed: failures.length === 0,
                failures
              }
            }
          : {})
      },
      null,
      2
    )
  );
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

function runSfxBurst(): AudioBenchmarkCase {
  const eventsPerRound = 1000;
  const rounds = 30;
  const { audio } = createHarness(64);
  const samples: number[] = [];
  for (let round = 0; round < rounds; round += 1) {
    audio.update(16, round * 16);
    const started = performance.now();
    for (let index = 0; index < eventsPerRound; index += 1) {
      audio.sfx.play("sfx.rifle", { priority: index % 8 });
    }
    samples.push(performance.now() - started);
  }
  const snapshot = audio.snapshot();
  const stats = summarize(samples);
  audio.dispose();
  return {
    eventsPerRound,
    rounds,
    activePlaybackInstances: snapshot.activePlaybackInstances,
    nativePlaybackCount: snapshot.nativePlaybackCount,
    rejectedPlayback: snapshot.sfx.rejected,
    stoppedForConcurrency: snapshot.sfx.stoppedForConcurrency,
    meanMsPerRound: stats.mean,
    p50MsPerRound: stats.p50,
    p95MsPerRound: stats.p95,
    maxMsPerRound: stats.max,
    microsecondsPerEvent: round((stats.mean * 1_000) / eventsPerRound)
  };
}

function runSpatialUpdate(): AudioBenchmarkCase {
  const instances = 500;
  const ticks = 120;
  const { audio } = createHarness(instances);
  audio.spatial.setEmitters(
    Array.from({ length: instances }, (_, index) => ({
      id: `emitter.${index}`,
      transform: { position: { x: index, y: 0 } }
    }))
  );
  for (let index = 0; index < instances; index += 1) {
    audio.sfx.play("sfx.spatial", { emitterId: `emitter.${index}` });
  }
  const samples: number[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    audio.update(16, (tick + 1) * 16);
    const emitters = Array.from({ length: instances }, (_, index) => ({
      id: `emitter.${index}`,
      transform: { position: { x: index + tick * 0.25, y: tick * 0.1 } }
    }));
    const started = performance.now();
    audio.spatial.setEmitters(emitters);
    samples.push(performance.now() - started);
  }
  const stats = summarize(samples);
  const activePlaybackInstances = audio.snapshot().activePlaybackInstances;
  audio.dispose();
  return {
    instances,
    ticks,
    activePlaybackInstances,
    meanMsPerTick: stats.mean,
    p50MsPerTick: stats.p50,
    p95MsPerTick: stats.p95,
    maxMsPerTick: stats.max,
    microsecondsPerInstanceTick: round((stats.mean * 1_000) / instances)
  };
}

function runStopGroup(): AudioBenchmarkCase {
  const instances = 1000;
  const { audio, backend } = createHarness(instances);
  for (let index = 0; index < instances; index += 1) {
    audio.sfx.play("sfx.loop", { ownerId: "ambience" });
  }
  const started = performance.now();
  const stopped = audio.sfx.stopOwner("ambience");
  const milliseconds = performance.now() - started;
  const activeAfterStop = audio.snapshot().activePlaybackInstances;
  audio.dispose();
  const disposed = audio.snapshot();
  return {
    instances,
    stopped,
    milliseconds: round(milliseconds),
    activeAfterStop,
    retainedAfterDispose:
      disposed.activePlaybackInstances +
      backend.snapshot().activePlaybackInstances +
      backend.snapshot().retainedCommands
  };
}

function createHarness(maxInstances: number) {
  const backend = createMemoryAudioBackend({ maxRetainedCommands: 0, unlocked: true });
  const audio = createGameAudio({
    backend,
    sfx: SFX,
    concurrency: [
      {
        id: "rifle",
        maxInstances: 64,
        resolution: "stop-lowest-priority"
      }
    ],
    maxPlaybackInstances: maxInstances,
    maxNativePlaybackCount: maxInstances * 2,
    playbackBudgets: {
      sfx: {
        maxPlaybackInstances: maxInstances,
        maxNativePlaybackCount: maxInstances * 2
      }
    },
    diagnosticLimit: 0,
    maxDedupeEntries: 0
  });
  return { audio, backend };
}

const SFX: SfxEventDefinition[] = [
  {
    id: "sfx.rifle",
    bus: "sfx",
    concurrency: ["rifle"],
    layers: [
      {
        id: "body",
        clips: [{ id: "body", asset: { assetId: "audio.rifle", type: "audio" } }]
      },
      {
        id: "mechanical",
        clips: [
          {
            id: "mechanical",
            asset: { assetId: "audio.rifle-mechanical", type: "audio" },
            volume: 0.5
          }
        ]
      }
    ]
  },
  {
    id: "sfx.spatial",
    bus: "sfx",
    spatial: { maxDistance: 10_000 },
    layers: [
      {
        id: "main",
        clips: [{ id: "main", asset: { assetId: "audio.spatial", type: "audio" } }]
      }
    ]
  },
  {
    id: "sfx.loop",
    bus: "sfx/ambience",
    loop: true,
    layers: [
      {
        id: "main",
        clips: [{ id: "main", asset: { assetId: "audio.loop", type: "audio" } }]
      }
    ]
  }
];

function summarize(values: number[]): { mean: number; p50: number; p95: number; max: number } {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    mean: round(values.reduce((total, value) => total + value, 0) / values.length),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1) ?? 0)
  };
}

function percentile(sorted: number[], quantile: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

main();
