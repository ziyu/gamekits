import { createConfiguredAppHost } from "@gamekits/app-host";
import type { DevToolsRuntime } from "@gamekits/devtools";
import type { UiRuntime } from "@gamekits/ui-core";
import { navigationLabAppDefinition } from "./app-definition";
import { createNavigationLabWebProfile, type NavigationLabAppContext } from "./app-profile";
import type { NavigationLabBackendProvider } from "./backends";
import { NAVIGATION_LAB_SCENARIO, type NavigationLabScenarioDefinition } from "./scenario";
import type { NavigationLabController } from "./types";

export type NavigationLabAppSession = {
  scenario: NavigationLabScenarioDefinition;
  backend: NavigationLabBackendProvider;
  scene: NavigationLabController;
  devtools?: DevToolsRuntime | undefined;
  tick(deltaMs: number, elapsedMs: number): void;
  dispose(): Promise<void>;
};

export async function createNavigationLabAppSession(options: {
  uiRuntime: UiRuntime;
  scenario?: NavigationLabScenarioDefinition | undefined;
  backend: NavigationLabBackendProvider;
}): Promise<NavigationLabAppSession> {
  const scenario = options.scenario ?? NAVIGATION_LAB_SCENARIO;
  const context: NavigationLabAppContext = { uiRuntime: options.uiRuntime };
  const { host } = createConfiguredAppHost({
    app: navigationLabAppDefinition,
    profile: createNavigationLabWebProfile({ ...options, scenario }),
    context
  });

  await host.boot();
  const scene = requireScene(context);
  await host.start();

  return {
    scenario,
    backend: options.backend,
    scene,
    devtools: context.devtools,
    tick(deltaMs, elapsedMs) {
      host.tick(deltaMs, elapsedMs);
    },
    async dispose() {
      await host.dispose();
    }
  };
}

function requireScene(context: NavigationLabAppContext): NavigationLabController {
  if (!context.scene) {
    throw new Error("Navigation Lab runtime was not exposed by App Host");
  }
  return context.scene;
}
