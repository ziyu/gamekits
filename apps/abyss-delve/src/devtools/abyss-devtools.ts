import type {
  DevToolsPanelDefinition,
  DevToolsRuntime,
  DevToolsTraceInput,
  DevToolsTraceKind
} from "@gamekits/devtools";
import type { AbyssCheckpointData, AbyssSnapshot, AbyssTraceEntry } from "../game";

export const ABYSS_CHAIN_PANEL_ID = "abyss.chain";
export const ABYSS_SOURCE_ID = "abyss";

export type AbyssDevToolsTraceBridge = {
  sync(snapshot: AbyssSnapshot | undefined): void;
  pushSaveCompleted(input: {
    checkpoint: AbyssCheckpointData;
    elapsed: number;
    ticks: number;
  }): void;
};

export function createAbyssDevToolsPanel(): DevToolsPanelDefinition {
  return {
    id: ABYSS_CHAIN_PANEL_ID,
    label: "Abyss Chain",
    area: "dock",
    order: 7,
    sourceKinds: ["custom"],
    pin: {
      enabled: true,
      defaultPinned: false,
      icon: "chain",
      label: "Chain",
      order: 2,
      area: "floating"
    }
  };
}

export function createAbyssDevToolsTraceBridge(
  runtime: () => DevToolsRuntime | undefined
): AbyssDevToolsTraceBridge {
  const seenTraceIds = new Set<string>();

  return {
    sync(snapshot) {
      const devtools = runtime();
      if (!devtools || !snapshot) {
        return;
      }

      for (const entry of [...snapshot.timeline].reverse()) {
        if (seenTraceIds.has(entry.id)) {
          continue;
        }
        seenTraceIds.add(entry.id);
        devtools.pushTrace(toDevToolsTrace(entry));
      }
    },
    pushSaveCompleted(input) {
      const devtools = runtime();
      if (!devtools) {
        return;
      }
      devtools.pushTrace({
        kind: "save",
        label: "checkpoint saved",
        source: "abyss.save",
        status: "completed",
        severity: "info",
        payload: {
          roomId: input.checkpoint.currentRoomId,
          roomIndex: input.checkpoint.roomIndex,
          gold: input.checkpoint.gold,
          selectedRewards: input.checkpoint.selectedRewardIds.length,
          ticks: input.ticks,
          elapsed: input.elapsed
        }
      });
    }
  };
}

function toDevToolsTrace(entry: AbyssTraceEntry): DevToolsTraceInput {
  return {
    id: `abyss.${entry.id}`,
    time: entry.time,
    kind: toDevToolsKind(entry.kind),
    label: entry.label,
    source: `abyss.${entry.kind}`,
    severity: "info",
    ...(entry.actorId === undefined ? {} : { actorId: entry.actorId }),
    ...(entry.entityId === undefined ? {} : { entityId: entry.entityId }),
    payload: entry.payload
  };
}

function toDevToolsKind(kind: AbyssTraceEntry["kind"]): DevToolsTraceKind {
  if (kind === "input") {
    return "input";
  }
  if (kind === "gas") {
    return "gas";
  }
  if (kind === "tca") {
    return "tca";
  }
  if (kind === "runtime") {
    return "runtime";
  }
  if (kind === "save") {
    return "save";
  }
  return "custom";
}
