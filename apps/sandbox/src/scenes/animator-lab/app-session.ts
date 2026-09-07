import { createConfiguredAppHost } from "@gamekits/app-host";
import type { DevToolsRuntime } from "@gamekits/devtools";
import type { UiRuntime } from "@gamekits/ui-core";
import { animatorLabAppDefinition } from "./app-definition";
import { createAnimatorLabWebProfile, type AnimatorLabAppContext } from "./app-profile";
import type { AnimatorLabController } from "./runtime";

export type AnimatorLabAppSession = {
  scene: AnimatorLabController;
  devtools?: DevToolsRuntime | undefined;
  tick(deltaMs: number, elapsedMs: number): void;
  dispose(): Promise<void>;
};

export async function createAnimatorLabAppSession(options: {
  stageRoot: HTMLElement;
  uiRuntime: UiRuntime;
}): Promise<AnimatorLabAppSession> {
  const context: AnimatorLabAppContext = {
    stageRoot: options.stageRoot,
    uiRuntime: options.uiRuntime
  };
  const { host } = createConfiguredAppHost({
    app: animatorLabAppDefinition,
    profile: createAnimatorLabWebProfile(options),
    context
  });

  await host.boot();
  const scene = requireScene(context);
  scene.start();
  await host.start();

  return {
    scene,
    devtools: context.devtools,
    tick(deltaMs, elapsedMs) {
      host.tick(deltaMs, elapsedMs);
    },
    async dispose() {
      scene.dispose();
      await host.dispose();
    }
  };
}

function requireScene(context: AnimatorLabAppContext): AnimatorLabController {
  if (!context.scene) {
    throw new Error("Animator Lab controller was not exposed by App Host");
  }
  return context.scene;
}
