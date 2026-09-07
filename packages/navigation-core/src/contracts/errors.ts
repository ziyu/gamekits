import { GameError } from "@gamekits/core";

export class NavigationError extends GameError {
  override readonly name = "NavigationError";
}

export function createNavigationError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): NavigationError {
  return new NavigationError(code, message, details);
}
