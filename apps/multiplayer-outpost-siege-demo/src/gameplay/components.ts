import { defineComponent } from "@gamekits/world";

export type OutpostGameplayObjectState = {
  id: string;
  kind: "player" | "enemy" | "buildable" | "projectile" | "arena-boundary";
  facing: number;
};

export type OutpostPresentationState = {
  renderKey: string;
  renderObjectId?: string | undefined;
};

export const OutpostGameplayObject = defineComponent<OutpostGameplayObjectState>({
  id: "outpost.gameplay-object",
  create(data) {
    return {
      id: data?.id ?? "",
      kind: data?.kind ?? "player",
      facing: data?.facing ?? 0
    };
  }
});

export const OutpostPresentation = defineComponent<OutpostPresentationState>({
  id: "outpost.presentation",
  create(data) {
    return {
      renderKey: data?.renderKey ?? "",
      ...(data?.renderObjectId === undefined ? {} : { renderObjectId: data.renderObjectId })
    };
  }
});
