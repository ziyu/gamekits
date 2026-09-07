import {
  createMultiplayerClientReplication,
  defineMultiplayerReplicationSchema,
  definePredictionStatePresentation,
  definePredictionVector2StateField,
  type MultiplayerAuthorityBindingStore,
  type MultiplayerClientReplicationDiagnostics,
  type MultiplayerClientReplicationRuntime,
  type MultiplayerClientReplicationSnapshotSource,
  type MultiplayerOutgoingMessage,
  type MultiplayerRuntime,
  type SnapshotPlaybackDiagnostics,
  type SnapshotPlaybackSample
} from "@gamekits/multiplayer-core";
import { REALTIME_ARENA_TICK_MS } from "./config";
import { REALTIME_ARENA_SCHEMA_VERSION } from "./authority-path";
import type { RealtimeArenaSnapshot, RealtimeInputFrame } from "./domain";
import {
  createRealtimeArenaPresentationTracks,
  projectRealtimeArenaSnapshot,
  shouldResetRealtimeArenaPresentation
} from "./presentation";
import {
  applyRealtimeArenaPredictionInput,
  calculateRealtimeArenaInputLead,
  cloneRealtimeArenaPredictedPlayer,
  emptyRealtimeArenaPredictionDiagnostics,
  readRealtimeArenaPredictedPlayer,
  readRealtimeArenaPredictionContext,
  type RealtimeArenaPredictedPlayer,
  type RealtimeArenaPredictionDiagnostics
} from "./prediction";
import {
  readRealtimeArenaInputPayload,
  readRealtimeArenaSnapshotPayload,
  REALTIME_ARENA_CHANNEL,
  REALTIME_ARENA_INPUT_KIND,
  REALTIME_ARENA_SNAPSHOT_KIND,
  type RealtimeArenaSnapshotPayload
} from "./protocol";

export type RealtimeArenaClientReplicationOptions = {
  runtime: MultiplayerRuntime;
  authority: MultiplayerAuthorityBindingStore;
  peerId: string;
  snapshotSource?: MultiplayerClientReplicationSnapshotSource | undefined;
  readInput(elapsed: number): RealtimeInputFrame | undefined;
  sendInput(frame: RealtimeInputFrame): Promise<void>;
  wallClock?: (() => number) | undefined;
  onSendError?: ((error: unknown) => void) | undefined;
};

export type RealtimeArenaClientReplicationDiagnostics = {
  replication: MultiplayerClientReplicationDiagnostics;
  presentation: SnapshotPlaybackDiagnostics;
  prediction: RealtimeArenaPredictionDiagnostics;
};

export type RealtimeArenaClientReplication = {
  update(frame: { delta: number; elapsed: number }): void;
  authoritativePayload(): RealtimeArenaSnapshotPayload | undefined;
  presentedSnapshot(): RealtimeArenaSnapshot | undefined;
  diagnostics(): RealtimeArenaClientReplicationDiagnostics;
  dispose(): void;
};

type PredictionContext = ReturnType<typeof readRealtimeArenaPredictionContext>;

const INTERPOLATION_DELAY_MS = 50;
const MAX_INTERPOLATION_DELAY_MS = 150;
const CORRECTION_SMOOTHING_MS = 100;
const MAX_SMOOTHED_CORRECTION_DISTANCE = 48;

/** App-level declaration for the standard managed replication runtime. */
export function createRealtimeArenaClientReplication(
  options: RealtimeArenaClientReplicationOptions
): RealtimeArenaClientReplication {
  const wallClock = options.wallClock ?? (() => Date.now());
  const deliveryRuntime = createRealtimeInputDeliveryRuntime(options.runtime, options.sendInput);
  const predictedPosition = definePredictionVector2StateField<RealtimeArenaPredictedPlayer>({
    readX: (state) => state.position.x,
    readY: (state) => state.position.y,
    write(state, x, y) {
      state.position.x = x;
      state.position.y = y;
    }
  });
  let predictionContext: PredictionContext | undefined;
  let latestAuthoritativePayload: RealtimeArenaSnapshotPayload | undefined;
  let latestPresentedSnapshot: RealtimeArenaSnapshot | undefined;
  let lastFrameElapsed = 0;
  let latestInputAckSequence: number | undefined;
  let latestRoundTripTimeMs: number | undefined;
  let latestSnapshotAgeMs: number | undefined;
  const inputTimesBySequence = new Map<number, number>();
  const replicationSchema = defineMultiplayerReplicationSchema<
    RealtimeArenaSnapshotPayload,
    string,
    RealtimeArenaPredictedPlayer
  >({
    id: "realtime-arena.snapshot",
    version: REALTIME_ARENA_SCHEMA_VERSION,
    decode: readRealtimeArenaSnapshotPayload,
    tick: (payload) => payload.snapshot.tick,
    time: (payload) => payload.snapshot.tick * REALTIME_ARENA_TICK_MS,
    serverTime: (payload) => payload.serverTime,
    local: {
      select(payload, peerId) {
        const playerId = payload.playersByPeerId[peerId];
        return playerId === undefined
          ? undefined
          : readRealtimeArenaPredictedPlayer(payload.snapshot, playerId);
      },
      acknowledgedSequence: readAcknowledgedSequence
    }
  }).bindClient<RealtimeArenaPredictedPlayer, undefined>({
    identity: () => options.peerId,
    state(player, context) {
      predictionContext = readRealtimeArenaPredictionContext(context.snapshot.snapshot);
      return player;
    }
  });
  const replication: MultiplayerClientReplicationRuntime<
    RealtimeArenaSnapshotPayload,
    RealtimeArenaPredictedPlayer
  > = createMultiplayerClientReplication<
    RealtimeArenaSnapshotPayload,
    RealtimeInputFrame,
    RealtimeArenaPredictedPlayer,
    undefined
  >({
    runtime: deliveryRuntime,
    installContext: undefined,
    options: {
      id: "multiplayer-demo.client.replication",
      schema: replicationSchema,
      snapshotKind: REALTIME_ARENA_SNAPSHOT_KIND,
      ...(options.snapshotSource === undefined ? {} : { snapshotSource: options.snapshotSource }),
      authority: { binding: options.authority },
      playback: {
        interpolationDelayMs: INTERPOLATION_DELAY_MS,
        adaptiveDelay: {
          minDelayMs: INTERPOLATION_DELAY_MS,
          maxDelayMs: MAX_INTERPOLATION_DELAY_MS,
          jitterMultiplier: 2
        },
        maxSnapshots: 24,
        timeSource: "tick",
        readTime(entry) {
          return entry.snapshot.snapshot.tick * REALTIME_ARENA_TICK_MS;
        },
        shouldReset(previous, next) {
          return shouldResetRealtimeArenaPresentation(previous?.snapshot, next.snapshot);
        }
      },
      tracks: createRealtimeArenaPresentationTracks(
        (payload: RealtimeArenaSnapshotPayload) => payload.snapshot
      ),
      applyAuthoritative({ snapshot }) {
        latestAuthoritativePayload = snapshot;
        const acknowledgedSequence = readAcknowledgedSequence(snapshot, options.peerId);
        latestInputAckSequence = acknowledgedSequence;
        latestSnapshotAgeMs = Math.max(0, wallClock() - snapshot.serverTime);
        latestRoundTripTimeMs = readRoundTripTime(
          inputTimesBySequence,
          acknowledgedSequence,
          lastFrameElapsed
        );
        deleteAcknowledgedInputs(inputTimesBySequence, acknowledgedSequence);
      },
      prediction: {
        inputKind: REALTIME_ARENA_INPUT_KIND,
        inputChannel: REALTIME_ARENA_CHANNEL,
        inputRateHz: 1000 / REALTIME_ARENA_TICK_MS,
        maxCatchUpSteps: 2,
        maxInFlightSends: 4,
        maxPredictionLeadInputs: 8,
        buffer: {
          cloneState: cloneRealtimeArenaPredictedPlayer,
          applyInput(state, input) {
            return applyRealtimeArenaPredictionInput(state, input, predictionContext);
          },
          presentation: definePredictionStatePresentation({
            fields: [predictedPosition],
            correction: {
              measure: predictedPosition,
              smooth: [predictedPosition],
              durationMs: CORRECTION_SMOOTHING_MS,
              maxMagnitude: MAX_SMOOTHED_CORRECTION_DISTANCE
            }
          }),
          predictionStepMs: REALTIME_ARENA_TICK_MS,
          maxInputs: 240
        },
        readInput({ frame }) {
          return options.readInput(frame.elapsed ?? lastFrameElapsed);
        },
        encodeInput({ input, predictionFrame }) {
          const frame: RealtimeInputFrame = {
            ...input,
            sequence: predictionFrame.sequence,
            clientTime: predictionFrame.timestamp ?? input.clientTime
          };
          inputTimesBySequence.set(frame.sequence, frame.clientTime);
          return { frame };
        },
        active({ snapshot }) {
          return snapshot.snapshot.phase === "running";
        },
        ...(options.onSendError === undefined ? {} : { onSendError: options.onSendError })
      },
      applyFrame({ snapshot, sample, presented, predictedState }) {
        latestPresentedSnapshot = projectRealtimeArenaSnapshot(
          toArenaPlaybackSample(sample),
          snapshot.snapshot,
          presented,
          predictedState === undefined
            ? undefined
            : {
                playerId: predictedState.playerId,
                position: predictedState.position,
                velocity: predictedState.velocity
              }
        );
      }
    }
  });

  return {
    update(frame) {
      lastFrameElapsed = frame.elapsed;
      replication.update(frame);
    },
    authoritativePayload() {
      return latestAuthoritativePayload;
    },
    presentedSnapshot() {
      return latestPresentedSnapshot;
    },
    diagnostics() {
      const snapshot = replication.diagnostics();
      const corePrediction = snapshot.prediction ?? emptyRealtimeArenaPredictionDiagnostics();
      const inputLead = calculateRealtimeArenaInputLead(corePrediction);
      return {
        replication: snapshot,
        presentation: snapshot.playback,
        prediction: {
          ...corePrediction,
          ...(latestInputAckSequence === undefined
            ? {}
            : { inputAckSequence: latestInputAckSequence }),
          ...(latestRoundTripTimeMs === undefined
            ? {}
            : { roundTripTimeMs: latestRoundTripTimeMs }),
          ...(latestSnapshotAgeMs === undefined ? {} : { snapshotAgeMs: latestSnapshotAgeMs }),
          ...(inputLead === undefined ? {} : { inputLead })
        }
      };
    },
    dispose() {
      replication.dispose();
      latestAuthoritativePayload = undefined;
      latestPresentedSnapshot = undefined;
      predictionContext = undefined;
      inputTimesBySequence.clear();
    }
  };
}

function createRealtimeInputDeliveryRuntime(
  runtime: MultiplayerRuntime,
  sendInput: (frame: RealtimeInputFrame) => Promise<void>
): MultiplayerRuntime {
  return {
    ...runtime,
    async send<TPayload = unknown>(message: MultiplayerOutgoingMessage<TPayload>): Promise<void> {
      if (message.kind === REALTIME_ARENA_INPUT_KIND) {
        const payload = readRealtimeArenaInputPayload(message.payload);
        if (payload === undefined) {
          throw new Error("Managed realtime input payload is invalid.");
        }
        await sendInput(payload.frame);
        return;
      }
      await runtime.send(message);
    }
  };
}

function toArenaPlaybackSample(
  sample: SnapshotPlaybackSample<RealtimeArenaSnapshotPayload>
): SnapshotPlaybackSample<RealtimeArenaSnapshot> {
  const { previous, next, ...rest } = sample;
  return {
    ...rest,
    ...(previous === undefined
      ? {}
      : { previous: { ...previous, snapshot: previous.snapshot.snapshot } }),
    ...(next === undefined ? {} : { next: { ...next, snapshot: next.snapshot.snapshot } })
  };
}

function readAcknowledgedSequence(
  payload: RealtimeArenaSnapshotPayload,
  peerId: string
): number | undefined {
  const playerId = payload.playersByPeerId[peerId];
  return (
    payload.inputAcksByPeerId[peerId] ??
    payload.snapshot.players.find((player) => player.id === playerId)?.lastInputSequence
  );
}

function readRoundTripTime(
  inputTimesBySequence: ReadonlyMap<number, number>,
  acknowledgedSequence: number | undefined,
  frameTime: number
): number | undefined {
  if (acknowledgedSequence === undefined) {
    return undefined;
  }
  let inputTime = inputTimesBySequence.get(acknowledgedSequence);
  if (inputTime === undefined) {
    for (const [sequence, timestamp] of inputTimesBySequence) {
      if (sequence <= acknowledgedSequence) {
        inputTime = timestamp;
      }
    }
  }
  return inputTime === undefined ? undefined : Math.max(0, frameTime - inputTime);
}

function deleteAcknowledgedInputs(
  inputTimesBySequence: Map<number, number>,
  acknowledgedSequence: number | undefined
): void {
  if (acknowledgedSequence === undefined) {
    return;
  }
  for (const sequence of inputTimesBySequence.keys()) {
    if (sequence <= acknowledgedSequence) {
      inputTimesBySequence.delete(sequence);
    }
  }
}
