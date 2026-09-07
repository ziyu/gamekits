import type { RenderNodePath, RenderObjectDefinition } from "@gamekits/renderer-core";
import { defineComponent } from "@gamekits/world";

export type SandboxSceneRole =
  | "campfire"
  | "resource-node"
  | "worker"
  | "storage"
  | "workshop"
  | "tower"
  | "monster"
  | "road";

export const Position = defineComponent({
  id: "sandbox.position",
  create: (data?: Partial<{ x: number; y: number }>) => ({
    x: data?.x ?? 0,
    y: data?.y ?? 0
  })
});

export const Velocity = defineComponent({
  id: "sandbox.velocity",
  create: (data?: Partial<{ x: number; y: number }>) => ({
    x: data?.x ?? 0,
    y: data?.y ?? 0
  })
});

export const SceneObject = defineComponent({
  id: "sandbox.scene_object",
  create: (data?: Partial<SandboxSceneObject>): SandboxSceneObject => ({
    objectId: data?.objectId ?? "sandbox.object",
    label: data?.label ?? data?.objectId ?? "Sandbox Object",
    role: data?.role ?? "worker",
    dataType: data?.dataType,
    dataId: data?.dataId,
    actorId: data?.actorId
  })
});

export const Selectable = defineComponent({
  id: "sandbox.selectable",
  create: (data?: Partial<SandboxSelectable>) => ({
    order: data?.order ?? 0,
    selected: data?.selected ?? false
  })
});

export const ResourceStorage = defineComponent({
  id: "sandbox.resource_storage",
  create: (data?: Partial<SandboxResourceStorage>) => ({
    resource: data?.resource ?? 0,
    materials: data?.materials ?? 0,
    capacity: data?.capacity ?? 100
  })
});

export const BuildingState = defineComponent({
  id: "sandbox.building_state",
  create: (data?: Partial<SandboxBuildingState>) => ({
    buildingId: data?.buildingId ?? "building.sandbox.unknown",
    zone: data?.zone ?? "camp",
    priority: data?.priority ?? 1,
    health: data?.health ?? 100,
    heat: data?.heat ?? 0,
    throughput: data?.throughput ?? 1,
    mode: data?.mode ?? "normal"
  })
});

export const ProductionState = defineComponent({
  id: "sandbox.production_state",
  create: (data?: Partial<SandboxProductionState>) => ({
    ratePerSecond: data?.ratePerSecond ?? 0,
    recipeId: data?.recipeId,
    status: data?.status ?? "idle"
  })
});

export const WorkAssignment = defineComponent({
  id: "sandbox.work_assignment",
  create: (data?: Partial<SandboxWorkAssignment>) => ({
    task: data?.task ?? "idle",
    status: data?.status ?? "idle",
    sourceObjectId: data?.sourceObjectId,
    targetObjectId: data?.targetObjectId,
    cargo: data?.cargo ?? 0,
    battery: data?.battery ?? 100,
    fatigue: data?.fatigue ?? 0,
    progress: data?.progress ?? 0,
    routeProgress: data?.routeProgress ?? 0
  })
});

export const ObjectiveState = defineComponent({
  id: "sandbox.objective_state",
  create: (data?: Partial<SandboxObjectiveState>) => ({
    objectiveId: data?.objectiveId ?? "objective.sandbox.tiny_camp",
    phaseId: data?.phaseId ?? "phase.bootstrap",
    progressResources: data?.progressResources ?? 0,
    targetResources: data?.targetResources ?? 220,
    unlocked: data?.unlocked ?? []
  })
});

export const ThreatState = defineComponent({
  id: "sandbox.threat_state",
  create: (data?: Partial<SandboxThreatState>) => ({
    intensity: data?.intensity ?? 0,
    nextStrikeTick: data?.nextStrikeTick ?? 120,
    status: data?.status ?? "charging"
  })
});

export const LinkState = defineComponent({
  id: "sandbox.link_state",
  create: (data?: Partial<SandboxLinkState>) => ({
    fromObjectId: data?.fromObjectId ?? "from",
    toObjectId: data?.toObjectId ?? "to",
    flow: data?.flow ?? 0,
    status: data?.status ?? "idle"
  })
});

export const RenderObjectPresentation = defineComponent({
  id: "sandbox.render_object_presentation",
  create: (data?: Partial<SandboxRenderObjectPresentation>): SandboxRenderObjectPresentation => {
    const presentation: SandboxRenderObjectPresentation = {
      definition: data?.definition ?? {
        type: "debug.square",
        props: {
          width: 20,
          height: 20
        }
      }
    };

    if (data?.renderObjectId) {
      presentation.renderObjectId = data.renderObjectId;
    }
    if (data?.nodeAnimations) {
      presentation.nodeAnimations = data.nodeAnimations;
    }

    return presentation;
  }
});

export type SandboxRenderObjectPresentation = {
  renderObjectId?: string;
  definition: RenderObjectDefinition;
  nodeAnimations?: SandboxRenderNodeAnimation[];
};

export type SandboxSceneObject = {
  objectId: string;
  label: string;
  role: SandboxSceneRole;
  dataType?: string | undefined;
  dataId?: string | undefined;
  actorId?: string | undefined;
};

export type SandboxSelectable = {
  order: number;
  selected: boolean;
};

export type SandboxResourceStorage = {
  resource: number;
  materials: number;
  capacity: number;
};

export type SandboxBuildingState = {
  buildingId: string;
  zone: "camp" | "forest" | "quarry" | "food" | "workshop" | "defense" | "wilds";
  priority: number;
  health: number;
  heat: number;
  throughput: number;
  mode: "normal" | "gather" | "build" | "defend" | "damaged";
};

export type SandboxProductionState = {
  ratePerSecond: number;
  recipeId?: string | undefined;
  status: "idle" | "producing" | "boosted" | "blocked";
};

export type SandboxWorkAssignment = {
  task: "idle" | "gather" | "haul" | "build" | "repair" | "defend" | "rescue";
  status: "idle" | "routing" | "working" | "returning";
  sourceObjectId?: string | undefined;
  targetObjectId?: string | undefined;
  cargo: number;
  battery: number;
  fatigue: number;
  progress: number;
  routeProgress: number;
};

export type SandboxObjectiveState = {
  objectiveId: string;
  phaseId: string;
  progressResources: number;
  targetResources: number;
  unlocked: string[];
};

export type SandboxThreatState = {
  intensity: number;
  nextStrikeTick: number;
  status: "charging" | "striking" | "cooldown";
};

export type SandboxLinkState = {
  fromObjectId: string;
  toObjectId: string;
  flow: number;
  status: "idle" | "moving" | "blocked" | "danger";
};

export type SandboxRenderNodeAnimation =
  | {
      kind: "orbit";
      nodePath: RenderNodePath;
      radius: number;
      speed: number;
      phase?: number;
    }
  | {
      kind: "pulse";
      nodePath: RenderNodePath;
      scale: number;
      speed: number;
      phase?: number;
      alpha?: {
        min: number;
        max: number;
      };
    }
  | {
      kind: "spin";
      nodePath: RenderNodePath;
      speed: number;
      phase?: number;
    };
