import {
  createCombatAbilityDeliveryBridge,
  createCombatDataTypes,
  createCombatRuntime,
  type CombatDeliveryRequestResult,
  type CombatHitResult
} from "@gamekits/combat";
import { createDataRegistry, type DataPack, type DataPackEntry } from "@gamekits/data";
import { createEventBus } from "@gamekits/event-bus";
import {
  createGasDataTypes,
  createGasRuntime,
  type GasAbilityDefinition,
  type GasActorDefinition,
  type GasEffectDefinition
} from "@gamekits/gas";
import type {
  PhysicsPredictionIslandCommand,
  PhysicsQueries,
  PhysicsVector
} from "@gamekits/physics-core";
import { createKootaWorld } from "@gamekits/world-koota";

import type { ArenaCompiledItemDefinition } from "../items/item-definition";
import type { ArenaImpactLedger } from "../match/impact-ledger";
import type { ArenaParticipantRegistry } from "../match/participant-registry";
import type { ArenaPublicCombatHit, ArenaPublicCombatState } from "../shared/protocol";

export type ArenaCombatDelivery = {
  id: string;
  executionId: string;
  itemId: string;
  itemGeneration: number;
  definitionId: string;
  sourceParticipantId: string;
  targetParticipantId: string;
  tick: number;
  charge: number;
  direction: PhysicsVector;
};

export type ArenaCombatAuthorityDiagnostics = {
  actors: number;
  hits: number;
  pendingKnockbacks: number;
  gasTraces: number;
  combatTraces: number;
  deliveries: number;
  duplicates: number;
  rejected: number;
  disposed: boolean;
};

export type ArenaCombatAuthorityCoordinator = {
  advance(tick: number): void;
  resolve(delivery: ArenaCombatDelivery): CombatDeliveryRequestResult | undefined;
  queuePhysicsCommands(input: {
    tick: number;
    nextSequence(): number;
    commands: PhysicsPredictionIslandCommand[];
  }): void;
  takeStaggerDurationMs(participantId: string): number | undefined;
  publicActors(): ArenaPublicCombatState[];
  publicHits(): ArenaPublicCombatHit[];
  reset(tick: number): void;
  diagnostics(): ArenaCombatAuthorityDiagnostics;
  dispose(): void;
};

type PendingKnockback = {
  id: string;
  targetParticipantId: string;
  targetMemberId: string;
  impulse: PhysicsVector;
};

type DeliveryContext = ArenaCombatDelivery & {
  definition: ArenaCompiledItemDefinition;
};

const ARENA_ACTOR_DEFINITION_ID = "actor.arena.competitor";
const ARENA_INSTABILITY_ATTRIBUTE_ID = "instability";
const ARENA_RELATIONSHIP_POLICY_ID = "combat.arena.relationship.opponent";
const MAX_PUBLIC_HITS = 64;
const INSTABILITY_DECAY_PER_TICK = 0.0025;

export function createArenaCombatAuthorityCoordinator(options: {
  participants: ArenaParticipantRegistry;
  impactLedger: ArenaImpactLedger;
  definitions: readonly ArenaCompiledItemDefinition[];
  fixedDeltaMs: number;
}): ArenaCombatAuthorityCoordinator {
  const definitionsById = new Map(
    options.definitions.map((definition) => [definition.id, definition])
  );
  const dataRegistry = createCombatDataRegistry(options.definitions);
  const eventBus = createEventBus();
  const world = createKootaWorld();
  const gas = createGasRuntime({
    world,
    dataRegistry,
    eventBus,
    abilityExecutions: { maxActivePerActor: 8, recentHistoryLimit: 512 }
  });
  const combat = createCombatRuntime({
    id: "arena.authority.combat",
    world,
    physics: emptyPhysicsQueries(),
    gas,
    dataRegistry,
    eventBus,
    relationshipResolver: {
      resolve(source, target) {
        return source.actorId === target.actorId ? "self" : "opponent";
      },
      allows(policyId, relationship) {
        return policyId === ARENA_RELATIONSHIP_POLICY_ID && relationship === "opponent";
      }
    },
    limits: {
      maxCandidatesPerRequest: 32,
      maxTargetsPerRequest: 16,
      recentDeliveryLimit: 512,
      resolvedTicketLimit: 2_048
    }
  });
  const deliveryContextByRequestId = new Map<string, DeliveryContext>();
  const instabilityByParticipantId = new Map<string, number>();
  const pendingKnockbacks = new Map<string, PendingKnockback>();
  const pendingStaggerByParticipantId = new Map<string, number>();
  const staggerUntilTickByParticipantId = new Map<string, number>();
  const publicHits = new Map<string, ArenaPublicCombatHit>();
  const lastHitTickByParticipantId = new Map<string, number>();
  let currentTick = 0;
  let deliveries = 0;
  let duplicates = 0;
  let rejected = 0;
  let disposed = false;
  const abilityBridge = createCombatAbilityDeliveryBridge({
    id: "arena.authority.item-delivery",
    eventBus,
    dataRegistry,
    gas,
    combat,
    resolveRequest({ execution }) {
      const context =
        execution.requestId === undefined
          ? undefined
          : deliveryContextByRequestId.get(execution.requestId);
      return context === undefined ? false : { targetActorId: context.targetParticipantId };
    },
    onResult({ execution, result }) {
      const context =
        execution.requestId === undefined
          ? undefined
          : deliveryContextByRequestId.get(execution.requestId);
      if (context !== undefined) {
        recordDeliveryResult(context, result);
        deliveryContextByRequestId.delete(context.id);
      }
    }
  });

  syncActors();

  return {
    advance(tick) {
      assertActive();
      if (!Number.isSafeInteger(tick) || tick < currentTick) {
        throw new Error("Arena combat authority cannot advance backwards");
      }
      currentTick = tick;
      syncActors();
      for (const [participantId, untilTick] of staggerUntilTickByParticipantId) {
        if (untilTick <= currentTick) staggerUntilTickByParticipantId.delete(participantId);
      }
      for (const [participantId, instability] of instabilityByParticipantId) {
        if (instability <= 0) continue;
        const next = Math.max(0, instability - INSTABILITY_DECAY_PER_TICK);
        gas.modifyAttribute(
          participantId,
          {
            attribute: ARENA_INSTABILITY_ATTRIBUTE_ID,
            operation: "set",
            value: next
          },
          "arena.instability.decay"
        );
        instabilityByParticipantId.set(participantId, next);
      }
    },
    resolve(delivery) {
      assertActive();
      const definition = definitionsById.get(delivery.definitionId);
      const source = options.participants.participant(delivery.sourceParticipantId);
      const target = options.participants.participant(delivery.targetParticipantId);
      if (
        definition === undefined ||
        source?.actorMemberId === undefined ||
        target?.actorMemberId === undefined ||
        source.id === target.id ||
        !gas.hasActor(source.id) ||
        !gas.hasActor(target.id)
      ) {
        rejected += 1;
        return undefined;
      }
      const context: DeliveryContext = { ...structuredClone(delivery), definition };
      deliveryContextByRequestId.set(delivery.id, context);
      const elapsedMs = delivery.tick * options.fixedDeltaMs;
      gas.update(0, elapsedMs);
      combat.update(0, elapsedMs);
      const result = gas.requestAbilityExecution({
        actorId: source.id,
        abilityId: abilityId(definition.id),
        targetActorId: target.id,
        requestId: delivery.id,
        correlationId: delivery.executionId
      });
      if (result.status === "rejected") {
        deliveryContextByRequestId.delete(delivery.id);
        rejected += 1;
        return undefined;
      }
      deliveries += result.duplicate ? 0 : 1;
      duplicates += result.duplicate ? 1 : 0;
      return undefined;
    },
    queuePhysicsCommands(input) {
      assertActive();
      for (const knockback of [...pendingKnockbacks.values()].sort((left, right) =>
        left.id.localeCompare(right.id)
      )) {
        input.commands.push({
          type: "body-command",
          tick: input.tick,
          sequence: input.nextSequence(),
          memberId: knockback.targetMemberId,
          command: { type: "linear-impulse", impulse: knockback.impulse, wake: "wake" }
        });
      }
      pendingKnockbacks.clear();
    },
    takeStaggerDurationMs(participantId) {
      assertActive();
      const duration = pendingStaggerByParticipantId.get(participantId);
      pendingStaggerByParticipantId.delete(participantId);
      return duration;
    },
    publicActors() {
      assertActive();
      return [...instabilityByParticipantId.keys()]
        .map((participantId) => ({
          participantId,
          instability: instabilityByParticipantId.get(participantId) ?? 0,
          staggerUntilTick: staggerUntilTickByParticipantId.get(participantId) ?? currentTick,
          ...(lastHitTickByParticipantId.get(participantId) === undefined
            ? {}
            : { lastHitTick: lastHitTickByParticipantId.get(participantId)! }),
          revision: (lastHitTickByParticipantId.get(participantId) ?? 0) + 1
        }))
        .sort((left, right) => left.participantId.localeCompare(right.participantId));
    },
    publicHits() {
      assertActive();
      return [...publicHits.values()].map((hit) => structuredClone(hit));
    },
    reset(tick) {
      assertActive();
      currentTick = tick;
      pendingKnockbacks.clear();
      pendingStaggerByParticipantId.clear();
      staggerUntilTickByParticipantId.clear();
      publicHits.clear();
      lastHitTickByParticipantId.clear();
      deliveryContextByRequestId.clear();
      for (const participant of options.participants.list()) {
        if (!gas.hasActor(participant.id)) continue;
        gas.modifyAttribute(
          participant.id,
          { attribute: ARENA_INSTABILITY_ATTRIBUTE_ID, operation: "set", value: 0 },
          "arena.combat.reset"
        );
        instabilityByParticipantId.set(participant.id, 0);
      }
      combat.restoreCheckpoint({ elapsed: tick * options.fixedDeltaMs, projectiles: [] });
      const gasCheckpoint = gas.captureCheckpoint();
      gas.restoreCheckpoint({
        elapsed: tick * options.fixedDeltaMs,
        actors: gasCheckpoint.actors,
        executions: []
      });
    },
    diagnostics() {
      return {
        actors: instabilityByParticipantId.size,
        hits: publicHits.size,
        pendingKnockbacks: pendingKnockbacks.size,
        gasTraces: gas.traceStore.snapshot().entries.length,
        combatTraces: combat.traceStore.snapshot().entries.length,
        deliveries,
        duplicates,
        rejected,
        disposed
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      abilityBridge.dispose();
      combat.dispose();
      gas.dispose();
      pendingKnockbacks.clear();
      pendingStaggerByParticipantId.clear();
      staggerUntilTickByParticipantId.clear();
      publicHits.clear();
      lastHitTickByParticipantId.clear();
      deliveryContextByRequestId.clear();
      instabilityByParticipantId.clear();
    }
  };

  function recordDeliveryResult(
    context: DeliveryContext,
    result: CombatDeliveryRequestResult
  ): void {
    if (result.status !== "resolved") {
      rejected += 1;
      return;
    }
    if (result.duplicate) {
      duplicates += 1;
      return;
    }
    for (const hit of result.hits) {
      if (hit.status !== "applied") continue;
      recordAppliedHit(context, hit);
    }
  }

  function recordAppliedHit(context: DeliveryContext, hit: CombatHitResult): void {
    const target = options.participants.participant(context.targetParticipantId);
    if (target?.actorMemberId === undefined) return;
    const instability = readInstability(target.id);
    instabilityByParticipantId.set(target.id, instability);
    const chargeScale = 0.65 + Math.max(0, Math.min(1, context.charge)) * 0.35;
    const impulseMagnitude =
      context.definition.baseImpulse * chargeScale * (1 + instability * 1.15);
    const impulse = resolveArenaItemImpulse(
      context.definition,
      context.direction,
      impulseMagnitude
    );
    const impactId = `${hit.ticketId}:impact`;
    const recorded = options.impactLedger.record({
      id: impactId,
      hitTicket: hit.ticketId,
      sourceParticipantId: context.sourceParticipantId,
      targetParticipantId: context.targetParticipantId,
      itemOrAbilityId: context.definitionId,
      impulseMagnitude,
      tick: context.tick,
      cause: "participant"
    });
    if (recorded !== "applied") {
      duplicates += 1;
      return;
    }
    pendingKnockbacks.set(hit.ticketId, {
      id: hit.ticketId,
      targetParticipantId: context.targetParticipantId,
      targetMemberId: target.actorMemberId,
      impulse
    });
    const staggerDurationMs = Math.min(
      1_200,
      (120 + impulseMagnitude * 18 + instability * 220) * context.definition.staggerMultiplier
    );
    pendingStaggerByParticipantId.set(
      target.id,
      Math.max(pendingStaggerByParticipantId.get(target.id) ?? 0, staggerDurationMs)
    );
    staggerUntilTickByParticipantId.set(
      target.id,
      Math.max(
        staggerUntilTickByParticipantId.get(target.id) ?? currentTick,
        currentTick + Math.ceil(staggerDurationMs / options.fixedDeltaMs)
      )
    );
    lastHitTickByParticipantId.set(target.id, context.tick);
    publicHits.set(hit.ticketId, {
      id: hit.ticketId,
      sourceParticipantId: context.sourceParticipantId,
      targetParticipantId: context.targetParticipantId,
      itemId: context.itemId,
      itemGeneration: context.itemGeneration,
      definitionId: context.definitionId,
      tick: context.tick,
      impulseMagnitude,
      instability
    });
    while (publicHits.size > MAX_PUBLIC_HITS) {
      const oldest = publicHits.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      publicHits.delete(oldest);
    }
  }

  function syncActors(): void {
    for (const participant of options.participants.list()) {
      if (participant.actorMemberId === undefined || gas.hasActor(participant.id)) continue;
      gas.createActor({ actorId: participant.id, definitionId: ARENA_ACTOR_DEFINITION_ID });
      instabilityByParticipantId.set(participant.id, 0);
    }
  }

  function readInstability(participantId: string): number {
    return gas.getActor(participantId).attributes.current[ARENA_INSTABILITY_ATTRIBUTE_ID] ?? 0;
  }

  function assertActive(): void {
    if (disposed) throw new Error("Arena combat authority coordinator is disposed");
  }
}

function createCombatDataRegistry(definitions: readonly ArenaCompiledItemDefinition[]) {
  const registry = createDataRegistry();
  for (const type of [...createGasDataTypes(), ...createCombatDataTypes()]) {
    registry.registerType(type);
  }
  const abilities: GasAbilityDefinition[] = definitions.map((definition) => ({
    id: abilityId(definition.id),
    execution: { preparingMs: 0, activeMs: 0, recoveringMs: 0, maxConcurrent: 8 }
  }));
  const actor: GasActorDefinition = {
    id: ARENA_ACTOR_DEFINITION_ID,
    attributes: { [ARENA_INSTABILITY_ATTRIBUTE_ID]: 0 },
    abilities: abilities.map((ability) => ability.id),
    tags: ["arena.competitor"]
  };
  const entries: DataPackEntry[] = [
    entry("gas.attribute", ARENA_INSTABILITY_ATTRIBUTE_ID, {
      id: ARENA_INSTABILITY_ATTRIBUTE_ID,
      min: 0,
      max: 1,
      defaultValue: 0
    }),
    ...definitions.map((definition) => {
      const effect: GasEffectDefinition = {
        id: effectId(definition.id),
        attributeModifiers: [
          {
            attribute: ARENA_INSTABILITY_ATTRIBUTE_ID,
            operation: "add",
            value: definition.instabilityDelta
          }
        ]
      };
      return entry("gas.effect", effect.id, effect);
    }),
    ...abilities.map((ability) => entry("gas.ability", ability.id, ability)),
    entry("gas.actor", actor.id, actor),
    entry("combat.relationship-policy", ARENA_RELATIONSHIP_POLICY_ID, {
      id: ARENA_RELATIONSHIP_POLICY_ID,
      tags: ["arena", "opponent-only"]
    }),
    ...definitions.map((definition) =>
      entry("combat.delivery", deliveryId(definition.id), {
        id: deliveryId(definition.id),
        delivery: { type: "direct" as const },
        payloads: [{ effectId: effectId(definition.id), target: "hit-actor" as const }],
        relationshipPolicy: ARENA_RELATIONSHIP_POLICY_ID
      })
    ),
    ...definitions.map((definition) =>
      entry("combat.ability-delivery", bindingId(definition.id), {
        id: bindingId(definition.id),
        ability: { type: "gas.ability", id: abilityId(definition.id) },
        delivery: { type: "combat.delivery", id: deliveryId(definition.id) },
        phase: "committed" as const
      })
    )
  ];
  const pack: DataPack = { id: "arena.combat", version: "1.0.0", entries };
  registry.registerPack(pack);
  return registry;
}

function abilityId(definitionId: string): string {
  return `ability.arena.${definitionId}`;
}

function effectId(definitionId: string): string {
  return `effect.arena.${definitionId}.instability`;
}

function deliveryId(definitionId: string): string {
  return `delivery.arena.${definitionId}`;
}

function bindingId(definitionId: string): string {
  return `binding.arena.${definitionId}`;
}

function entry<T>(type: string, id: string, data: T): DataPackEntry<T> {
  return { type, id, data };
}

function normalizeHorizontal(value: PhysicsVector): PhysicsVector {
  const length = Math.hypot(value.x, value.z ?? 0);
  return length <= 0.0001
    ? { x: 0, y: 0, z: -1 }
    : { x: value.x / length, y: 0, z: (value.z ?? 0) / length };
}

export function resolveArenaItemImpulse(
  definition: Pick<ArenaCompiledItemDefinition, "impulseMode">,
  directionValue: PhysicsVector,
  impulseMagnitude: number
): PhysicsVector {
  const direction = normalizeHorizontal(directionValue);
  if (definition.impulseMode === "pull") {
    return {
      x: -direction.x * impulseMagnitude,
      y: Math.max(1.1, impulseMagnitude * 0.1),
      z: -(direction.z ?? 0) * impulseMagnitude
    };
  }
  if (definition.impulseMode === "launch") {
    return {
      x: direction.x * impulseMagnitude * 0.32,
      y: Math.max(5.5, impulseMagnitude * 0.9),
      z: (direction.z ?? 0) * impulseMagnitude * 0.32
    };
  }
  return {
    x: direction.x * impulseMagnitude,
    y: Math.max(1.5, impulseMagnitude * 0.18),
    z: (direction.z ?? 0) * impulseMagnitude
  };
}

function emptyPhysicsQueries(): PhysicsQueries {
  return {
    query: () => [],
    queryPoint: () => [],
    raycast: () => [],
    shapeCast: () => [],
    overlapShape: () => [],
    checkOverlap: () => false,
    checkCollision: () => false,
    queryBounds: () => [],
    snapshot: () => ({
      id: "arena.combat.no-spatial-query",
      backend: "none",
      dimension: "3d",
      gravity: { x: 0, y: 0, z: 0 },
      bodyCount: 0,
      colliderCount: 0,
      activeContactCount: 0,
      disposed: false
    })
  };
}
