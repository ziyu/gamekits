import { defineGameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type { NavigationHandle } from "@gamekits/navigation-core";

import {
  outpostNavigationBarricadeBlockers,
  type OutpostNavigationBarricadeBlocker
} from "../content";

export type OutpostAuthorityNavigationBlockerSnapshot = {
  id: string;
  edgeId: string;
  blocked: boolean;
  objectIds: readonly string[];
};

export type OutpostAuthorityNavigationIntegration = {
  module: ReturnType<typeof defineGameModule<GameInstallContext>>;
  setArenaObjectBlocked(objectId: string, blocked: boolean): boolean;
  blockers(): OutpostAuthorityNavigationBlockerSnapshot[];
};

export function createOutpostAuthorityNavigationIntegration(
  navigation: NavigationHandle
): OutpostAuthorityNavigationIntegration {
  const blockedByObjectId = new Map<string, boolean>();
  const blockerByObjectId = new Map<string, OutpostNavigationBarricadeBlocker>();
  const appliedByBlockerId = new Map<string, boolean>();
  for (const blocker of outpostNavigationBarricadeBlockers) {
    for (const objectId of blocker.objectIds) {
      if (blockerByObjectId.has(objectId)) {
        throw new Error(
          `Outpost arena object has duplicate navigation blocker mapping: ${objectId}`
        );
      }
      blockerByObjectId.set(objectId, blocker);
      blockedByObjectId.set(objectId, true);
    }
  }

  const module = defineGameModule<GameInstallContext>({
    id: "outpost.authority.navigation-blockers",
    install(ctx) {
      ctx.systems.register({
        id: "outpost.authority.navigation-blockers.sync",
        update() {
          for (const blocker of outpostNavigationBarricadeBlockers) {
            const blocked = blocker.objectIds.some(
              (objectId) => blockedByObjectId.get(objectId) === true
            );
            if (appliedByBlockerId.get(blocker.id) === blocked) {
              continue;
            }
            const result = navigation.updateObstacle({
              id: blocker.id,
              target: { kind: "edge", id: blocker.edgeId },
              blocked
            });
            if (result.status === "unsupported") {
              throw new Error(
                `Outpost navigation blocker target is unsupported: ${blocker.id} -> ${blocker.edgeId}`
              );
            }
            appliedByBlockerId.set(blocker.id, blocked);
          }
        }
      });
      return () => {
        appliedByBlockerId.clear();
      };
    }
  });

  return {
    module,
    setArenaObjectBlocked(objectId, blocked) {
      if (!blockerByObjectId.has(objectId)) {
        return false;
      }
      blockedByObjectId.set(objectId, blocked);
      return true;
    },
    blockers() {
      return outpostNavigationBarricadeBlockers.map((blocker) => ({
        id: blocker.id,
        edgeId: blocker.edgeId,
        blocked: blocker.objectIds.some((objectId) => blockedByObjectId.get(objectId) === true),
        objectIds: [...blocker.objectIds]
      }));
    }
  };
}
