import {
  createNavigationHandle,
  createNavigationModule,
  type CreateNavigationModuleOptions
} from "@gamekits/navigation-core";
import { resolveStandardValue } from "../resolve";
import type { StandardServiceBuildContext, StandardValue } from "../types";

export function createStandardNavigationModule<TContext>(
  ctx: StandardServiceBuildContext<TContext>,
  options: StandardValue<CreateNavigationModuleOptions, TContext>
) {
  const resolved = resolveStandardValue(ctx, options);
  const handle = resolved.handle ?? createNavigationHandle();
  ctx.state.navigation = handle;
  return createNavigationModule({ ...resolved, handle });
}
