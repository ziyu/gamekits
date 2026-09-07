import { createConfiguredAppHost } from "@gamekits/app-host";
import { initRapier2dPhysicsBackend } from "@gamekits/physics-rapier2d";
import { createUiRuntime } from "@gamekits/ui-core";
import { combatRangeAppDefinition } from "./app-definition";
import { createCombatRangeWebProfile, type CombatRangeAppContext } from "./app-profile";
import {
  bindCombatRangeUi,
  mountCombatRangeDevTools,
  renderCombatRangeUi,
  updateCombatRangeUi
} from "./ui";
import "./styles.css";

export async function mount(root: HTMLElement): Promise<void> {
  const uiRuntime = createUiRuntime();
  const ui = renderCombatRangeUi(root, uiRuntime);
  const backend = await initRapier2dPhysicsBackend({
    id: "sandbox.combat-range.rapier2d",
    groups: {
      actor: 0b0001,
      cover: 0b0010,
      projectile: 0b0100
    }
  });
  const context: CombatRangeAppContext = { uiRuntime };
  const { host } = createConfiguredAppHost({
    app: combatRangeAppDefinition,
    profile: createCombatRangeWebProfile({ backend, uiRuntime }),
    context
  });

  await host.boot();
  const scene = requireScene(context);
  bindCombatRangeUi(ui, scene);
  if (context.devtools) {
    mountCombatRangeDevTools(ui, context.devtools);
  }
  await host.start();

  let frameHandle = 0;
  let lastTime: number | undefined;
  let lastUiUpdate = 0;
  const frame = (now: number): void => {
    const delta = lastTime === undefined ? 0 : Math.max(0, Math.min(now - lastTime, 64));
    lastTime = now;
    host.tick(delta, now);
    if (now - lastUiUpdate >= 1000 / 30) {
      lastUiUpdate = now;
      updateCombatRangeUi(ui, scene.snapshot());
    }
    frameHandle = requestAnimationFrame(frame);
  };

  updateCombatRangeUi(ui, scene.snapshot());
  frameHandle = requestAnimationFrame(frame);
  window.addEventListener(
    "beforeunload",
    () => {
      cancelAnimationFrame(frameHandle);
      void host.dispose();
    },
    { once: true }
  );
}

function requireScene(context: CombatRangeAppContext) {
  if (!context.scene) {
    throw new Error("Combat range runtime was not exposed by App Host");
  }
  return context.scene;
}
