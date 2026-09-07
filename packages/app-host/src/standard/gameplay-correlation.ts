import {
  createDevToolsCorrelationSource,
  type DevToolsCorrelationSource,
  type DevToolsCorrelationSourceOptions,
  type DevToolsRuntime,
  type DevToolsTraceInput
} from "@gamekits/devtools";
import {
  createCombatTraceStore,
  type CombatTraceEntry,
  type CombatTraceStore
} from "@gamekits/combat";
import type { AiTraceEntry } from "@gamekits/ai-core";
import type { AnimatorTraceEntry } from "@gamekits/animator-core";
import type { AudioDiagnosticEntry } from "@gamekits/audio-core";
import { createGasTraceStore, type GasTraceEntry, type GasTraceStore } from "@gamekits/gas";
import type { NavigationTraceEntry } from "@gamekits/navigation-core";
import {
  createPhysicsTraceStore,
  type PhysicsTraceEntry,
  type PhysicsTraceStore
} from "@gamekits/physics-core";
import { createTcaTraceStore, type TcaTraceEntry, type TcaTraceStore } from "@gamekits/tca";

export type GameplayDevToolsCorrelationOptions = DevToolsCorrelationSourceOptions & {
  devtools: DevToolsRuntime;
  tcaTraceLimit?: number | undefined;
  gasTraceLimit?: number | undefined;
  physicsTraceLimit?: number | undefined;
  combatTraceLimit?: number | undefined;
  summaries?: GameplayDevToolsTraceSummaries | undefined;
};

export type GameplayDevToolsTraceKind =
  | "tca"
  | "gas"
  | "physics"
  | "combat"
  | "navigation"
  | "ai"
  | "animator"
  | "audio";

export type GameplayDevToolsTraceSummaryContext = {
  kind: GameplayDevToolsTraceKind;
  source: string;
  traceId: string;
};

export type GameplayDevToolsTraceSummaries = {
  tca?(entry: TcaTraceEntry): unknown;
  gas?(entry: GasTraceEntry): unknown;
  physics?(entry: PhysicsTraceEntry): unknown;
  combat?(entry: CombatTraceEntry): unknown;
  navigation?(entry: NavigationTraceEntry): unknown;
  ai?(entry: AiTraceEntry): unknown;
  animator?(entry: AnimatorTraceEntry): unknown;
  audio?(entry: AudioDiagnosticEntry): unknown;
  redact?(payload: unknown, context: GameplayDevToolsTraceSummaryContext): unknown;
};

export type GameplayDevToolsCorrelation = {
  source: DevToolsCorrelationSource;
  tcaTraceStore: TcaTraceStore;
  gasTraceStore: GasTraceStore;
  physicsTraceStore: PhysicsTraceStore;
  combatTraceStore: CombatTraceStore;
  observeNavigationTrace(entry: NavigationTraceEntry): void;
  observeAiTrace(entry: AiTraceEntry): void;
  observeAnimatorTrace(entry: AnimatorTraceEntry): void;
  observeAudioDiagnostic(entry: AudioDiagnosticEntry): void;
  dispose(): void;
};

export function createGameplayDevToolsCorrelation(
  options: GameplayDevToolsCorrelationOptions
): GameplayDevToolsCorrelation {
  const source = createDevToolsCorrelationSource(options.devtools, {
    id: options.id,
    label: options.label,
    correlationLimit: options.correlationLimit,
    rootLimitPerCorrelation: options.rootLimitPerCorrelation
  });
  const unregisterSource = options.devtools.registerDataSource(source.dataSource);
  let disposed = false;

  function reportBridgeError(
    kind: GameplayDevToolsTraceKind,
    entry: TcaTraceEntry | GasTraceEntry | PhysicsTraceEntry | CombatTraceEntry,
    error: unknown
  ): void {
    options.devtools.pushDiagnostic({
      type: "devtools.gameplay_trace_bridge_failed",
      severity: "warning",
      source: "app-host.gameplay-correlation",
      phase: "trace",
      code: "devtools.gameplay_trace_bridge_failed",
      message: truncateText(error instanceof Error ? error.message : String(error)),
      relatedTraceId: entry.id,
      dataSourceId: source.dataSource.id,
      payload: { kind }
    });
  }

  function pushObserved(
    kind: GameplayDevToolsTraceKind,
    traceId: string,
    create: () => DevToolsTraceInput
  ): void {
    try {
      source.push(create());
    } catch (error) {
      options.devtools.pushDiagnostic({
        type: "devtools.gameplay_trace_bridge_failed",
        severity: "warning",
        source: "app-host.gameplay-correlation",
        phase: "trace",
        code: "devtools.gameplay_trace_bridge_failed",
        message: truncateText(error instanceof Error ? error.message : String(error)),
        relatedTraceId: traceId,
        dataSourceId: source.dataSource.id,
        payload: { kind }
      });
    }
  }

  return {
    source,
    tcaTraceStore: createTcaTraceStore({
      limit: options.tcaTraceLimit,
      onEntry(entry) {
        source.push(mapTcaTrace(entry, options.summaries));
      },
      onEntryError(error, entry) {
        reportBridgeError("tca", entry, error);
      }
    }),
    gasTraceStore: createGasTraceStore({
      ...(options.gasTraceLimit === undefined ? {} : { limit: options.gasTraceLimit }),
      onEntry(entry) {
        source.push(mapGasTrace(entry, options.summaries));
      },
      onEntryError(error, entry) {
        reportBridgeError("gas", entry, error);
      }
    }),
    physicsTraceStore: createPhysicsTraceStore({
      ...(options.physicsTraceLimit === undefined ? {} : { limit: options.physicsTraceLimit }),
      onEntry(entry) {
        source.push(mapPhysicsTrace(entry, options.summaries));
      },
      onEntryError(error, entry) {
        reportBridgeError("physics", entry, error);
      }
    }),
    combatTraceStore: createCombatTraceStore({
      ...(options.combatTraceLimit === undefined ? {} : { limit: options.combatTraceLimit }),
      onEntry(entry) {
        source.push(mapCombatTrace(entry, options.summaries));
      },
      onEntryError(error, entry) {
        reportBridgeError("combat", entry, error);
      }
    }),
    observeNavigationTrace(entry) {
      const traceId = `navigation-trace-${entry.sequence}`;
      pushObserved("navigation", traceId, () =>
        mapNavigationTrace(entry, traceId, options.summaries)
      );
    },
    observeAiTrace(entry) {
      const traceId = `ai-trace-${entry.sequence}`;
      pushObserved("ai", traceId, () => mapAiTrace(entry, traceId, options.summaries));
    },
    observeAnimatorTrace(entry) {
      const traceId = `animator-trace-${entry.sequence}`;
      pushObserved("animator", traceId, () => mapAnimatorTrace(entry, traceId, options.summaries));
    },
    observeAudioDiagnostic(entry) {
      const traceId = `audio-diagnostic-${entry.sequence}`;
      pushObserved("audio", traceId, () => mapAudioDiagnostic(entry, traceId, options.summaries));
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      unregisterSource();
      source.dispose();
    }
  };
}

function mapNavigationTrace(
  entry: NavigationTraceEntry,
  traceId: string,
  summaries: GameplayDevToolsTraceSummaries | undefined
) {
  const context = createSummaryContext("navigation", "gamekits.navigation", traceId);
  return {
    id: traceId,
    time: entry.timestamp,
    kind: "navigation" as const,
    label: entry.label,
    source: "gamekits.navigation",
    ...(entry.requestId === undefined ? {} : { correlationId: entry.requestId }),
    payload: summarize(
      summaries?.navigation
        ? summaries.navigation(entry)
        : {
            kind: entry.kind,
            timestamp: entry.timestamp,
            revision: entry.revision,
            ...(entry.requestId === undefined ? {} : { requestId: entry.requestId }),
            ...(entry.requesterId === undefined ? {} : { requesterId: entry.requesterId }),
            ...pickPayload(entry.payload, [
              "profileId",
              "goalKey",
              "reason",
              "cache",
              "pending",
              "processed",
              "budget",
              "obstacleId",
              "targetKind",
              "targetId",
              "previousRevision",
              "invalidatedRouteFields"
            ])
          },
      context,
      summaries
    )
  };
}

function mapAiTrace(
  entry: AiTraceEntry,
  traceId: string,
  summaries: GameplayDevToolsTraceSummaries | undefined
) {
  const context = createSummaryContext("ai", "gamekits.ai", traceId);
  return {
    id: traceId,
    time: entry.timestamp,
    kind: "ai" as const,
    label: entry.label,
    source: "gamekits.ai",
    payload: summarize(
      summaries?.ai
        ? summaries.ai(entry)
        : {
            kind: entry.kind,
            timestamp: entry.timestamp,
            ...(entry.agentId === undefined ? {} : { agentId: entry.agentId }),
            ...pickPayload(entry.payload, [
              "definitionId",
              "reason",
              "sensorId",
              "facts",
              "candidates",
              "winner",
              "goalId",
              "score",
              "taskId",
              "executorId",
              "status",
              "type"
            ])
          },
      context,
      summaries
    )
  };
}

function mapAnimatorTrace(
  entry: AnimatorTraceEntry,
  traceId: string,
  summaries: GameplayDevToolsTraceSummaries | undefined
) {
  const context = createSummaryContext("animator", "gamekits.animator", traceId);
  const correlationId = payloadString(entry.payload, "executionId");
  return {
    id: traceId,
    time: entry.timestamp,
    kind: "animator" as const,
    label: entry.label,
    source: "gamekits.animator",
    ...(correlationId === undefined ? {} : { correlationId }),
    payload: summarize(
      summaries?.animator
        ? summaries.animator(entry)
        : {
            kind: entry.kind,
            timestamp: entry.timestamp,
            ...(entry.controllerId === undefined ? {} : { controllerId: entry.controllerId }),
            ...pickPayload(entry.payload, [
              "bindingId",
              "renderObjectId",
              "generation",
              "parameterId",
              "oneShotId",
              "layerId",
              "executionId",
              "abilityId",
              "phase",
              "seekTimeMs",
              "predicted",
              "frames",
              "clipId",
              "markerId",
              "from",
              "to"
            ])
          },
      context,
      summaries
    )
  };
}

function mapAudioDiagnostic(
  entry: AudioDiagnosticEntry,
  traceId: string,
  summaries: GameplayDevToolsTraceSummaries | undefined
) {
  const context = createSummaryContext("audio", "gamekits.audio", traceId);
  const correlationId =
    payloadString(entry.payload, "dedupeKey") ?? payloadString(entry.payload, "instanceId");
  return {
    id: traceId,
    time: entry.timestamp,
    kind: "audio" as const,
    label: entry.type,
    source: "gamekits.audio",
    ...(correlationId === undefined ? {} : { correlationId }),
    payload: summarize(
      summaries?.audio
        ? summaries.audio(entry)
        : {
            type: entry.type,
            timestamp: entry.timestamp,
            ...pickPayload(entry.payload, [
              "category",
              "sourceId",
              "eventId",
              "trackId",
              "lineId",
              "dedupeKey",
              "emitterId",
              "reason",
              "instanceId",
              "instanceIds",
              "busId",
              "volume",
              "muted",
              "paused",
              "fadeMs",
              "transitionMs",
              "maxPlaybackInstances",
              "nativePlaybackCount",
              "buses",
              "musicTracks",
              "sfxEvents",
              "dialogueLines"
            ])
          },
      context,
      summaries
    )
  };
}

function mapCombatTrace(
  entry: CombatTraceEntry,
  summaries: GameplayDevToolsTraceSummaries | undefined
) {
  const context = createSummaryContext("combat", "gamekits.combat", entry.id);
  return {
    id: entry.id,
    kind: "combat" as const,
    label: `combat.${entry.type}`,
    source: "gamekits.combat",
    ...(entry.correlationId === undefined ? {} : { correlationId: entry.correlationId }),
    ...(entry.parentId === undefined ? {} : { parentId: entry.parentId }),
    ...(entry.sourceActorId === undefined ? {} : { actorId: entry.sourceActorId }),
    ...(entry.targetEntityId === undefined ? {} : { entityId: entry.targetEntityId }),
    payload: summarize(
      summaries?.combat
        ? summaries.combat(entry)
        : {
            type: entry.type,
            timestamp: entry.timestamp,
            ...(entry.requestId === undefined ? {} : { requestId: entry.requestId }),
            ...(entry.projectileId === undefined ? {} : { projectileId: entry.projectileId }),
            ...(entry.targetActorId === undefined ? {} : { targetActorId: entry.targetActorId }),
            ...(entry.message === undefined ? {} : { message: truncateText(entry.message) })
          },
      context,
      summaries
    )
  };
}

function mapTcaTrace(entry: TcaTraceEntry, summaries: GameplayDevToolsTraceSummaries | undefined) {
  const context = createSummaryContext("tca", "gamekits.tca", entry.id);
  return {
    id: entry.id,
    kind: "tca" as const,
    label: `tca.rule.${entry.status}`,
    source: "gamekits.tca",
    status: entry.status,
    ...(entry.correlationId === undefined ? {} : { correlationId: entry.correlationId }),
    ...(entry.parentId === undefined ? {} : { parentId: entry.parentId }),
    dataKey: { type: "tca.rule", id: entry.ruleId },
    payload: summarize(
      summaries?.tca
        ? summaries.tca(entry)
        : {
            ruleId: entry.ruleId,
            eventType: entry.eventType,
            timestamp: entry.timestamp,
            conditionCount: entry.conditions.length,
            actionCount: entry.actions.length,
            ...(entry.reason === undefined ? {} : { reason: truncateText(entry.reason) })
          },
      context,
      summaries
    )
  };
}

function mapGasTrace(entry: GasTraceEntry, summaries: GameplayDevToolsTraceSummaries | undefined) {
  const context = createSummaryContext("gas", "gamekits.gas", entry.id);
  return {
    id: entry.id,
    kind: "gas" as const,
    label: `gas.${entry.type}`,
    source: "gamekits.gas",
    ...(entry.correlationId === undefined ? {} : { correlationId: entry.correlationId }),
    ...(entry.parentId === undefined ? {} : { parentId: entry.parentId }),
    ...(entry.actorId === undefined ? {} : { actorId: entry.actorId }),
    ...(entry.abilityId === undefined
      ? entry.effectId === undefined
        ? {}
        : { dataKey: { type: "gas.effect", id: entry.effectId } }
      : { dataKey: { type: "gas.ability", id: entry.abilityId } }),
    payload: summarize(
      summaries?.gas
        ? summaries.gas(entry)
        : {
            type: entry.type,
            timestamp: entry.timestamp,
            ...(entry.effectId === undefined ? {} : { effectId: entry.effectId }),
            ...(entry.message === undefined ? {} : { message: truncateText(entry.message) })
          },
      context,
      summaries
    )
  };
}

function mapPhysicsTrace(
  entry: PhysicsTraceEntry,
  summaries: GameplayDevToolsTraceSummaries | undefined
) {
  const context = createSummaryContext("physics", "gamekits.physics", entry.id);
  return {
    id: entry.id,
    kind: "physics" as const,
    label: truncateText(entry.label),
    source: "gamekits.physics",
    ...(entry.correlationId === undefined ? {} : { correlationId: entry.correlationId }),
    ...(entry.parentId === undefined ? {} : { parentId: entry.parentId }),
    ...(entry.entityId === undefined ? {} : { entityId: entry.entityId }),
    payload: summarize(
      summaries?.physics
        ? summaries.physics(entry)
        : {
            kind: entry.kind,
            ...(entry.tick === undefined ? {} : { tick: entry.tick }),
            ...(entry.elapsed === undefined ? {} : { elapsed: entry.elapsed }),
            ...(entry.bodyId === undefined ? {} : { bodyId: entry.bodyId }),
            ...(entry.colliderId === undefined ? {} : { colliderId: entry.colliderId })
          },
      context,
      summaries
    )
  };
}

function createSummaryContext(
  kind: GameplayDevToolsTraceKind,
  source: string,
  traceId: string
): GameplayDevToolsTraceSummaryContext {
  return { kind, source, traceId };
}

function summarize(
  payload: unknown,
  context: GameplayDevToolsTraceSummaryContext,
  summaries: GameplayDevToolsTraceSummaries | undefined
): unknown {
  return summaries?.redact ? summaries.redact(payload, context) : payload;
}

function pickPayload(
  payload: Record<string, unknown> | undefined,
  keys: string[]
): Record<string, unknown> {
  if (payload === undefined) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const value = boundedSummaryValue(payload[key]);
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function boundedSummaryValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return truncateText(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 16).flatMap((entry) => {
      const summary = boundedSummaryValue(entry);
      return summary === undefined || typeof summary === "object" ? [] : [summary];
    });
  }
  return undefined;
}

function payloadString(
  payload: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = payload?.[key];
  return typeof value === "string" && value.length > 0 ? truncateText(value) : undefined;
}

function truncateText(value: string, limit = 256): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
