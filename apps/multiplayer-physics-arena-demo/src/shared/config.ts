import { ARENA_COMPILED_CONTENT } from "../content/default-content";

export const ARENA_ROOM_NAME = "gamekits-knockout-circuit";
export const ARENA_BROWSER_CONFIG_PATH = "/__gamekits/knockout-config";
export const ARENA_SCHEMA_VERSION = "knockout-arena.v10";
export const ARENA_DEFINITION_VERSION = ARENA_COMPILED_CONTENT.definitionVersion;
export const ARENA_ISLAND_ID = "knockout.full-arena";
export const ARENA_FIXED_STEP_MS = 1000 / 60;
export const ARENA_MOVE_SPEED = 6.4;
export const ARENA_JUMP_SPEED = 7.2;
export const ARENA_SNAPSHOT_INTERVAL_TICKS = 3;
export const ARENA_MAX_HUMANS = 2;
export const ARENA_BOT_COUNT = 6;
export const ARENA_ACTOR_COUNT = ARENA_MAX_HUMANS + ARENA_BOT_COUNT;
export const ARENA_INPUT_KIND = "game.input";
export const ARENA_ACTION_KIND = "game.action";
export const ARENA_SNAPSHOT_KIND = "game.snapshot";
export const ARENA_MESSAGE_TYPE = "gamekits.message";

export type ArenaMatchPhase = "lobby" | "countdown" | "running" | "results";

export type ArenaActorControl = {
  moveX: number;
  moveZ: number;
  jump: boolean;
};

export type ArenaActorControlFrame = ArenaActorControl & { sequence: number };
export type ArenaMoveInput = ArenaActorControlFrame & { authorityEpoch?: string | undefined };

export function arenaAuthorityPeerId(sessionId: string): string {
  return `${sessionId}.server`;
}

export function arenaPlayerMemberId(slot: number): string {
  return `player.${slot}`;
}

export function arenaBotMemberId(slot: number): string {
  return `bot.${slot}`;
}
