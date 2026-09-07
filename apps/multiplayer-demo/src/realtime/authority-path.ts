export type RealtimeArenaAuthorityPath = "gamekits-envelope" | "colyseus-schema";

export const REALTIME_ARENA_DEFAULT_AUTHORITY_PATH: RealtimeArenaAuthorityPath =
  "gamekits-envelope";
export const REALTIME_ARENA_SCHEMA_VERSION = "realtime-arena.v1";

export function readRealtimeArenaAuthorityPath(
  value: unknown
): RealtimeArenaAuthorityPath | undefined {
  return value === "gamekits-envelope" || value === "colyseus-schema" ? value : undefined;
}
