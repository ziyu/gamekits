import type { AnimatorBindingDefinition } from "@gamekits/animator-core";
import type {
  AnimationPlaybackAdapter,
  AnimationPlaybackFrame
} from "@gamekits/animator-core/playback";
import type { RenderNodePath, RenderObjectId } from "@gamekits/renderer-core";
import type { PhaserRendererNative } from "@gamekits/renderer-phaser";

type BoundAnimationController = {
  binding: AnimatorBindingDefinition;
  renderObjectId: RenderObjectId;
  targets: Map<string, RenderNodePath | undefined>;
};

export function createPhaserAnimationPlaybackAdapter(options: {
  id: string;
  runtime: () => PhaserRendererNative;
}): AnimationPlaybackAdapter {
  const controllers = new Map<string, BoundAnimationController>();
  let appliedFrames = 0;
  let appliedBatches = 0;
  let missingTargets = 0;

  return {
    id: options.id,
    bind(controllerId, binding, renderObjectId) {
      controllers.set(controllerId, {
        binding: cloneBinding(binding),
        renderObjectId,
        targets: new Map([[targetKey(binding.target), binding.target]])
      });
    },
    apply(controllerId, frame) {
      applyFrame(controllerId, frame);
    },
    applyBatch(frames) {
      appliedBatches += 1;
      for (const frame of frames) {
        applyFrame(frame.controllerId, frame);
      }
    },
    reset(controllerId) {
      const controller = controllers.get(controllerId);
      if (controller === undefined) {
        return;
      }
      for (const target of controller.targets.values()) {
        stopTarget(resolveTarget(options.runtime(), controller.renderObjectId, target));
      }
    },
    unbind(controllerId) {
      const controller = controllers.get(controllerId);
      if (controller !== undefined) {
        try {
          for (const target of controller.targets.values()) {
            stopTarget(resolveTarget(options.runtime(), controller.renderObjectId, target));
          }
        } catch {
          // The shared driver runtime may already be unavailable during app teardown.
        }
      }
      controllers.delete(controllerId);
    },
    snapshot() {
      return {
        id: options.id,
        boundControllers: controllers.size,
        retainedFrames: 0,
        appliedFrames,
        details: { appliedBatches, missingTargets }
      };
    }
  };

  function applyFrame(controllerId: string, frame: AnimationPlaybackFrame): void {
    const controller = controllers.get(controllerId);
    if (controller === undefined) {
      return;
    }
    assertPhaserLayerSupport(frame);
    const native = options.runtime();
    for (const layer of frame.layers) {
      const targetPath = layer.target ?? controller.binding.target;
      controller.targets.set(targetKey(targetPath), targetPath);
      const target = resolveTarget(native, controller.renderObjectId, targetPath);
      if (
        !playTarget(
          target,
          layer.backendClip ?? layer.clipId,
          layer.speed,
          layer.normalizedTime,
          layer.seek
        )
      ) {
        missingTargets += 1;
      }
    }
    appliedFrames += 1;
  }
}

function assertPhaserLayerSupport(frame: AnimationPlaybackFrame): void {
  const unsupported = frame.layers.find((layer) => layer.mode !== "replace" || layer.weight !== 1);
  if (unsupported === undefined) {
    return;
  }
  throw new Error(
    `Phaser animation playback does not support weighted or additive layers: ${unsupported.layerId} (${unsupported.mode}, weight ${unsupported.weight})`
  );
}

function resolveTarget(
  native: PhaserRendererNative,
  renderObjectId: RenderObjectId,
  target: RenderNodePath | undefined
): unknown {
  return target === undefined
    ? native.gameObject(renderObjectId)
    : native.node(renderObjectId, target);
}

function playTarget(
  target: unknown,
  animationId: string,
  speed: number,
  normalizedTime: number,
  seek: boolean
): boolean {
  if (typeof target !== "object" || target === null) {
    return false;
  }
  const animationTarget = target as {
    play?: (animationId: string, ignoreIfPlaying?: boolean) => unknown;
    anims?: { timeScale?: number; setProgress?: (progress: number) => unknown };
  };
  if (animationTarget.play === undefined) {
    return false;
  }
  animationTarget.play(animationId, true);
  if (animationTarget.anims !== undefined) {
    animationTarget.anims.timeScale = speed;
    if (seek) {
      animationTarget.anims.setProgress?.(normalizedTime);
    }
  }
  return true;
}

function stopTarget(target: unknown): void {
  if (typeof target === "object" && target !== null && "stop" in target) {
    const stop = (target as { stop?: () => unknown }).stop;
    stop?.call(target);
  }
}

function targetKey(target: RenderNodePath | undefined): string {
  return Array.isArray(target) ? target.join("/") : (target ?? "");
}

function cloneBinding(binding: AnimatorBindingDefinition): AnimatorBindingDefinition {
  return {
    ...binding,
    graph: { ...binding.graph },
    clips: Object.fromEntries(
      Object.entries(binding.clips).map(([alias, reference]) => [alias, { ...reference }])
    ),
    ...(Array.isArray(binding.target) ? { target: [...binding.target] } : {}),
    ...(binding.phaseMappings === undefined
      ? {}
      : { phaseMappings: binding.phaseMappings.map((mapping) => ({ ...mapping })) })
  };
}
