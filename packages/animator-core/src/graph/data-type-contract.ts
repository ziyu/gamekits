import type { DataTypeDefinition } from "@gamekits/data";
import type { AnimatorBindingDefinition } from "./binding-definition";
import type { AnimationClipDefinition } from "./clip-definition";
import type { AnimatorGraphDefinition } from "./graph-definition";

export const ANIMATION_CLIP_TYPE = "animation.clip";
export const ANIMATOR_GRAPH_TYPE = "animator.graph";
export const ANIMATOR_BINDING_TYPE = "animator.binding";

export type AnimatorDataTypeDefinition =
  | DataTypeDefinition<AnimationClipDefinition>
  | DataTypeDefinition<AnimatorGraphDefinition>
  | DataTypeDefinition<AnimatorBindingDefinition>;
