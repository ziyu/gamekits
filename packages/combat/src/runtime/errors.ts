import { GameError } from "@gamekits/core";

export function createCombatError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): GameError {
  return new GameError(code, message, details);
}
