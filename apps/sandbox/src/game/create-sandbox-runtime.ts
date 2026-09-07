import { createEventBus, type EventBus, type GameEvent } from "@gamekits/event-bus";
import {
  createGasModule,
  createGasTcaDefinitions,
  createGasTraceStore,
  GasAbilities,
  GasActor,
  GasAttributes,
  GasEffects,
  GasTags,
  type GasActorRuntimeState,
  type GasRuntime,
  type GasTraceStore
} from "@gamekits/gas";
import { createGame, type GameInstallContext } from "@gamekits/game-runtime";
import type { GameModule } from "@gamekits/core";
import type { RendererAdapter } from "@gamekits/renderer-core";
import {
  createTcaModule,
  createTcaTraceStore,
  mergeTcaDefinitionSets,
  type TcaTraceStore
} from "@gamekits/tca";
import type { ComponentDef, EntityId, GameWorld } from "@gamekits/world";
import type { DataRegistry } from "@gamekits/data";
import {
  LinkState,
  ObjectiveState,
  Position,
  ProductionState,
  RenderObjectPresentation,
  SceneObject,
  Selectable,
  BuildingState,
  ResourceStorage,
  ThreatState,
  Velocity,
  WorkAssignment
} from "./components";
import {
  createSandboxDataRegistry,
  getSandboxBuildingDefinition,
  getSandboxObjectivePhase,
  getSandboxRenderObject,
  getSandboxRenderRig,
  getSandboxSceneObjects,
  getSandboxTinyCampLayout
} from "./sandbox-data";
import { createSandboxCampModule } from "./modules/sandbox-camp-module";
import { createSandboxRenderSyncModule } from "./modules/sandbox-render-sync-module";
import { createSandboxTcaDefinitions } from "./modules/sandbox-tca-definitions";
import type {
  SandboxContentSummary,
  SandboxEntitySnapshot,
  SandboxModuleSummary,
  SandboxObjectiveSnapshot,
  SandboxRuntime,
  SandboxSaveData,
  SandboxSavedEntity,
  SandboxSnapshotOptions,
  SandboxTimelineEntry
} from "./types";

export const SANDBOX_RENDER_SIZE = {
  width: 720,
  height: 524
} as const;

const TRANSIENT_SAVE_TAGS = new Set(["state.overcharged"]);
const TRANSIENT_SAVE_EFFECT_IDS = new Set([
  "gas.effect.sandbox.overcharge_regen",
  "gas.effect.sandbox.campfire_boost"
]);

export type CreateSandboxRuntimeOptions = {
  seed?: string;
  world: GameWorld;
  eventBus?: EventBus;
  clock?: () => number;
  renderer?: RendererAdapter;
  dataRegistry?: DataRegistry;
  modules?: Array<GameModule<GameInstallContext>>;
  tcaTraceStore?: TcaTraceStore;
  gasTraceStore?: GasTraceStore;
  gasRuntime?: (() => GasRuntime | undefined) | undefined;
  onGasRuntime?: ((runtime: GasRuntime) => void) | undefined;
  assetSummary?: (() => Pick<SandboxContentSummary, "assetsLoaded" | "assetsFailed">) | undefined;
  renderSize?: {
    width: number;
    height: number;
  };
};

export function createSandboxRuntime(options: CreateSandboxRuntimeOptions): SandboxRuntime {
  const world = options.world;
  const eventBus =
    options.eventBus ??
    createEventBus(options.clock === undefined ? undefined : { clock: options.clock });
  const events: GameEvent[] = [];
  const dataRegistry = options.dataRegistry ?? createSandboxDataRegistry();
  const tcaTraceStore = options.tcaTraceStore ?? createTcaTraceStore({ limit: 20 });
  const gasTraceStore = options.gasTraceStore ?? createGasTraceStore({ limit: 30 });
  let gasRuntime: GasRuntime | undefined;
  const readGasRuntime = options.gasRuntime ?? (() => gasRuntime);
  const campLayout = getSandboxTinyCampLayout(dataRegistry);
  const modules = [
    ...(options.modules ?? [
      createGasModule({
        id: "sandbox.gas",
        dataRegistry,
        traceStore: gasTraceStore,
        onRuntime(runtime) {
          gasRuntime = runtime;
          options.onGasRuntime?.(runtime);
        }
      }),
      createTcaModule({
        id: "sandbox.tca",
        dataRegistry,
        traceStore: tcaTraceStore,
        definitions: mergeTcaDefinitionSets(
          createSandboxTcaDefinitions(),
          createGasTcaDefinitions({ runtime: () => gasRuntime })
        )
      })
    ]),
    createSandboxCampModule({
      layout: campLayout,
      sceneObjects: getSandboxSceneObjects(dataRegistry, campLayout),
      renderObject: (id) => getSandboxRenderObject(dataRegistry, id),
      renderRig: (id) => getSandboxRenderRig(dataRegistry, id),
      buildingDefinition: (id) => getSandboxBuildingDefinition(dataRegistry, id),
      objectivePhase: (id) => getSandboxObjectivePhase(dataRegistry, id),
      gasRuntime: readGasRuntime
    })
  ];

  if (options.renderer) {
    modules.push(
      createSandboxRenderSyncModule({
        renderer: options.renderer,
        size: options.renderSize ?? SANDBOX_RENDER_SIZE
      })
    );
  }

  eventBus.onAny((event) => {
    events.push(event);
    if (events.length > 80) {
      events.shift();
    }
  });

  const runtime = createGame({
    modules,
    world,
    eventBus,
    seed: options.seed ?? "tiny-camp-dev-seed"
  });

  return {
    runtime,
    events,
    tcaTraceStore,
    gasTraceStore,
    resolveEntityPosition(entityId) {
      const position = world.get(entityId, Position);
      return position
        ? {
            x: position.x,
            y: position.y
          }
        : undefined;
    },
    captureSaveData() {
      return captureSandboxSaveData(world, readGasRuntime);
    },
    restoreSaveData(data) {
      restoreSandboxSaveData(world, readGasRuntime, data);
      eventBus.emit(
        "sandbox.save_restored",
        {
          entities: data.entities.length,
          gasActors: data.gasActors.length
        },
        "sandbox.save"
      );
    },
    snapshot(snapshotOptions?: SandboxSnapshotOptions) {
      const gasActors = readGasRuntime()?.snapshot().actors ?? [];
      const actorIdByEntity = new Map(
        gasActors
          .filter((actor) => actor.actor.entityId !== undefined)
          .map((actor) => [actor.actor.entityId!, actor.actor.actorId])
      );
      const entities: SandboxEntitySnapshot[] = world
        .query([Position, SceneObject])
        .map((entity) => {
          const position = world.get(entity, Position);
          const velocity = world.get(entity, Velocity);
          const presentation = world.get(entity, RenderObjectPresentation);
          const sceneObject = world.get(entity, SceneObject);
          const storage = world.get(entity, ResourceStorage);
          const building = world.get(entity, BuildingState);
          const production = world.get(entity, ProductionState);
          const work = world.get(entity, WorkAssignment);
          const threat = world.get(entity, ThreatState);
          const objective = world.get(entity, ObjectiveState);
          const link = world.get(entity, LinkState);
          const selectable = world.get(entity, Selectable);

          return {
            id: entity,
            objectId: sceneObject?.objectId,
            label: sceneObject?.label,
            role: sceneObject?.role,
            actorId: actorIdByEntity.get(entity),
            renderObjectId: presentation?.renderObjectId,
            x: position?.x ?? 0,
            y: position?.y ?? 0,
            vx: velocity?.x ?? 0,
            vy: velocity?.y ?? 0,
            resource: storage?.resource,
            materials: storage?.materials,
            capacity: storage?.capacity,
            building: building
              ? {
                  buildingId: building.buildingId,
                  zone: building.zone,
                  priority: building.priority,
                  health: building.health,
                  heat: building.heat,
                  throughput: building.throughput,
                  mode: building.mode
                }
              : undefined,
            productionRate: production?.ratePerSecond,
            recipeId: production?.recipeId,
            task: work?.task,
            taskStatus: work?.status,
            sourceObjectId: work?.sourceObjectId,
            targetObjectId: work?.targetObjectId,
            cargo: work?.cargo,
            battery: work?.battery,
            fatigue: work?.fatigue,
            routeProgress: work?.routeProgress,
            threatIntensity: threat?.intensity,
            objective: objective
              ? {
                  objectiveId: objective.objectiveId,
                  phaseId: objective.phaseId,
                  progressResources: objective.progressResources,
                  targetResources: objective.targetResources,
                  unlocked: objective.unlocked
                }
              : undefined,
            link: link
              ? {
                  fromObjectId: link.fromObjectId,
                  toObjectId: link.toObjectId,
                  flow: link.flow,
                  status: link.status
                }
              : undefined,
            selected: selectable?.selected
          };
        });

      const selectedEntity = snapshotOptions?.selectedEntityId
        ? entities.find((entity) => entity.id === snapshotOptions.selectedEntityId)
        : undefined;
      const useDefaultSelection = snapshotOptions?.defaultSelection !== false;
      const selectedActorId =
        snapshotOptions?.selectedActorId ??
        (useDefaultSelection && snapshotOptions?.selectedEntityId === undefined
          ? (selectedEntity?.actorId ?? gasActors[0]?.actor.actorId)
          : selectedEntity?.actorId);
      const selectedActor = gasActors.find((actor) => actor.actor.actorId === selectedActorId);
      const contentSummary = createContentSummary(dataRegistry, options.assetSummary?.());

      return {
        running: runtime.isRunning(),
        clock: runtime.clock.snapshot(),
        entityCount: world.count(),
        entities,
        selected:
          selectedActorId === undefined && selectedEntity === undefined
            ? undefined
            : {
                actorId: selectedActorId,
                entityId: selectedEntity?.id ?? selectedActor?.actor.entityId
              },
        objective: createObjectiveSnapshot(entities),
        timeline: createTimeline({
          events,
          tcaTraces: tcaTraceStore.list(),
          gasTraces: gasTraceStore.list()
        }),
        moduleSummary: createModuleSummary(runtime, world.count(), gasActors.length),
        contentSummary,
        events: [...events],
        tcaRuleCount: dataRegistry.list("tca.rule").length,
        tcaTraces: tcaTraceStore.list(),
        gasActors,
        gasTraces: gasTraceStore.list()
      };
    }
  };
}

function captureSandboxSaveData(
  world: GameWorld,
  readGasRuntime: () => GasRuntime | undefined
): SandboxSaveData {
  return {
    version: "1.0.0",
    entities: world
      .query([SceneObject])
      .map((entity): SandboxSavedEntity | undefined => {
        const sceneObject = world.get(entity, SceneObject);
        if (!sceneObject) {
          return undefined;
        }

        return {
          objectId: sceneObject.objectId,
          sceneObject: cloneData(sceneObject),
          position: cloneOptional(world.get(entity, Position)),
          velocity: cloneOptional(world.get(entity, Velocity)),
          storage: cloneOptional(world.get(entity, ResourceStorage)),
          building: cloneOptional(world.get(entity, BuildingState)),
          production: cloneOptional(world.get(entity, ProductionState)),
          work: cloneOptional(world.get(entity, WorkAssignment)),
          objective: cloneOptional(world.get(entity, ObjectiveState)),
          threat: cloneOptional(world.get(entity, ThreatState)),
          link: cloneOptional(world.get(entity, LinkState))
        };
      })
      .filter((entry): entry is SandboxSavedEntity => entry !== undefined),
    gasActors: (readGasRuntime()?.snapshot().actors ?? []).map(cloneGasActorForSave)
  };
}

function restoreSandboxSaveData(
  world: GameWorld,
  readGasRuntime: () => GasRuntime | undefined,
  data: SandboxSaveData
): void {
  const entityByObjectId = new Map(
    world
      .query([SceneObject])
      .map((entity) => [world.get(entity, SceneObject)?.objectId, entity] as const)
      .filter((entry): entry is [string, EntityId] => entry[0] !== undefined)
  );

  for (const saved of data.entities) {
    const entity = entityByObjectId.get(saved.objectId);
    if (entity === undefined) {
      continue;
    }

    world.set(entity, SceneObject, saved.sceneObject);
    setIfPresent(world, entity, Position, saved.position);
    setIfPresent(world, entity, Velocity, saved.velocity);
    setIfPresent(world, entity, ResourceStorage, saved.storage);
    setIfPresent(world, entity, BuildingState, saved.building);
    setIfPresent(world, entity, ProductionState, saved.production);
    setIfPresent(world, entity, WorkAssignment, saved.work);
    setIfPresent(world, entity, ObjectiveState, saved.objective);
    setIfPresent(world, entity, ThreatState, saved.threat);
    setIfPresent(world, entity, LinkState, saved.link);
  }

  const gasRuntime = readGasRuntime();
  for (const savedActor of data.gasActors) {
    if (!gasRuntime?.hasActor(savedActor.actor.actorId)) {
      continue;
    }
    const currentActor = gasRuntime.getActor(savedActor.actor.actorId);
    const entity = currentActor.actor.entityId;
    if (entity === undefined) {
      continue;
    }

    world.set(entity, GasActor, {
      ...savedActor.actor,
      entityId: entity
    });
    world.set(entity, GasAttributes, cloneData(savedActor.attributes));
    world.set(entity, GasTags, cloneData(savedActor.tags));
    world.set(entity, GasAbilities, cloneData(savedActor.abilities));
    world.set(entity, GasEffects, cloneData(savedActor.effects));
  }
}

function setIfPresent<T extends object>(
  world: GameWorld,
  entity: EntityId,
  component: ComponentDef<T>,
  value: T | undefined
): void {
  if (value !== undefined) {
    world.set(entity, component, value);
  }
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : cloneData(value);
}

function cloneGasActorForSave(state: GasActorRuntimeState): GasActorRuntimeState {
  const actor = cloneData(state);
  actor.tags.values = actor.tags.values.filter((tag) => !TRANSIENT_SAVE_TAGS.has(tag));
  actor.effects.active = actor.effects.active.filter(
    (effect) =>
      !TRANSIENT_SAVE_EFFECT_IDS.has(effect.effectId) &&
      !effect.grantedTags.some((tag) => TRANSIENT_SAVE_TAGS.has(tag))
  );
  return actor;
}

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createObjectiveSnapshot(entities: SandboxEntitySnapshot[]): SandboxObjectiveSnapshot {
  const campfire = entities.find((entity) => entity.role === "campfire");
  const resources = entities.filter((entity) => entity.role === "resource-node");
  const threat = entities.find((entity) => entity.role === "monster");
  const objective = campfire?.objective;
  const averageHealth =
    resources.length === 0
      ? 100
      : resources.reduce((total, resource) => total + (resource.building?.health ?? 100), 0) /
        resources.length;
  const objectiveProgress = Math.min(
    1,
    Math.max(
      0,
      (objective?.progressResources ?? campfire?.resource ?? 0) /
        (objective?.targetResources ?? 220)
    )
  );
  const resourceProgress =
    resources.length === 0
      ? 0
      : resources.reduce((total, resource) => {
          const capacity = resource.capacity ?? 1;
          return total + Math.min(1, (resource.resource ?? 0) / capacity);
        }, 0) / resources.length;
  const progress = Math.round(
    (objectiveProgress * 0.72 + resourceProgress * 0.18 + (averageHealth / 100) * 0.1) * 100
  );

  return {
    id: "tiny-camp",
    label:
      objective?.phaseId === "objective.sandbox.phase.bootstrap"
        ? "Tiny Camp / Stock the Campfire"
        : "Tiny Camp",
    status: progress >= 100 ? "complete" : progress > 0 ? "running" : "waiting",
    progress,
    detail:
      progress === 0
        ? "Workers are warming up. Focus the viewport and press confirm to boost the selected object."
        : `Phase ${objective?.phaseId.replace("objective.sandbox.phase.", "") ?? "bootstrap"} · camp resources ${Math.round(objective?.progressResources ?? 0)} / ${Math.round(objective?.targetResources ?? 220)} · resource nodes ${Math.round(resourceProgress * 100)}% · health ${Math.round(averageHealth)}% · threat ${Math.round((threat?.threatIntensity ?? 0) * 100)}%`
  };
}

function createTimeline(input: {
  events: GameEvent[];
  tcaTraces: ReturnType<TcaTraceStore["list"]>;
  gasTraces: ReturnType<GasTraceStore["list"]>;
}): SandboxTimelineEntry[] {
  return [
    ...input.events.map((event, index): SandboxTimelineEntry => {
      const payload = isRecord(event.payload) ? event.payload : {};
      return {
        id: `event-${index}-${event.type}-${event.timestamp}`,
        time: event.timestamp,
        kind: eventKind(event.type),
        label: event.type,
        source: event.source ?? "event-bus",
        actorId: readString(payload.actorId),
        entityId: readEntityId(payload.entity),
        status: readString(payload.phase)
      };
    }),
    ...input.tcaTraces.map(
      (trace): SandboxTimelineEntry => ({
        id: `tca-${trace.id}`,
        time: trace.timestamp,
        kind: "tca",
        label: trace.ruleId,
        source: trace.eventType,
        status: trace.status
      })
    ),
    ...input.gasTraces.map(
      (trace): SandboxTimelineEntry => ({
        id: `gas-${trace.id}`,
        time: trace.timestamp,
        kind: "gas",
        label: trace.type,
        source: trace.message ?? "gas",
        actorId: trace.actorId,
        status: trace.abilityId ?? trace.effectId
      })
    )
  ]
    .sort((left, right) => left.time - right.time || left.id.localeCompare(right.id))
    .slice(-120);
}

function createModuleSummary(
  runtime: ReturnType<typeof createGame>,
  entityCount: number,
  actorCount: number
): SandboxModuleSummary[] {
  return [
    {
      id: "runtime",
      label: "Runtime",
      status: runtime.isRunning() ? "running" : "stopped",
      detail: `${runtime.systems.values().length} systems · ${runtime.modules.length} modules`
    },
    {
      id: "world",
      label: "World",
      status: `${entityCount} entities`,
      detail: "Gameplay reads and writes through the GameWorld facade"
    },
    {
      id: "renderer",
      label: "Renderer",
      status: "phaser",
      detail: "RenderObject tree + node animation sync"
    },
    {
      id: "rules",
      label: "TCA / GAS",
      status: `${actorCount} actors`,
      detail: "Event rules activate abilities and effects"
    }
  ];
}

function createContentSummary(
  dataRegistry: DataRegistry,
  assets: Pick<SandboxContentSummary, "assetsLoaded" | "assetsFailed"> | undefined
): SandboxContentSummary {
  const snapshot = dataRegistry.snapshot();
  return {
    packs: snapshot.packs.length,
    types: snapshot.types.length,
    documents: snapshot.documents.length,
    references: snapshot.references.length,
    assetsLoaded: assets?.assetsLoaded ?? 0,
    assetsFailed: assets?.assetsFailed ?? 0
  };
}

function eventKind(type: string): SandboxTimelineEntry["kind"] {
  if (type === "input.action") {
    return "input";
  }
  if (type.startsWith("renderer.") || type.startsWith("sandbox.render")) {
    return "renderer";
  }
  if (type.startsWith("runtime.")) {
    return "runtime";
  }
  return "event";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readEntityId(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
