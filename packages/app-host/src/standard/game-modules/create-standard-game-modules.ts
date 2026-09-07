import type { GameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import { resolveDriverCamera } from "../driver-adapters";
import { resolveStandardValue } from "../resolve";
import type {
  StandardCameraGameModuleOptions,
  StandardGameOptions,
  StandardServiceBuildContext
} from "../types";
import { createStandardAiModule } from "./ai-module";
import { createStandardAnimatorModule } from "./animator-module";
import { createStandardCameraModule } from "./camera-module";
import { createStandardCombatModule } from "./combat-module";
import { createStandardGasModule } from "./gas-module";
import { createStandardMultiplayerModule } from "./multiplayer-module";
import { createStandardNavigationModule } from "./navigation-module";
import { createStandardPhysicsModule } from "./physics-module";
import { createStandardTcaModule } from "./tca-module";

export function createStandardGameModules<TContext>(
  ctx: StandardServiceBuildContext<TContext>,
  options: StandardGameOptions<TContext>
): Array<GameModule<GameInstallContext>> {
  const modules: Array<GameModule<GameInstallContext>> = [];
  const standardModules = options.standardModules;

  if (standardModules?.tca) {
    modules.push(createStandardTcaModule(ctx, standardModules.tca));
  }

  if (standardModules?.gas) {
    modules.push(createStandardGasModule(ctx, standardModules.gas));
  }

  if (standardModules?.multiplayer) {
    modules.push(createStandardMultiplayerModule(ctx, standardModules.multiplayer));
  }

  if (standardModules?.physics) {
    modules.push(createStandardPhysicsModule(ctx, standardModules.physics));
  }

  if (standardModules?.combat) {
    modules.push(createStandardCombatModule(ctx, standardModules.combat));
  }

  if (standardModules?.navigation) {
    modules.push(createStandardNavigationModule(ctx, standardModules.navigation));
  }

  if (standardModules?.ai) {
    modules.push(createStandardAiModule(ctx, standardModules.ai));
  }

  if (standardModules?.animator) {
    modules.push(createStandardAnimatorModule(ctx, standardModules.animator));
  }

  if (standardModules?.camera) {
    const camera = resolveStandardValue(ctx, standardModules.camera.controller);

    modules.push(
      createStandardCameraModule({
        id: standardModules.camera.id,
        controller: camera,
        inputEventType: standardModules.camera.inputEventType,
        actions:
          standardModules.camera.actions === undefined
            ? []
            : resolveStandardValue(ctx, standardModules.camera.actions),
        smoothing:
          standardModules.camera.smoothing === undefined
            ? undefined
            : resolveStandardValue(ctx, standardModules.camera.smoothing),
        follow:
          standardModules.camera.follow === undefined
            ? undefined
            : resolveStandardValue(ctx, standardModules.camera.follow),
        sync: createCameraSync(standardModules.camera),
        buildContext: ctx
      })
    );
  }

  modules.push(
    ...(options.modules === undefined ? [] : resolveStandardValue(ctx, options.modules))
  );

  return modules;
}

function createCameraSync<TContext>(
  options: StandardCameraGameModuleOptions<TContext>
): StandardCameraGameModuleOptions<TContext>["sync"] {
  const shouldSyncToDriver = options.syncToDriver === true || options.driver !== undefined;

  return (syncCtx, controller, action, state) => {
    if (options.sync) {
      options.sync(syncCtx, controller, action, state);
    } else if (shouldSyncToDriver) {
      resolveDriverCamera(syncCtx, options.driver).applyCameraState(state);
    }
  };
}
