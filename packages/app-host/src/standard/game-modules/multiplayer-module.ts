import { createMultiplayerModule, type MultiplayerModuleOptions } from "@gamekits/multiplayer-core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import { resolveStandardValue } from "../resolve";
import type { StandardMultiplayerGameModuleOptions, StandardServiceBuildContext } from "../types";

export function createStandardMultiplayerModule<TContext>(
  ctx: StandardServiceBuildContext<TContext>,
  options: StandardMultiplayerGameModuleOptions<TContext>
) {
  const runtime =
    options.runtime === undefined
      ? ctx.state.multiplayer
      : resolveStandardValue(ctx, options.runtime);
  if (!runtime) {
    throw new Error("Standard multiplayer game module requires the multiplayer service");
  }

  const moduleOptions: MultiplayerModuleOptions<GameInstallContext> = {
    runtime
  };
  if (options.handleCommand !== undefined) {
    moduleOptions.handleCommand = options.handleCommand;
  }
  if (options.id !== undefined) {
    moduleOptions.id = options.id;
  }
  if (options.commandKinds !== undefined) {
    moduleOptions.commandKinds = options.commandKinds;
  }
  if (options.commandQueue !== undefined) {
    moduleOptions.commandQueue = options.commandQueue;
  }
  if (options.authority !== undefined) {
    moduleOptions.authority = options.authority;
  }
  if (options.presentation !== undefined) {
    moduleOptions.presentation = resolveStandardValue(ctx, options.presentation);
  }
  if (options.clientReplication !== undefined) {
    moduleOptions.clientReplication = resolveStandardValue(ctx, options.clientReplication);
  }

  return createMultiplayerModule<GameInstallContext>(moduleOptions);
}
