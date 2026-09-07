import { GameError } from "@gamekits/core";
import type { PlatformCapabilityId, PlatformRuntimeId, PlatformServiceId } from "./types";

export function createPlatformUnsupportedError(
  platformId: PlatformRuntimeId,
  capability: PlatformCapabilityId,
  detail?: Record<string, unknown>
): GameError {
  return new GameError(
    "platform.unsupported_capability",
    `Platform ${platformId} does not support capability: ${capability}`,
    { platformId, capability, ...detail }
  );
}

export function createPlatformMissingServiceError(
  platformId: PlatformRuntimeId,
  serviceId: PlatformServiceId
): GameError {
  return new GameError(
    "platform.missing_service",
    `Platform ${platformId} does not provide service: ${serviceId}`,
    { platformId, serviceId }
  );
}
