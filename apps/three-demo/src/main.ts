import "./styles.css";
import { createConfiguredAppHost } from "@gamekits/app-host";
import type { AssetLoadState, AssetManager } from "@gamekits/asset";
import type { ThreeGameDriver } from "@gamekits/driver-three";
import { THREE_DEMO_DRIVER_ID, threeDemoAppDefinition } from "./app-definition";
import { createThreeDemoProfile, measureViewport, type ThreeDemoAppContext } from "./app-profile";
import { createThreeDemoScene, type ThreeDemoModel, type ThreeDemoScene } from "./demo-scene";
import { THREE_DEMO_ASSET_IDS, THREE_DEMO_BOOT_ASSET_IDS } from "./demo-assets";
import {
  bindThreeDemoControls,
  renderBootError,
  renderThreeDemoShell,
  updateLoadingState,
  updateHostSnapshot,
  updateSceneSnapshot
} from "./ui";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app element");
}

void bootThreeDemo(root).catch((error) => {
  renderBootError(root, error);
});

async function bootThreeDemo(rootElement: HTMLElement): Promise<void> {
  const ui = renderThreeDemoShell(rootElement);
  updateLoadingState(ui, {
    visible: true,
    title: "Booting Three driver",
    detail: "Preparing renderer runtime"
  });
  const context: ThreeDemoAppContext = { ui };
  const configured = createConfiguredAppHost({
    app: threeDemoAppDefinition,
    profile: createThreeDemoProfile(),
    context
  });
  const { host } = configured;
  updateHostSnapshot(ui, host.snapshot());

  updateLoadingState(ui, {
    visible: true,
    title: "Booting App Host",
    detail: "Registering data, assets, renderer, and driver"
  });
  await host.boot();
  const renderer = requireContext(context.renderer, "renderer");
  const assets = requireContext(context.assets, "assets");
  const driver = requireContext(context.drivers, "drivers").require<ThreeGameDriver>(
    THREE_DEMO_DRIVER_ID
  );
  const scene = createThreeDemoScene(renderer, {
    camera: driver.adapters().camera,
    assets,
    viewport: measureViewport(ui.viewport),
    onSnapshot(snapshot) {
      updateSceneSnapshot(ui, snapshot);
    }
  });
  scene.boot();
  updateLoadingState(ui, {
    visible: true,
    title: "Starting scene",
    detail: "Opening the capability lab viewport"
  });
  await host.start();
  updateHostSnapshot(ui, host.snapshot());
  const assetLoading = createAssetLoadingController(ui, assets, scene);

  bindThreeDemoControls(ui, {
    onMode(mode) {
      scene.setMode(mode);
    },
    onMaterial(material) {
      scene.setMaterial(material);
    },
    onModel(model) {
      scene.setModel(model);
      void assetLoading.ensureModel(model);
    },
    onTexture(texture) {
      scene.setTexture(texture);
    },
    onClip(clip) {
      scene.setClip(clip);
    },
    onCameraPreset(preset) {
      scene.setCameraPreset(preset);
    },
    onLightingPreset(preset) {
      scene.setLightingPreset(preset);
    },
    onAnimationSpeed(speed) {
      scene.setAnimationSpeed(speed);
    },
    onTimeline(timeMs) {
      scene.setTimelineMs(timeMs);
    },
    onPlaying(enabled) {
      scene.setPlaying(enabled);
    },
    onWireframe(enabled) {
      scene.setWireframe(enabled);
    },
    onReset() {
      scene.reset();
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    const size = measureViewport(ui.viewport);
    scene.resize(size.width, size.height);
  });
  resizeObserver.observe(ui.viewport);

  let lastTime: number | undefined;
  let lastSnapshotUpdate = 0;
  let frameHandle = 0;
  const frame = (now: number): void => {
    const delta = lastTime === undefined ? 0 : now - lastTime;
    lastTime = now;
    host.tick(delta, now);
    scene.update(delta);
    if (now - lastSnapshotUpdate > 180) {
      updateHostSnapshot(ui, host.snapshot());
      lastSnapshotUpdate = now;
    }
    frameHandle = requestAnimationFrame(frame);
  };
  frameHandle = requestAnimationFrame(frame);
  void assetLoading.loadInitial();

  window.addEventListener(
    "beforeunload",
    () => {
      cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      scene.destroy();
      void host.dispose();
    },
    { once: true }
  );
}

type AssetLoadingController = {
  loadInitial(): Promise<void>;
  ensureModel(model: ThreeDemoModel): Promise<void>;
};

const MODEL_ASSET_BY_MODEL: Partial<Record<ThreeDemoModel, string>> = {
  robot: THREE_DEMO_ASSET_IDS.robot,
  tokyo: THREE_DEMO_ASSET_IDS.tokyo,
  flamingo: THREE_DEMO_ASSET_IDS.flamingo
};

function createAssetLoadingController(
  ui: ReturnType<typeof renderThreeDemoShell>,
  assets: AssetManager,
  scene: ThreeDemoScene
): AssetLoadingController {
  const pending = new Map<string, Promise<AssetLoadState>>();

  const countLoaded = (ids: readonly string[]): number =>
    ids.filter((id) => assets.state(id).status === "loaded").length;

  const showProgress = (title: string, ids: readonly string[]): void => {
    const loaded = countLoaded(ids);
    updateLoadingState(ui, {
      visible: true,
      title,
      detail: `${loaded}/${ids.length} remote assets ready`,
      loaded,
      total: ids.length
    });
  };

  const hideProgress = (): void => {
    updateLoadingState(ui, { visible: false });
  };

  const loadAsset = (id: string, progressIds: readonly string[], title: string) => {
    const current = assets.state(id);
    if (current.status === "loaded") {
      return Promise.resolve(current);
    }

    const existing = pending.get(id);
    if (existing) {
      showProgress(title, progressIds);
      return existing;
    }

    showProgress(title, progressIds);
    const next = assets
      .load(id)
      .then((state) => {
        scene.refreshAssets();
        showProgress(title, progressIds);
        if (state.status === "failed") {
          ui.pushDiagnostic(`asset failed: ${id}`, "asset.manager");
        }
        return state;
      })
      .finally(() => {
        pending.delete(id);
      });
    pending.set(id, next);
    return next;
  };

  return {
    async loadInitial() {
      const ids = [...THREE_DEMO_BOOT_ASSET_IDS];
      const results = await Promise.all(ids.map((id) => loadAsset(id, ids, "Loading assets")));
      const failedCount = results.filter((state) => state.status === "failed").length;
      if (failedCount === 0) {
        hideProgress();
        return;
      }

      updateLoadingState(ui, {
        visible: true,
        title: "Assets settled",
        detail: `${results.length - failedCount}/${results.length} loaded, ${failedCount} failed`,
        loaded: results.length - failedCount,
        total: results.length
      });
      window.setTimeout(hideProgress, 1800);
    },
    async ensureModel(model) {
      const assetId = MODEL_ASSET_BY_MODEL[model];
      if (!assetId) {
        return;
      }

      const state = await loadAsset(assetId, [assetId], `Loading ${model} model`);
      if (state.status === "loaded") {
        hideProgress();
        return;
      }

      updateLoadingState(ui, {
        visible: true,
        title: "Model fallback active",
        detail: `${model} did not load; procedural fallback remains visible`,
        loaded: 0,
        total: 1
      });
      window.setTimeout(hideProgress, 2200);
    }
  };
}

function requireContext<TValue>(value: TValue | undefined, name: string): TValue {
  if (value === undefined) {
    throw new Error(`Missing Three demo context value: ${name}`);
  }

  return value;
}
