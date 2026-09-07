import "@gamekits/devtools-ui/styles.css";
import "./styles.css";
import { createConfiguredAppHost } from "@gamekits/app-host";
import type { InputActionEvent } from "@gamekits/input-core";
import { createUiRuntime } from "@gamekits/ui-core";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ABYSS_ACTION, applyAbyssInputAction } from "./app-input";
import { abyssAppDefinition } from "./app-definition";
import { createAbyssWebProfile, type AbyssAppContext } from "./app-profile";
import { createAbyssDevToolsTraceBridge } from "./devtools/abyss-devtools";
import { AbyssApp } from "./ui/AbyssApp";

const CHECKPOINT_SLOT_ID = "checkpoint";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app element");
}

void boot(app).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  app.textContent = `Abyss Delve failed to boot: ${message}`;
  throw error;
});

async function boot(rootElement: HTMLElement): Promise<void> {
  const reactRoot = createRoot(rootElement);
  const uiRuntime = createUiRuntime();
  const rendererRoot = document.createElement("div");
  rendererRoot.className = "abyss-renderer";
  rendererRoot.setAttribute("aria-label", "Abyss Delve game viewport");
  const context: AbyssAppContext = {
    ui: {
      rendererRoot
    },
    uiRuntime,
    inputBlocked: false
  };

  let unsubscribeFocus: (() => void) | undefined;
  let unsubscribeInput: (() => void) | undefined;
  let saveStatus: string | undefined;
  const devtoolsTraceBridge = createAbyssDevToolsTraceBridge(() => context.devtools);

  const render = (sync = false) => {
    const snapshot = context.abyss?.snapshot();
    devtoolsTraceBridge.sync(snapshot);
    context.inputBlocked =
      snapshot?.rewardOpen === true ||
      snapshot?.player.inventoryOpen === true ||
      snapshot?.player.paused === true;
    if (context.abyss) {
      context.abyss.input.gameplayBlocked = context.inputBlocked;
    }

    const element = (
      <AbyssApp
        devtools={context.devtools}
        onLoadCheckpoint={() => {
          void loadCheckpoint(context, (status) => {
            saveStatus = status;
            render();
          });
        }}
        onGameFocus={() => uiRuntime.setFocus({ scope: "game", reason: "abyss.viewport" })}
        onReward={(rewardId) => {
          if (context.abyss) {
            context.abyss.input.rewardChoiceRequested = rewardId;
          }
        }}
        onSaveCheckpoint={() => {
          void saveCheckpoint(context, (status) => {
            saveStatus = status;
            render();
          });
        }}
        rendererRoot={rendererRoot}
        saveStatus={saveStatus}
        snapshot={snapshot}
        uiRuntime={uiRuntime}
      />
    );
    if (sync) {
      flushSync(() => reactRoot.render(element));
      return;
    }
    reactRoot.render(element);
  };

  render(true);
  await waitForRendererRoot(rendererRoot);

  const configured = createConfiguredAppHost({
    app: abyssAppDefinition,
    profile: createAbyssWebProfile(),
    context
  });
  const host = configured.host;
  await host.boot();
  if (!context.abyss || !context.inputRouter) {
    throw new Error("Abyss app failed to initialize runtime services");
  }

  unsubscribeInput = context.inputRouter.onAction((event) =>
    routeInputAction(context, event, uiRuntime)
  );
  unsubscribeFocus = uiRuntime.subscribe(() => {
    const scope = uiRuntime.focus().scope;
    if (scope !== "game" && scope !== "none") context.inputRouter?.cancelAll();
  });
  await host.start();
  render();

  let lastTime: number | undefined;
  const frame = (now: number) => {
    const delta = lastTime === undefined ? 0 : Math.max(0, Math.min(48, now - lastTime));
    lastTime = now;
    host.tick(delta, now);
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  window.addEventListener(
    "beforeunload",
    () => {
      unsubscribeFocus?.();
      unsubscribeInput?.();
      host.dispose();
    },
    { once: true }
  );
}

async function saveCheckpoint(
  context: AbyssAppContext,
  updateStatus: (status: string) => void
): Promise<void> {
  if (!context.abyss || !context.saveManager) {
    updateStatus("Checkpoint unavailable");
    return;
  }

  updateStatus("Saving...");
  try {
    const checkpoint = context.abyss.captureCheckpoint();
    const clock = context.abyss.runtime.clock.snapshot();
    await context.saveManager.save(CHECKPOINT_SLOT_ID, {
      runtime: {
        seed: checkpoint.seed,
        clock: {
          ticks: clock.ticks,
          elapsed: clock.elapsed
        }
      },
      metadata: {
        label: "Abyss Delve Checkpoint",
        description: `Room ${context.abyss.snapshot().objective.roomIndex + 1}`,
        tags: ["abyss", "checkpoint"]
      }
    });
    context.abyss.trace({
      kind: "save",
      label: "checkpoint saved",
      payload: {
        roomId: checkpoint.currentRoomId,
        roomIndex: checkpoint.roomIndex,
        gold: checkpoint.gold,
        ticks: clock.ticks,
        elapsed: clock.elapsed
      }
    });
    updateStatus(`Saved tick ${clock.ticks}`);
  } catch (error) {
    updateStatus(error instanceof Error ? error.message : "Save failed");
  }
}

async function loadCheckpoint(
  context: AbyssAppContext,
  updateStatus: (status: string) => void
): Promise<void> {
  if (!context.abyss || !context.saveManager) {
    updateStatus("Checkpoint unavailable");
    return;
  }

  updateStatus("Loading...");
  try {
    const result = await context.saveManager.load(CHECKPOINT_SLOT_ID);
    context.abyss.runtime.clock.restore({
      elapsed: result.envelope.payload.runtime.clock.elapsed,
      ticks: result.envelope.payload.runtime.clock.ticks,
      running: context.abyss.runtime.isRunning()
    });
    context.abyss.trace({
      kind: "save",
      label: "checkpoint loaded",
      payload: {
        ticks: result.envelope.payload.runtime.clock.ticks,
        elapsed: result.envelope.payload.runtime.clock.elapsed
      }
    });
    updateStatus(`Loaded tick ${result.envelope.payload.runtime.clock.ticks}`);
  } catch (error) {
    updateStatus(error instanceof Error ? error.message : "Load failed");
  }
}

function routeInputAction(
  context: AbyssAppContext,
  event: InputActionEvent,
  uiRuntime: ReturnType<typeof createUiRuntime>
): void {
  if (!context.abyss) {
    return;
  }

  applyAbyssInputAction(context.abyss.input, toAbyssGameInput(context, event));
  if (event.input.scope === "game" && event.phase !== "cancelled" && event.phase !== "released") {
    uiRuntime.setFocus({ scope: "game", reason: event.actionId });
  }
  context.abyss.trace({
    kind: "input",
    label: event.actionId,
    payload: { phase: event.phase }
  });
}

function toAbyssGameInput(context: AbyssAppContext, event: InputActionEvent): InputActionEvent {
  if (
    event.actionId !== ABYSS_ACTION.aim ||
    event.input.x === undefined ||
    event.input.y === undefined
  ) {
    return event;
  }

  const world = context.abyss?.screenToWorld({ x: event.input.x, y: event.input.y });
  if (!world) {
    return event;
  }

  return {
    ...event,
    input: {
      ...event.input,
      x: world.x,
      y: world.y
    }
  };
}

async function waitForRendererRoot(rendererRoot: HTMLElement): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (rendererRoot.isConnected) {
      return;
    }
    await new Promise((done) => window.setTimeout(done, 0));
  }
  throw new Error("Abyss renderer root was not mounted");
}
