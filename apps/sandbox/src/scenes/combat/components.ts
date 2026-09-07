import { defineComponent } from "@gamekits/world";

export type CombatRangeRole = "operator" | "ally" | "target" | "cover";

export type CombatRangeObjectState = {
  id: string;
  label: string;
  role: CombatRangeRole;
  team?: "cyan" | "amber" | undefined;
  actorId?: string | undefined;
};

export const CombatRangeObject = defineComponent<CombatRangeObjectState>({
  id: "sandbox.combat-range.object",
  create(data) {
    return {
      id: data?.id ?? "range-object",
      label: data?.label ?? data?.id ?? "Range Object",
      role: data?.role ?? "target",
      ...(data?.team === undefined ? {} : { team: data.team }),
      ...(data?.actorId === undefined ? {} : { actorId: data.actorId })
    };
  }
});
