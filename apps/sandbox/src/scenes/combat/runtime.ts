import {
  type CombatDeliveryRequestResult,
  type CombatHandle,
  type CombatHitResult,
  type CombatRelationshipResolver
} from "@gamekits/combat";
import { defineGameModule, type GameModule } from "@gamekits/core";
import type { GameInstallContext, GameRuntime } from "@gamekits/game-runtime";
import type { GasCueEvent, GasHandle } from "@gamekits/gas";
import {
  PhysicsBodyComponent,
  PhysicsColliderComponent,
  PhysicsTransformComponent,
  type PhysicsHandle
} from "@gamekits/physics-core";
import type { EntityId, GameWorld } from "@gamekits/world";
import { CombatRangeObject, type CombatRangeObjectState } from "./components";
import { COMBAT_RANGE_IDS } from "./data";

export type CombatRangeAction = "melee" | "hitscan" | "area" | "projectile" | "cover" | "heal";

export type CombatRangeObjectSnapshot = CombatRangeObjectState & {
  entityId: EntityId;
  x: number;
  y: number;
  health?: number | undefined;
};

export type CombatRangeFeedback = {
  id: string;
  tone: "impact" | "blocked" | "launch" | "system";
  label: string;
};

export type CombatRangeCueSnapshot = {
  id: string;
  cueId: string;
  type: string;
  sourceActorId?: string | undefined;
  targetActorId?: string | undefined;
  correlationId?: string | undefined;
  startedAt: number;
  durationMs: number;
  selectedActorIds?: string[] | undefined;
  point?: { x: number; y: number } | undefined;
  normal?: { x: number; y: number } | undefined;
};

export type CombatRangeSnapshot = {
  running: boolean;
  tick: number;
  elapsed: number;
  objects: CombatRangeObjectSnapshot[];
  projectiles: Array<{ id: string; x: number; y: number }>;
  targetCount: number;
  lastAction?: CombatRangeAction | "reset" | undefined;
  lastResult?: CombatDeliveryRequestResult | undefined;
  cues: CombatRangeCueSnapshot[];
  feedback: CombatRangeFeedback[];
};

export type CombatRangeController = {
  perform(action: CombatRangeAction): CombatDeliveryRequestResult;
  reset(): void;
  snapshot(): CombatRangeSnapshot;
};

export type CombatRangeState = {
  entities: Map<string, EntityId>;
  actorIds: string[];
  sequence: number;
  cueSequence: number;
  elapsed: number;
  cues: CombatRangeCueSnapshot[];
  lastAction?: CombatRangeAction | "reset" | undefined;
  lastResult?: CombatDeliveryRequestResult | undefined;
};

export const combatRangeRelationshipResolver: CombatRelationshipResolver = {
  resolve(source, target) {
    const sourceTeam = source.tags?.find((tag) => tag.startsWith("team."));
    const targetTeam = target.tags?.find((tag) => tag.startsWith("team."));
    return sourceTeam !== undefined && sourceTeam === targetTeam ? "ally" : "hostile";
  },
  allows(policyId, relationship) {
    return policyId === COMBAT_RANGE_IDS.supportPolicy
      ? relationship === "ally"
      : relationship === "hostile";
  }
};

export function createCombatRangeState(): CombatRangeState {
  return {
    entities: new Map(),
    actorIds: [],
    sequence: 0,
    cueSequence: 0,
    elapsed: 0,
    cues: []
  };
}

export function createCombatRangePresentationModule(
  state: CombatRangeState
): GameModule<GameInstallContext> {
  return defineGameModule<GameInstallContext>({
    id: "sandbox.combat-range.presentation",
    install(ctx) {
      const unsubscribeCue = ctx.eventBus.on<GasCueEvent>("gas.cue", (event) => {
        state.cueSequence += 1;
        const selectedActorIds =
          event.payload.type === "combat.attack.area" && state.lastResult?.status === "resolved"
            ? state.lastResult.hits.map((hit) => hit.targetActorId)
            : undefined;
        const cue: CombatRangeCueSnapshot = {
          id: `range-cue-${state.cueSequence}`,
          cueId: event.payload.cueId,
          type: event.payload.type,
          ...(event.payload.sourceActorId === undefined
            ? {}
            : { sourceActorId: event.payload.sourceActorId }),
          ...(event.payload.targetActorId === undefined
            ? {}
            : { targetActorId: event.payload.targetActorId }),
          ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }),
          ...(selectedActorIds === undefined || selectedActorIds.length === 0
            ? {}
            : { selectedActorIds }),
          startedAt: state.elapsed,
          durationMs: cueDuration(event.payload.type)
        };
        const spatial = spatialFromResult(state.lastResult, event.payload.targetActorId);
        if (spatial?.point !== undefined) {
          cue.point = { ...spatial.point };
        }
        if (spatial?.normal !== undefined) {
          cue.normal = { ...spatial.normal };
        }
        state.cues.push(cue);
        if (state.cues.length > 24) {
          state.cues.splice(0, state.cues.length - 24);
        }
      });
      const unsubscribeHit = ctx.eventBus.on<CombatHitResult>("combat.hit_resolved", (event) => {
        const cue = [...state.cues]
          .reverse()
          .find(
            (candidate) =>
              candidate.correlationId === event.correlationId &&
              candidate.targetActorId === event.payload.targetActorId
          );
        if (cue !== undefined) {
          cue.point = event.payload.point === undefined ? undefined : { ...event.payload.point };
          cue.normal = event.payload.normal === undefined ? undefined : { ...event.payload.normal };
        }
      });
      ctx.systems.register({
        id: "sandbox.combat-range.presentation.update",
        update(systemCtx) {
          state.elapsed = systemCtx.elapsed;
          state.cues = state.cues.filter(
            (cue) => systemCtx.elapsed - cue.startedAt <= cue.durationMs
          );
        }
      });
      return () => {
        unsubscribeHit();
        unsubscribeCue();
        state.cues.length = 0;
      };
    }
  });
}

export function createCombatRangeBootstrapModule(
  state: CombatRangeState,
  gas: GasHandle
): GameModule<GameInstallContext> {
  return defineGameModule<GameInstallContext>({
    id: "sandbox.combat-range.bootstrap",
    install(ctx) {
      const spawned = [
        spawnActor(ctx.world, gas, {
          id: "operator",
          label: "Range Operator",
          role: "operator",
          team: "cyan",
          actorId: "actor.range.operator",
          definitionId: COMBAT_RANGE_IDS.operatorActor,
          x: -5.2,
          y: 1.2,
          health: 100
        }),
        spawnActor(ctx.world, gas, {
          id: "close-target",
          label: "Close Drone",
          role: "target",
          team: "amber",
          actorId: "actor.range.close-target",
          definitionId: COMBAT_RANGE_IDS.targetActor,
          x: -3.35,
          y: 1.2,
          health: 100
        }),
        spawnActor(ctx.world, gas, {
          id: "area-target",
          label: "Ring Drone B",
          role: "target",
          team: "amber",
          actorId: "actor.range.area-target",
          definitionId: COMBAT_RANGE_IDS.targetActor,
          x: 1.2,
          y: 1.15,
          health: 100
        }),
        spawnActor(ctx.world, gas, {
          id: "area-target-left",
          label: "Ring Drone A",
          role: "target",
          team: "amber",
          actorId: "actor.range.area-target-left",
          definitionId: COMBAT_RANGE_IDS.targetActor,
          x: 0.25,
          y: 1.55,
          health: 100
        }),
        spawnActor(ctx.world, gas, {
          id: "area-target-right",
          label: "Ring Drone C",
          role: "target",
          team: "amber",
          actorId: "actor.range.area-target-right",
          definitionId: COMBAT_RANGE_IDS.targetActor,
          x: 2.15,
          y: 1.55,
          health: 100
        }),
        spawnActor(ctx.world, gas, {
          id: "support-drone",
          label: "Support Drone",
          role: "ally",
          team: "cyan",
          actorId: "actor.range.support",
          definitionId: COMBAT_RANGE_IDS.allyActor,
          x: 1.1,
          y: 2.35,
          health: 64
        }),
        spawnCover(ctx.world, {
          id: "cover-wall",
          label: "Cover Plate",
          role: "cover",
          x: 0,
          y: -1.6,
          width: 0.55,
          height: 1.5
        }),
        spawnActor(ctx.world, gas, {
          id: "covered-target",
          label: "Covered Drone",
          role: "target",
          team: "amber",
          actorId: "actor.range.covered-target",
          definitionId: COMBAT_RANGE_IDS.targetActor,
          x: 3.45,
          y: -1.6,
          health: 100
        })
      ];

      for (const entry of spawned) {
        state.entities.set(entry.id, entry.entityId);
        if (entry.actorId !== undefined) {
          state.actorIds.push(entry.actorId);
        }
      }

      ctx.eventBus.emit(
        "sandbox.combat_range.ready",
        { entities: spawned.length, actors: state.actorIds.length },
        "sandbox.combat-range.bootstrap"
      );

      return () => {
        for (const actorId of state.actorIds) {
          if (gas.hasActor(actorId)) {
            gas.removeActor(actorId);
          }
        }
        for (const entityId of state.entities.values()) {
          if (ctx.world.has(entityId)) {
            ctx.world.despawn(entityId);
          }
        }
        state.entities.clear();
        state.actorIds.length = 0;
      };
    }
  });
}

export function createCombatRangeController(options: {
  runtime: GameRuntime;
  world: GameWorld;
  gas: GasHandle;
  physics: PhysicsHandle;
  combat: CombatHandle;
  state: CombatRangeState;
}): CombatRangeController {
  const { runtime, world, gas, combat, state } = options;

  return {
    perform(action) {
      state.sequence += 1;
      state.lastAction = action;
      state.lastResult = undefined;
      const requestId = `sandbox.combat-range.${action}.${state.sequence}`;
      const execution = gas.requestAbilityExecution({
        actorId: "actor.range.operator",
        abilityId: actionAbility(action),
        requestId,
        ...(action === "heal" ? { targetActorId: "actor.range.support" } : {}),
        correlationId: requestId
      });
      if (execution.status === "rejected") {
        const rejection: CombatDeliveryRequestResult = {
          status: "rejected",
          requestId,
          reason: "invalid-request",
          message: `Ability execution rejected: ${execution.reason}`,
          correlationId: execution.correlationId ?? requestId
        };
        state.lastResult = rejection;
        return rejection;
      }
      if (state.lastResult === undefined) {
        throw new Error(`Combat ability committed without delivery: ${execution.execution.id}`);
      }
      return state.lastResult;
    },
    reset() {
      for (const projectile of combat.listProjectiles()) {
        combat.cancelProjectile({
          projectileId: projectile.projectileId,
          reason: "range-reset"
        });
      }
      for (const actorId of state.actorIds) {
        gas.modifyAttribute(actorId, {
          attribute: "health",
          operation: "set",
          value: actorId === "actor.range.support" ? 64 : 100
        });
      }
      state.lastAction = "reset";
      state.lastResult = undefined;
      state.cues.length = 0;
    },
    snapshot() {
      const clock = runtime.clock.snapshot();
      const objects = [...state.entities.values()].flatMap((entityId) => {
        const object = world.get(entityId, CombatRangeObject);
        const transform = world.get(entityId, PhysicsTransformComponent);
        if (!object || !transform) {
          return [];
        }
        const health = object.actorId === undefined ? undefined : actorHealth(gas, object.actorId);
        return [
          {
            ...object,
            entityId,
            x: transform.position.x,
            y: transform.position.y,
            ...(health === undefined ? {} : { health })
          }
        ];
      });
      const projectiles = combat.listProjectiles().flatMap((projectile) => {
        const transform = world.get(projectile.entityId, PhysicsTransformComponent);
        return transform
          ? [{ id: projectile.projectileId, x: transform.position.x, y: transform.position.y }]
          : [];
      });
      return {
        running: runtime.isRunning(),
        tick: clock.ticks,
        elapsed: clock.elapsed,
        objects,
        projectiles,
        targetCount: objects.filter(
          (object) => object.role === "target" && (object.health ?? 0) > 0
        ).length,
        lastAction: state.lastAction,
        lastResult: state.lastResult,
        cues: state.cues.map((cue) => ({
          ...cue,
          ...(cue.selectedActorIds === undefined
            ? {}
            : { selectedActorIds: [...cue.selectedActorIds] }),
          ...(cue.point === undefined ? {} : { point: { ...cue.point } }),
          ...(cue.normal === undefined ? {} : { normal: { ...cue.normal } })
        })),
        feedback: feedbackFromCombat(combat)
      };
    }
  };
}

function actionAbility(action: CombatRangeAction): string {
  const abilities: Record<CombatRangeAction, string> = {
    melee: COMBAT_RANGE_IDS.meleeAbility,
    hitscan: COMBAT_RANGE_IDS.hitscanAbility,
    area: COMBAT_RANGE_IDS.areaAbility,
    projectile: COMBAT_RANGE_IDS.projectileAbility,
    cover: COMBAT_RANGE_IDS.coverAbility,
    heal: COMBAT_RANGE_IDS.healAbility
  };
  return abilities[action];
}

function cueDuration(type: string): number {
  if (type === "combat.attack.area" || type === "combat.impact.repair") {
    return 700;
  }
  if (type === "combat.attack.hitscan" || type === "combat.attack.cover") {
    return 260;
  }
  if (type === "combat.attack.projectile") {
    return 320;
  }
  return 460;
}

function spatialFromResult(
  result: CombatDeliveryRequestResult | undefined,
  targetActorId: string | undefined
): Pick<CombatRangeCueSnapshot, "point" | "normal"> | undefined {
  if (result?.status !== "resolved") {
    return undefined;
  }
  const hit = result.hits.find(
    (candidate) => targetActorId === undefined || candidate.targetActorId === targetActorId
  );
  const spatial = hit ?? result.blockedBy;
  if (spatial === undefined) {
    return undefined;
  }
  return {
    ...(spatial.point === undefined ? {} : { point: { ...spatial.point } }),
    ...(spatial.normal === undefined ? {} : { normal: { ...spatial.normal } })
  };
}

function feedbackFromCombat(combat: CombatHandle): CombatRangeFeedback[] {
  return combat
    .snapshot()
    .traces.slice(-8)
    .reverse()
    .map((trace) => {
      if (trace.type === "hit.applied") {
        return {
          id: trace.id,
          tone: "impact" as const,
          label: `${shortActor(trace.targetActorId)} took a confirmed payload`
        };
      }
      if (trace.type === "projectile.spawned") {
        return {
          id: trace.id,
          tone: "launch" as const,
          label: "Arc bolt entered the physical lane"
        };
      }
      if (trace.type === "candidate.rejected") {
        return {
          id: trace.id,
          tone: "blocked" as const,
          label: trace.message ?? "Candidate rejected by combat policy"
        };
      }
      return {
        id: trace.id,
        tone: "system" as const,
        label: traceLabel(trace.type)
      };
    });
}

function traceLabel(type: string): string {
  const labels: Record<string, string> = {
    "delivery.accepted": "Delivery accepted",
    "delivery.resolved": "Delivery resolved",
    "delivery.rejected": "Delivery rejected",
    "query.completed": "Physical target query completed",
    "projectile.hit": "Arc bolt struck a target",
    "projectile.despawned": "Arc bolt left the lane"
  };
  return labels[type] ?? type.replaceAll(".", " ");
}

function shortActor(actorId: string | undefined): string {
  return actorId?.split(".").at(-1)?.replaceAll("-", " ") ?? "Target";
}

function actorHealth(gas: GasHandle, actorId: string): number | undefined {
  return gas.hasActor(actorId) ? gas.getActor(actorId).attributes.current.health : undefined;
}

function spawnActor(
  world: GameWorld,
  gas: GasHandle,
  input: {
    id: string;
    label: string;
    role: "operator" | "ally" | "target";
    team: "cyan" | "amber";
    actorId: string;
    definitionId: string;
    x: number;
    y: number;
    health: number;
  }
): { id: string; entityId: EntityId; actorId: string } {
  const entityId = world.spawn();
  world.add(entityId, CombatRangeObject, input);
  world.add(entityId, PhysicsTransformComponent, { position: { x: input.x, y: input.y } });
  world.add(entityId, PhysicsBodyComponent, {
    definition: {
      id: `sandbox.combat-range.body.${input.id}`,
      kind: "static",
      userData: { rangeObjectId: input.id }
    }
  });
  world.add(entityId, PhysicsColliderComponent, {
    definition: {
      id: `sandbox.combat-range.collider.${input.id}`,
      shape: { type: "circle", radius: input.role === "operator" ? 0.42 : 0.36 },
      sensor: true,
      filter: { groups: ["actor"], collidesWith: ["actor", "projectile"] },
      userData: { rangeObjectId: input.id }
    }
  });
  gas.createActor({
    actorId: input.actorId,
    definitionId: input.definitionId,
    entityId,
    attributes: { health: input.health }
  });
  return { id: input.id, entityId, actorId: input.actorId };
}

function spawnCover(
  world: GameWorld,
  input: {
    id: string;
    label: string;
    role: "cover";
    x: number;
    y: number;
    width: number;
    height: number;
  }
): { id: string; entityId: EntityId; actorId?: undefined } {
  const entityId = world.spawn();
  world.add(entityId, CombatRangeObject, input);
  world.add(entityId, PhysicsTransformComponent, { position: { x: input.x, y: input.y } });
  world.add(entityId, PhysicsBodyComponent, {
    definition: {
      id: `sandbox.combat-range.body.${input.id}`,
      kind: "static",
      userData: { rangeObjectId: input.id }
    }
  });
  world.add(entityId, PhysicsColliderComponent, {
    definition: {
      id: `sandbox.combat-range.collider.${input.id}`,
      shape: { type: "box", width: input.width, height: input.height },
      filter: { groups: ["cover"], collidesWith: ["actor", "projectile"] },
      userData: { rangeObjectId: input.id }
    }
  });
  return { id: input.id, entityId };
}
