import { createAssetDataType } from "@gamekits/asset";
import {
  createAnimatorDataTypes,
  createAnimatorRuntime,
  type AnimatorControllerSnapshot
} from "@gamekits/animator-core";
import type {
  AnimationPlaybackFrame,
  AnimationPlaybackLayerFrame
} from "@gamekits/animator-core/playback";
import type {
  CharacterMotorPredictionCheckpoint,
  CharacterMotorState
} from "@gamekits/character-controller";
import { createDataRegistry, type DataTypeDefinition } from "@gamekits/data";
import type { PhysicsPredictionIslandStateSnapshot } from "@gamekits/physics-core";

import { compileArenaItemCatalog } from "../items/item-definition";
import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import { ARENA_CHARACTER_MOTOR_CONTRIBUTOR_ID } from "../shared/arena-control";
import { ARENA_FIXED_STEP_MS } from "../shared/config";
import type { ArenaPublicParticipantState, ArenaSnapshot } from "../shared/protocol";
import {
  ARENA_ANIMATOR_BINDING_ID,
  ARENA_ANIMATOR_PACK,
  type ArenaPresentedBaseState
} from "./arena-animation-content";
import { createArenaAnimationPlaybackAdapter } from "./arena-animation-playback";
import type { ArenaEffectPresentationEvent } from "./arena-effects";

export type { ArenaPresentedBaseState } from "./arena-animation-content";

export type ArenaPresentedActorState = {
  memberId: string;
  participantId: string;
  generation: number;
  tick: number;
  local: boolean;
  horizontalSpeed: number;
  normalizedSpeed: number;
  verticalVelocity: number;
  facingYaw: number;
  instability: number;
  grounded: boolean;
  carrying: boolean;
  baseState: ArenaPresentedBaseState;
  actionClip?: string | undefined;
  reactionClip?: string | undefined;
  actionNormalizedTime?: number | undefined;
};

export type ArenaPresentedItemState = {
  itemId: string;
  definitionId: string;
  instanceGeneration: number;
  ownerParticipantId: string;
  ownerMemberId: string;
  state: "carried" | "windup";
  normalizedActionTime: number;
};

export type ArenaPresentationSnapshot = {
  generation: number;
  sourceGeneration?: string | number | undefined;
  actors: ArenaPresentedActorState[];
  items: ArenaPresentedItemState[];
};

export type ArenaPresentationDiagnostics = {
  generation: number;
  controllers: number;
  retainedFrames: number;
  appliedFrames: number;
  consumedEffectIdentities: number;
  generationResets: number;
  phaseSeeks: number;
  disposed: boolean;
};

export type ArenaPresentationRuntime = {
  sync(input: {
    snapshot: ArenaSnapshot | undefined;
    predictedState: PhysicsPredictionIslandStateSnapshot | undefined;
    localMemberId?: string | undefined;
    deltaMs: number;
  }): void;
  effect(event: ArenaEffectPresentationEvent): void;
  snapshot(): ArenaPresentationSnapshot;
  actor(memberId: string): ArenaPresentedActorState | undefined;
  diagnostics(): ArenaPresentationDiagnostics;
  dispose(): void;
};

const MAX_EFFECT_IDENTITIES = 512;
const ITEM_DEFINITIONS = new Map(
  compileArenaItemCatalog(ARENA_COMPILED_CONTENT.stages).definitions.map((definition) => [
    definition.id,
    definition
  ])
);

export function createArenaPresentationRuntime(): ArenaPresentationRuntime {
  const registry = createDataRegistry();
  registry.registerType(
    createAssetDataType({ supportedTypes: ["custom"], supportedSources: ["memory"] })
  );
  for (const dataType of createAnimatorDataTypes()) {
    registry.registerType(dataType as DataTypeDefinition<any>);
  }
  registry.registerPack(ARENA_ANIMATOR_PACK);

  const adapter = createArenaAnimationPlaybackAdapter();
  const animator = createAnimatorRuntime({
    id: "knockout.presentation.animator",
    dataRegistry: registry,
    adapter,
    maxControllers: 32,
    maxQueuedOneShotsPerController: 2,
    markerHistoryLimit: 32,
    maxMarkerEventsPerControllerUpdate: 4,
    traceLimit: 256
  });
  const actors = new Map<string, ArenaPresentedActorState>();
  const items = new Map<string, ArenaPresentedItemState>();
  const controllers = new Map<string, string>();
  const phaseSignatures = new Map<string, string>();
  const phaseExecutions = new Map<string, string>();
  const consumedEffects = new Map<string, number>();
  let sourceGeneration: string | number | undefined;
  let generation = 0;
  let elapsedMs = 0;
  let generationResets = 0;
  let phaseSeeks = 0;
  let disposed = false;

  return {
    sync({ snapshot, predictedState, localMemberId, deltaMs }) {
      if (disposed) return;
      const safeDeltaMs = Math.min(50, Math.max(0, finite(deltaMs, 0)));
      elapsedMs += safeDeltaMs;
      const nextSourceGeneration = predictedState?.generation ?? snapshot?.frame.generation;
      if (nextSourceGeneration !== undefined && nextSourceGeneration !== sourceGeneration) {
        sourceGeneration = nextSourceGeneration;
        generation += 1;
        generationResets += 1;
        phaseSignatures.clear();
        phaseExecutions.clear();
        consumedEffects.clear();
        items.clear();
        for (const controllerId of controllers.values()) animator.reset(controllerId, generation);
      }
      if (snapshot === undefined || predictedState === undefined) {
        animator.update(safeDeltaMs, elapsedMs);
        return;
      }

      const motorStates = readMotorStates(predictedState);
      const bodies = new Map(predictedState.members.map((member) => [member.id, member.body]));
      const actorMemberIdByParticipantId = new Map(
        snapshot.participants.flatMap((participant) =>
          participant.actorMemberId === undefined
            ? []
            : [[participant.id, participant.actorMemberId] as const]
        )
      );
      const desiredItems = new Set<string>();
      for (const item of snapshot.items) {
        if (
          item.ownerParticipantId === undefined ||
          (item.state !== "carried" && item.state !== "windup")
        ) {
          continue;
        }
        const ownerMemberId = actorMemberIdByParticipantId.get(item.ownerParticipantId);
        if (ownerMemberId === undefined || !bodies.has(ownerMemberId)) continue;
        desiredItems.add(item.id);
        const durationTicks = Math.max(
          1,
          (item.deadlineTick ?? item.stateChangedAtTick + 1) - item.stateChangedAtTick
        );
        items.set(item.id, {
          itemId: item.id,
          definitionId: item.definitionId,
          instanceGeneration: item.instanceGeneration,
          ownerParticipantId: item.ownerParticipantId,
          ownerMemberId,
          state: item.state,
          normalizedActionTime:
            item.state === "windup"
              ? Math.max(
                  0,
                  Math.min(1, (predictedState.tick - item.stateChangedAtTick) / durationTicks)
                )
              : 0
        });
      }
      for (const itemId of items.keys()) {
        if (!desiredItems.has(itemId)) items.delete(itemId);
      }
      const desiredMembers = new Set<string>();
      for (const participant of snapshot.participants) {
        const memberId = participant.actorMemberId;
        const body = memberId === undefined ? undefined : bodies.get(memberId);
        if (memberId === undefined || body === undefined) continue;
        desiredMembers.add(memberId);
        const controllerId = ensureController(memberId);
        const motor = motorStates.get(memberId);
        const horizontalSpeed = Math.hypot(body.linearVelocity.x, body.linearVelocity.z ?? 0);
        const verticalVelocity = body.linearVelocity.y;
        const instability =
          snapshot.combat.actors.find((actor) => actor.participantId === participant.id)
            ?.instability ?? 0;
        const carrying = snapshot.items.some(
          (item) =>
            item.ownerParticipantId === participant.id &&
            (item.state === "carried" || item.state === "windup")
        );
        const eliminated = isEliminated(participant, snapshot, memberId);
        const grounded = motor?.grounded ?? Math.abs(verticalVelocity) < 0.3;
        const mode = eliminated ? "eliminated" : motor?.mode;
        const baseState = resolveBaseState(mode, grounded, horizontalSpeed, verticalVelocity);
        const facingYaw = resolveFacingYaw(motor, actors.get(memberId), body.linearVelocity);
        const normalizedSpeed = Math.min(1.5, horizontalSpeed / 7.2);

        animator.setParameters(controllerId, {
          moving: horizontalSpeed > 0.18,
          speed: Math.max(0.2, normalizedSpeed),
          airborne: !grounded,
          falling: verticalVelocity < -0.2,
          diving: mode === "diving",
          recovering: mode === "recovering",
          staggered: mode === "staggered",
          eliminated,
          carrying
        });
        syncActionPhase({
          controllerId,
          participant,
          snapshot,
          predictedTick: predictedState.tick,
          memberId
        });

        actors.set(memberId, {
          memberId,
          participantId: participant.id,
          generation,
          tick: predictedState.tick,
          local: memberId === localMemberId,
          horizontalSpeed,
          normalizedSpeed,
          verticalVelocity,
          facingYaw,
          instability,
          grounded,
          carrying,
          baseState
        });
      }

      for (const [memberId, controllerId] of controllers) {
        if (desiredMembers.has(memberId)) continue;
        animator.unbind(controllerId);
        controllers.delete(memberId);
        actors.delete(memberId);
        phaseSignatures.delete(memberId);
        phaseExecutions.delete(memberId);
      }

      animator.update(safeDeltaMs, elapsedMs);
      for (const [memberId, actor] of actors) {
        const frame = adapter.frame(controllers.get(memberId));
        actors.set(
          memberId,
          mergePlayback(actor, frame, animator.getController(controllers.get(memberId) ?? ""))
        );
      }
    },
    effect(event) {
      if (disposed || (event.phase !== "confirm" && event.phase !== "replace")) return;
      if (consumedEffects.has(event.effectId)) return;
      consumedEffects.set(event.effectId, event.tick);
      while (consumedEffects.size > MAX_EFFECT_IDENTITIES) {
        const oldest = consumedEffects.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        consumedEffects.delete(oldest);
      }
      const target = resolveEffectTarget(event, actors);
      if (target === undefined) return;
      const controllerId = controllers.get(target);
      if (controllerId === undefined) return;
      animator.trigger(
        controllerId,
        event.kind === "jump"
          ? "jump-accent"
          : event.kind === "item-action"
            ? "item-action"
            : "impact"
      );
    },
    snapshot() {
      return {
        generation,
        ...(sourceGeneration === undefined ? {} : { sourceGeneration }),
        actors: [...actors.values()]
          .sort((left, right) => left.memberId.localeCompare(right.memberId))
          .map((actor) => ({ ...actor })),
        items: [...items.values()]
          .sort((left, right) => left.itemId.localeCompare(right.itemId))
          .map((item) => ({ ...item }))
      };
    },
    actor(memberId) {
      const actor = actors.get(memberId);
      return actor === undefined ? undefined : { ...actor };
    },
    diagnostics() {
      const playback = adapter.snapshot();
      return {
        generation,
        controllers: controllers.size,
        retainedFrames: playback.retainedFrames,
        appliedFrames: playback.appliedFrames,
        consumedEffectIdentities: consumedEffects.size,
        generationResets,
        phaseSeeks,
        disposed
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      animator.dispose();
      actors.clear();
      items.clear();
      controllers.clear();
      phaseSignatures.clear();
      phaseExecutions.clear();
      consumedEffects.clear();
    }
  };

  function ensureController(memberId: string): string {
    const existing = controllers.get(memberId);
    if (existing !== undefined) return existing;
    const controllerId = `knockout.animator.${memberId}`;
    animator.bind({
      controllerId,
      bindingId: ARENA_ANIMATOR_BINDING_ID,
      renderObjectId: memberId,
      generation
    });
    controllers.set(memberId, controllerId);
    return controllerId;
  }

  function syncActionPhase(input: {
    controllerId: string;
    participant: ArenaPublicParticipantState;
    snapshot: ArenaSnapshot;
    predictedTick: number;
    memberId: string;
  }): void {
    const item = input.snapshot.items.find(
      (candidate) =>
        candidate.ownerParticipantId === input.participant.id && candidate.state === "windup"
    );
    if (item?.executionId === undefined) {
      const previous = phaseExecutions.get(input.memberId);
      if (previous !== undefined) animator.cancelGameplayPhase(input.controllerId, previous);
      phaseExecutions.delete(input.memberId);
      phaseSignatures.delete(input.memberId);
      return;
    }
    const definition = ITEM_DEFINITIONS.get(item.definitionId);
    const durationTicks = Math.max(
      1,
      item.deadlineTick === undefined
        ? (definition?.windupTicks ?? 1)
        : item.deadlineTick - item.stateChangedAtTick
    );
    const signature = `${item.executionId}:${item.stateChangedAtTick}:${durationTicks}:${generation}`;
    if (phaseSignatures.get(input.memberId) === signature) return;
    const previous = phaseExecutions.get(input.memberId);
    if (previous !== undefined && previous !== item.executionId) {
      animator.cancelGameplayPhase(input.controllerId, previous);
    }
    const authorityProgressMs =
      Math.max(0, Math.min(durationTicks, input.predictedTick - item.stateChangedAtTick)) *
      ARENA_FIXED_STEP_MS;
    animator.syncGameplayPhase(input.controllerId, {
      executionId: item.executionId,
      abilityId: "arena.item",
      phase: "windup",
      startedAt: elapsedMs - authorityProgressMs,
      durationMs: durationTicks * ARENA_FIXED_STEP_MS,
      generation
    });
    phaseSignatures.set(input.memberId, signature);
    phaseExecutions.set(input.memberId, item.executionId);
    phaseSeeks += 1;
  }
}

function readMotorStates(
  state: PhysicsPredictionIslandStateSnapshot | undefined
): Map<string, CharacterMotorState> {
  const value = state?.auxiliary?.find(
    (candidate) => candidate.id === ARENA_CHARACTER_MOTOR_CONTRIBUTOR_ID
  )?.state as CharacterMotorPredictionCheckpoint | undefined;
  if (value?.version !== 1 || !Array.isArray(value.members)) return new Map();
  return new Map(value.members.map((member) => [member.memberId, member.state]));
}

function isEliminated(
  participant: ArenaPublicParticipantState,
  snapshot: ArenaSnapshot,
  memberId: string
): boolean {
  if (participant.status === "qualified" || participant.status === "finished") return false;
  return participant.status === "eliminated" || snapshot.removedMemberIds.includes(memberId);
}

function resolveBaseState(
  mode: CharacterMotorState["mode"] | undefined,
  grounded: boolean,
  speed: number,
  verticalVelocity: number
): ArenaPresentedBaseState {
  if (mode === "eliminated") return "eliminated";
  if (mode === "staggered") return "stagger";
  if (mode === "diving") return "dive";
  if (mode === "recovering") return "recovery";
  if (!grounded) return verticalVelocity < -0.2 ? "fall" : "jump";
  return speed > 0.18 ? "run" : "idle";
}

function resolveFacingYaw(
  motor: CharacterMotorState | undefined,
  previous: ArenaPresentedActorState | undefined,
  velocity: { x: number; z?: number | undefined }
): number {
  if (motor !== undefined) return motor.facingYaw;
  const speed = Math.hypot(velocity.x, velocity.z ?? 0);
  return speed > 0.12 ? Math.atan2(-velocity.x, -(velocity.z ?? 0)) : (previous?.facingYaw ?? 0);
}

function mergePlayback(
  actor: ArenaPresentedActorState,
  frame: AnimationPlaybackFrame | undefined,
  controller: AnimatorControllerSnapshot | undefined
): ArenaPresentedActorState {
  const base = frame?.layers.find((layer) => layer.layerId === "base");
  const action = activeLayer(frame?.layers, "action");
  const reaction = activeLayer(frame?.layers, "reaction");
  return {
    ...actor,
    baseState: (base?.stateId as ArenaPresentedBaseState | undefined) ?? actor.baseState,
    ...(action === undefined
      ? {}
      : { actionClip: action.clipId, actionNormalizedTime: action.normalizedTime }),
    ...(reaction === undefined ? {} : { reactionClip: reaction.clipId }),
    ...(controller === undefined ? {} : { generation: controller.generation })
  };
}

function activeLayer(
  layers: AnimationPlaybackLayerFrame[] | undefined,
  layerId: string
): AnimationPlaybackLayerFrame | undefined {
  const layer = layers?.find((candidate) => candidate.layerId === layerId);
  return layer?.kind === "state" ? undefined : layer;
}

function resolveEffectTarget(
  event: ArenaEffectPresentationEvent,
  actors: ReadonlyMap<string, ArenaPresentedActorState>
): string | undefined {
  if (event.kind === "jump") {
    const prefix = "jump:";
    const sequenceSeparator = event.effectId.lastIndexOf(":");
    const memberId = event.effectId.slice(prefix.length, sequenceSeparator);
    if (actors.has(memberId)) return memberId;
  }
  if (event.kind === "item-hit") {
    const participantId = event.effectId.split(":").at(-1);
    return [...actors.values()].find((actor) => actor.participantId === participantId)?.memberId;
  }
  return [...actors.values()].find((actor) => actor.local)?.memberId;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
