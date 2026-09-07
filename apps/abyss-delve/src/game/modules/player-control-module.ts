import { defineGameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import { Combat, Hitbox, PlayerControl, Position, Velocity } from "../components";
import { ABYSS_ROOM_BOUNDS } from "../constants";
import { normalize } from "../math";
import type { AbyssRuntimeState } from "../runtime-state";

const PLAYER_SPEED = 230;
const DODGE_SPEED = 560;
const DODGE_DURATION_MS = 160;
const DODGE_COOLDOWN_MS = 620;

export function createAbyssPlayerControlModule(state: AbyssRuntimeState) {
  return defineGameModule<GameInstallContext>({
    id: "abyss.player_control",
    install({ systems }) {
      systems.register({
        id: "abyss.player_control.system",
        update({ world, delta, elapsed }) {
          const player = state.playerEntity;
          if (player === undefined) {
            return;
          }
          const position = world.get(player, Position);
          const velocity = world.get(player, Velocity);
          const control = world.get(player, PlayerControl);
          const combat = world.get(player, Combat);
          const hitbox = world.get(player, Hitbox);
          if (!position || !velocity || !control || !combat || !hitbox) {
            return;
          }

          if (state.input.inventoryToggleRequested) {
            state.run.inventoryOpen = !state.run.inventoryOpen;
          }
          if (state.input.pauseToggleRequested) {
            state.run.paused = !state.run.paused;
          }
          state.input.gameplayBlocked =
            state.run.inventoryOpen || state.run.rewardOpen || state.run.paused;

          const aim = normalize(state.input.aimX - position.x, state.input.aimY - position.y);
          if (aim.x || aim.y) {
            control.aimX = state.input.aimX;
            control.aimY = state.input.aimY;
            control.facingX = aim.x;
            control.facingY = aim.y;
            position.rotation = Math.atan2(aim.y, aim.x);
          }

          const move = normalize(state.input.moveX, state.input.moveY);
          const dodging = elapsed < control.dodgingUntil;
          if (
            !state.input.gameplayBlocked &&
            state.input.dodgeRequested &&
            elapsed >= control.dashCooldownUntil
          ) {
            control.dodgingUntil = elapsed + DODGE_DURATION_MS;
            control.dashCooldownUntil = elapsed + DODGE_COOLDOWN_MS;
            combat.invulnerableUntil = elapsed + DODGE_DURATION_MS;
            state.trace({ kind: "input", label: "Dodge", actorId: "abyss.player" });
          }

          const speed = dodging ? DODGE_SPEED : PLAYER_SPEED;
          velocity.x = state.input.gameplayBlocked ? 0 : move.x * speed;
          velocity.y = state.input.gameplayBlocked ? 0 : move.y * speed;
          position.x += velocity.x * (delta / 1000);
          position.y += velocity.y * (delta / 1000);
          position.x = Math.max(
            ABYSS_ROOM_BOUNDS.x + hitbox.radius,
            Math.min(ABYSS_ROOM_BOUNDS.x + ABYSS_ROOM_BOUNDS.width - hitbox.radius, position.x)
          );
          position.y = Math.max(
            ABYSS_ROOM_BOUNDS.y + hitbox.radius,
            Math.min(ABYSS_ROOM_BOUNDS.y + ABYSS_ROOM_BOUNDS.height - hitbox.radius, position.y)
          );

          world.set(player, Position, position);
          world.set(player, Velocity, velocity);
          world.set(player, PlayerControl, control);
          world.set(player, Combat, combat);
        }
      });
    }
  });
}
