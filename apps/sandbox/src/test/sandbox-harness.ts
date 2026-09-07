import type { DataRegistry } from "@gamekits/data";
import { createEventBus, type GameEvent } from "@gamekits/event-bus";
import { createInputRouter, type InputActionEvent, type InputRouter } from "@gamekits/input-core";
import { createMemoryRenderer, type MemoryRendererAdapter } from "@gamekits/test-utils";
import type { EntityId } from "@gamekits/world";
import { createKootaWorld } from "@gamekits/world-koota";
import {
  configureSandboxInputRouter,
  SANDBOX_SCENE_CLICK_ACTION_ID,
  type SandboxInputContext
} from "../app-input";
import {
  createSandboxDataRegistry,
  createSandboxRuntime,
  SANDBOX_RENDER_SIZE,
  type SandboxEntitySnapshot,
  type SandboxRuntime,
  type SandboxSnapshot,
  type SandboxSnapshotOptions
} from "../sandbox-game";
import type { SandboxUiHandles } from "../ui/render-sandbox";

export type SandboxTestHarnessOptions = {
  seed?: string;
  dataRegistry?: DataRegistry;
  renderer?: MemoryRendererAdapter;
  assetsLoaded?: number;
  assetsFailed?: number;
};

export type SandboxTestHarness = {
  dataRegistry: DataRegistry;
  renderer: MemoryRendererAdapter;
  sandbox: SandboxRuntime;
  bootRenderer(): Promise<void>;
  start(): void;
  tickMany(count: number, delta?: number): void;
  snapshot(options?: SandboxSnapshotOptions): SandboxSnapshot;
  events(): GameEvent[];
  emitConfirm(source?: string): void;
  emitSceneClick(point: { x: number; y: number }, source?: string): void;
  findEntityByRole(role: SandboxEntitySnapshot["role"]): SandboxEntitySnapshot | undefined;
  findEntityByObjectId(objectId: string): SandboxEntitySnapshot | undefined;
  findEntityById(entityId: EntityId): SandboxEntitySnapshot | undefined;
};

export type SandboxInputTestHarness = {
  router: InputRouter;
  context: SandboxInputContext;
  actions: InputActionEvent[];
};

export function createSandboxTestHarness(
  options: SandboxTestHarnessOptions = {}
): SandboxTestHarness {
  const dataRegistry = options.dataRegistry ?? createSandboxDataRegistry();
  const renderer = options.renderer ?? createMemoryRenderer();
  let timestamp = 0;
  const sandbox = createSandboxRuntime({
    seed: options.seed ?? "sandbox-long-chain-seed",
    world: createKootaWorld(),
    eventBus: createEventBus({ clock: () => timestamp++ }),
    dataRegistry,
    renderer,
    assetSummary: () => ({
      assetsLoaded: options.assetsLoaded ?? 2,
      assetsFailed: options.assetsFailed ?? 0
    }),
    renderSize: SANDBOX_RENDER_SIZE
  });

  return {
    dataRegistry,
    renderer,
    sandbox,
    async bootRenderer() {
      await renderer.boot({
        container: { append() {} } as unknown as HTMLElement,
        width: SANDBOX_RENDER_SIZE.width,
        height: SANDBOX_RENDER_SIZE.height,
        onDiagnostic(event) {
          sandbox.runtime.eventBus.emit(event.type, event.payload, event.source);
        }
      });
    },
    start() {
      sandbox.runtime.start();
    },
    tickMany(count, delta = 16) {
      for (let i = 0; i < count; i += 1) {
        sandbox.runtime.tick(delta);
      }
    },
    snapshot(snapshotOptions) {
      return sandbox.snapshot(snapshotOptions);
    },
    events() {
      return [...sandbox.events];
    },
    emitConfirm(source = "sandbox.long-chain-test") {
      sandbox.runtime.eventBus.emit(
        "input.action",
        { actionId: "game.confirm", contextId: "gameplay", phase: "pressed", value: 1 },
        source
      );
    },
    emitSceneClick(point, source = "sandbox.long-chain-test") {
      sandbox.runtime.eventBus.emit(
        "input.action",
        {
          actionId: SANDBOX_SCENE_CLICK_ACTION_ID,
          contextId: "scene",
          phase: "released",
          value: 1,
          input: { device: "mouse", button: "primary", x: point.x, y: point.y, scope: "game" }
        },
        source
      );
    },
    findEntityByRole(role) {
      return sandbox.snapshot().entities.find((entity) => entity.role === role);
    },
    findEntityByObjectId(objectId) {
      return sandbox.snapshot().entities.find((entity) => entity.objectId === objectId);
    },
    findEntityById(entityId) {
      return sandbox.snapshot().entities.find((entity) => entity.id === entityId);
    }
  };
}

export function createSandboxInputTestHarness(): SandboxInputTestHarness {
  const router = createInputRouter();
  const context: SandboxInputContext = {
    ui: createFakeUi(),
    activeInputScope: "game"
  };
  const actions: InputActionEvent[] = [];

  configureSandboxInputRouter(context, router);
  router.onAction((event) => {
    actions.push(event);
  });

  return { router, context, actions };
}

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
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: SANDBOX_RENDER_SIZE.width,
        height: SANDBOX_RENDER_SIZE.height
      })
    } as unknown as SandboxUiHandles["stage"],
    devtoolsRoot: element,
    rendererRoot: {
      ...element,
      focus: () => undefined,
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: SANDBOX_RENDER_SIZE.width,
        height: SANDBOX_RENDER_SIZE.height
      })
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
