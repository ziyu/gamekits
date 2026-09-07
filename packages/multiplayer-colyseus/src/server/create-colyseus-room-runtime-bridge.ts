import { GameError } from "@gamekits/core";
import {
  createMultiplayerRuntime,
  type MultiplayerPeer,
  type MultiplayerPeerInput
} from "@gamekits/multiplayer-core";

import {
  createRoomMultiplayerBackend,
  type RoomMultiplayerBackend
} from "./create-room-multiplayer-backend";
import type {
  ColyseusRoomOwnedRuntime,
  ColyseusRoomRuntimeBridge,
  ColyseusRoomRuntimeBridgeDiagnostic,
  ColyseusRoomRuntimeBridgePhase,
  ColyseusRoomRuntimeClient,
  ColyseusRoomRuntimeHost,
  CreateColyseusRoomRuntimeBridgeOptions
} from "./room-runtime-types";

const DEFAULT_FIXED_STEP_MS = 1000 / 60;
const DEFAULT_MAX_PAYLOAD_BYTES = 32 * 1024;

export const colyseusRoomRuntimeBridgeErrorCodes = {
  invalidConfiguration: "COLYSEUS_ROOM_RUNTIME_INVALID_CONFIGURATION",
  invalidLifecycle: "COLYSEUS_ROOM_RUNTIME_INVALID_LIFECYCLE",
  invalidPeer: "COLYSEUS_ROOM_RUNTIME_INVALID_PEER",
  runtimeFailure: "COLYSEUS_ROOM_RUNTIME_FAILURE"
} as const;

export type ColyseusRoomRuntimeBridgeErrorCode =
  (typeof colyseusRoomRuntimeBridgeErrorCodes)[keyof typeof colyseusRoomRuntimeBridgeErrorCodes];

export function createColyseusRoomRuntimeBridge<
  TRoom extends ColyseusRoomRuntimeHost,
  TClient extends ColyseusRoomRuntimeClient,
  TCreateOptions,
  TRuntimeSnapshot = unknown,
  TRuntime extends ColyseusRoomOwnedRuntime<TRuntimeSnapshot> =
    ColyseusRoomOwnedRuntime<TRuntimeSnapshot>
>(
  options: CreateColyseusRoomRuntimeBridgeOptions<TRoom, TCreateOptions, TRuntime, TRuntimeSnapshot>
): ColyseusRoomRuntimeBridge<TRoom, TClient, TCreateOptions, TRuntimeSnapshot> {
  const id = options.id ?? "colyseus.room-runtime";
  const fixedStepMs = positiveFinite(options.fixedStepMs ?? DEFAULT_FIXED_STEP_MS, "fixedStepMs");
  const maxPayloadBytes = positiveInteger(
    options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    "maxPayloadBytes"
  );
  const clock = options.clock ?? (() => Date.now());
  let room: TRoom | undefined;
  let runtime: TRuntime | undefined;
  let lastRuntimeSnapshot: TRuntimeSnapshot | undefined;
  let phase: ColyseusRoomRuntimeBridgePhase = "idle";
  let roomId: string | undefined;
  let sessionId: string | undefined;
  let ticks = 0;
  let elapsedMs = 0;
  let lastDiagnostic: ColyseusRoomRuntimeBridgeDiagnostic | undefined;

  function report(diagnostic: ColyseusRoomRuntimeBridgeDiagnostic): void {
    lastDiagnostic = diagnostic;
    try {
      options.onDiagnostic?.(diagnostic);
    } catch {
      // Diagnostics are observational and must not change Room gameplay lifecycle.
    }
  }

  const roomMultiplayer: RoomMultiplayerBackend<TRoom, TClient> = createRoomMultiplayerBackend({
    id,
    messageType: options.messageType ?? "gamekits.message",
    presenceType: options.presenceType ?? "gamekits.presence",
    maxPayloadBytes,
    clock,
    invalidPeer(message, details) {
      return new GameError(colyseusRoomRuntimeBridgeErrorCodes.invalidPeer, message, details);
    },
    onMessageRejected(code, message) {
      report({
        kind: "message-rejected",
        phase,
        operation: "message",
        code,
        message
      });
    }
  });
  const multiplayer = createMultiplayerRuntime({
    id: `${id}.multiplayer`,
    backend: roomMultiplayer.adapter,
    clock
  });

  function tick(deltaMs: number): void {
    if (phase !== "running" || !runtime) {
      return;
    }
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      report({
        kind: "lifecycle-failed",
        phase,
        operation: "tick",
        code: colyseusRoomRuntimeBridgeErrorCodes.invalidConfiguration,
        message: `Ignored invalid Colyseus simulation delta: ${deltaMs}`
      });
      return;
    }

    ticks += 1;
    elapsedMs += deltaMs;
    try {
      runtime.tick({ tick: ticks, deltaMs, elapsedMs });
    } catch (error) {
      phase = "failed";
      roomMultiplayer.closeSession();
      room?.setSimulationInterval(undefined);
      report({
        kind: "lifecycle-failed",
        phase,
        operation: "tick",
        code: colyseusRoomRuntimeBridgeErrorCodes.runtimeFailure,
        message: errorMessage(error)
      });
      throw error;
    }
  }

  async function stopRuntime(): Promise<void> {
    if (phase === "stopped" || phase === "idle" || phase === "disposed") {
      return;
    }
    phase = "stopping";
    room?.setSimulationInterval(undefined);
    try {
      await runtime?.stop?.();
      phase = "stopped";
      roomMultiplayer.closeSession();
    } catch (error) {
      phase = "failed";
      roomMultiplayer.closeSession();
      report({
        kind: "lifecycle-failed",
        phase,
        operation: "stop",
        code: colyseusRoomRuntimeBridgeErrorCodes.runtimeFailure,
        message: errorMessage(error)
      });
      throw error;
    }
  }

  return {
    multiplayer,
    async create(activeRoom, createOptions) {
      if (phase !== "idle") {
        throw lifecycleError("create", phase);
      }

      phase = "creating";
      room = activeRoom;
      roomId = activeRoom.roomId;

      try {
        const resolvedSessionId =
          options.resolveSessionId?.(activeRoom, createOptions) ?? activeRoom.roomId;
        if (resolvedSessionId.length === 0) {
          throw configurationError("sessionId must not be empty.", { bridgeId: id });
        }
        sessionId = resolvedSessionId;
        const serverPeer = toServerPeer(options.serverPeer, resolvedSessionId);
        roomMultiplayer.attach({
          room: activeRoom,
          sessionId: resolvedSessionId,
          sessionKind: options.sessionKind ?? "private",
          serverPeer
        });
        await multiplayer.joinSession({
          sessionId: resolvedSessionId,
          localPeer: toPeerInput(serverPeer)
        });
        runtime = await options.createRuntime({
          room: activeRoom,
          roomId,
          sessionId: resolvedSessionId,
          options: createOptions,
          multiplayer
        });
        await runtime.boot?.();
        await runtime.start?.();
        phase = "running";
        activeRoom.setSimulationInterval(tick, fixedStepMs);
      } catch (error) {
        phase = "failed";
        roomMultiplayer.closeSession();
        report({
          kind: "lifecycle-failed",
          phase,
          operation: "create",
          code: colyseusRoomRuntimeBridgeErrorCodes.runtimeFailure,
          message: errorMessage(error)
        });
        await cleanupFailedRuntime(runtime);
        runtime = undefined;
        await multiplayer.dispose();
        roomMultiplayer.clear();
        throw error;
      }
    },
    join(client, peerInput) {
      assertRunning("join");
      roomMultiplayer.join(client, toClientPeer(peerInput));
    },
    leave(client, code) {
      if (phase === "disposed") {
        return;
      }
      roomMultiplayer.leave(client, code);
    },
    receive(client, message) {
      return roomMultiplayer.receive(client, message);
    },
    stop: stopRuntime,
    async dispose() {
      if (phase === "disposed") {
        return;
      }

      let firstError: unknown;
      try {
        await stopRuntime();
      } catch (error) {
        firstError = error;
      }

      try {
        await runtime?.dispose();
      } catch (error) {
        firstError ??= error;
        report({
          kind: "lifecycle-failed",
          phase,
          operation: "dispose",
          code: colyseusRoomRuntimeBridgeErrorCodes.runtimeFailure,
          message: errorMessage(error)
        });
      }

      lastRuntimeSnapshot = captureRuntimeSnapshot(runtime, phase, report);
      runtime = undefined;
      await multiplayer.dispose();
      roomMultiplayer.clear();
      room = undefined;
      phase = "disposed";

      if (firstError !== undefined) {
        throw firstError;
      }
    },
    snapshot() {
      return {
        id,
        phase,
        ...(roomId === undefined ? {} : { roomId }),
        ...(sessionId === undefined ? {} : { sessionId }),
        fixedStepMs,
        ticks,
        elapsedMs,
        ...roomMultiplayer.snapshot(),
        ...runtimeSnapshot(runtime, lastRuntimeSnapshot, phase, report),
        ...(lastDiagnostic === undefined ? {} : { lastDiagnostic: { ...lastDiagnostic } })
      };
    }
  };

  function assertRunning(operation: "join"): void {
    if (phase !== "running") {
      throw lifecycleError(operation, phase);
    }
  }
}

function toServerPeer(input: MultiplayerPeerInput | undefined, sessionId: string): MultiplayerPeer {
  const peerId = input?.id ?? `${sessionId}.server`;
  if (peerId.length === 0) {
    throw new GameError(
      colyseusRoomRuntimeBridgeErrorCodes.invalidPeer,
      "Colyseus Room runtime bridge requires a stable server peer id."
    );
  }
  return {
    id: peerId,
    ...(input?.displayName === undefined ? {} : { displayName: input.displayName }),
    role: input?.role ?? "server",
    status: "connected",
    ...(input?.playerId === undefined ? {} : { playerId: input.playerId }),
    ...(input?.metadata ? { metadata: { ...input.metadata } } : {})
  };
}

function toClientPeer(input: MultiplayerPeerInput): MultiplayerPeer {
  if (!input.id) {
    throw new GameError(
      colyseusRoomRuntimeBridgeErrorCodes.invalidPeer,
      "Colyseus Room runtime bridge requires a stable peer id."
    );
  }
  return {
    id: input.id,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    role: input.role ?? "client",
    status: "connected",
    ...(input.playerId === undefined ? {} : { playerId: input.playerId }),
    ...(input.metadata ? { metadata: { ...input.metadata } } : {})
  };
}

function toPeerInput(peer: MultiplayerPeer): MultiplayerPeerInput {
  return {
    id: peer.id,
    ...(peer.displayName === undefined ? {} : { displayName: peer.displayName }),
    ...(peer.role === undefined ? {} : { role: peer.role }),
    ...(peer.playerId === undefined ? {} : { playerId: peer.playerId }),
    ...(peer.metadata ? { metadata: { ...peer.metadata } } : {})
  };
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw configurationError(`${name} must be a positive finite number.`, { [name]: value });
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw configurationError(`${name} must be a positive safe integer.`, { [name]: value });
  }
  return value;
}

function configurationError(message: string, details?: unknown): GameError {
  return new GameError(colyseusRoomRuntimeBridgeErrorCodes.invalidConfiguration, message, details);
}

function lifecycleError(operation: string, phase: ColyseusRoomRuntimeBridgePhase): GameError {
  return new GameError(
    colyseusRoomRuntimeBridgeErrorCodes.invalidLifecycle,
    `Cannot ${operation} Colyseus Room runtime bridge while phase is ${phase}.`,
    { operation, phase }
  );
}

async function cleanupFailedRuntime(runtime: ColyseusRoomOwnedRuntime | undefined): Promise<void> {
  if (!runtime) {
    return;
  }
  try {
    await runtime.stop?.();
  } catch {
    // Preserve the original creation failure.
  }
  try {
    await runtime.dispose();
  } catch {
    // Preserve the original creation failure.
  }
}

function captureRuntimeSnapshot<TSnapshot>(
  runtime: ColyseusRoomOwnedRuntime<TSnapshot> | undefined,
  phase: ColyseusRoomRuntimeBridgePhase,
  report: (diagnostic: ColyseusRoomRuntimeBridgeDiagnostic) => void
): TSnapshot | undefined {
  if (!runtime?.snapshot) {
    return undefined;
  }
  try {
    return runtime.snapshot();
  } catch (error) {
    report({
      kind: "lifecycle-failed",
      phase,
      operation: "snapshot",
      code: colyseusRoomRuntimeBridgeErrorCodes.runtimeFailure,
      message: errorMessage(error)
    });
    return undefined;
  }
}

function runtimeSnapshot<TSnapshot>(
  runtime: ColyseusRoomOwnedRuntime<TSnapshot> | undefined,
  retained: TSnapshot | undefined,
  phase: ColyseusRoomRuntimeBridgePhase,
  report: (diagnostic: ColyseusRoomRuntimeBridgeDiagnostic) => void
): { runtime: TSnapshot } | Record<string, never> {
  if (runtime?.snapshot) {
    const snapshot = captureRuntimeSnapshot(runtime, phase, report);
    return snapshot === undefined ? {} : { runtime: snapshot };
  }
  return retained === undefined ? {} : { runtime: retained };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
