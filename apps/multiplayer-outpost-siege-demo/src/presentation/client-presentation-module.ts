import type { AnimatorHandle } from "@gamekits/animator-core";
import type { GameAudio } from "@gamekits/audio-core";
import type { CameraController } from "@gamekits/camera-core";
import { defineGameModule } from "@gamekits/core";
import type { DataRegistry } from "@gamekits/data";
import type { GameInstallContext } from "@gamekits/game-runtime";
import { PhysicsTransformComponent, type PhysicsBackendAdapter } from "@gamekits/physics-core";
import type { RendererAdapter } from "@gamekits/renderer-core";

import { outpostAnimatorBindingIdForRenderKey } from "../content";
import { OutpostGameplayObject, OutpostPresentation } from "../gameplay/components";
import { OUTPOST_AUDIO_IDS } from "./audio-content";
import {
  createOutpostArenaRenderObjectDefinitions,
  type OutpostRenderTargetWriter
} from "./preview-presentation-module";
import { createOutpostDynamicRenderObjectDefinition } from "./player-render-object";
import { resolveOutpostFacingRotation } from "./render-rotation";
import {
  createOutpostCombatFeedbackState,
  cancelOutpostAnticipatedProjectile,
  disposeOutpostCombatFeedback,
  markOutpostCrosshairFeedback,
  startOutpostAnticipatedTracer,
  syncOutpostCombatFeedback,
  type OutpostClientCombatPresentation,
  type OutpostCombatFeedbackState,
  type OutpostProjectilePredictionFrame
} from "./combat";
import type { OutpostClientPlayerPresentation } from "./player";

export type CreateOutpostClientPresentationModuleOptions = {
  dataRegistry: DataRegistry;
  renderer: RendererAdapter;
  animator?: AnimatorHandle | undefined;
  audio?: GameAudio | undefined;
  camera?: CameraController | undefined;
  physicsBackend?: PhysicsBackendAdapter | undefined;
  playerPresentation?: OutpostClientPlayerPresentation | undefined;
  combatPresentation?: OutpostClientCombatPresentation | undefined;
  readProjectilePredictionFrame?(): OutpostProjectilePredictionFrame | undefined;
  listenerObjectId?: string | undefined;
  applyRenderTargetState?: OutpostRenderTargetWriter | undefined;
  readObjectState?(objectId: string):
    | {
        position: { x: number; y: number };
        velocityX: number;
        velocityY: number;
        facing: number;
        generation?: number | undefined;
        authorityElapsedMs?: number | undefined;
        tags?: readonly string[] | undefined;
        targetActorId?: string | undefined;
        aiGoalId?: string | undefined;
        aiTaskPhase?: string | undefined;
        abilityExecutionId?: string | undefined;
        abilityId?: string | undefined;
        abilityPhase?: string | undefined;
        abilityPhaseStartedAt?: number | undefined;
        abilityPhaseEndsAt?: number | undefined;
        weaponShotSequence?: number | undefined;
        weaponLastShotCorrelationId?: string | undefined;
        dashRemainingMs?: number | undefined;
      }
    | undefined;
};

type OutpostPresentedObjectState = NonNullable<
  ReturnType<NonNullable<CreateOutpostClientPresentationModuleOptions["readObjectState"]>>
>;

export function createOutpostClientPresentationModule(
  options: CreateOutpostClientPresentationModuleOptions
) {
  const arenaObjects = createOutpostArenaRenderObjectDefinitions(options.dataRegistry);
  return defineGameModule<GameInstallContext>({
    id: "outpost.client.presentation",
    install(ctx) {
      const arenaObjectIds = new Set<string>();
      const dynamicObjectIds = new Set<string>();
      const signatures = new Map<string, string>();
      const animatorParameterSignatures = new Map<string, string>();
      const animatorPhaseSignatures = new Map<string, string>();
      const animatorPhaseExecutions = new Map<string, string>();
      const animatorGenerations = new Map<string, number>();
      const animatorControllers = new Map<string, string>();
      const audioPhaseSignatures = new Map<string, string>();
      const weaponShotSequences = new Map<string, number>();
      const localWeaponPresentation = createLocalWeaponPresentationState();
      const combatFeedback = createOutpostCombatFeedbackState(options);
      let musicStarted = false;
      let arenaCreated = false;

      ctx.systems.register({
        id: "outpost.client.presentation.sync",
        update({ elapsed }) {
          if (!arenaCreated) {
            for (const definition of arenaObjects) {
              const objectId = requireObjectId(definition.id, "arena");
              options.renderer.createObject(definition);
              arenaObjectIds.add(objectId);
            }
            arenaCreated = true;
          }

          syncLocalWeaponPresentation(options, localWeaponPresentation, combatFeedback, elapsed);
          syncOutpostCombatFeedback(options, combatFeedback, {
            presentation: options.combatPresentation,
            playerFrame: options.playerPresentation?.currentFrame(),
            elapsed,
            localAnticipations: localWeaponPresentation.anticipatedCorrelations
          });

          const desiredObjectIds = new Set<string>();
          const audioEmitters: Array<{
            id: string;
            transform: { position: { x: number; y: number } };
            velocity: { x: number; y: number };
          }> = [];
          if (!musicStarted && options.audio) {
            options.audio.music.play(OUTPOST_AUDIO_IDS.music, { fadeInMs: 700 });
            musicStarted = true;
          }
          for (const entity of ctx.world.query([
            OutpostPresentation,
            OutpostGameplayObject,
            PhysicsTransformComponent
          ])) {
            const presentation = ctx.world.get(entity, OutpostPresentation);
            const object = ctx.world.get(entity, OutpostGameplayObject);
            const transform = ctx.world.get(entity, PhysicsTransformComponent);
            if (!presentation || !object || !transform || object.kind === "arena-boundary") {
              continue;
            }
            if (object.kind === "projectile") {
              continue;
            }
            const presented = options.readObjectState?.(object.id);
            const authorityPosition = presented?.position ?? transform.position;
            const position = authorityPosition;
            const facing = presented?.facing ?? object.facing;
            const objectId = presentation.renderObjectId ?? object.id;
            desiredObjectIds.add(objectId);
            if (!dynamicObjectIds.has(objectId)) {
              options.renderer.createObject(
                createOutpostDynamicRenderObjectDefinition(
                  options.dataRegistry,
                  presentation.renderKey,
                  objectId,
                  position.x,
                  position.y,
                  facing,
                  [`outpost.client-${object.kind}`]
                )
              );
              dynamicObjectIds.add(objectId);
              bindAnimator(
                options.animator,
                animatorControllers,
                objectId,
                presentation.renderKey,
                {
                  generation: presented?.generation ?? 0
                }
              );
            }

            const shocked = presented?.tags?.includes("status.shocked") ?? false;
            const dead = presented?.tags?.includes("state.dead") ?? false;
            const phase = presented?.abilityPhase;
            const isLocalPlayer = object.id === options.listenerObjectId;
            const riflePulse = isLocalPlayer && elapsed < localWeaponPresentation.muzzleEndsAt;
            const denyPulse = isLocalPlayer && elapsed < localWeaponPresentation.denyEndsAt;
            const tint = riflePulse
              ? 0xfff1a8
              : denyPulse
                ? 0xff8a80
                : presentationTint(shocked, dead, phase);
            const scale = riflePulse ? 1.06 : denyPulse ? 0.97 : presentationScale(phase);
            const signature = `${position.x.toFixed(3)}:${position.y.toFixed(3)}:${facing.toFixed(3)}:${tint}:${scale}`;
            if (signatures.get(objectId) !== signature) {
              signatures.set(objectId, signature);
              const handle = options.renderer.getObjectHandle?.(objectId);
              if (handle && options.applyRenderTargetState) {
                options.applyRenderTargetState(handle.native, {
                  transform: {
                    position: { x: position.x, y: position.y },
                    rotation: {
                      z: resolveOutpostFacingRotation(
                        options.dataRegistry,
                        presentation.renderKey,
                        facing
                      )
                    },
                    scale: { x: scale, y: scale }
                  },
                  props: { tint }
                });
              }
            }

            const velocityX = presented?.velocityX ?? 0;
            const velocityY = presented?.velocityY ?? 0;
            syncAnimatorParameters(
              options.animator,
              animatorControllers,
              animatorParameterSignatures,
              animatorGenerations,
              objectId,
              presented?.generation ?? 0,
              velocityX,
              velocityY,
              dead,
              presentation.renderKey === "render.outpost.player"
                ? (presented?.dashRemainingMs ?? 0) > 0
                : undefined
            );
            syncAnimatorPhase(
              options.animator,
              animatorControllers,
              animatorPhaseSignatures,
              animatorPhaseExecutions,
              objectId,
              presented,
              elapsed
            );
            syncAudioPhase(
              options.audio,
              audioPhaseSignatures,
              objectId,
              position,
              presented,
              isLocalPlayer &&
                presented?.weaponLastShotCorrelationId !== undefined &&
                localWeaponPresentation.anticipatedCorrelations.has(
                  presented.weaponLastShotCorrelationId
                )
            );
            if (isLocalPlayer) {
              flushLocalWeaponAudio(options, localWeaponPresentation, position);
              flushLocalWeaponTracers(
                options,
                combatFeedback,
                localWeaponPresentation,
                position,
                elapsed
              );
            }
            if (options.playerPresentation === undefined) {
              syncWeaponFeedback(
                options.camera,
                weaponShotSequences,
                object.id,
                options.listenerObjectId,
                presented
              );
            }
            if (options.audio) {
              audioEmitters.push({
                id: objectId,
                transform: { position: { x: position.x, y: position.y } },
                velocity: { x: velocityX, y: velocityY }
              });
              if (object.id === options.listenerObjectId) {
                options.audio.spatial.setListener({
                  id: outpostListenerId(options.listenerObjectId),
                  transform: { position: { x: position.x, y: position.y } },
                  weight: 1
                });
              }
            }
          }

          options.audio?.spatial.setEmitters(audioEmitters);

          for (const objectId of dynamicObjectIds) {
            if (desiredObjectIds.has(objectId)) {
              continue;
            }
            removeDynamicPresentation(
              options,
              animatorControllers,
              animatorParameterSignatures,
              animatorPhaseSignatures,
              animatorPhaseExecutions,
              animatorGenerations,
              audioPhaseSignatures,
              weaponShotSequences,
              objectId
            );
            options.renderer.destroyObject(objectId);
            dynamicObjectIds.delete(objectId);
            signatures.delete(objectId);
          }
        }
      });

      return () => {
        for (const objectId of dynamicObjectIds) {
          removeDynamicPresentation(
            options,
            animatorControllers,
            animatorParameterSignatures,
            animatorPhaseSignatures,
            animatorPhaseExecutions,
            animatorGenerations,
            audioPhaseSignatures,
            weaponShotSequences,
            objectId
          );
          options.renderer.destroyObject(objectId);
        }
        for (const objectId of arenaObjectIds) {
          options.renderer.destroyObject(objectId);
        }
        dynamicObjectIds.clear();
        arenaObjectIds.clear();
        signatures.clear();
        animatorControllers.clear();
        animatorParameterSignatures.clear();
        animatorPhaseSignatures.clear();
        animatorPhaseExecutions.clear();
        animatorGenerations.clear();
        audioPhaseSignatures.clear();
        weaponShotSequences.clear();
        disposeOutpostCombatFeedback(options, combatFeedback);
        if (options.audio) {
          options.audio.music.stop({ fadeMs: 240 });
          if (options.listenerObjectId) {
            options.audio.spatial.removeListener(outpostListenerId(options.listenerObjectId));
          }
        }
        musicStarted = false;
        arenaCreated = false;
      };
    }
  });
}

function bindAnimator(
  animator: AnimatorHandle | undefined,
  controllers: Map<string, string>,
  objectId: string,
  renderKey: string,
  options: { generation: number }
): void {
  const bindingId = outpostAnimatorBindingIdForRenderKey(renderKey);
  if (!animator || !bindingId || controllers.has(objectId)) {
    return;
  }
  const controllerId = `outpost.animator.${objectId}`;
  animator.bind({
    controllerId,
    bindingId,
    renderObjectId: objectId,
    generation: options.generation
  });
  controllers.set(objectId, controllerId);
}

function syncAnimatorParameters(
  animator: AnimatorHandle | undefined,
  controllers: Map<string, string>,
  signatures: Map<string, string>,
  generations: Map<string, number>,
  objectId: string,
  generation: number,
  velocityX: number,
  velocityY: number,
  dead: boolean,
  dashing: boolean | undefined
): void {
  const controllerId = controllers.get(objectId);
  if (!animator || !controllerId) {
    return;
  }
  const currentGeneration = generations.get(objectId);
  if (currentGeneration === undefined) {
    generations.set(objectId, generation);
  } else if (currentGeneration !== generation) {
    animator.reset(controllerId, generation);
    generations.set(objectId, generation);
    signatures.delete(objectId);
  }
  const speed = Math.min(1, Math.hypot(velocityX, velocityY) / 360);
  const signature = `${speed.toFixed(3)}:${dead ? 1 : 0}:${dashing === undefined ? "na" : dashing ? 1 : 0}`;
  if (signatures.get(objectId) === signature) {
    return;
  }
  signatures.set(objectId, signature);
  animator.setParameters(controllerId, {
    speed,
    dead,
    ...(dashing === undefined ? {} : { dashing })
  });
}

function syncAnimatorPhase(
  animator: AnimatorHandle | undefined,
  controllers: Map<string, string>,
  signatures: Map<string, string>,
  executions: Map<string, string>,
  objectId: string,
  presented: OutpostPresentedObjectState | undefined,
  clientElapsed: number
): void {
  const controllerId = controllers.get(objectId);
  if (!animator || !controllerId) {
    return;
  }
  const executionId = presented?.abilityExecutionId;
  const abilityId = presented?.abilityId;
  const phase = presented?.abilityPhase;
  const phaseStartedAt = presented?.abilityPhaseStartedAt;
  if (!executionId || !abilityId || !phase || phaseStartedAt === undefined) {
    const previousExecution = executions.get(objectId);
    if (previousExecution) {
      animator.cancelGameplayPhase(controllerId, previousExecution);
      executions.delete(objectId);
      signatures.delete(objectId);
    }
    return;
  }
  const generation = presented.generation ?? 0;
  const phaseEndsAt = presented.abilityPhaseEndsAt;
  const durationMs =
    phaseEndsAt === undefined ? undefined : Math.max(0, phaseEndsAt - phaseStartedAt);
  const signature = `${executionId}:${phase}:${phaseStartedAt}:${phaseEndsAt ?? "open"}:${generation}`;
  if (signatures.get(objectId) === signature) {
    return;
  }
  const previousExecution = executions.get(objectId);
  if (previousExecution && previousExecution !== executionId) {
    animator.cancelGameplayPhase(controllerId, previousExecution);
  }
  const authorityElapsed = presented.authorityElapsedMs ?? phaseStartedAt;
  const phaseElapsed = Math.max(
    0,
    durationMs === undefined
      ? authorityElapsed - phaseStartedAt
      : Math.min(durationMs, authorityElapsed - phaseStartedAt)
  );
  animator.syncGameplayPhase(controllerId, {
    executionId,
    abilityId,
    phase,
    startedAt: Math.max(0, clientElapsed - phaseElapsed),
    ...(durationMs === undefined ? {} : { durationMs }),
    generation
  });
  signatures.set(objectId, signature);
  executions.set(objectId, executionId);
}

function syncAudioPhase(
  audio: GameAudio | undefined,
  signatures: Map<string, string>,
  objectId: string,
  position: { x: number; y: number },
  presented: OutpostPresentedObjectState | undefined,
  suppressLocalRifle: boolean
): void {
  const executionId = presented?.abilityExecutionId;
  const phase = presented?.abilityPhase;
  const abilityId = presented?.abilityId;
  if (!audio || !executionId || !phase || !abilityId) {
    signatures.delete(objectId);
    return;
  }
  const signature = `${executionId}:${phase}:${abilityId}`;
  if (signatures.get(objectId) === signature) {
    return;
  }
  signatures.set(objectId, signature);
  const soundId =
    abilityId === "ability.outpost.rifle_fire" && phase === "committed" && !suppressLocalRifle
      ? OUTPOST_AUDIO_IDS.rifle
      : abilityId === "ability.outpost.enemy_attack" && phase === "preparing"
        ? OUTPOST_AUDIO_IDS.enemyTelegraph
        : undefined;
  if (!soundId) {
    return;
  }
  audio.sfx.play(soundId, {
    emitterId: objectId,
    ownerId: objectId,
    transform: { position },
    dedupeKey: `${executionId}:${phase}:${soundId}`
  });
}

type LocalWeaponPresentationState = {
  cueWatermark: number;
  muzzleEndsAt: number;
  denyEndsAt: number;
  pendingRifleAudioKeys: string[];
  pendingTracers: Array<{ sequence: number; correlationId: string }>;
  anticipatedCorrelations: Map<string, number>;
};

const MAX_PENDING_LOCAL_WEAPON_FEEDBACK = 8;

function createLocalWeaponPresentationState(): LocalWeaponPresentationState {
  return {
    cueWatermark: 0,
    muzzleEndsAt: Number.NEGATIVE_INFINITY,
    denyEndsAt: Number.NEGATIVE_INFINITY,
    pendingRifleAudioKeys: [],
    pendingTracers: [],
    anticipatedCorrelations: new Map()
  };
}

function syncLocalWeaponPresentation(
  options: CreateOutpostClientPresentationModuleOptions,
  state: LocalWeaponPresentationState,
  combatFeedback: OutpostCombatFeedbackState,
  elapsed: number
): void {
  if (!options.playerPresentation || !options.listenerObjectId) {
    return;
  }
  for (const cue of options.playerPresentation.cuesAfter(state.cueWatermark)) {
    state.cueWatermark = Math.max(state.cueWatermark, cue.sequence);
    if (cue.phase === "anticipated") {
      state.anticipatedCorrelations.delete(cue.correlationId);
      state.anticipatedCorrelations.set(cue.correlationId, cue.sequence);
      while (state.anticipatedCorrelations.size > 32) {
        const oldest = state.anticipatedCorrelations.keys().next().value as string | undefined;
        if (oldest === undefined) {
          break;
        }
        state.anticipatedCorrelations.delete(oldest);
      }
      state.muzzleEndsAt = elapsed + 82;
      options.camera?.shake({
        id: `outpost.rifle.anticipation.${cue.correlationId}.${cue.sequence}`,
        amplitude: 3.5,
        durationMs: 72,
        frequency: 18
      });
      state.pendingRifleAudioKeys.push(`${cue.correlationId}:${cue.sequence}:anticipated`);
      state.pendingTracers.push({ sequence: cue.sequence, correlationId: cue.correlationId });
      trimPendingFeedback(state.pendingRifleAudioKeys);
      trimPendingFeedback(state.pendingTracers);
    } else if (cue.phase === "rejected" || cue.phase === "expired") {
      state.anticipatedCorrelations.delete(cue.correlationId);
      cancelOutpostAnticipatedProjectile(
        options,
        combatFeedback,
        cue.correlationId,
        elapsed,
        cue.phase
      );
      state.denyEndsAt = elapsed + 90;
      markOutpostCrosshairFeedback(combatFeedback, "action-rejected", elapsed);
      options.camera?.shake({
        id: `outpost.rifle.deny.${cue.correlationId}.${cue.sequence}`,
        amplitude: 1.1,
        durationMs: 54,
        frequency: 24
      });
    }
  }
}

function flushLocalWeaponAudio(
  options: CreateOutpostClientPresentationModuleOptions,
  state: LocalWeaponPresentationState,
  position: { x: number; y: number }
): void {
  if (!options.audio || !options.listenerObjectId || state.pendingRifleAudioKeys.length === 0) {
    return;
  }
  for (const dedupeKey of state.pendingRifleAudioKeys) {
    options.audio.sfx.play(OUTPOST_AUDIO_IDS.rifle, {
      ownerId: options.listenerObjectId,
      transform: { position },
      dedupeKey
    });
  }
  state.pendingRifleAudioKeys.length = 0;
}

function flushLocalWeaponTracers(
  options: CreateOutpostClientPresentationModuleOptions,
  combatFeedback: OutpostCombatFeedbackState,
  state: LocalWeaponPresentationState,
  position: { x: number; y: number },
  elapsed: number
): void {
  if (!options.playerPresentation || state.pendingTracers.length === 0) {
    return;
  }
  const frame = options.playerPresentation.currentFrame();
  for (const tracer of state.pendingTracers) {
    startOutpostAnticipatedTracer(options, combatFeedback, {
      correlationId: tracer.correlationId,
      position,
      aim: frame.aim,
      elapsed
    });
  }
  state.pendingTracers.length = 0;
}

function trimPendingFeedback<TValue>(values: TValue[]): void {
  if (values.length > MAX_PENDING_LOCAL_WEAPON_FEEDBACK) {
    values.splice(0, values.length - MAX_PENDING_LOCAL_WEAPON_FEEDBACK);
  }
}

function syncWeaponFeedback(
  camera: CameraController | undefined,
  shotSequences: Map<string, number>,
  objectId: string,
  localPlayerId: string | undefined,
  presented: OutpostPresentedObjectState | undefined
): void {
  if (objectId !== localPlayerId || presented?.weaponShotSequence === undefined) {
    return;
  }
  const current = presented.weaponShotSequence;
  const previous = shotSequences.get(objectId);
  shotSequences.set(objectId, current);
  if (!camera || previous === undefined || current <= previous) {
    return;
  }
  camera.shake({
    id: `outpost.rifle.recoil.${objectId}.${current}`,
    amplitude: 3.5,
    durationMs: 72,
    frequency: 18
  });
}

function removeDynamicPresentation(
  options: CreateOutpostClientPresentationModuleOptions,
  controllers: Map<string, string>,
  parameterSignatures: Map<string, string>,
  phaseSignatures: Map<string, string>,
  phaseExecutions: Map<string, string>,
  generations: Map<string, number>,
  audioSignatures: Map<string, string>,
  weaponShotSequences: Map<string, number>,
  objectId: string
): void {
  const controllerId = controllers.get(objectId);
  if (controllerId && options.animator?.isBound()) {
    options.animator.unbind(controllerId);
  }
  controllers.delete(objectId);
  parameterSignatures.delete(objectId);
  phaseSignatures.delete(objectId);
  phaseExecutions.delete(objectId);
  generations.delete(objectId);
  audioSignatures.delete(objectId);
  weaponShotSequences.delete(objectId);
  options.audio?.sfx.stopOwner(objectId, { fadeMs: 60 });
  options.audio?.spatial.removeEmitter(objectId, { stopPlayback: true, fadeMs: 60 });
}

function presentationTint(shocked: boolean, dead: boolean, phase: string | undefined): number {
  if (dead) {
    return 0x777d82;
  }
  if (shocked) {
    return 0x63fff2;
  }
  if (phase === "preparing") {
    return 0xffa94d;
  }
  if (phase === "committed" || phase === "active") {
    return 0xffef99;
  }
  return 0xffffff;
}

function presentationScale(phase: string | undefined): number {
  return phase === "preparing" ? 1.08 : phase === "committed" ? 1.04 : 1;
}

function outpostListenerId(objectId: string): string {
  return `outpost.listener.${objectId}`;
}

function requireObjectId(value: string | undefined, kind: string): string {
  if (!value) {
    throw new Error(`Outpost ${kind} RenderObject requires id`);
  }
  return value;
}
