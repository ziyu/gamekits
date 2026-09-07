import { createConfiguredAppHost } from "@gamekits/app-host";
import type { ThreeRendererNative } from "@gamekits/driver-three";
import { initRapier3dPhysicsBackend } from "@gamekits/physics-rapier3d";
import { characterControllerLabAppDefinition } from "./app-definition";
import {
  createCharacterControllerLabWebProfile,
  measureCharacterControllerLabViewport,
  type CharacterControllerLabAppContext
} from "./app-profile";
import { createCharacterControllerLabThirdPersonCamera } from "./camera";
import { characterControllerLabIntent } from "./motor";
import { createCharacterControllerLabInput } from "./input";
import { createCharacterControllerLab } from "./runtime";
import { renderCharacterControllerLabUi } from "./ui";
import { createCharacterControllerLabVisual } from "./visual";
import "./styles.css";

const groups = {
  runner: 0b0001,
  course: 0b0010,
  dynamic: 0b0100
} as const;

export async function mount(root: HTMLElement): Promise<void> {
  const ui = renderCharacterControllerLabUi(root);
  ui.setLoading(true, "Booting App Host and Three driver");
  const context: CharacterControllerLabAppContext = { viewport: ui.viewport };
  const { host } = createConfiguredAppHost({
    app: characterControllerLabAppDefinition,
    profile: createCharacterControllerLabWebProfile(),
    context
  });
  await host.boot();
  await host.start();
  ui.setLoading(true, "Loading Rapier3D and materializing the motor course");
  const backend = await initRapier3dPhysicsBackend({
    id: "sandbox.character-controller-lab.rapier3d",
    groups
  });
  const renderer = requireValue(context.renderer, "renderer");
  const native = renderer.native() as ThreeRendererNative;
  const lab = createCharacterControllerLab(backend);
  const camera = createCharacterControllerLabThirdPersonCamera(native);
  const visual = createCharacterControllerLabVisual(native, camera);
  let snapshot = lab.snapshot();
  const input = createCharacterControllerLabInput(ui.viewport);
  let sequence = 0;
  let disposed = false;

  const commit = (next: ReturnType<typeof lab.snapshot>): void => {
    snapshot = next;
    visual.update(snapshot);
    ui.update(snapshot);
  };

  const onPointerDown = (): void => ui.viewport.focus();

  ui.viewport.addEventListener("pointerdown", onPointerDown);
  input.start();

  ui.pauseButton.addEventListener("click", () => commit(lab.setPaused(!snapshot.paused)));
  ui.stepButton.addEventListener("click", () => commit(lab.singleStep()));
  ui.staggerButton.addEventListener("click", () => commit(lab.queueStagger()));
  ui.impulseButton.addEventListener("click", () => commit(lab.applyExternalImpulse()));
  ui.resetButton.addEventListener("click", () => commit(lab.reset()));
  for (const [stationId, button] of ui.stationButtons) {
    button.addEventListener("click", () => {
      commit(lab.moveToStation(stationId));
      ui.viewport.focus();
    });
  }

  const resizeObserver = new ResizeObserver(() => {
    const size = measureCharacterControllerLabViewport(ui.viewport);
    renderer.resize(size.width, size.height);
  });
  resizeObserver.observe(ui.viewport);

  let lastTime: number | undefined;
  let lastUiUpdate = 0;
  let frameHandle = 0;
  const frame = (now: number): void => {
    if (disposed) return;
    const deltaMs = lastTime === undefined ? 1000 / 60 : Math.max(0, Math.min(80, now - lastTime));
    lastTime = now;
    host.tick(deltaMs, now);
    sequence += 1;
    input.tick(now);
    const inputFrame = input.sample(sequence);
    camera.applyInput(inputFrame.camera);
    const movement = camera.movement(inputFrame.axes.moveX, inputFrame.axes.moveZ);
    lab.setIntent(
      characterControllerLabIntent({
        ...inputFrame.axes,
        moveX: movement.x,
        moveZ: movement.z
      })
    );
    snapshot = lab.advance(deltaMs);
    visual.update(snapshot, deltaMs);
    if (now - lastUiUpdate >= 1000 / 20) {
      ui.update(snapshot);
      lastUiUpdate = now;
    }
    frameHandle = requestAnimationFrame(frame);
  };

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frameHandle);
    resizeObserver.disconnect();
    ui.viewport.removeEventListener("pointerdown", onPointerDown);
    input.destroy();
    lab.dispose();
    visual.destroy();
    camera.destroy();
    await host.dispose();
    ui.dispose();
  };

  commit(snapshot);
  ui.setLoading(false);
  ui.viewport.focus();
  frameHandle = requestAnimationFrame(frame);
  window.addEventListener("beforeunload", () => void dispose(), { once: true });
}

function requireValue<TValue>(value: TValue | undefined, label: string): TValue {
  if (value === undefined) throw new Error(`Character Controller Lab ${label} is unavailable`);
  return value;
}
