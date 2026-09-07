import type { RenderObjectId } from "@gamekits/renderer-core";

export type AnimatorControllerBinding = {
  controllerId: string;
  bindingId: string;
  renderObjectId: RenderObjectId;
  generation?: number | undefined;
};

export type AnimatorParameterValue = number | boolean | string;
