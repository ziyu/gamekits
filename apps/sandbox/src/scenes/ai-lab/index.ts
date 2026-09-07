import { createUiRuntime } from "@gamekits/ui-core";
import { createAiLabAppSession } from "./app-session";
import { renderAiLabUi } from "./ui";
import "./styles.css";

export async function mount(root: HTMLElement): Promise<void> {
  const uiRuntime = createUiRuntime();
  const ui = renderAiLabUi(root, uiRuntime);
  const session = await createAiLabAppSession({ uiRuntime });
  ui.bind(session.scene);
  if (session.devtools) {
    ui.mountDevTools(session.devtools);
  }

  let frameHandle = 0;
  let lastTime: number | undefined;
  let lastUiUpdate = 0;
  let disposed = false;

  const frame = (now: number): void => {
    const delta = lastTime === undefined ? 0 : Math.max(0, Math.min(now - lastTime, 64));
    lastTime = now;
    session.tick(delta);
    if (now - lastUiUpdate >= 1000 / 24) {
      lastUiUpdate = now;
      ui.update(session.scene.snapshot());
    }
    frameHandle = requestAnimationFrame(frame);
  };

  const dispose = async (): Promise<void> => {
    if (disposed) {
      return;
    }
    disposed = true;
    cancelAnimationFrame(frameHandle);
    await session.dispose();
    ui.dispose();
  };

  session.tick(0);
  ui.update(session.scene.snapshot());
  frameHandle = requestAnimationFrame(frame);
  window.addEventListener("beforeunload", () => void dispose(), { once: true });
}
