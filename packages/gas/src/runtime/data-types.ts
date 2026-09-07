import type { DataDiagnostic, DataTypeDefinition } from "@gamekits/data";
import type {
  GasAbilityDefinition,
  GasAbilityExecutionPhase,
  GasActorDefinition,
  GasAttributeDefinition,
  GasCueDefinition,
  GasEffectDefinition,
  GasTagDefinition
} from "./types";

export const GAS_ACTOR_TYPE = "gas.actor";
export const GAS_ATTRIBUTE_TYPE = "gas.attribute";
export const GAS_ABILITY_TYPE = "gas.ability";
export const GAS_EFFECT_TYPE = "gas.effect";
export const GAS_TAG_TYPE = "gas.tag";
export const GAS_CUE_TYPE = "gas.cue";

const GAS_ABILITY_EXECUTION_PHASES = new Set<GasAbilityExecutionPhase>([
  "requested",
  "preparing",
  "committed",
  "active",
  "recovering",
  "completed",
  "cancelled"
]);

export function createGasDataTypes(): Array<DataTypeDefinition<any>> {
  return [
    createGasActorDataType(),
    createGasAttributeDataType(),
    createGasAbilityDataType(),
    createGasEffectDataType(),
    createGasTagDataType(),
    createGasCueDataType()
  ];
}

export function createGasActorDataType(): DataTypeDefinition<GasActorDefinition> {
  return {
    type: GAS_ACTOR_TYPE,
    getTags: (definition) => definition.tags ?? [],
    references(document) {
      return (document.data.abilities ?? []).map((id, index) => ({
        type: GAS_ABILITY_TYPE,
        id,
        path: `abilities[${index}]`
      }));
    },
    validate(document) {
      return validateStringId(document.data.id, "gas.actor_missing_id", "Gas actor requires id");
    }
  };
}

export function createGasAttributeDataType(): DataTypeDefinition<GasAttributeDefinition> {
  return {
    type: GAS_ATTRIBUTE_TYPE,
    getTags: (definition) => definition.tags ?? [],
    validate(document) {
      const diagnostics = validateStringId(
        document.data.id,
        "gas.attribute_missing_id",
        "Gas attribute requires id"
      );

      if (
        document.data.min !== undefined &&
        document.data.max !== undefined &&
        document.data.min > document.data.max
      ) {
        diagnostics.push({
          code: "gas.attribute_invalid_range",
          message: "Gas attribute min cannot be greater than max",
          severity: "error",
          key: document
        });
      }

      return diagnostics;
    }
  };
}

export function createGasAbilityDataType(): DataTypeDefinition<GasAbilityDefinition> {
  return {
    type: GAS_ABILITY_TYPE,
    getTags: (definition) => definition.tags ?? [],
    references(document) {
      const phaseCueReferences = Object.entries(document.data.execution?.phaseCues ?? {}).flatMap(
        ([phase, cueIds]) =>
          (cueIds ?? []).map((id, index) => ({
            type: GAS_CUE_TYPE,
            id,
            path: `execution.phaseCues.${phase}[${index}]`,
            optional: true
          }))
      );
      return [
        ...(document.data.effects ?? []).map((effect, index) => ({
          type: GAS_EFFECT_TYPE,
          id: effect.effectId,
          path: `effects[${index}].effectId`
        })),
        ...(document.data.cues ?? []).map((id, index) => ({
          type: GAS_CUE_TYPE,
          id,
          path: `cues[${index}]`,
          optional: true
        })),
        ...phaseCueReferences
      ];
    },
    validate(document) {
      const diagnostics = validateStringId(
        document.data.id,
        "gas.ability_missing_id",
        "Gas ability requires id"
      );

      if ((document.data.cooldownMs ?? 0) < 0) {
        diagnostics.push({
          code: "gas.ability_invalid_cooldown",
          message: "Gas ability cooldown cannot be negative",
          severity: "error",
          key: document
        });
      }

      for (const [index, cost] of (document.data.costs ?? []).entries()) {
        if (cost.amount < 0) {
          diagnostics.push({
            code: "gas.ability_invalid_cost",
            message: "Gas ability cost cannot be negative",
            severity: "error",
            key: document,
            path: `costs[${index}]`
          });
        }
      }

      const execution = document.data.execution;
      if (execution !== undefined) {
        for (const [field, value] of [
          ["preparingMs", execution.preparingMs],
          ["activeMs", execution.activeMs],
          ["recoveringMs", execution.recoveringMs]
        ] as const) {
          if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
            diagnostics.push({
              code: "gas.ability_invalid_execution_duration",
              message: "Gas ability execution duration must be a non-negative finite number",
              severity: "error",
              key: document,
              path: `execution.${field}`
            });
          }
        }
        for (const [field, value] of [
          ["costCommit", execution.costCommit],
          ["cooldownCommit", execution.cooldownCommit]
        ] as const) {
          if (value !== undefined && value !== "requested" && value !== "committed") {
            diagnostics.push({
              code: "gas.ability_invalid_execution_commit",
              message: "Gas ability execution commit policy must be requested or committed",
              severity: "error",
              key: document,
              path: `execution.${field}`
            });
          }
        }
        for (const [field, value] of [
          ["beforeCommit", execution.cancellation?.beforeCommit],
          ["afterCommit", execution.cancellation?.afterCommit]
        ] as const) {
          if (value !== undefined && value !== "allow" && value !== "deny") {
            diagnostics.push({
              code: "gas.ability_invalid_execution_cancellation",
              message: "Gas ability cancellation policy must be allow or deny",
              severity: "error",
              key: document,
              path: `execution.cancellation.${field}`
            });
          }
        }
        if (
          execution.maxConcurrent !== undefined &&
          (!Number.isSafeInteger(execution.maxConcurrent) || execution.maxConcurrent <= 0)
        ) {
          diagnostics.push({
            code: "gas.ability_invalid_execution_concurrency",
            message: "Gas ability maxConcurrent must be a positive integer",
            severity: "error",
            key: document,
            path: "execution.maxConcurrent"
          });
        }
        if (
          execution.overflow !== undefined &&
          execution.overflow !== "reject-newest" &&
          execution.overflow !== "cancel-oldest"
        ) {
          diagnostics.push({
            code: "gas.ability_invalid_execution_overflow",
            message: "Gas ability overflow must be reject-newest or cancel-oldest",
            severity: "error",
            key: document,
            path: "execution.overflow"
          });
        }
        for (const phase of Object.keys(execution.phaseCues ?? {})) {
          if (!GAS_ABILITY_EXECUTION_PHASES.has(phase as GasAbilityExecutionPhase)) {
            diagnostics.push({
              code: "gas.ability_invalid_execution_phase",
              message: `Unknown Gas ability execution phase: ${phase}`,
              severity: "error",
              key: document,
              path: `execution.phaseCues.${phase}`
            });
          }
        }
      }

      return diagnostics;
    }
  };
}

export function createGasEffectDataType(): DataTypeDefinition<GasEffectDefinition> {
  return {
    type: GAS_EFFECT_TYPE,
    getTags: (definition) => definition.tags ?? [],
    references(document) {
      return (document.data.cues ?? []).map((id, index) => ({
        type: GAS_CUE_TYPE,
        id,
        path: `cues[${index}]`,
        optional: true
      }));
    },
    validate(document) {
      const diagnostics = validateStringId(
        document.data.id,
        "gas.effect_missing_id",
        "Gas effect requires id"
      );

      if ((document.data.durationMs ?? 0) < 0) {
        diagnostics.push({
          code: "gas.effect_invalid_duration",
          message: "Gas effect duration cannot be negative",
          severity: "error",
          key: document
        });
      }
      if (
        document.data.periodMs !== undefined &&
        (!Number.isFinite(document.data.periodMs) || document.data.periodMs <= 0)
      ) {
        diagnostics.push({
          code: "gas.effect_invalid_period",
          message: "Gas effect period must be positive and finite",
          severity: "error",
          key: document
        });
      }

      if (
        document.data.stacking !== undefined &&
        (!Number.isInteger(document.data.stacking.limit) || document.data.stacking.limit <= 0)
      ) {
        diagnostics.push({
          code: "gas.effect_invalid_stack_limit",
          message: "Gas effect stack limit must be a positive integer",
          severity: "error",
          key: document,
          path: "stacking.limit"
        });
      }

      return diagnostics;
    }
  };
}

export function createGasTagDataType(): DataTypeDefinition<GasTagDefinition> {
  return {
    type: GAS_TAG_TYPE,
    getTags: (definition) => definition.tags ?? [],
    validate(document) {
      return validateStringId(document.data.id, "gas.tag_missing_id", "Gas tag requires id");
    }
  };
}

export function createGasCueDataType(): DataTypeDefinition<GasCueDefinition> {
  return {
    type: GAS_CUE_TYPE,
    getTags: (definition) => definition.tags ?? [],
    validate(document) {
      const diagnostics = validateStringId(
        document.data.id,
        "gas.cue_missing_id",
        "Gas cue requires id"
      );

      if (!document.data.type) {
        diagnostics.push({
          code: "gas.cue_missing_type",
          message: "Gas cue requires type",
          severity: "error",
          key: document
        });
      }

      return diagnostics;
    }
  };
}

function validateStringId(id: string, code: string, message: string): DataDiagnostic[] {
  return typeof id === "string" && id.length > 0
    ? []
    : [
        {
          code,
          message,
          severity: "error"
        }
      ];
}
