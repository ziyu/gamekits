import { defineGameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type { AbyssRuntimeState } from "../runtime-state";
import { enterAbyssRoom } from "./room-helpers";

export function createAbyssRoomModule(state: AbyssRuntimeState) {
  return defineGameModule<GameInstallContext>({
    id: "abyss.room",
    install() {
      enterAbyssRoom(state, "room.bootstrap");
    }
  });
}
