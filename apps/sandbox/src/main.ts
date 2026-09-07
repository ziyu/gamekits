import "@gamekits/react-ui/styles.css";
import "@gamekits/devtools-ui/styles.css";
import "./ui/theme.css";
import "./styles.css";
import "./ui/scene-host.css";
import { resolveSandboxScene, sandboxSceneCatalog } from "./scenes/registry";
import { renderSandboxSceneHost } from "./ui/scene-host";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app element");
}

void mountSelectedScene(app);

async function mountSelectedScene(root: HTMLElement): Promise<void> {
  const scene = resolveSandboxScene(window.location.search);
  const host = renderSandboxSceneHost(root, scene, sandboxSceneCatalog);

  try {
    const module = await scene.load();
    await module.mount(host.sceneRoot);
    host.markReady();
  } catch (error) {
    host.showError(error);
    throw error;
  }
}
