import type {
  AnimatorControllerSnapshot,
  AnimatorHandle,
  AnimatorMarkerEvent,
  AnimatorRuntimeSnapshot,
  AnimatorTraceEntry
} from "@gamekits/animator-core";
import type {
  AnimationPlaybackAdapter,
  AnimationPlaybackFrame
} from "@gamekits/animator-core/playback";
import type {
  RenderObjectDefinition,
  RenderObjectId,
  RendererAdapter
} from "@gamekits/renderer-core";
import { ANIMATOR_LAB_BINDING_ID, ANIMATOR_LAB_TEXTURE_ID } from "./content";

const CONTROLLER_ID = "sandbox.animator-lab.signal-runner";
const RENDER_OBJECT_ID = "sandbox.animator-lab.signal-runner.render";
const PHASE_DURATION_MS = 2_000;
const MAX_MARKERS = 16;

export type AnimatorLabPlaybackProbe = AnimationPlaybackAdapter & {
  frame(controllerId: string): AnimationPlaybackFrame | undefined;
};

export type AnimatorLabState = {
  speed: number;
  auto: boolean;
  generation: number;
  notice: string;
  markers: AnimatorMarkerEvent[];
  retainMarker(marker: AnimatorMarkerEvent): void;
};

export type AnimatorLabSnapshot = {
  running: boolean;
  speed: number;
  auto: boolean;
  generation: number;
  notice: string;
  phaseProgress: number | undefined;
  runtime: AnimatorRuntimeSnapshot;
  controller: AnimatorControllerSnapshot | undefined;
  frame: AnimationPlaybackFrame | undefined;
  markers: AnimatorMarkerEvent[];
  traces: AnimatorTraceEntry[];
};

export type AnimatorLabController = {
  start(): void;
  advance(deltaMs: number): void;
  setSpeed(value: number): void;
  triggerFire(): void;
  triggerBurst(): void;
  triggerHit(): void;
  seekGameplayPhase(progress: number): void;
  cancelGameplayPhase(): void;
  resetGeneration(): void;
  toggleAuto(): void;
  snapshot(): AnimatorLabSnapshot;
  dispose(): void;
};

type AnimatorLabAnimatorPort = Pick<
  AnimatorHandle,
  | "bind"
  | "unbind"
  | "setParameter"
  | "trigger"
  | "syncGameplayPhase"
  | "cancelGameplayPhase"
  | "reset"
  | "getController"
  | "snapshot"
  | "traces"
>;

export function createAnimatorLabState(): AnimatorLabState {
  const state: AnimatorLabState = {
    speed: 0,
    auto: false,
    generation: 0,
    notice: "Motion channel armed. Adjust speed or fire a one-shot.",
    markers: [],
    retainMarker(marker) {
      state.markers.push(cloneMarker(marker));
      if (state.markers.length > MAX_MARKERS) {
        state.markers.splice(0, state.markers.length - MAX_MARKERS);
      }
    }
  };
  return state;
}

export function createAnimatorLabPlaybackProbe(
  delegate: AnimationPlaybackAdapter
): AnimatorLabPlaybackProbe {
  const frames = new Map<string, AnimationPlaybackFrame>();
  let appliedFrames = 0;

  return {
    id: "sandbox.animator-lab.playback-probe",
    bind(controllerId, binding, renderObjectId) {
      delegate.bind(controllerId, binding, renderObjectId);
    },
    apply(controllerId, frame) {
      frames.set(controllerId, cloneFrame(frame));
      appliedFrames += 1;
      delegate.apply(controllerId, frame);
    },
    applyBatch(batch) {
      for (const frame of batch) {
        frames.set(frame.controllerId, cloneFrame(frame));
      }
      appliedFrames += batch.length;
      if (delegate.applyBatch) {
        delegate.applyBatch(batch);
      } else {
        for (const frame of batch) {
          delegate.apply(frame.controllerId, frame);
        }
      }
    },
    reset(controllerId, generation) {
      frames.delete(controllerId);
      delegate.reset?.(controllerId, generation);
    },
    unbind(controllerId) {
      frames.delete(controllerId);
      delegate.unbind(controllerId);
    },
    snapshot() {
      const delegateSnapshot = delegate.snapshot();
      return {
        id: "sandbox.animator-lab.playback-probe",
        boundControllers: delegateSnapshot.boundControllers,
        retainedFrames: frames.size,
        appliedFrames,
        details: {
          delegateId: delegateSnapshot.id,
          delegateAppliedFrames: delegateSnapshot.appliedFrames,
          delegateDetails: delegateSnapshot.details ?? {}
        }
      };
    },
    frame(controllerId) {
      const frame = frames.get(controllerId);
      return frame === undefined ? undefined : cloneFrame(frame);
    }
  };
}

export function createAnimatorLabController(options: {
  animator: AnimatorLabAnimatorPort;
  renderer: RendererAdapter;
  playback: AnimatorLabPlaybackProbe;
  state: AnimatorLabState;
}): AnimatorLabController {
  let running = false;
  let renderObjectId: RenderObjectId | undefined;
  let phaseExecutionId: string | undefined;
  let phaseProgress: number | undefined;
  let autoElapsed = 0;
  let autoSegment = -1;

  return {
    start() {
      if (running) {
        return;
      }
      renderObjectId = options.renderer.createObject(signalRunnerRenderObject());
      options.animator.bind({
        controllerId: CONTROLLER_ID,
        bindingId: ANIMATOR_LAB_BINDING_ID,
        renderObjectId,
        generation: options.state.generation
      });
      options.animator.setParameter(CONTROLLER_ID, "speed", options.state.speed);
      options.state.notice = "Controller bound to Phaser nodes: body + action.";
      running = true;
    },
    advance(deltaMs) {
      if (!running || !options.state.auto) {
        return;
      }
      autoElapsed += Math.max(0, deltaMs);
      const segment = Math.floor((autoElapsed % 8_000) / 1_000);
      if (segment === autoSegment) {
        return;
      }
      autoSegment = segment;
      switch (segment) {
        case 0:
          setSpeed(0);
          options.state.notice = "Auto sequence: idle baseline.";
          break;
        case 1:
          setSpeed(0.42);
          options.state.notice = "Auto sequence: run transition.";
          break;
        case 2:
          setSpeed(0.92);
          options.state.notice = "Auto sequence: sprint threshold.";
          break;
        case 3:
          trigger("fire");
          options.state.notice = "Auto sequence: fire one-shot over locomotion.";
          break;
        case 4:
          trigger("hit");
          options.state.notice = "Auto sequence: higher-priority hit interrupt.";
          break;
        case 5:
          syncPhase(0.58);
          options.state.notice = "Auto sequence: authority phase restored at 58%.";
          break;
        case 6:
          cancelPhase();
          setSpeed(0.3);
          options.state.notice = "Auto sequence: phase cancelled, run resumed.";
          break;
        case 7:
          setSpeed(0);
          options.state.notice = "Auto sequence complete; returning to idle.";
          break;
      }
    },
    setSpeed(value) {
      requireRunning();
      options.state.auto = false;
      setSpeed(value);
      options.state.notice = `Speed parameter set to ${options.state.speed.toFixed(2)}.`;
    },
    triggerFire() {
      requireRunning();
      options.state.auto = false;
      trigger("fire");
      options.state.notice = "Fire one-shot accepted on the action layer.";
    },
    triggerBurst() {
      requireRunning();
      options.state.auto = false;
      trigger("fire");
      trigger("fire");
      trigger("fire");
      options.state.notice = "Three fire requests submitted; queue-one keeps one replay.";
    },
    triggerHit() {
      requireRunning();
      options.state.auto = false;
      trigger("hit");
      options.state.notice = "Hit reaction interrupted lower-priority action playback.";
    },
    seekGameplayPhase(progress) {
      requireRunning();
      options.state.auto = false;
      syncPhase(progress);
      options.state.notice = `Gameplay phase restored at ${Math.round((phaseProgress ?? 0) * 100)}%.`;
    },
    cancelGameplayPhase() {
      requireRunning();
      options.state.auto = false;
      cancelPhase();
      options.state.notice = "Gameplay phase cancelled; graph state regained the action layer.";
    },
    resetGeneration() {
      requireRunning();
      options.state.auto = false;
      options.state.generation += 1;
      options.animator.reset(CONTROLLER_ID, options.state.generation);
      options.state.speed = 0;
      options.state.markers.length = 0;
      phaseExecutionId = undefined;
      phaseProgress = undefined;
      options.state.notice = `Controller reset to generation ${options.state.generation}.`;
    },
    toggleAuto() {
      requireRunning();
      options.state.auto = !options.state.auto;
      autoElapsed = 0;
      autoSegment = -1;
      options.state.notice = options.state.auto
        ? "Eight-step automatic verification sequence started."
        : "Automatic sequence paused; manual controls restored.";
    },
    snapshot() {
      return {
        running,
        speed: options.state.speed,
        auto: options.state.auto,
        generation: options.state.generation,
        notice: options.state.notice,
        phaseProgress,
        runtime: options.animator.snapshot(),
        controller: options.animator.getController(CONTROLLER_ID),
        frame: options.playback.frame(CONTROLLER_ID),
        markers: options.state.markers.map(cloneMarker),
        traces: options.animator.traces().slice(-12).map(cloneTrace)
      };
    },
    dispose() {
      if (!running) {
        return;
      }
      options.animator.unbind(CONTROLLER_ID);
      if (renderObjectId !== undefined) {
        options.renderer.destroyObject(renderObjectId);
      }
      renderObjectId = undefined;
      running = false;
    }
  };

  function requireRunning(): void {
    if (!running) {
      throw new Error("Animator Lab controller has not started");
    }
  }

  function setSpeed(value: number): void {
    options.state.speed = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    options.animator.setParameter(CONTROLLER_ID, "speed", options.state.speed);
  }

  function trigger(oneShotId: "fire" | "hit"): void {
    options.animator.trigger(CONTROLLER_ID, oneShotId);
  }

  function syncPhase(progress: number): void {
    phaseProgress = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    phaseExecutionId ??= `sandbox.animator-lab.phase.${options.state.generation}`;
    const elapsed = options.animator.snapshot().elapsed;
    options.animator.syncGameplayPhase(CONTROLLER_ID, {
      executionId: phaseExecutionId,
      abilityId: "ability.signal-calibration",
      phase: "active",
      startedAt: elapsed - phaseProgress * PHASE_DURATION_MS,
      durationMs: PHASE_DURATION_MS,
      generation: options.state.generation
    });
  }

  function cancelPhase(): void {
    if (phaseExecutionId === undefined) {
      return;
    }
    options.animator.cancelGameplayPhase(CONTROLLER_ID, phaseExecutionId);
    phaseExecutionId = undefined;
    phaseProgress = undefined;
  }
}

function signalRunnerRenderObject(): RenderObjectDefinition {
  return {
    id: RENDER_OBJECT_ID,
    type: "container",
    transform: { position: { x: 360, y: 212 } },
    children: [
      {
        id: "body",
        type: "animated-sprite",
        props: {
          textureId: ANIMATOR_LAB_TEXTURE_ID,
          width: 224,
          height: 224,
          depth: 2
        }
      },
      {
        id: "action",
        type: "animated-sprite",
        alpha: 0.92,
        props: {
          textureId: ANIMATOR_LAB_TEXTURE_ID,
          width: 224,
          height: 224,
          depth: 3
        }
      }
    ]
  };
}

function cloneFrame(frame: AnimationPlaybackFrame): AnimationPlaybackFrame {
  return {
    ...frame,
    layers: frame.layers.map((layer) => ({
      ...layer,
      asset: { ...layer.asset },
      ...(Array.isArray(layer.target) ? { target: [...layer.target] } : {})
    })),
    markers: frame.markers.map(cloneMarker),
    reasons: [...frame.reasons]
  };
}

function cloneMarker(marker: AnimatorMarkerEvent): AnimatorMarkerEvent {
  return {
    ...marker,
    ...(marker.tags === undefined ? {} : { tags: [...marker.tags] })
  };
}

function cloneTrace(trace: AnimatorTraceEntry): AnimatorTraceEntry {
  return {
    ...trace,
    ...(trace.payload === undefined ? {} : { payload: { ...trace.payload } })
  };
}
