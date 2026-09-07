import { createAiHandle, createAiModule, type CreateAiModuleOptions } from "@gamekits/ai-core";
import { resolveStandardValue } from "../resolve";
import type { StandardServiceBuildContext, StandardValue } from "../types";

export function createStandardAiModule<TContext>(
  ctx: StandardServiceBuildContext<TContext>,
  options: StandardValue<CreateAiModuleOptions, TContext>
) {
  const resolved = resolveStandardValue(ctx, options);
  const handle = resolved.handle ?? createAiHandle();
  ctx.state.ai = handle;
  return createAiModule({ ...resolved, handle });
}
