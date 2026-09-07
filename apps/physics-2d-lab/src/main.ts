import "./styles.css";
import { initRapier2dPhysicsBackend } from "@gamekits/physics-rapier2d";
import { PHYSICS_2D_GROUPS, createPhysics2dLab } from "./physics-2d-lab";
import {
  bindPhysics2dLabUi,
  drawPhysics2dLab,
  renderPhysics2dLabShell,
  updatePhysics2dLabUi
} from "./ui";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app element");
}

void boot(root).catch((error) => {
  root.replaceChildren();
  const message = document.createElement("pre");
  message.className = "physics-2d-lab__boot-error";
  message.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
  root.append(message);
});

async function boot(rootElement: HTMLElement): Promise<void> {
  const ui = renderPhysics2dLabShell(rootElement);
  ui.pushDiagnostic("initializing rapier2d compat backend");
  const backend = await initRapier2dPhysicsBackend({
    id: "physics-2d-lab.rapier2d",
    groups: PHYSICS_2D_GROUPS
  });
  const lab = createPhysics2dLab(backend);
  bindPhysics2dLabUi(ui, lab);
  let snapshot = lab.snapshot();
  updatePhysics2dLabUi(ui, snapshot);
  drawPhysics2dLab(ui.canvas, snapshot);
  ui.pushDiagnostic("physics scene ready");

  let lastTime: number | undefined;
  let frameHandle = 0;
  const frame = (now: number): void => {
    const delta = lastTime === undefined ? 1000 / 60 : now - lastTime;
    lastTime = now;
    snapshot = lab.step(delta);
    updatePhysics2dLabUi(ui, snapshot);
    drawPhysics2dLab(ui.canvas, snapshot);
    frameHandle = requestAnimationFrame(frame);
  };
  frameHandle = requestAnimationFrame(frame);

  window.addEventListener(
    "beforeunload",
    () => {
      cancelAnimationFrame(frameHandle);
      lab.dispose();
    },
    { once: true }
  );
}
