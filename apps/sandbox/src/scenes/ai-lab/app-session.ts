import { createConfiguredAppHost } from "@gamekits/app-host";
import type { DevToolsRuntime } from "@gamekits/devtools";
import type { UiRuntime } from "@gamekits/ui-core";
import { aiLabAppDefinition } from "./app-definition";
import { createAiLabWebProfile, type AiLabAppContext } from "./app-profile";
import type { AiLabController } from "./runtime";

export type AiLabAppSession = {
  scene: AiLabController;
  devtools?: DevToolsRuntime | undefined;
  tick(deltaMs: number): void;
  dispose(): Promise<void>;
};

export async function createAiLabAppSession(options: {
  uiRuntime: UiRuntime;
}): Promise<AiLabAppSession> {
  const context: AiLabAppContext = { uiRuntime: options.uiRuntime };
  const { host } = createConfiguredAppHost({
    app: aiLabAppDefinition,
    profile: createAiLabWebProfile(options),
    context
  });

  await host.boot();
  const scene = requireScene(context);
  scene.start();
  await host.start();

  return {
    scene,
    devtools: context.devtools,
    tick(deltaMs) {
      const step = scene.advance(deltaMs);
      if (step === undefined) {
        return;
      }
      host.tick(step.deltaMs, step.elapsedMs);
      scene.afterTick(step.deltaMs);
    },
    async dispose() {
      scene.dispose();
      await host.dispose();
    }
  };
}

function requireScene(context: AiLabAppContext): AiLabController {
  if (!context.scene) {
    throw new Error("AI Lab controller was not exposed by App Host");
  }
  return context.scene;
}
