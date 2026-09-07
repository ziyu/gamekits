import type { SaveContributor } from "@gamekits/save";
import type { AbyssRuntime } from "../types";
import {
  ABYSS_CHECKPOINT_SECTION_ID,
  ABYSS_CHECKPOINT_SECTION_VERSION,
  type AbyssCheckpointData
} from "./checkpoint-types";

export function createAbyssSaveContributor(
  runtime: () => AbyssRuntime | undefined
): SaveContributor<AbyssCheckpointData> {
  return {
    id: ABYSS_CHECKPOINT_SECTION_ID,
    version: ABYSS_CHECKPOINT_SECTION_VERSION,
    order: 10,
    scope: "gameplay",
    tags: ["abyss", "checkpoint"],
    required: true,
    capture() {
      return {
        id: ABYSS_CHECKPOINT_SECTION_ID,
        version: ABYSS_CHECKPOINT_SECTION_VERSION,
        data: requireRuntime(runtime).captureCheckpoint()
      };
    },
    restore(_ctx, section) {
      requireRuntime(runtime).restoreCheckpoint(section.data);
    },
    validate(section) {
      const data = section.data;
      const issues = [];
      if (data.version !== 1) {
        issues.push({
          code: "abyss.checkpoint_version",
          message: `Unsupported Abyss checkpoint version: ${data.version}`,
          severity: "error" as const,
          path: "version"
        });
      }
      if (!data.currentRoomId) {
        issues.push({
          code: "abyss.checkpoint_missing_room",
          message: "Abyss checkpoint is missing currentRoomId",
          severity: "error" as const,
          path: "currentRoomId"
        });
      }
      return { issues };
    }
  };
}

function requireRuntime(runtime: () => AbyssRuntime | undefined): AbyssRuntime {
  const abyss = runtime();
  if (!abyss) {
    throw new Error("Abyss runtime is not available for save checkpoint");
  }
  return abyss;
}
