import type { GameAudio } from "@gamekits/audio-core";
import type { CameraController } from "@gamekits/camera-core";
import type { DataRegistry } from "@gamekits/data";
import type { PhysicsBackendAdapter } from "@gamekits/physics-core";
import type { RendererAdapter } from "@gamekits/renderer-core";

import type { OutpostRenderTargetWriter } from "../preview-presentation-module";
import { createOutpostDynamicRenderObjectDefinition } from "../player-render-object";
import { resolveOutpostFacingRotation } from "../render-rotation";
import { OUTPOST_AUDIO_IDS } from "../audio-content";
import type { OutpostPlayerPresentationFrame } from "../player";
import type {
  OutpostClientCombatPresentation,
  OutpostClientCombatPresentationCue
} from "./client-combat-presentation";
import {
  createOutpostClientProjectilePrediction,
  type OutpostClientProjectilePrediction,
  type OutpostProjectilePredictionFrame
} from "./client-projectile-prediction";

export type OutpostCombatFeedbackOptions = {
  dataRegistry: DataRegistry;
  renderer: RendererAdapter;
  audio?: GameAudio | undefined;
  camera?: CameraController | undefined;
  listenerObjectId?: string | undefined;
  physicsBackend?: PhysicsBackendAdapter | undefined;
  readProjectilePredictionFrame?(): OutpostProjectilePredictionFrame | undefined;
  applyRenderTargetState?: OutpostRenderTargetWriter | undefined;
};

type ActiveCombatEffect = {
  objectId: string;
  startedAt: number;
  endsAt: number;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  tint?: number | undefined;
  scaleX: number;
  scaleY: number;
  expansion: number;
  fade: boolean;
  projectileId?: string | undefined;
};

type CrosshairFeedbackKind = "shield-hit" | "health-hit" | "kill-confirmed" | "action-rejected";

type CrosshairFeedback = {
  kind: CrosshairFeedbackKind;
  startedAt: number;
  endsAt: number;
};

export type OutpostCombatFeedbackState = {
  cueWatermark: number;
  effects: Map<string, ActiveCombatEffect>;
  recordProjectiles: Map<string, string>;
  terminalProjectileCorrelations: Map<string, number>;
  projectilePrediction?: OutpostClientProjectilePrediction | undefined;
  crosshairCreated: boolean;
  crosshairFeedback?: CrosshairFeedback | undefined;
};

const MAX_ACTIVE_COMBAT_EFFECTS = 48;
const MAX_RECORD_PROJECTILES = 64;
const TRACER_BASE_WIDTH = 118;
const MAX_TERMINAL_PROJECTILE_CORRELATIONS = 128;
const TERMINAL_PROJECTILE_RETENTION_MS = 2_000;

export function createOutpostCombatFeedbackState(
  options?: Pick<
    OutpostCombatFeedbackOptions,
    "dataRegistry" | "physicsBackend" | "listenerObjectId"
  >
): OutpostCombatFeedbackState {
  return {
    cueWatermark: 0,
    effects: new Map(),
    recordProjectiles: new Map(),
    terminalProjectileCorrelations: new Map(),
    ...(options?.physicsBackend === undefined
      ? {}
      : {
          projectilePrediction: createOutpostClientProjectilePrediction({
            dataRegistry: options.dataRegistry,
            physicsBackend: options.physicsBackend,
            id: options.listenerObjectId ?? "spectator"
          })
        }),
    crosshairCreated: false
  };
}

export function syncOutpostCombatFeedback(
  options: OutpostCombatFeedbackOptions,
  state: OutpostCombatFeedbackState,
  input: {
    presentation?: OutpostClientCombatPresentation | undefined;
    playerFrame?: OutpostPlayerPresentationFrame | undefined;
    elapsed: number;
    localAnticipations: { has(correlationId: string): boolean };
  }
): void {
  state.projectilePrediction?.sync(options.readProjectilePredictionFrame?.(), input.elapsed);
  if (input.presentation !== undefined) {
    for (const cue of input.presentation.cuesAfter(state.cueWatermark)) {
      state.cueWatermark = Math.max(state.cueWatermark, cue.sequence);
      startAuthorityCue(options, state, cue, input);
    }
  }

  syncActiveEffects(options, state, input.elapsed);
  syncRecordProjectiles(options, state, input.elapsed);
  syncCrosshair(options, state, input.playerFrame, input.elapsed);
}

export function resolveOutpostProjectilePresentationPosition(
  state: OutpostCombatFeedbackState,
  input: {
    projectileId: string;
    authorityPosition: { x: number; y: number };
    elapsed: number;
  }
): { x: number; y: number } {
  return (
    state.projectilePrediction?.sample(input.projectileId, input.elapsed)?.position ??
    input.authorityPosition
  );
}

export function startOutpostAnticipatedTracer(
  options: OutpostCombatFeedbackOptions,
  state: OutpostCombatFeedbackState,
  input: {
    correlationId: string;
    position: { x: number; y: number };
    aim: { x: number; y: number };
    elapsed: number;
  }
): void {
  const direction = normalizedDirection({
    x: input.aim.x - input.position.x,
    y: input.aim.y - input.position.y
  });
  if (direction === undefined) {
    return;
  }
  const record = state.projectilePrediction?.anticipate(input);
  const origin = record?.firePosition ?? {
    x: input.position.x + direction.x * 34,
    y: input.position.y + direction.y * 34
  };
  const aimDistance = Math.hypot(input.aim.x - origin.x, input.aim.y - origin.y);
  startTracer(options, state, {
    key: `local-tracer:${input.correlationId}`,
    objectId: `outpost.player-feedback.tracer.${input.correlationId}`,
    origin,
    direction,
    length: Math.max(72, Math.min(150, aimDistance)),
    tint: 0xffe08a,
    elapsed: input.elapsed
  });
  if (record !== undefined) {
    startEffect(options, state, {
      key: `local-projectile:${input.correlationId}`,
      objectId: projectileRenderObjectId(record.generation, record.correlationId),
      renderKey: "render.outpost.projectile",
      position: origin,
      rotation: Math.atan2(record.fireVelocity.y, record.fireVelocity.x),
      startedAt: input.elapsed,
      durationMs: (record.expiresTick - record.fireTick) * record.fixedDeltaMs,
      scaleX: 1,
      scaleY: 1,
      expansion: 0,
      projectileId: record.projectileId,
      fade: false
    });
  }
}

export function cancelOutpostAnticipatedProjectile(
  options: OutpostCombatFeedbackOptions,
  state: OutpostCombatFeedbackState,
  correlationId: string,
  elapsed: number,
  reason: string
): void {
  state.projectilePrediction?.cancel(correlationId, elapsed, reason);
  removeEffect(options, state, `local-projectile:${correlationId}`);
}

export function markOutpostCrosshairFeedback(
  state: OutpostCombatFeedbackState,
  kind: CrosshairFeedbackKind,
  elapsed: number
): void {
  const durationMs = kind === "kill-confirmed" ? 260 : kind === "action-rejected" ? 120 : 170;
  state.crosshairFeedback = { kind, startedAt: elapsed, endsAt: elapsed + durationMs };
}

export function disposeOutpostCombatFeedback(
  options: OutpostCombatFeedbackOptions,
  state: OutpostCombatFeedbackState
): void {
  for (const effect of state.effects.values()) {
    options.renderer.destroyObject(effect.objectId);
    options.audio?.sfx.stopOwner(effect.objectId, { fadeMs: 30 });
  }
  state.effects.clear();
  for (const objectId of state.recordProjectiles.values()) {
    options.renderer.destroyObject(objectId);
  }
  state.recordProjectiles.clear();
  state.terminalProjectileCorrelations.clear();
  state.projectilePrediction?.dispose();
  const crosshairId = crosshairObjectId(options.listenerObjectId);
  if (state.crosshairCreated && crosshairId !== undefined) {
    options.renderer.destroyObject(crosshairId);
  }
  state.crosshairCreated = false;
  state.crosshairFeedback = undefined;
}

function startAuthorityCue(
  options: OutpostCombatFeedbackOptions,
  state: OutpostCombatFeedbackState,
  cue: OutpostClientCombatPresentationCue,
  input: {
    elapsed: number;
    localAnticipations: { has(correlationId: string): boolean };
  }
): void {
  if (isTerminalProjectileCue(cue) && cue.correlationId !== undefined) {
    markTerminalProjectileCorrelation(state, cue.correlationId, input.elapsed);
    cancelOutpostAnticipatedProjectile(options, state, cue.correlationId, input.elapsed, cue.kind);
  }
  if (cue.kind === "action-rejected") {
    if (cue.sourceObjectId === options.listenerObjectId) {
      if (cue.correlationId !== undefined) {
        cancelOutpostAnticipatedProjectile(
          options,
          state,
          cue.correlationId,
          input.elapsed,
          cue.reason ?? "action-rejected"
        );
      }
      markOutpostCrosshairFeedback(state, "action-rejected", input.elapsed);
      options.camera?.shake({
        id: `outpost.combat.rejected.${cue.authoritySequence}`,
        amplitude: 1.1,
        durationMs: 54,
        frequency: 24
      });
    }
    return;
  }

  const suppressLocalSpawn =
    cue.kind === "projectile-spawned" &&
    cue.sourceObjectId === options.listenerObjectId &&
    cue.correlationId !== undefined &&
    input.localAnticipations.has(cue.correlationId);
  if (!suppressLocalSpawn && cue.kind === "projectile-spawned") {
    const direction = normalizedDirection(cue.direction);
    if (cue.position !== undefined && direction !== undefined) {
      startTracer(options, state, {
        key: `authority-tracer:${cue.authoritySequence}`,
        objectId: `outpost.combat-cue.${cue.sequence}.tracer`,
        origin: cue.position,
        direction,
        length: TRACER_BASE_WIDTH,
        tint: 0xffe08a,
        elapsed: input.elapsed
      });
      playCueSound(
        options,
        cue,
        OUTPOST_AUDIO_IDS.rifle,
        `outpost.combat-cue.${cue.sequence}.projectile`
      );
    }
  } else if (cue.kind !== "projectile-spawned" && cue.position !== undefined) {
    const style = impactStyle(cue.kind);
    if (style !== undefined) {
      startEffect(options, state, {
        key: `authority-impact:${cue.authoritySequence}`,
        objectId: `outpost.combat-cue.${cue.sequence}.impact`,
        renderKey: "render.outpost.feedback.impact",
        position: cue.position,
        rotation: 0,
        startedAt: input.elapsed,
        durationMs: style.durationMs,
        tint: style.tint,
        scaleX: style.scale,
        scaleY: style.scale,
        expansion: style.expansion
      });
      playCueSound(
        options,
        cue,
        OUTPOST_AUDIO_IDS.hit,
        `outpost.combat-cue.${cue.sequence}.impact`
      );
    }
  }

  if (
    cue.sourceObjectId === options.listenerObjectId &&
    (cue.kind === "shield-hit" || cue.kind === "health-hit" || cue.kind === "kill-confirmed")
  ) {
    markOutpostCrosshairFeedback(state, cue.kind, input.elapsed);
  }

  if (
    cue.targetObjectId === options.listenerObjectId &&
    (cue.kind === "shield-hit" || cue.kind === "health-hit" || cue.kind === "kill-confirmed")
  ) {
    startDamageDirection(options, state, cue, input.elapsed);
    const amplitude = cue.kind === "kill-confirmed" ? 6 : cue.kind === "health-hit" ? 4 : 2.2;
    options.camera?.shake({
      id: `outpost.combat.received.${cue.kind}.${cue.authoritySequence}`,
      amplitude,
      durationMs: cue.kind === "kill-confirmed" ? 180 : 110,
      frequency: 20
    });
  } else if (cue.kind === "kill-confirmed" && cue.sourceObjectId === options.listenerObjectId) {
    options.camera?.shake({
      id: `outpost.combat.kill-confirm.${cue.authoritySequence}`,
      amplitude: 1.6,
      durationMs: 80,
      frequency: 16
    });
  }
}

function startTracer(
  options: OutpostCombatFeedbackOptions,
  state: OutpostCombatFeedbackState,
  input: {
    key: string;
    objectId: string;
    origin: { x: number; y: number };
    direction: { x: number; y: number };
    length: number;
    tint: number;
    elapsed: number;
  }
): void {
  const midpoint = {
    x: input.origin.x + input.direction.x * input.length * 0.5,
    y: input.origin.y + input.direction.y * input.length * 0.5
  };
  startEffect(options, state, {
    key: input.key,
    objectId: input.objectId,
    renderKey: "render.outpost.feedback.tracer",
    position: midpoint,
    rotation: Math.atan2(input.direction.y, input.direction.x),
    startedAt: input.elapsed,
    durationMs: 82,
    tint: input.tint,
    scaleX: input.length / TRACER_BASE_WIDTH,
    scaleY: 1,
    expansion: 0
  });
}

function startDamageDirection(
  options: OutpostCombatFeedbackOptions,
  state: OutpostCombatFeedbackState,
  cue: OutpostClientCombatPresentationCue,
  elapsed: number
): void {
  const incoming = normalizedDirection(cue.direction);
  if (incoming === undefined || cue.position === undefined) {
    return;
  }
  const towardSource = { x: -incoming.x, y: -incoming.y };
  const tint =
    cue.kind === "shield-hit" ? 0x63fff2 : cue.kind === "kill-confirmed" ? 0xfff1a8 : 0xff6b6b;
  startEffect(options, state, {
    key: `damage-direction:${cue.authoritySequence}`,
    objectId: `outpost.player-feedback.damage-direction.${cue.sequence}`,
    renderKey: "render.outpost.feedback.damage-direction",
    position: {
      x: cue.position.x + towardSource.x * 58,
      y: cue.position.y + towardSource.y * 58
    },
    rotation: Math.atan2(towardSource.y, towardSource.x),
    startedAt: elapsed,
    durationMs: 420,
    tint,
    scaleX: 1,
    scaleY: 1,
    expansion: 0.08
  });
}

function startEffect(
  options: OutpostCombatFeedbackOptions,
  state: OutpostCombatFeedbackState,
  input: {
    key: string;
    objectId: string;
    renderKey: string;
    position: { x: number; y: number };
    rotation: number;
    startedAt: number;
    durationMs: number;
    tint?: number | undefined;
    scaleX: number;
    scaleY: number;
    expansion: number;
    velocity?: { x: number; y: number } | undefined;
    projectileId?: string | undefined;
    fade?: boolean | undefined;
  }
): void {
  const previous = state.effects.get(input.key);
  if (previous !== undefined) {
    options.renderer.destroyObject(previous.objectId);
    state.effects.delete(input.key);
  }
  while (state.effects.size >= MAX_ACTIVE_COMBAT_EFFECTS) {
    const oldest = state.effects.entries().next().value as [string, ActiveCombatEffect] | undefined;
    if (oldest === undefined) {
      break;
    }
    options.renderer.destroyObject(oldest[1].objectId);
    state.effects.delete(oldest[0]);
  }
  const definition = createOutpostDynamicRenderObjectDefinition(
    options.dataRegistry,
    input.renderKey,
    input.objectId,
    input.position.x,
    input.position.y,
    input.rotation,
    ["outpost.player-feedback"]
  );
  options.renderer.createObject({
    ...definition,
    alpha: 1,
    ...(input.tint === undefined
      ? {}
      : { props: { ...definition.props, tint: input.tint, tintMode: "fill" } })
  });
  state.effects.set(input.key, {
    objectId: input.objectId,
    startedAt: input.startedAt,
    endsAt: input.startedAt + input.durationMs,
    position: { ...input.position },
    velocity: input.velocity === undefined ? { x: 0, y: 0 } : { ...input.velocity },
    ...(input.tint === undefined ? {} : { tint: input.tint }),
    scaleX: input.scaleX,
    scaleY: input.scaleY,
    expansion: input.expansion,
    fade: input.fade ?? true,
    ...(input.projectileId === undefined ? {} : { projectileId: input.projectileId })
  });
}

function removeEffect(
  options: OutpostCombatFeedbackOptions,
  state: OutpostCombatFeedbackState,
  key: string
): void {
  const effect = state.effects.get(key);
  if (effect === undefined) {
    return;
  }
  options.renderer.destroyObject(effect.objectId);
  options.audio?.sfx.stopOwner(effect.objectId, { fadeMs: 20 });
  state.effects.delete(key);
}

function syncActiveEffects(
  options: OutpostCombatFeedbackOptions,
  state: OutpostCombatFeedbackState,
  elapsed: number
): void {
  for (const [key, effect] of state.effects) {
    const projectileSample =
      effect.projectileId === undefined
        ? undefined
        : state.projectilePrediction?.sample(effect.projectileId, elapsed);
    if (effect.projectileId !== undefined && projectileSample?.active !== true) {
      options.renderer.destroyObject(effect.objectId);
      state.effects.delete(key);
      continue;
    }
    if (elapsed >= effect.endsAt) {
      options.renderer.destroyObject(effect.objectId);
      state.effects.delete(key);
      continue;
    }
    const handle = options.renderer.getObjectHandle?.(effect.objectId);
    if (handle === undefined || options.applyRenderTargetState === undefined) {
      continue;
    }
    const duration = Math.max(1, effect.endsAt - effect.startedAt);
    const remaining = Math.max(0, Math.min(1, (effect.endsAt - elapsed) / duration));
    const ageSeconds = Math.max(0, elapsed - effect.startedAt) / 1_000;
    const expansion = 1 + (1 - remaining) * effect.expansion;
    const position = projectileSample?.position ?? {
      x: effect.position.x + effect.velocity.x * ageSeconds,
      y: effect.position.y + effect.velocity.y * ageSeconds
    };
    options.applyRenderTargetState(handle.native, {
      visible: true,
      alpha: effect.fade ? remaining : 1,
      transform: {
        position,
        scale: {
          x: effect.scaleX * expansion,
          y: effect.scaleY * expansion
        }
      },
      ...(effect.tint === undefined ? {} : { props: { tint: effect.tint, tintMode: "fill" } })
    });
  }
}

function syncRecordProjectiles(
  options: OutpostCombatFeedbackOptions,
  state: OutpostCombatFeedbackState,
  elapsed: number
): void {
  pruneTerminalProjectileCorrelations(state, elapsed);
  const samples =
    state.projectilePrediction
      ?.listAuthoritySamples(elapsed)
      .filter(
        ({ record, sample }) =>
          sample.active && !state.terminalProjectileCorrelations.has(record.correlationId)
      )
      .slice(-MAX_RECORD_PROJECTILES) ?? [];
  const desired = new Set<string>();
  for (const { record, sample } of samples) {
    desired.add(record.projectileId);
    const localEffectKey = `local-projectile:${record.correlationId}`;
    const localEffect = state.effects.get(localEffectKey);
    const objectId =
      state.recordProjectiles.get(record.projectileId) ??
      projectileRenderObjectId(record.generation, record.correlationId);
    if (!state.recordProjectiles.has(record.projectileId)) {
      if (localEffect === undefined) {
        const facing = Math.atan2(record.fireVelocity.y, record.fireVelocity.x);
        options.renderer.createObject(
          createOutpostDynamicRenderObjectDefinition(
            options.dataRegistry,
            "render.outpost.projectile",
            objectId,
            sample.position.x,
            sample.position.y,
            facing,
            ["outpost.client-projectile-record"]
          )
        );
      } else {
        state.effects.delete(localEffectKey);
      }
      state.recordProjectiles.set(record.projectileId, objectId);
    }
    const handle = options.renderer.getObjectHandle?.(objectId);
    if (handle !== undefined && options.applyRenderTargetState !== undefined) {
      options.applyRenderTargetState(handle.native, {
        visible: true,
        alpha: 1,
        transform: {
          position: { ...sample.position },
          rotation: {
            z: resolveOutpostFacingRotation(
              options.dataRegistry,
              "render.outpost.projectile",
              Math.atan2(record.fireVelocity.y, record.fireVelocity.x)
            )
          },
          scale: { x: 1, y: 1 }
        }
      });
    }
  }
  for (const [projectileId, objectId] of state.recordProjectiles) {
    if (!desired.has(projectileId)) {
      options.renderer.destroyObject(objectId);
      state.recordProjectiles.delete(projectileId);
    }
  }
}

function markTerminalProjectileCorrelation(
  state: OutpostCombatFeedbackState,
  correlationId: string,
  elapsed: number
): void {
  state.terminalProjectileCorrelations.delete(correlationId);
  state.terminalProjectileCorrelations.set(
    correlationId,
    elapsed + TERMINAL_PROJECTILE_RETENTION_MS
  );
  while (state.terminalProjectileCorrelations.size > MAX_TERMINAL_PROJECTILE_CORRELATIONS) {
    const oldest = state.terminalProjectileCorrelations.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    state.terminalProjectileCorrelations.delete(oldest);
  }
}

function pruneTerminalProjectileCorrelations(
  state: OutpostCombatFeedbackState,
  elapsed: number
): void {
  for (const [correlationId, expiresAt] of state.terminalProjectileCorrelations) {
    if (elapsed >= expiresAt) {
      state.terminalProjectileCorrelations.delete(correlationId);
    }
  }
}

function isTerminalProjectileCue(cue: OutpostClientCombatPresentationCue): boolean {
  return (
    cue.projectileId !== undefined &&
    (cue.kind === "miss" ||
      cue.kind === "world-impact" ||
      cue.kind === "shield-hit" ||
      cue.kind === "health-hit" ||
      cue.kind === "kill-confirmed")
  );
}

function projectileRenderObjectId(generation: string | number, correlationId: string): string {
  return `outpost.combat-projectile.${safeRenderId(String(generation))}.${safeRenderId(correlationId)}`;
}

function safeRenderId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function syncCrosshair(
  options: OutpostCombatFeedbackOptions,
  state: OutpostCombatFeedbackState,
  frame: OutpostPlayerPresentationFrame | undefined,
  elapsed: number
): void {
  const objectId = crosshairObjectId(options.listenerObjectId);
  if (objectId === undefined || frame === undefined) {
    return;
  }
  const visible = frame.active && frame.health > 0;
  if (!state.crosshairCreated) {
    const definition = createOutpostDynamicRenderObjectDefinition(
      options.dataRegistry,
      "render.outpost.feedback.crosshair",
      objectId,
      frame.aim.x,
      frame.aim.y,
      0,
      ["outpost.player-crosshair"]
    );
    options.renderer.createObject({ ...definition, visible, alpha: visible ? 0.86 : 0 });
    state.crosshairCreated = true;
  }
  const handle = options.renderer.getObjectHandle?.(objectId);
  if (handle === undefined || options.applyRenderTargetState === undefined) {
    return;
  }
  const feedback = state.crosshairFeedback;
  const activeFeedback = feedback !== undefined && elapsed < feedback.endsAt ? feedback : undefined;
  if (feedback !== undefined && activeFeedback === undefined) {
    state.crosshairFeedback = undefined;
  }
  const style = crosshairStyle(activeFeedback?.kind);
  const pulse =
    activeFeedback === undefined
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            (activeFeedback.endsAt - elapsed) /
              Math.max(1, activeFeedback.endsAt - activeFeedback.startedAt)
          )
        );
  options.applyRenderTargetState(handle.native, {
    visible,
    alpha: visible ? (activeFeedback === undefined ? 0.86 : 1) : 0,
    transform: {
      position: { x: frame.aim.x, y: frame.aim.y },
      rotation: { z: style.rotation },
      scale: { x: style.scale + pulse * style.pulse, y: style.scale + pulse * style.pulse }
    },
    props: { tint: style.tint, tintMode: "fill" }
  });
}

function crosshairStyle(kind: CrosshairFeedbackKind | undefined): {
  tint: number;
  scale: number;
  pulse: number;
  rotation: number;
} {
  switch (kind) {
    case "shield-hit":
      return { tint: 0x63fff2, scale: 0.9, pulse: 0.18, rotation: 0 };
    case "health-hit":
      return { tint: 0xff6b6b, scale: 0.94, pulse: 0.24, rotation: 0 };
    case "kill-confirmed":
      return { tint: 0xfff1a8, scale: 1.02, pulse: 0.34, rotation: Math.PI / 4 };
    case "action-rejected":
      return { tint: 0xff8a80, scale: 0.78, pulse: -0.12, rotation: 0 };
    default:
      return { tint: 0xb8fff5, scale: 0.82, pulse: 0, rotation: 0 };
  }
}

function impactStyle(
  kind: OutpostClientCombatPresentationCue["kind"]
): { tint: number; durationMs: number; scale: number; expansion: number } | undefined {
  switch (kind) {
    case "miss":
      return { tint: 0xc8d0d6, durationMs: 100, scale: 0.72, expansion: 0.24 };
    case "world-impact":
      return { tint: 0xffbd66, durationMs: 150, scale: 0.92, expansion: 0.52 };
    case "shield-hit":
      return { tint: 0x63fff2, durationMs: 170, scale: 1.05, expansion: 0.62 };
    case "health-hit":
      return { tint: 0xff6b6b, durationMs: 190, scale: 1.08, expansion: 0.7 };
    case "kill-confirmed":
      return { tint: 0xfff1a8, durationMs: 280, scale: 1.2, expansion: 1.05 };
    case "projectile-spawned":
    case "action-rejected":
      return undefined;
  }
}

function playCueSound(
  options: OutpostCombatFeedbackOptions,
  cue: OutpostClientCombatPresentationCue,
  soundId: string,
  ownerId: string
): void {
  if (cue.position === undefined) {
    return;
  }
  options.audio?.sfx.play(soundId, {
    ownerId,
    transform: { position: cue.position },
    dedupeKey: `authority:${cue.authoritySequence}:${soundId}`
  });
}

function normalizedDirection(
  direction: { x: number; y: number } | undefined
): { x: number; y: number } | undefined {
  if (direction === undefined) {
    return undefined;
  }
  const length = Math.hypot(direction.x, direction.y);
  return length <= Number.EPSILON
    ? undefined
    : { x: direction.x / length, y: direction.y / length };
}

function crosshairObjectId(listenerObjectId: string | undefined): string | undefined {
  return listenerObjectId === undefined
    ? undefined
    : `outpost.player-feedback.${listenerObjectId}.crosshair`;
}
