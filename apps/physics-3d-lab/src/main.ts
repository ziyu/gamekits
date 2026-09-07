import "./styles.css";
import { createConfiguredAppHost } from "@gamekits/app-host";
import type { ThreeRendererNative } from "@gamekits/driver-three";
import { initRapier3dPhysicsBackend } from "@gamekits/physics-rapier3d";
import { physics3dLabAppDefinition } from "./app-definition";
import {
  createPhysics3dLabProfile,
  measureViewport,
  type Physics3dLabAppContext
} from "./app-profile";
import { createPhysics3dFreeCamera } from "./physics-3d-free-camera";
import { createPhysics3dCharacterIntent } from "./physics-3d-character-controller";
import { PHYSICS_3D_GROUPS, createPhysics3dLab, type Physics3dLabSnapshot } from "./physics-3d-lab";
import { createPhysics3dLabVisual, screenToPhysicsQueryPoint } from "./physics-3d-visual";
import {
  bindPhysics3dLabUi,
  renderPhysics3dLabShell,
  setPhysics3dLabLoading,
  updatePhysics3dLabUi
} from "./ui";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app element");
}

void boot(root).catch((error) => {
  root.replaceChildren();
  const message = document.createElement("pre");
  message.className = "physics-3d-lab__boot-error";
  message.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
  root.append(message);
});

async function boot(rootElement: HTMLElement): Promise<void> {
  const ui = renderPhysics3dLabShell(rootElement);
  const context: Physics3dLabAppContext = { ui };
  setPhysics3dLabLoading(ui, {
    visible: true,
    title: "Booting App Host",
    detail: "Registering Web platform and Three driver"
  });
  const configured = createConfiguredAppHost({
    app: physics3dLabAppDefinition,
    profile: createPhysics3dLabProfile(),
    context
  });
  await configured.host.boot();
  await configured.host.start();

  setPhysics3dLabLoading(ui, {
    visible: true,
    title: "Initializing Rapier3D",
    detail: "Preparing physics scene and debug mesh layer"
  });
  const backend = await initRapier3dPhysicsBackend({
    id: "physics-3d-lab.rapier3d",
    groups: PHYSICS_3D_GROUPS
  });
  const renderer = requireContext(context.renderer, "renderer");
  const lab = createPhysics3dLab(backend);
  const threeNative = renderer.native() as ThreeRendererNative;
  const visual = createPhysics3dLabVisual(threeNative);
  let snapshot = lab.snapshot();
  const freeCamera = createPhysics3dFreeCamera(threeNative, ui.viewport, {
    enabled: () => snapshot.cameraPreset === "free"
  });
  const commitSnapshot = (
    nextSnapshot: Physics3dLabSnapshot,
    options: { updateUi?: boolean | undefined } = {}
  ): void => {
    snapshot = nextSnapshot;
    if (snapshot.cameraPreset === "free") {
      freeCamera.apply();
    }
    visual.update(snapshot);
    if (options.updateUi !== false) {
      updatePhysics3dLabUi(ui, snapshot);
    }
  };
  bindPhysics3dLabUi(ui, lab, commitSnapshot);
  commitSnapshot(snapshot);
  setPhysics3dLabLoading(ui, { visible: false });
  ui.pushDiagnostic("physics scene ready");
  ui.viewport.tabIndex = 0;
  ui.viewport.setAttribute("aria-label", "Physics 3D controller viewport");
  const pressedKeys = new Set<string>();
  let characterSequence = 0;
  let jumpRequested = false;
  let diveRequested = false;
  const onCharacterKeyDown = (event: KeyboardEvent): void => {
    if (!characterControlCode(event.code)) return;
    event.preventDefault();
    pressedKeys.add(event.code);
    if (!event.repeat && event.code === "Space") jumpRequested = true;
    if (!event.repeat && (event.code === "ShiftLeft" || event.code === "ShiftRight")) {
      diveRequested = true;
    }
  };
  const onCharacterKeyUp = (event: KeyboardEvent): void => {
    if (!characterControlCode(event.code)) return;
    event.preventDefault();
    pressedKeys.delete(event.code);
  };
  ui.viewport.addEventListener("keydown", onCharacterKeyDown);
  ui.viewport.addEventListener("keyup", onCharacterKeyUp);

  const resizeObserver = new ResizeObserver(() => {
    const size = measureViewport(ui.viewport);
    renderer.resize(size.width, size.height);
  });
  resizeObserver.observe(ui.viewport);
  const updateQueryFromPointer = (event: PointerEvent): void => {
    if (freeCamera.isDragging()) {
      return;
    }
    const point = screenToPhysicsQueryPoint(
      threeNative,
      ui.viewport.getBoundingClientRect(),
      event.clientX,
      event.clientY
    );
    if (point) {
      commitSnapshot(lab.setQueryPoint(point), { updateUi: false });
    }
  };
  ui.viewport.addEventListener("pointermove", updateQueryFromPointer);

  let lastTime: number | undefined;
  let lastUiUpdate = 0;
  let frameHandle = 0;
  const frame = (now: number): void => {
    const delta = lastTime === undefined ? 1000 / 60 : now - lastTime;
    lastTime = now;
    configured.host.tick(delta, now);
    characterSequence += 1;
    lab.setCharacterIntent(
      createPhysics3dCharacterIntent({
        sequence: characterSequence,
        moveX: Number(pressedKeys.has("KeyD")) - Number(pressedKeys.has("KeyA")),
        moveZ: Number(pressedKeys.has("KeyS")) - Number(pressedKeys.has("KeyW")),
        jumpPressed: jumpRequested,
        jumpHeld: pressedKeys.has("Space"),
        divePressed: diveRequested
      })
    );
    jumpRequested = false;
    diveRequested = false;
    commitSnapshot(lab.step(delta), { updateUi: false });
    if (now - lastUiUpdate > 120) {
      updatePhysics3dLabUi(ui, snapshot);
      lastUiUpdate = now;
    }
    frameHandle = requestAnimationFrame(frame);
  };
  frameHandle = requestAnimationFrame(frame);

  window.addEventListener(
    "beforeunload",
    () => {
      cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      ui.viewport.removeEventListener("pointermove", updateQueryFromPointer);
      ui.viewport.removeEventListener("keydown", onCharacterKeyDown);
      ui.viewport.removeEventListener("keyup", onCharacterKeyUp);
      freeCamera.destroy();
      visual.destroy();
      lab.dispose();
      void configured.host.dispose();
    },
    { once: true }
  );
}

function characterControlCode(code: string): boolean {
  return (
    code === "KeyW" ||
    code === "KeyA" ||
    code === "KeyS" ||
    code === "KeyD" ||
    code === "Space" ||
    code === "ShiftLeft" ||
    code === "ShiftRight"
  );
}

function requireContext<TValue>(value: TValue | undefined, name: string): TValue {
  if (value === undefined) {
    throw new Error(`Missing Physics 3D Lab context value: ${name}`);
  }
  return value;
}
