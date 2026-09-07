import type { DataRef, DataRegistry } from "@gamekits/data";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type { NavigationBackendAdapter, NavigationBackendFactory } from "../backend/port";
import type { NavigationHandle, NavigationRuntime } from "../contracts/facade";
import type { NavigationLayoutDefinition } from "../contracts/layout";
import type { NavigationTraceEntry } from "../contracts/observability";
import type { NavigationAgentProfileDefinition } from "../contracts/profile";

type NavigationRuntimeSource =
  | {
      backend: NavigationBackendAdapter;
      layout?: never;
      backendFactories?: never;
    }
  | {
      backend?: never;
      layout: NavigationLayoutDefinition | DataRef;
      backendFactories: readonly NavigationBackendFactory[];
      dataRegistry: DataRegistry;
    };

export type CreateNavigationRuntimeOptions = NavigationRuntimeSource & {
  id?: string | undefined;
  dataRegistry?: DataRegistry | undefined;
  profiles?: NavigationAgentProfileDefinition[] | undefined;
  disposeBackend?: boolean | undefined;
  maxRequestsPerTick?: number | undefined;
  maxBackendPollsPerTick?: number | undefined;
  maxPendingRequests?: number | undefined;
  maxPendingPerRequester?: number | undefined;
  maxRetainedResults?: number | undefined;
  maxRetainedRoutes?: number | undefined;
  maxCacheEntries?: number | undefined;
  maxStaleRetries?: number | undefined;
  cacheTtlMs?: number | undefined;
  negativeCacheTtlMs?: number | undefined;
  pointQuantization?: number | undefined;
  traceLimit?: number | undefined;
  onTrace?: ((entry: NavigationTraceEntry) => void) | undefined;
  onTraceError?: ((error: unknown, entry: NavigationTraceEntry) => void) | undefined;
};

export type CreateNavigationModuleOptions = CreateNavigationRuntimeOptions & {
  handle?: NavigationHandle | undefined;
  onRuntime?: ((runtime: NavigationRuntime, context: GameInstallContext) => void) | undefined;
};
