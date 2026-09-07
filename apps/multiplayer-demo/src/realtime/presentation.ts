import {
  createSnapshotPresentationProjector,
  createSnapshotPlayback,
  defineSnapshotVector2Track,
  stepValue,
  type PresentedSnapshotTracks,
  type NetworkVector2,
  type SnapshotPlaybackAdaptiveDelayOptions,
  type SnapshotPlaybackDiagnostics,
  type SnapshotPlaybackSample,
  type SnapshotPresentationTrack
} from "@gamekits/multiplayer-core";
import { REALTIME_ARENA_TICK_MS } from "./config";
import type { RealtimeArenaPhase, RealtimeArenaSnapshot } from "./domain";

export type RealtimeArenaPresentation = {
  reset(): void;
  sample(
    snapshot: RealtimeArenaSnapshot,
    deltaMs: number,
    options?: RealtimeArenaPresentationFrameOptions
  ): RealtimeArenaPresentationFrame;
  present(
    snapshot: RealtimeArenaSnapshot,
    deltaMs: number,
    options?: RealtimeArenaPresentationFrameOptions
  ): RealtimeArenaSnapshot;
  diagnostics(): RealtimeArenaPresentationDiagnostics;
};

export type RealtimeArenaPresentationFrame = {
  readonly snapshot: RealtimeArenaSnapshot;
  readonly players: RealtimeArenaSnapshot["players"];
  readonly cores: RealtimeArenaSnapshot["cores"];
  writePlayerPosition(playerId: string, target: NetworkVector2, fallback: NetworkVector2): void;
  writePlayerVelocity(playerId: string, target: NetworkVector2, fallback: NetworkVector2): void;
  writeCorePosition(coreId: string, target: NetworkVector2, fallback: NetworkVector2): void;
};

export type RealtimeArenaPresentationFrameOptions = {
  predictedPlayer?: {
    playerId: string;
    position: NetworkVector2;
    velocity?: NetworkVector2;
  };
};

export type RealtimeArenaPresentationOptions = {
  interpolationDelayMs?: number;
  adaptiveDelay?: SnapshotPlaybackAdaptiveDelayOptions | false;
  snapDistance?: number;
  maxSnapshots?: number;
};

export type RealtimeArenaPresentationDiagnostics = SnapshotPlaybackDiagnostics;

const DEFAULT_INTERPOLATION_DELAY_MS = 50;
const DEFAULT_MAX_INTERPOLATION_DELAY_MS = 150;
const DEFAULT_SNAP_DISTANCE = 96;

export function createRealtimeArenaPresentation(
  options: RealtimeArenaPresentationOptions = {}
): RealtimeArenaPresentation {
  const snapDistance = options.snapDistance ?? DEFAULT_SNAP_DISTANCE;
  const interpolationDelayMs = options.interpolationDelayMs ?? DEFAULT_INTERPOLATION_DELAY_MS;
  const adaptiveDelay =
    options.adaptiveDelay === false
      ? undefined
      : {
          minDelayMs: interpolationDelayMs,
          maxDelayMs: DEFAULT_MAX_INTERPOLATION_DELAY_MS,
          jitterMultiplier: 2,
          ...options.adaptiveDelay
        };
  const tracks = createRealtimeArenaPresentationTracks<RealtimeArenaSnapshot>(
    (snapshot) => snapshot,
    snapDistance
  );
  const projector = createSnapshotPresentationProjector(tracks);
  const playback = createSnapshotPlayback<RealtimeArenaSnapshot>({
    interpolationDelayMs,
    ...(adaptiveDelay === undefined ? {} : { adaptiveDelay }),
    maxSnapshots: options.maxSnapshots ?? 24,
    timeSource: "tick",
    readTime(entry) {
      return entry.snapshot.tick * REALTIME_ARENA_TICK_MS;
    },
    shouldReset(previous, next) {
      return shouldResetRealtimeArenaPresentation(previous, next);
    }
  });
  let activeSample: SnapshotPlaybackSample<RealtimeArenaSnapshot> | undefined;
  let activePresented: PresentedSnapshotTracks | undefined;
  let activePredictedPlayer: RealtimeArenaPresentationFrameOptions["predictedPlayer"];
  let activeSnapshot: RealtimeArenaSnapshot | undefined;
  let activePlayers: RealtimeArenaSnapshot["players"] = [];
  let activeCores: RealtimeArenaSnapshot["cores"] = [];
  const frame: RealtimeArenaPresentationFrame = {
    get snapshot() {
      return requireActiveSnapshot(activeSnapshot);
    },
    get players() {
      return activePlayers;
    },
    get cores() {
      return activeCores;
    },
    writePlayerPosition(playerId, target, fallback) {
      if (activePredictedPlayer?.playerId === playerId) {
        writeVector2(target, activePredictedPlayer.position);
        return;
      }
      if (activePresented === undefined) {
        writeVector2(target, fallback);
      } else {
        activePresented.vector2Into(playerKey(playerId), target, fallback);
      }
    },
    writePlayerVelocity(playerId, target, fallback) {
      const velocity =
        activePredictedPlayer?.playerId === playerId && activePredictedPlayer.velocity !== undefined
          ? activePredictedPlayer.velocity
          : fallback;
      writeVector2(target, velocity);
    },
    writeCorePosition(coreId, target, fallback) {
      if (activePresented === undefined) {
        writeVector2(target, fallback);
      } else {
        activePresented.vector2Into(coreKey(coreId), target, fallback);
      }
    }
  };

  function prepareFrame(
    snapshot: RealtimeArenaSnapshot,
    deltaMs: number,
    frameOptions: RealtimeArenaPresentationFrameOptions
  ): void {
    activeSample = playback.present(
      {
        snapshot,
        tick: snapshot.tick,
        time: snapshot.tick * REALTIME_ARENA_TICK_MS
      },
      deltaMs
    );
    activePresented = projector.present(activeSample);
    activePredictedPlayer = frameOptions.predictedPlayer;
    const previous = activeSample.previous?.snapshot;
    const next = activeSample.next?.snapshot ?? previous ?? snapshot;
    activeSnapshot =
      previous === undefined || activeSample.status === "empty"
        ? next
        : stepValue(previous, next, activeSample.alpha);
    activePlayers = next.players;
    activeCores = next.cores;
  }

  return {
    reset() {
      playback.reset();
      projector.reset();
      activeSample = undefined;
      activePresented = undefined;
      activePredictedPlayer = undefined;
      activeSnapshot = undefined;
      activePlayers = [];
      activeCores = [];
    },
    sample(snapshot, deltaMs, frameOptions = {}) {
      prepareFrame(snapshot, deltaMs, frameOptions);
      return frame;
    },
    present(snapshot, deltaMs, frameOptions = {}) {
      prepareFrame(snapshot, deltaMs, frameOptions);
      return projectRealtimeArenaSnapshot(
        requireActiveSample(activeSample),
        snapshot,
        activePresented ?? projector.present(requireActiveSample(activeSample)),
        frameOptions.predictedPlayer
      );
    },
    diagnostics() {
      return playback.diagnostics();
    }
  };
}

function requireActiveSample(
  sample: SnapshotPlaybackSample<RealtimeArenaSnapshot> | undefined
): SnapshotPlaybackSample<RealtimeArenaSnapshot> {
  if (sample === undefined) {
    throw new Error("Realtime arena presentation frame has not been sampled.");
  }
  return sample;
}

function requireActiveSnapshot(snapshot: RealtimeArenaSnapshot | undefined): RealtimeArenaSnapshot {
  if (snapshot === undefined) {
    throw new Error("Realtime arena presentation frame has no snapshot.");
  }
  return snapshot;
}

function writeVector2(target: NetworkVector2, value: NetworkVector2): void {
  target.x = value.x;
  target.y = value.y;
}

export function projectRealtimeArenaSnapshot(
  sample: SnapshotPlaybackSample<RealtimeArenaSnapshot>,
  fallback: RealtimeArenaSnapshot,
  presented: PresentedSnapshotTracks,
  predictedPlayer: RealtimeArenaPresentationFrameOptions["predictedPlayer"] | undefined
): RealtimeArenaSnapshot {
  const previous = sample.previous?.snapshot;
  const next = sample.next?.snapshot ?? previous ?? fallback;
  if (!previous || sample.status === "empty") {
    return applyPredictedPlayerOverride(cloneArenaSnapshot(next), predictedPlayer);
  }

  const discrete = stepValue(previous, next, sample.alpha);
  const players = next.players.map((player) => {
    return {
      ...player,
      spawn: { ...player.spawn },
      position:
        predictedPlayer?.playerId === player.id
          ? { ...predictedPlayer.position }
          : presented.vector2(playerKey(player.id), player.position),
      velocity:
        predictedPlayer?.playerId === player.id && predictedPlayer.velocity !== undefined
          ? { ...predictedPlayer.velocity }
          : { ...player.velocity },
      ...(player.inputState === undefined ? {} : { inputState: { ...player.inputState } })
    };
  });
  const playersById = new Map(players.map((player) => [player.id, player]));
  const cores = next.cores.map((core) => {
    const carriedByPlayer =
      core.carriedByPlayerId === undefined ? undefined : playersById.get(core.carriedByPlayerId);

    return {
      ...core,
      spawn: { ...core.spawn },
      position:
        carriedByPlayer === undefined
          ? presented.vector2(coreKey(core.id), core.position)
          : { ...carriedByPlayer.position }
    };
  });

  return {
    ...discrete,
    bounds: { ...discrete.bounds },
    rules: { ...discrete.rules },
    players,
    cores,
    relayNodes: discrete.relayNodes.map((relay) => ({
      ...relay,
      position: { ...relay.position }
    })),
    walls: discrete.walls.map((wall) => ({ ...wall })),
    score: { ...discrete.score },
    events: discrete.events.map((event) => ({ ...event })),
    ...(discrete.result === undefined
      ? {}
      : {
          result: {
            ...discrete.result,
            score: { ...discrete.result.score }
          }
        })
  };
}

function applyPredictedPlayerOverride(
  snapshot: RealtimeArenaSnapshot,
  predictedPlayer: RealtimeArenaPresentationFrameOptions["predictedPlayer"] | undefined
): RealtimeArenaSnapshot {
  if (predictedPlayer === undefined) {
    return snapshot;
  }

  const player = snapshot.players.find((candidate) => candidate.id === predictedPlayer.playerId);
  if (!player) {
    return snapshot;
  }

  player.position = { ...predictedPlayer.position };
  if (predictedPlayer.velocity !== undefined) {
    player.velocity = { ...predictedPlayer.velocity };
  }
  for (const core of snapshot.cores) {
    if (core.carriedByPlayerId === predictedPlayer.playerId) {
      core.position = { ...predictedPlayer.position };
    }
  }
  return snapshot;
}

function cloneArenaSnapshot(snapshot: RealtimeArenaSnapshot): RealtimeArenaSnapshot {
  return {
    ...snapshot,
    bounds: { ...snapshot.bounds },
    rules: { ...snapshot.rules },
    players: snapshot.players.map((player) => ({
      ...player,
      spawn: { ...player.spawn },
      position: { ...player.position },
      velocity: { ...player.velocity },
      ...(player.inputState === undefined ? {} : { inputState: { ...player.inputState } })
    })),
    cores: snapshot.cores.map((core) => ({
      ...core,
      spawn: { ...core.spawn },
      position: { ...core.position }
    })),
    relayNodes: snapshot.relayNodes.map((relay) => ({
      ...relay,
      position: { ...relay.position }
    })),
    walls: snapshot.walls.map((wall) => ({ ...wall })),
    score: { ...snapshot.score },
    events: snapshot.events.map((event) => ({ ...event })),
    ...(snapshot.result === undefined
      ? {}
      : {
          result: {
            ...snapshot.result,
            score: { ...snapshot.result.score }
          }
        })
  };
}

export function createRealtimeArenaPresentationTracks<TSnapshot>(
  readSnapshot: (snapshot: TSnapshot) => RealtimeArenaSnapshot,
  snapDistance = DEFAULT_SNAP_DISTANCE
): Array<SnapshotPresentationTrack<TSnapshot>> {
  return [
    defineSnapshotVector2Track<TSnapshot>({
      snapDistance,
      selectInto(source, writer) {
        for (const player of readSnapshot(source).players) {
          writer.add(playerKey(player.id), player.position);
        }
      }
    }),
    defineSnapshotVector2Track<TSnapshot>({
      snapDistance,
      selectInto(source, writer) {
        for (const core of readSnapshot(source).cores) {
          if (core.carriedByPlayerId === undefined) {
            writer.add(coreKey(core.id), core.position);
          }
        }
      }
    })
  ];
}

function shouldSnapPhase(
  previous: RealtimeArenaPhase | undefined,
  next: RealtimeArenaPhase
): boolean {
  if (previous === undefined || previous === next) {
    return false;
  }

  return next === "lobby" || next === "countdown" || previous === "results";
}

export function shouldResetRealtimeArenaPresentation(
  previous: RealtimeArenaSnapshot | undefined,
  next: RealtimeArenaSnapshot
): boolean {
  return (
    previous !== undefined &&
    (next.tick < previous.tick || shouldSnapPhase(previous.phase, next.phase))
  );
}

function playerKey(playerId: string): string {
  return `player:${playerId}:position`;
}

function coreKey(coreId: string): string {
  return `core:${coreId}:position`;
}
