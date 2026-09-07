import type {
  MultiplayerAuthorityBinding,
  MultiplayerAuthorityBindingStore,
  MultiplayerAuthorityDecision
} from "@gamekits/multiplayer-core";

export const GAMEKITS_COLYSEUS_NATIVE_STATE_MESSAGE = "gamekits.native-state";

export type ColyseusAuthorityPath = "gamekits-envelope" | "colyseus-schema" | "provider-native";

export type ColyseusNativeStateSyncCapability = {
  available: boolean;
  active: boolean;
  lane: Exclude<ColyseusAuthorityPath, "gamekits-envelope">;
  schemaVersion?: string;
};

export type ColyseusNativeReconnectCapability = {
  available: boolean;
  mode?: string;
};

export type ColyseusNativeMatchmakingCapability = {
  available: boolean;
  queue?: string;
};

export type ColyseusNativeCapabilitySummary = {
  lanes: ColyseusAuthorityPath[];
  authoritativePath: ColyseusAuthorityPath;
  stateSync: ColyseusNativeStateSyncCapability;
  reconnect: ColyseusNativeReconnectCapability;
  matchmaking: ColyseusNativeMatchmakingCapability;
  roomMetadata?: Record<string, unknown>;
};

export type ColyseusNativeCapabilityInput = {
  lanes?: ColyseusAuthorityPath[];
  authoritativePath?: ColyseusAuthorityPath;
  stateSync?: {
    available?: boolean;
    lane?: Exclude<ColyseusAuthorityPath, "gamekits-envelope">;
    schemaVersion?: string;
  };
  reconnect?: boolean | ColyseusNativeReconnectCapability;
  matchmaking?: boolean | ColyseusNativeMatchmakingCapability;
  roomMetadata?: Record<string, unknown>;
};

export type ColyseusNativeStateUpdate<TState = unknown> = {
  sessionId: string;
  state: TState;
  sourcePeerId?: string;
  sourceEndpointId?: string;
  tick?: number;
  stateVersion?: number;
  version?: string;
  timestamp?: number;
  stateBytes?: number;
};

export type ColyseusNativeStateListener = (update: ColyseusNativeStateUpdate<unknown>) => void;

export type ColyseusNativeStateApplyContext = {
  binding: MultiplayerAuthorityBinding;
  authoritativePath: ColyseusAuthorityPath;
  sourceEndpointId: string;
  sourcePeerId?: string;
  tick?: number;
  stateVersion?: number;
  version?: string;
  stateBytes?: number;
  ageMs?: number;
};

export type ColyseusNativeStateRejectedPayload = {
  code: string;
  reason: string;
  sessionId?: string;
  sourcePeerId?: string;
  sourceEndpointId?: string;
};

export type ColyseusNativeStateBridgeDiagnostics = {
  authoritativePath: ColyseusAuthorityPath;
  sourceEndpointId: string;
  receivedUpdates: number;
  appliedUpdates: number;
  rejectedUpdates: number;
  resyncs: number;
  lastAppliedTick?: number;
  lastStateVersion?: number;
  lastVersion?: string;
  lastStateBytes?: number;
  lastStateAgeMs?: number;
  lastResyncReason?: string;
  lastRejected?: ColyseusNativeStateRejectedPayload;
};

export type ColyseusNativeStateBridgeOptions<TProviderState, TViewState = TProviderState> = {
  binding: MultiplayerAuthorityBindingStore;
  authoritativePath?: ColyseusAuthorityPath;
  sourceEndpointId?: string;
  maxStateBytes?: number;
  clock?: () => number;
  readState?(
    state: unknown,
    update: ColyseusNativeStateUpdate<unknown>
  ): TProviderState | undefined;
  mapState?(state: TProviderState, ctx: ColyseusNativeStateApplyContext): TViewState;
  applyState(state: TViewState, ctx: ColyseusNativeStateApplyContext): void;
  measureStateBytes?(state: TProviderState): number;
  onRejected?(rejection: ColyseusNativeStateRejectedPayload): void;
};

export type ColyseusNativeStateBridge = {
  receiveState(update: ColyseusNativeStateUpdate<unknown>): MultiplayerAuthorityDecision;
  resync(reason: string): void;
  diagnostics(): ColyseusNativeStateBridgeDiagnostics;
};

export function createColyseusNativeCapabilitySummary(
  input: ColyseusNativeCapabilityInput = {}
): ColyseusNativeCapabilitySummary {
  const authoritativePath = input.authoritativePath ?? "gamekits-envelope";
  const stateSyncLane = input.stateSync?.lane ?? "colyseus-schema";
  const lanes = normalizeLanes(input.lanes, authoritativePath, stateSyncLane);
  const stateSyncAvailable =
    input.stateSync?.available ?? lanes.some((lane) => lane === stateSyncLane);

  return {
    lanes,
    authoritativePath,
    stateSync: {
      available: stateSyncAvailable,
      active: authoritativePath === stateSyncLane,
      lane: stateSyncLane,
      ...(input.stateSync?.schemaVersion === undefined
        ? {}
        : { schemaVersion: input.stateSync.schemaVersion })
    },
    reconnect: normalizeBooleanCapability(input.reconnect),
    matchmaking: normalizeBooleanCapability(input.matchmaking),
    ...(input.roomMetadata === undefined ? {} : { roomMetadata: { ...input.roomMetadata } })
  };
}

export function cloneColyseusNativeCapabilitySummary(
  summary: ColyseusNativeCapabilitySummary
): ColyseusNativeCapabilitySummary {
  return {
    lanes: [...summary.lanes],
    authoritativePath: summary.authoritativePath,
    stateSync: { ...summary.stateSync },
    reconnect: { ...summary.reconnect },
    matchmaking: { ...summary.matchmaking },
    ...(summary.roomMetadata === undefined ? {} : { roomMetadata: { ...summary.roomMetadata } })
  };
}

export function createColyseusNativeStateBridge<TProviderState, TViewState = TProviderState>(
  options: ColyseusNativeStateBridgeOptions<TProviderState, TViewState>
): ColyseusNativeStateBridge {
  const authoritativePath = options.authoritativePath ?? "colyseus-schema";
  const sourceEndpointId = options.sourceEndpointId ?? authoritativePath;
  const maxStateBytes = options.maxStateBytes ?? Number.POSITIVE_INFINITY;
  const clock = options.clock ?? (() => Date.now());
  const diagnostics: ColyseusNativeStateBridgeDiagnostics = {
    authoritativePath,
    sourceEndpointId,
    receivedUpdates: 0,
    appliedUpdates: 0,
    rejectedUpdates: 0,
    resyncs: 0
  };

  function receiveState(update: ColyseusNativeStateUpdate<unknown>): MultiplayerAuthorityDecision {
    diagnostics.receivedUpdates += 1;
    const binding = options.binding.current();
    const updateSourceEndpointId = update.sourceEndpointId ?? sourceEndpointId;
    const sourceDecision = acceptsNativeStateUpdate(binding, update, updateSourceEndpointId);
    if (!sourceDecision.allowed) {
      reject(update, sourceDecision.code, sourceDecision.reason);
      return sourceDecision;
    }
    const staleStateVersion =
      update.stateVersion !== undefined &&
      diagnostics.lastStateVersion !== undefined &&
      update.stateVersion <= diagnostics.lastStateVersion;
    const staleTickWithoutStateVersion =
      update.stateVersion === undefined &&
      update.tick !== undefined &&
      diagnostics.lastAppliedTick !== undefined &&
      update.tick <= diagnostics.lastAppliedTick;
    if (binding.status !== "resyncing" && (staleStateVersion || staleTickWithoutStateVersion)) {
      const duplicate =
        update.stateVersion !== undefined
          ? update.stateVersion === diagnostics.lastStateVersion
          : update.tick === diagnostics.lastAppliedTick;
      const decision = deny(
        duplicate ? "duplicate-native-state" : "stale-native-state",
        "Colyseus native state version must advance monotonically."
      );
      reject(update, decision.code, decision.reason);
      return decision;
    }

    const state = options.readState
      ? options.readState(update.state, update)
      : (update.state as TProviderState);
    if (state === undefined) {
      const decision = deny("invalid-native-state", "Colyseus native state could not be decoded.");
      reject(update, decision.code, decision.reason);
      return decision;
    }

    const stateBytes = update.stateBytes ?? measureStateBytes(state, options.measureStateBytes);
    if (!Number.isSafeInteger(stateBytes) || stateBytes < 0) {
      const decision = deny(
        "invalid-native-state-size",
        "Colyseus native state byte size must be a non-negative safe integer."
      );
      reject(update, decision.code, decision.reason);
      return decision;
    }
    if (stateBytes > maxStateBytes) {
      const decision = deny(
        "native-state-too-large",
        `Colyseus native state exceeds max bytes: ${maxStateBytes}.`
      );
      reject(update, decision.code, decision.reason);
      return decision;
    }

    const ageMs =
      update.timestamp === undefined ? undefined : Math.max(0, clock() - update.timestamp);
    const applyContext = createApplyContext(
      binding,
      update,
      authoritativePath,
      updateSourceEndpointId,
      {
        stateBytes,
        ...(ageMs === undefined ? {} : { ageMs })
      }
    );
    const viewState = options.mapState ? options.mapState(state, applyContext) : state;
    options.applyState(viewState as TViewState, applyContext);
    diagnostics.appliedUpdates += 1;
    diagnostics.lastStateBytes = stateBytes;
    if (ageMs === undefined) {
      delete diagnostics.lastStateAgeMs;
    } else {
      diagnostics.lastStateAgeMs = ageMs;
    }
    if (update.tick === undefined) {
      delete diagnostics.lastAppliedTick;
    } else {
      diagnostics.lastAppliedTick = update.tick;
    }
    if (update.stateVersion === undefined) {
      delete diagnostics.lastStateVersion;
    } else {
      diagnostics.lastStateVersion = update.stateVersion;
    }
    if (update.version === undefined) {
      delete diagnostics.lastVersion;
    } else {
      diagnostics.lastVersion = update.version;
    }

    options.binding.update({
      ...(binding.status === "resyncing" ? { status: "bound" as const } : {}),
      ...(update.tick === undefined ? {} : { tick: update.tick }),
      ...(update.version === undefined ? {} : { snapshotVersion: update.version })
    });
    return { allowed: true };
  }

  function reject(update: ColyseusNativeStateUpdate<unknown>, code: string, reason: string): void {
    const rejection = {
      code,
      reason,
      sessionId: update.sessionId,
      ...(update.sourcePeerId === undefined ? {} : { sourcePeerId: update.sourcePeerId }),
      sourceEndpointId: update.sourceEndpointId ?? sourceEndpointId
    };
    diagnostics.rejectedUpdates += 1;
    diagnostics.lastRejected = rejection;
    options.onRejected?.(rejection);
  }

  return {
    receiveState,
    resync(reason) {
      diagnostics.resyncs += 1;
      diagnostics.lastResyncReason = reason;
      options.binding.update({ status: "resyncing", reason });
    },
    diagnostics() {
      return cloneDiagnostics(diagnostics);
    }
  };
}

function acceptsNativeStateUpdate(
  binding: MultiplayerAuthorityBinding,
  update: ColyseusNativeStateUpdate<unknown>,
  sourceEndpointId: string
): MultiplayerAuthorityDecision {
  if (binding.status !== "bound" && binding.status !== "resyncing") {
    return deny("authority-not-bound", `Authority binding is not ready: ${binding.status}.`);
  }

  if (update.sessionId !== binding.sessionId) {
    return deny("session-mismatch", `Colyseus native state session mismatch: ${update.sessionId}.`);
  }

  if (
    (update.tick !== undefined && (!Number.isSafeInteger(update.tick) || update.tick < 0)) ||
    (update.stateVersion !== undefined &&
      (!Number.isSafeInteger(update.stateVersion) || update.stateVersion < 1)) ||
    (update.timestamp !== undefined && (!Number.isFinite(update.timestamp) || update.timestamp < 0))
  ) {
    return deny("invalid-native-state-metadata", "Colyseus native state metadata is invalid.");
  }

  if (binding.snapshotVersion !== undefined && update.version !== binding.snapshotVersion) {
    return deny(
      "snapshot-version-mismatch",
      `Colyseus native state schema mismatch: ${update.version ?? "missing"}.`
    );
  }

  if (binding.authorityEndpoint?.id && binding.authorityEndpoint.id !== sourceEndpointId) {
    return deny(
      "authority-endpoint-mismatch",
      `Rejected Colyseus native state endpoint: ${sourceEndpointId}.`
    );
  }

  if (binding.authorityPeerId && update.sourcePeerId !== binding.authorityPeerId) {
    return deny(
      "non-authority-source",
      `Rejected non-authority Colyseus native state source: ${update.sourcePeerId}.`
    );
  }

  if (
    binding.authorityEndpoint?.peerId &&
    update.sourcePeerId !== binding.authorityEndpoint.peerId
  ) {
    return deny(
      "non-authority-source",
      `Rejected non-authority Colyseus native state source: ${update.sourcePeerId}.`
    );
  }

  return { allowed: true };
}

function createApplyContext(
  binding: MultiplayerAuthorityBinding,
  update: ColyseusNativeStateUpdate<unknown>,
  authoritativePath: ColyseusAuthorityPath,
  sourceEndpointId: string,
  measured: { stateBytes: number; ageMs?: number }
): ColyseusNativeStateApplyContext {
  return {
    binding,
    authoritativePath,
    sourceEndpointId,
    ...(update.sourcePeerId === undefined ? {} : { sourcePeerId: update.sourcePeerId }),
    ...(update.tick === undefined ? {} : { tick: update.tick }),
    ...(update.stateVersion === undefined ? {} : { stateVersion: update.stateVersion }),
    ...(update.version === undefined ? {} : { version: update.version }),
    stateBytes: measured.stateBytes,
    ...(measured.ageMs === undefined ? {} : { ageMs: measured.ageMs })
  };
}

function measureStateBytes<TState>(
  state: TState,
  customMeasure: ((state: TState) => number) | undefined
): number {
  if (customMeasure) {
    return customMeasure(state);
  }

  return new TextEncoder().encode(JSON.stringify(state)).byteLength;
}

function normalizeLanes(
  lanes: ColyseusAuthorityPath[] | undefined,
  authoritativePath: ColyseusAuthorityPath,
  stateSyncLane: Exclude<ColyseusAuthorityPath, "gamekits-envelope">
): ColyseusAuthorityPath[] {
  const normalized = new Set<ColyseusAuthorityPath>(lanes ?? ["gamekits-envelope", stateSyncLane]);
  normalized.add(authoritativePath);
  return [...normalized];
}

function normalizeBooleanCapability(
  input: boolean | { available: boolean; mode?: string; queue?: string } | undefined
): { available: boolean; mode?: string; queue?: string } {
  if (typeof input === "boolean") {
    return { available: input };
  }

  if (input) {
    return {
      available: input.available,
      ...("mode" in input && input.mode !== undefined ? { mode: input.mode } : {}),
      ...("queue" in input && input.queue !== undefined ? { queue: input.queue } : {})
    };
  }

  return { available: false };
}

function cloneDiagnostics(
  diagnostics: ColyseusNativeStateBridgeDiagnostics
): ColyseusNativeStateBridgeDiagnostics {
  return {
    authoritativePath: diagnostics.authoritativePath,
    sourceEndpointId: diagnostics.sourceEndpointId,
    receivedUpdates: diagnostics.receivedUpdates,
    appliedUpdates: diagnostics.appliedUpdates,
    rejectedUpdates: diagnostics.rejectedUpdates,
    resyncs: diagnostics.resyncs,
    ...(diagnostics.lastAppliedTick === undefined
      ? {}
      : { lastAppliedTick: diagnostics.lastAppliedTick }),
    ...(diagnostics.lastStateVersion === undefined
      ? {}
      : { lastStateVersion: diagnostics.lastStateVersion }),
    ...(diagnostics.lastVersion === undefined ? {} : { lastVersion: diagnostics.lastVersion }),
    ...(diagnostics.lastStateBytes === undefined
      ? {}
      : { lastStateBytes: diagnostics.lastStateBytes }),
    ...(diagnostics.lastStateAgeMs === undefined
      ? {}
      : { lastStateAgeMs: diagnostics.lastStateAgeMs }),
    ...(diagnostics.lastResyncReason === undefined
      ? {}
      : { lastResyncReason: diagnostics.lastResyncReason }),
    ...(diagnostics.lastRejected === undefined
      ? {}
      : { lastRejected: { ...diagnostics.lastRejected } })
  };
}

function deny(code: string, reason: string): MultiplayerAuthorityDecision & { allowed: false } {
  return {
    allowed: false,
    code,
    reason
  };
}
