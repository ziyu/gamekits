import { GameError } from "@gamekits/core";
import type { AppLifecycleStage, AppServiceId } from "./types";

export function createAppHostError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): GameError {
  return new GameError(code, message, details);
}

export function createDuplicateServiceError(serviceId: AppServiceId): GameError {
  return new GameError("app_host.duplicate_service", `Duplicate app service: ${serviceId}`, {
    serviceId
  });
}

export function createMissingServiceError(serviceId: AppServiceId): GameError {
  return new GameError("app_host.missing_service", `Missing app service: ${serviceId}`, {
    serviceId
  });
}

export function createMissingServiceDependencyError(
  serviceId: AppServiceId,
  dependencyId: AppServiceId
): GameError {
  return new GameError(
    "app_host.missing_service_dependency",
    `Service ${serviceId} depends on missing service: ${dependencyId}`,
    { serviceId, dependencyId }
  );
}

export function createServiceCycleError(serviceIds: AppServiceId[]): GameError {
  return new GameError("app_host.service_cycle", "App service dependency cycle detected", {
    serviceIds
  });
}

export function createServiceLifecycleError(
  serviceId: AppServiceId,
  stage: AppLifecycleStage | "tick",
  cause: unknown
): GameError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new GameError(
    "app_host.service_lifecycle_failed",
    `App service ${serviceId} failed during ${stage}: ${message}`,
    { serviceId, stage, cause: message }
  );
}

export function createMissingConfigError(path: string): GameError {
  return new GameError("app_host.missing_config", `Missing app config value: ${path}`, { path });
}
