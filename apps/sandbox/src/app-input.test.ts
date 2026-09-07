import { describe, expect, it } from "vitest";
import { createInputRouter } from "@gamekits/input-core";
import {
  configureSandboxInputRouter,
  SANDBOX_SCENE_CLICK_ACTION_ID,
  type SandboxInputContext
} from "./app-input";
import type { SandboxUiHandles } from "./ui/render-sandbox";

describe("sandbox input", () => {
  it("routes viewport primary clicks through the scene click action", () => {
    const router = createInputRouter();
    const context: SandboxInputContext = {
      ui: createFakeUi(),
      activeInputScope: "game"
    };
    const observed: string[] = [];

    configureSandboxInputRouter(context, router);
    router.onAction((event) => {
      observed.push(`${event.contextId}:${event.actionId}:${event.phase}`);
    });

    router.handle({
      id: "pointer",
      device: "mouse",
      button: "primary",
      phase: "released",
      scope: "game",
      x: 24,
      y: 32,
      timestamp: 1
    });

    expect(observed).toContain(`scene:${SANDBOX_SCENE_CLICK_ACTION_ID}:released`);
    expect(context.ui.inputAction.textContent).toContain(SANDBOX_SCENE_CLICK_ACTION_ID);
    expect(context.ui.inputContext.textContent).toBe("scene");
  });
});

function createFakeUi(): SandboxUiHandles {
  const element = createFakeElement();
  const divElement = element as unknown as HTMLDivElement;
  return {
    root: element,
    reactRoot: {} as SandboxUiHandles["reactRoot"],
    uiRuntime: {
      setFocus: () => undefined
    } as unknown as SandboxUiHandles["uiRuntime"],
    stage: {
      ...element,
      contains: (node: Node) => node === element,
      getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 })
    } as unknown as SandboxUiHandles["stage"],
    devtoolsRoot: element,
    rendererRoot: {
      ...element,
      focus: () => undefined,
      getBoundingClientRect: () => ({ width: 100, height: 100, left: 0, top: 0 })
    } as unknown as SandboxUiHandles["rendererRoot"],
    threePreviewRoot: element as HTMLDivElement,
    sceneOverlay: element,
    status: divElement,
    objectiveLabel: element,
    objectiveStatus: element,
    objectiveProgress: element,
    objectiveProgressBar: element,
    objectiveDetail: element,
    entityCount: element,
    tick: element,
    modules: element,
    systems: element,
    inputAction: createFakeElement(),
    inputContext: createFakeElement(),
    cameraPosition: element,
    cameraZoom: element,
    cameraMode: element,
    selectedActor: element,
    inspectorTabs: [],
    inspectorBody: element,
    timelineFilters: [],
    timelineList: element
  };
}

function createFakeElement(): HTMLElement {
  return {
    textContent: "",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    contains: () => false,
    querySelector: () => null,
    querySelectorAll: () => []
  } as unknown as HTMLElement;
}
