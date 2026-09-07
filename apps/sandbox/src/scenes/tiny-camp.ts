import { createConfiguredAppHost } from "@gamekits/app-host";
import type { NormalizedInputEvent } from "@gamekits/input-core";
import { createUiRuntime } from "@gamekits/ui-core";
import {
  routeSandboxSceneOverlayInput,
  SANDBOX_SCENE_CLICK_ACTION_ID,
  toRendererLocalInput
} from "../app-input";
import { sandboxAppDefinition } from "../app-definition";
import { createSandboxWebProfile, type SandboxAppContext } from "../app-profile";
import { SANDBOX_SAVE_SLOT_ID } from "../game";
import { resolveSandboxSceneClickTarget } from "../scene-hit-test";
import { createSandboxThreePreview, type SandboxThreePreview } from "../three-preview";
import {
  applySandboxSceneClickSelection,
  bindSandboxWorkbenchControls,
  createSandboxWorkbenchState,
  renderSandboxShell,
  updateAssetStatus,
  updateDataStatus,
  updateHostStatus,
  updatePlatformStatus,
  updateSandboxHud,
  mountSandboxDevToolsOverlay
} from "../ui/render-sandbox";

export async function mount(root: HTMLElement): Promise<void> {
  const uiRuntime = createUiRuntime();
  const ui = renderSandboxShell(root, uiRuntime);
  const workbench = createSandboxWorkbenchState();
  const context: SandboxAppContext = {
    ui,
    uiRuntime,
    activeInputScope: "ui"
  };
  uiRuntime.subscribe(() => {
    const scope = uiRuntime.focus().scope;
    context.activeInputScope = scope === "game" ? "game" : "ui";
  });
  const refreshWorkbench = () => {
    if (context.sandbox) {
      updateSandboxHud(ui, context.sandbox, workbench, {
        forceSnapshot: true,
        forceWorkbench: true
      });
    }
  };

  bindSandboxWorkbenchControls(ui, workbench, {
    onChange: refreshWorkbench,
    onFollowEntity(entityId) {
      context.sandbox?.runtime.eventBus.emit(
        "camera.follow_entity",
        { entityId },
        "sandbox.inspector"
      );
    },
    onStopFollow() {
      context.sandbox?.runtime.eventBus.emit("camera.stop_follow", {}, "sandbox.inspector");
    },
    onSave() {
      void saveSandbox(context, workbench, refreshWorkbench);
    },
    onLoad() {
      void loadSandbox(context, workbench, refreshWorkbench);
    },
    onSceneOverlayInput(event) {
      routeSandboxSceneOverlayInput(context, event);
    }
  });

  const configured = createConfiguredAppHost({
    app: sandboxAppDefinition,
    profile: createSandboxWebProfile(),
    context
  });
  const { host } = configured;
  const unsubscribeScenePick = requireSandboxContext(context.inputRouter, "inputRouter").onAction(
    (event) => {
      if (event.actionId !== SANDBOX_SCENE_CLICK_ACTION_ID || event.phase !== "released") {
        return;
      }
      const input = toRendererLocalInput(context, event.input);
      applySandboxSceneClickSelection(ui, workbench, resolveSceneClickSelection(context, input));
      refreshWorkbench();
    }
  );

  updateHostStatus(ui, host);
  await host.boot();
  const threePreview = createSandboxThreePreview(requireSandboxContext(context.drivers, "drivers"));
  updateHostStatus(ui, host);
  if (context.devtools) {
    mountSandboxDevToolsOverlay(ui, context.devtools);
  }
  updateDataStatus(ui, requireSandboxContext(context.dataRegistry, "dataRegistry"));
  updateAssetStatus(ui, requireSandboxContext(context.assetManager, "assetManager"));

  const platform = requireSandboxContext(context.platform, "platform");
  await platform.services.storage.setItem("sandbox.platform", "ready");
  updatePlatformStatus(ui, {
    id: platform.id,
    storage: (await platform.services.storage.getItem("sandbox.platform")) ?? "unavailable",
    fs:
      (await platform.services.permissions.query("fs.write")) === "granted"
        ? "memory"
        : "unavailable"
  });
  await host.start();
  updateHostStatus(ui, host);

  let lastTime: number | undefined;
  let frameHandle = 0;

  function frame(now: number) {
    const sandbox = requireSandboxContext(context.sandbox, "sandbox");
    const assetManager = requireSandboxContext(context.assetManager, "assetManager");
    const delta = lastTime === undefined ? 0 : Math.max(0, Math.min(now - lastTime, 64));
    lastTime = now;
    host.tick(delta, now);
    threePreview.update(delta);
    updateSandboxHud(ui, sandbox, workbench);
    updateAssetStatus(ui, assetManager);
    updateHostStatus(ui, host);
    frameHandle = requestAnimationFrame(frame);
  }

  updateSandboxHud(ui, requireSandboxContext(context.sandbox, "sandbox"), workbench);
  frameHandle = requestAnimationFrame(frame);
  window.addEventListener(
    "beforeunload",
    () => {
      cancelAnimationFrame(frameHandle);
      unsubscribeScenePick();
      disposeThreePreview(threePreview);
      void host.dispose();
    },
    { once: true }
  );
}

function requireSandboxContext<TValue>(value: TValue | undefined, name: string): TValue {
  if (value === undefined) {
    throw new Error(`Missing sandbox app context value: ${name}`);
  }

  return value;
}

async function saveSandbox(
  context: SandboxAppContext,
  workbench: ReturnType<typeof createSandboxWorkbenchState>,
  refreshWorkbench: () => void
): Promise<void> {
  if (!context.sandbox || !context.saveManager) {
    workbench.saveStatus = "save unavailable";
    refreshWorkbench();
    return;
  }

  workbench.saveStatus = "saving...";
  refreshWorkbench();
  try {
    const clock = context.sandbox.runtime.clock.snapshot();
    await context.saveManager.save(SANDBOX_SAVE_SLOT_ID, {
      runtime: {
        seed: "tiny-camp-dev-seed",
        clock: {
          ticks: clock.ticks,
          elapsed: clock.elapsed
        }
      },
      metadata: {
        label: "Tiny Camp Local",
        description: "Sandbox local save",
        playtimeMs: clock.elapsed,
        tags: ["sandbox", "tiny-camp"]
      }
    });
    context.sandbox.runtime.eventBus.emit("sandbox.save_completed", {}, "sandbox.ui");
    workbench.saveStatus = `saved tick ${clock.ticks}`;
  } catch (error) {
    workbench.saveStatus = `save failed: ${readErrorMessage(error)}`;
  }
  refreshWorkbench();
}

async function loadSandbox(
  context: SandboxAppContext,
  workbench: ReturnType<typeof createSandboxWorkbenchState>,
  refreshWorkbench: () => void
): Promise<void> {
  if (!context.sandbox || !context.saveManager) {
    workbench.saveStatus = "load unavailable";
    refreshWorkbench();
    return;
  }

  workbench.saveStatus = "loading...";
  refreshWorkbench();
  try {
    const wasRunning = context.sandbox.runtime.isRunning();
    const result = await context.saveManager.load(SANDBOX_SAVE_SLOT_ID);
    context.sandbox.runtime.clock.restore({
      elapsed: result.envelope.payload.runtime.clock.elapsed,
      ticks: result.envelope.payload.runtime.clock.ticks,
      running: wasRunning
    });
    context.sandbox.runtime.eventBus.emit(
      "sandbox.load_completed",
      {
        migrated: result.migrated,
        ticks: result.envelope.payload.runtime.clock.ticks
      },
      "sandbox.ui"
    );
    workbench.selectedActorId = undefined;
    workbench.selectedEntityId = undefined;
    workbench.followedEntityId = undefined;
    workbench.selectionCleared = true;
    context.sandbox.runtime.eventBus.emit("camera.stop_follow", {}, "sandbox.load");
    workbench.saveStatus = `loaded ${result.envelope.slot.label ?? result.slotId} · tick ${result.envelope.payload.runtime.clock.ticks}`;
  } catch (error) {
    workbench.saveStatus = `load failed: ${readErrorMessage(error)}`;
  }
  refreshWorkbench();
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function disposeThreePreview(preview: SandboxThreePreview): void {
  try {
    preview.destroy();
  } catch {
    // The App Host may already be tearing down the underlying driver.
  }
}

function resolveSceneClickSelection(
  context: SandboxAppContext,
  input: NormalizedInputEvent
): { entityId: string | number; actorId?: string } | undefined {
  const sandbox = context.sandbox;
  const camera = context.cameraController;
  if (!sandbox || !camera || input.x === undefined || input.y === undefined) {
    return undefined;
  }

  const cameraState = context.ui.latestCameraStatus ?? context.cameraController?.getState();
  if (!cameraState) {
    return undefined;
  }
  return resolveSandboxSceneClickTarget(
    sandbox.snapshot(),
    { x: input.x, y: input.y },
    cameraState
  );
}
