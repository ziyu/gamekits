import { createTcaModule } from "@gamekits/tca";
import type { DataRegistry } from "@gamekits/data";
import type { StandardServiceBuildContext, StandardTcaGameModuleOptions } from "../types";
import { resolveStandardValue } from "../resolve";

export function createStandardTcaModule<TContext>(
  ctx: StandardServiceBuildContext<TContext>,
  options: StandardTcaGameModuleOptions<TContext>
) {
  const dataRegistry = resolveTcaDataRegistry(ctx, options);
  const definitions =
    options.definitions === undefined ? undefined : resolveStandardValue(ctx, options.definitions);
  const traceStore =
    options.traceStore === undefined ? undefined : resolveStandardValue(ctx, options.traceStore);
  const handle =
    options.handle === undefined ? undefined : resolveStandardValue(ctx, options.handle);

  return createTcaModule({
    id: options.id ?? "gamekits.tca",
    dataRegistry,
    ruleKind: options.ruleKind,
    definitions,
    traceStore,
    handle,
    onRuntime(runtime) {
      options.onRuntime?.(ctx, runtime);
    }
  });
}

function resolveTcaDataRegistry<TContext>(
  ctx: StandardServiceBuildContext<TContext>,
  options: StandardTcaGameModuleOptions<TContext>
): DataRegistry {
  const registry = options.dataRegistry?.(ctx) ?? ctx.state.data;
  if (!registry) {
    throw new Error("Standard TCA game module requires a data registry");
  }
  return registry;
}
