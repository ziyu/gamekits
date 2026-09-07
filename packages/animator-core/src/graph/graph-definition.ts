import type { RenderNodePath } from "@gamekits/renderer-core";

export type AnimatorParameterType = "number" | "boolean" | "string" | "trigger";

export type AnimatorParameterDefinition = {
  id: string;
  type: AnimatorParameterType;
  default?: number | boolean | string | undefined;
};

export type AnimatorConditionOperator =
  | "=="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "truthy"
  | "falsy"
  | "triggered";

export type AnimatorTransitionCondition = {
  parameter: string;
  operator: AnimatorConditionOperator;
  value?: number | boolean | string | undefined;
};

export type AnimatorStateDefinition = {
  id: string;
  clip: string;
  speed?: number | undefined;
  speedParameter?: string | undefined;
  loop?: boolean | undefined;
};

export type AnimatorTransitionDefinition = {
  from: string | "*";
  to: string;
  conditions: AnimatorTransitionCondition[];
  priority?: number | undefined;
};

export type AnimatorLayerDefinition = {
  id: string;
  initialState: string;
  states: AnimatorStateDefinition[];
  transitions?: AnimatorTransitionDefinition[] | undefined;
  priority?: number | undefined;
  weight?: number | undefined;
  mode?: "replace" | "additive" | undefined;
  target?: RenderNodePath | undefined;
};

export type AnimatorOneShotRepeatPolicy = "ignore" | "restart" | "queue-one" | "merge";
export type AnimatorOneShotInterruptPolicy = "always" | "higher-priority" | "never";

export type AnimatorOneShotDefinition = {
  id: string;
  layer: string;
  clip: string;
  priority?: number | undefined;
  speed?: number | undefined;
  repeat?: AnimatorOneShotRepeatPolicy | undefined;
  interrupt?: AnimatorOneShotInterruptPolicy | undefined;
  maxQueue?: number | undefined;
};

export type AnimatorGraphDefinition = {
  id: string;
  parameters: AnimatorParameterDefinition[];
  layers: AnimatorLayerDefinition[];
  oneShots?: AnimatorOneShotDefinition[] | undefined;
  tags?: string[] | undefined;
};
