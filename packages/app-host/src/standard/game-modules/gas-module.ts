import { createGasModule } from "@gamekits/gas";
import { resolveStandardValue } from "../resolve";
import type { StandardGasGameModuleOptions, StandardServiceBuildContext } from "../types";

export function createStandardGasModule<TContext>(
  ctx: StandardServiceBuildContext<TContext>,
  options: StandardGasGameModuleOptions<TContext>
) {
  return createGasModule({
    id: options.id,
    dataRegistry: options.dataRegistry?.(ctx) ?? requireDataRegistry(ctx),
    traceStore:
      options.traceStore === undefined ? undefined : resolveStandardValue(ctx, options.traceStore),
    handle: options.handle === undefined ? undefined : resolveStandardValue(ctx, options.handle),
    onRuntime(runtime) {
      options.onRuntime?.(ctx, runtime);
    }
  });
}

function requireDataRegistry<TContext>(ctx: StandardServiceBuildContext<TContext>) {
  if (!ctx.state.data) {
    throw new Error("Standard GAS module requires the data service");
  }

  return ctx.state.data;
}
