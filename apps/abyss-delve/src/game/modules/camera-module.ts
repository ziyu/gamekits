import { defineGameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import { Position } from "../components";
import { ABYSS_VIEWPORT } from "../constants";
import type { AbyssRuntimeState } from "../runtime-state";

const LOOKAHEAD_DISTANCE = 76;
const SHAKE_AMPLITUDE = 7;
const SHAKE_DURATION_MS = 150;
const WHEEL_ZOOM_STEP = 1;

export function createAbyssCameraModule(state: AbyssRuntimeState) {
  return defineGameModule<GameInstallContext>({
    id: "abyss.camera",
    install(ctx) {
      if (state.camera && state.playerEntity !== undefined) {
        state.camera.follow(state.playerEntity);
      }

      const cleanup = ctx.eventBus.on("gas.effect_applied", (event) => {
        if (!state.camera || !isRecord(event.payload)) {
          return;
        }
        const effectId = event.payload.effectId;
        if (
          effectId === "effect.basic_damage" ||
          effectId === "effect.fire_damage" ||
          effectId === "effect.cleave_damage" ||
          effectId === "effect.elite_hit"
        ) {
          state.camera.shake({
            amplitude: effectId === "effect.elite_hit" ? SHAKE_AMPLITUDE * 1.7 : SHAKE_AMPLITUDE,
            durationMs: effectId === "effect.elite_hit" ? 220 : SHAKE_DURATION_MS
          });
        }
      });

      ctx.systems.register({
        id: "abyss.camera.system",
        update({ delta }) {
          syncCamera(state, delta);
        }
      });

      return cleanup;
    }
  });
}

function syncCamera(state: AbyssRuntimeState, delta: number): void {
  const camera = state.camera;
  const player = state.playerEntity;
  const playerPosition = player === undefined ? undefined : state.world.get(player, Position);
  if (!camera || player === undefined || !playerPosition) {
    return;
  }

  if (camera.getState().targetEntity !== player) {
    camera.follow(player);
  }

  const zoomDelta = state.input.cameraZoomDelta;
  if (zoomDelta !== undefined && zoomDelta !== 0) {
    camera.zoom(zoomDelta < 0 ? WHEEL_ZOOM_STEP : -WHEEL_ZOOM_STEP, {
      x: state.input.cameraZoomX ?? ABYSS_VIEWPORT.width / 2,
      y: state.input.cameraZoomY ?? ABYSS_VIEWPORT.height / 2
    });
  }

  const aimX = state.input.aimX - playerPosition.x;
  const aimY = state.input.aimY - playerPosition.y;
  const aimLength = Math.hypot(aimX, aimY);
  const lookahead =
    aimLength > 0
      ? {
          x: (aimX / aimLength) * LOOKAHEAD_DISTANCE,
          y: (aimY / aimLength) * LOOKAHEAD_DISTANCE
        }
      : { x: 0, y: 0 };

  camera.setState({
    mode: "follow",
    targetEntity: player,
    x: playerPosition.x + lookahead.x,
    y: playerPosition.y + lookahead.y,
    viewport: ABYSS_VIEWPORT
  });
  state.cameraAdapter?.applyCameraState(camera.update(delta));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
