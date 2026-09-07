import type { DataRef, DataRegistry } from "@gamekits/data";
import type { NavigationObstacleTarget } from "@gamekits/navigation-core";
import type { NavigationBackendFactory } from "@gamekits/navigation-core/backend";
import type { NavigationLabBackendDebugView } from "./debug-view";

export type NavigationLabObstacleBindings = {
  bridge: NavigationObstacleTarget;
  ridgeTrail: NavigationObstacleTarget;
  marsh: NavigationObstacleTarget;
  waystone: NavigationObstacleTarget;
};

export type NavigationLabBackendSummary = {
  id: string;
  label: string;
  technology: string;
  description: string;
};

export type NavigationLabBackendPresentation = NavigationLabBackendSummary & {
  debugView: NavigationLabBackendDebugView;
};

export type NavigationLabBackendProvider = NavigationLabBackendSummary & {
  layoutRef: DataRef;
  obstacleBindings: NavigationLabObstacleBindings;
  debugView: NavigationLabBackendDebugView;
  prepare?(): Promise<void>;
  createDataRegistry(): DataRegistry;
  createBackendFactories(): NavigationBackendFactory[];
};

export function navigationLabBackendSummary(
  provider: NavigationLabBackendProvider
): NavigationLabBackendSummary {
  return {
    id: provider.id,
    label: provider.label,
    technology: provider.technology,
    description: provider.description
  };
}

export function navigationLabBackendPresentation(
  provider: NavigationLabBackendProvider
): NavigationLabBackendPresentation {
  return {
    ...navigationLabBackendSummary(provider),
    debugView: provider.debugView
  };
}
