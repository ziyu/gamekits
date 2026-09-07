import type { NavigationBackendAdapter } from "@gamekits/navigation-core/backend";
import type { CreateRecastNavigationBackendOptions } from "../contracts";
import { createRecastNavigationBackendRuntime } from "../runtime";

export function createRecastNavigationBackend(
  options: CreateRecastNavigationBackendOptions
): NavigationBackendAdapter {
  return createRecastNavigationBackendRuntime(options);
}
