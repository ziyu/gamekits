import type { NavigationBackendAdapter } from "@gamekits/navigation-core/backend";
import type { CreateGraphNavigationBackendOptions } from "../contracts/graph-definition";
import { createGraphNavigationBackendRuntime } from "../runtime";

export function createGraphNavigationBackend(
  options: CreateGraphNavigationBackendOptions
): NavigationBackendAdapter {
  return createGraphNavigationBackendRuntime(options);
}
