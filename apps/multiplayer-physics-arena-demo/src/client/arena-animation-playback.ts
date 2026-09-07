import type {
  AnimationPlaybackAdapter,
  AnimationPlaybackFrame
} from "@gamekits/animator-core/playback";

export type ArenaAnimationPlaybackAdapter = AnimationPlaybackAdapter & {
  frame(controllerId: string | undefined): AnimationPlaybackFrame | undefined;
};

export function createArenaAnimationPlaybackAdapter(): ArenaAnimationPlaybackAdapter {
  const bound = new Set<string>();
  const frames = new Map<string, AnimationPlaybackFrame>();
  let appliedFrames = 0;
  let disposed = false;
  return {
    id: "knockout.presentation.procedural-playback",
    bind(controllerId) {
      bound.add(controllerId);
    },
    apply(controllerId, frame) {
      frames.set(controllerId, clonePlaybackFrame(frame));
      appliedFrames += 1;
    },
    applyBatch(input) {
      for (const frame of input) {
        frames.set(frame.controllerId, clonePlaybackFrame(frame));
        appliedFrames += 1;
      }
    },
    reset(controllerId) {
      frames.delete(controllerId);
    },
    unbind(controllerId) {
      bound.delete(controllerId);
      frames.delete(controllerId);
    },
    frame(controllerId) {
      if (controllerId === undefined) return undefined;
      const frame = frames.get(controllerId);
      return frame === undefined ? undefined : clonePlaybackFrame(frame);
    },
    snapshot() {
      return {
        id: "knockout.presentation.procedural-playback",
        boundControllers: bound.size,
        retainedFrames: frames.size,
        appliedFrames,
        disposed
      };
    },
    dispose() {
      disposed = true;
      bound.clear();
      frames.clear();
    }
  };
}

function clonePlaybackFrame(frame: AnimationPlaybackFrame): AnimationPlaybackFrame {
  return {
    ...frame,
    layers: frame.layers.map((layer) => ({ ...layer, asset: { ...layer.asset } })),
    markers: frame.markers.map((marker) => ({ ...marker })),
    reasons: [...frame.reasons]
  };
}
