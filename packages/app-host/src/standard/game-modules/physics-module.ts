import { createPhysicsModule, type PhysicsModuleOptions } from "@gamekits/physics-core";
import { resolveStandardValue } from "../resolve";
import type { StandardPhysicsGameModuleOptions, StandardServiceBuildContext } from "../types";

export function createStandardPhysicsModule<TContext>(
  ctx: StandardServiceBuildContext<TContext>,
  options: StandardPhysicsGameModuleOptions<TContext>
) {
  const moduleOptions: PhysicsModuleOptions = {
    id: options.id ?? "gamekits.physics",
    backend: resolveStandardValue(ctx, options.backend)
  };

  if (options.scene !== undefined) {
    moduleOptions.scene = resolveStandardValue(ctx, options.scene);
  }
  if (options.fixedDeltaMs !== undefined) {
    moduleOptions.fixedDeltaMs = options.fixedDeltaMs;
  }
  if (options.maxSubSteps !== undefined) {
    moduleOptions.maxSubSteps = options.maxSubSteps;
  }
  if (options.bindings !== undefined) {
    moduleOptions.bindings = resolveStandardValue(ctx, options.bindings);
  }
  if (options.eventPolicy !== undefined) {
    moduleOptions.eventPolicy = resolveStandardValue(ctx, options.eventPolicy);
  }
  if (options.traceStore !== undefined) {
    moduleOptions.traceStore = resolveStandardValue(ctx, options.traceStore);
  }
  if (options.handle !== undefined) {
    moduleOptions.handle = resolveStandardValue(ctx, options.handle);
  }
  if (options.interpolationStore !== undefined) {
    moduleOptions.interpolationStore = resolveStandardValue(ctx, options.interpolationStore);
  }

  return createPhysicsModule(moduleOptions);
}
