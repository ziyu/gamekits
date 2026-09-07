import type { SaveContributor } from "@gamekits/save";
import type { SandboxRuntime, SandboxSaveData } from "./types";

export const SANDBOX_SAVE_SLOT_ID = "tiny-camp.local";
export const SANDBOX_SAVE_CONTRIBUTOR_ID = "sandbox.tiny_camp";

export function createSandboxSaveContributor(
  sandbox: SandboxRuntime
): SaveContributor<SandboxSaveData> {
  return {
    id: SANDBOX_SAVE_CONTRIBUTOR_ID,
    version: "1.0.0",
    order: 100,
    scope: "gameplay",
    tags: ["sandbox", "world", "gas"],
    capture() {
      return {
        id: SANDBOX_SAVE_CONTRIBUTOR_ID,
        version: "1.0.0",
        data: sandbox.captureSaveData()
      };
    },
    restore(_ctx, section) {
      sandbox.restoreSaveData(section.data);
    },
    validate(section) {
      const valid =
        typeof section.data === "object" &&
        section.data !== null &&
        section.data.version === "1.0.0" &&
        Array.isArray(section.data.entities) &&
        Array.isArray(section.data.gasActors);

      return {
        issues: valid
          ? []
          : [
              {
                code: "sandbox.save_invalid",
                message: "Sandbox save section is invalid.",
                severity: "error",
                path: SANDBOX_SAVE_CONTRIBUTOR_ID
              }
            ]
      };
    }
  };
}
