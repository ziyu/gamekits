import type { DataRef } from "@gamekits/data";
import type { RenderNodePath } from "@gamekits/renderer-core";

export type AnimatorPhaseMapping = {
  phase: string;
  clip: string;
  layer: string;
  abilityId?: string | undefined;
  speed?: number | undefined;
  loop?: boolean | undefined;
};

export type AnimatorBindingDefinition = {
  id: string;
  graph: DataRef<"animator.graph">;
  clips: Record<string, DataRef<"animation.clip">>;
  fallbackClip?: string | undefined;
  target?: RenderNodePath | undefined;
  phaseMappings?: AnimatorPhaseMapping[] | undefined;
  tags?: string[] | undefined;
};
