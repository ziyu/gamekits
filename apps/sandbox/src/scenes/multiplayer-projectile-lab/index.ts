import { initRapier2dPhysicsBackend } from "@gamekits/physics-rapier2d";
import { createMultiplayerProjectileLabRuntime } from "./runtime";
import {
  bindMultiplayerProjectileLabUi,
  renderMultiplayerProjectileLabUi,
  updateMultiplayerProjectileLabUi
} from "./ui";
import "./styles.css";

export async function mount(root: HTMLElement): Promise<void> {
  const ui = renderMultiplayerProjectileLabUi(root);
  const backend = await initRapier2dPhysicsBackend({
    id: "sandbox.multiplayer-projectile-lab.rapier2d"
  });
  const runtime = await createMultiplayerProjectileLabRuntime({
    physicsBackend: backend,
    latencyMs: Number(ui.latencyInput.value)
  });
  bindMultiplayerProjectileLabUi(ui, runtime);
  updateMultiplayerProjectileLabUi(ui, runtime.snapshot());

  let frameHandle = 0;
  let previous: number | undefined;
  const frame = (now: number): void => {
    const delta = previous === undefined ? 0 : Math.max(0, Math.min(100, now - previous));
    previous = now;
    runtime.update(delta);
    updateMultiplayerProjectileLabUi(ui, runtime.snapshot());
    frameHandle = requestAnimationFrame(frame);
  };
  frameHandle = requestAnimationFrame(frame);

  window.addEventListener(
    "beforeunload",
    () => {
      cancelAnimationFrame(frameHandle);
      void runtime.dispose();
      ui.root.unmount();
    },
    { once: true }
  );
}
