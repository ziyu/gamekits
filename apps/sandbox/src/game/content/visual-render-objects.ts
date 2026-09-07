import type { DataPackEntry } from "@gamekits/data";
import { sandboxCampfireRenderEntries } from "./visual-render-campfire";
import { sandboxEntityRenderEntries } from "./visual-render-entity";
import { sandboxMonsterRenderEntries } from "./visual-render-monsters";
import { sandboxResourceRenderEntries } from "./visual-render-resources";
import { sandboxRoadRenderEntries } from "./visual-render-roads";
import { sandboxStorageRenderEntries } from "./visual-render-storage";
import { sandboxTowerRenderEntries } from "./visual-render-tower";
import { sandboxWorkerRenderEntries } from "./visual-render-workers";
import { sandboxWorkshopRenderEntries } from "./visual-render-workshop";

export const sandboxVisualRenderObjectEntries: DataPackEntry[] = [
  ...sandboxEntityRenderEntries,
  ...sandboxCampfireRenderEntries,
  ...sandboxResourceRenderEntries,
  ...sandboxWorkerRenderEntries,
  ...sandboxStorageRenderEntries,
  ...sandboxWorkshopRenderEntries,
  ...sandboxTowerRenderEntries,
  ...sandboxMonsterRenderEntries,
  ...sandboxRoadRenderEntries
];
