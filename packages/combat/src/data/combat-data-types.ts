import type {
  DataDiagnostic,
  DataDocument,
  DataReferenceTarget,
  DataTypeDefinition
} from "@gamekits/data";
import type {
  CombatAbilityDeliveryDefinition,
  CombatDeliveryDefinition,
  CombatDeliverySpec,
  CombatProjectileDefinition,
  CombatRelationshipPolicyDefinition
} from "../runtime/types";

export const COMBAT_DELIVERY_TYPE = "combat.delivery";
export const COMBAT_PROJECTILE_TYPE = "combat.projectile";
export const COMBAT_RELATIONSHIP_POLICY_TYPE = "combat.relationship-policy";
export const COMBAT_ABILITY_DELIVERY_TYPE = "combat.ability-delivery";

export type CombatDataTypeDefinition =
  | DataTypeDefinition<CombatAbilityDeliveryDefinition>
  | DataTypeDefinition<CombatDeliveryDefinition>
  | DataTypeDefinition<CombatProjectileDefinition>
  | DataTypeDefinition<CombatRelationshipPolicyDefinition>;

export function createCombatDataTypes(): CombatDataTypeDefinition[] {
  return [
    createCombatAbilityDeliveryDataType(),
    createCombatDeliveryDataType(),
    createCombatProjectileDataType(),
    createCombatRelationshipPolicyDataType()
  ];
}

export function createCombatAbilityDeliveryDataType(): DataTypeDefinition<CombatAbilityDeliveryDefinition> {
  return {
    type: COMBAT_ABILITY_DELIVERY_TYPE,
    getTags: (definition) => definition.tags ?? [],
    validate(document) {
      const diagnostics = validateId(
        document,
        "combat.ability_delivery_missing_id",
        "Combat ability delivery requires id"
      );
      if (!document.data.ability || document.data.ability.type !== "gas.ability") {
        diagnostics.push(
          diagnostic(
            "combat.ability_delivery_invalid_ability",
            "Combat ability delivery must reference gas.ability",
            document,
            "ability"
          )
        );
      }
      if (!document.data.delivery || document.data.delivery.type !== COMBAT_DELIVERY_TYPE) {
        diagnostics.push(
          diagnostic(
            "combat.ability_delivery_invalid_delivery",
            "Combat ability delivery must reference combat.delivery",
            document,
            "delivery"
          )
        );
      }
      if (document.data.phase !== undefined && document.data.phase !== "committed") {
        diagnostics.push(
          diagnostic(
            "combat.ability_delivery_invalid_phase",
            "Combat ability delivery phase must be committed",
            document,
            "phase"
          )
        );
      }
      return diagnostics;
    },
    references(document) {
      return [
        { type: "gas.ability", id: document.data.ability.id, path: "ability" },
        { type: COMBAT_DELIVERY_TYPE, id: document.data.delivery.id, path: "delivery" }
      ];
    }
  };
}

export function createCombatDeliveryDataType(): DataTypeDefinition<CombatDeliveryDefinition> {
  return {
    type: COMBAT_DELIVERY_TYPE,
    getTags: (definition) => definition.tags ?? [],
    validate(document) {
      const diagnostics = validateId(
        document,
        "combat.delivery_missing_id",
        "Combat delivery requires id"
      );
      diagnostics.push(...validateDeliverySpec(document.data.delivery, document, "delivery"));
      diagnostics.push(
        ...validatePayloads(
          document.data.payloads,
          document,
          "payloads",
          document.data.delivery.type === "projectile"
        )
      );
      if (!nonEmptyString(document.data.relationshipPolicy)) {
        diagnostics.push(
          diagnostic(
            "combat.delivery_missing_relationship_policy",
            "Combat delivery requires a relationship policy",
            document,
            "relationshipPolicy"
          )
        );
      }
      return diagnostics;
    },
    references(document) {
      return [
        ...deliveryReferences(document.data.delivery),
        ...payloadReferences(document.data.payloads, "payloads"),
        {
          type: COMBAT_RELATIONSHIP_POLICY_TYPE,
          id: document.data.relationshipPolicy,
          path: "relationshipPolicy"
        }
      ];
    }
  };
}

export function createCombatProjectileDataType(): DataTypeDefinition<CombatProjectileDefinition> {
  return {
    type: COMBAT_PROJECTILE_TYPE,
    getTags: (definition) => definition.tags ?? [],
    validate(document) {
      const diagnostics = validateId(
        document,
        "combat.projectile_missing_id",
        "Combat projectile requires id"
      );
      if (!document.data.body || document.data.body.type !== "physics.body") {
        diagnostics.push(
          diagnostic(
            "combat.projectile_invalid_body",
            "Combat projectile body must reference physics.body",
            document,
            "body"
          )
        );
      }
      if (!positiveFinite(document.data.lifetimeMs)) {
        diagnostics.push(
          diagnostic(
            "combat.projectile_invalid_lifetime",
            "Combat projectile lifetimeMs must be a positive finite number",
            document,
            "lifetimeMs"
          )
        );
      }
      if (document.data.speed !== undefined && !nonNegativeFinite(document.data.speed)) {
        diagnostics.push(
          diagnostic(
            "combat.projectile_invalid_speed",
            "Combat projectile speed must be a non-negative finite number",
            document,
            "speed"
          )
        );
      }
      if (
        !(["contact", "ray-sweep", "shape-sweep"] as unknown[]).includes(
          document.data.collisionMode
        )
      ) {
        diagnostics.push(
          diagnostic(
            "combat.projectile_invalid_collision_mode",
            "Combat projectile collisionMode is invalid",
            document,
            "collisionMode"
          )
        );
      }
      if (!(["stop", "pierce", "bounce"] as unknown[]).includes(document.data.hitPolicy)) {
        diagnostics.push(
          diagnostic(
            "combat.projectile_invalid_hit_policy",
            "Combat projectile hitPolicy is invalid",
            document,
            "hitPolicy"
          )
        );
      }
      for (const [field, value] of [
        ["maxHits", document.data.maxHits],
        ["maxBounces", document.data.maxBounces]
      ] as const) {
        if (
          value !== undefined &&
          (!Number.isSafeInteger(value) || value < (field === "maxHits" ? 1 : 0))
        ) {
          diagnostics.push(
            diagnostic(
              "combat.projectile_invalid_limit",
              `Combat projectile ${field} is invalid`,
              document,
              field
            )
          );
        }
      }
      if (
        document.data.repeatHitCooldownMs !== undefined &&
        !nonNegativeFinite(document.data.repeatHitCooldownMs)
      ) {
        diagnostics.push(
          diagnostic(
            "combat.projectile_invalid_repeat_cooldown",
            "Combat projectile repeatHitCooldownMs must be a non-negative finite number",
            document,
            "repeatHitCooldownMs"
          )
        );
      }
      diagnostics.push(...validatePayloads(document.data.payloads, document, "payloads"));
      return diagnostics;
    },
    references(document) {
      return [
        {
          type: "physics.body",
          id: document.data.body.id,
          path: "body"
        },
        ...payloadReferences(document.data.payloads, "payloads")
      ];
    }
  };
}

export function createCombatRelationshipPolicyDataType(): DataTypeDefinition<CombatRelationshipPolicyDefinition> {
  return {
    type: COMBAT_RELATIONSHIP_POLICY_TYPE,
    getTags: (definition) => definition.tags ?? [],
    getMetadata: (definition) => definition.metadata,
    validate(document) {
      return validateId(
        document,
        "combat.relationship_policy_missing_id",
        "Combat relationship policy requires id"
      );
    }
  };
}

function validateDeliverySpec(
  spec: CombatDeliverySpec,
  document: DataDocument,
  path: string
): DataDiagnostic[] {
  const diagnostics: DataDiagnostic[] = [];
  if (
    !spec ||
    !(["direct", "melee", "hitscan", "area", "projectile"] as unknown[]).includes(spec.type)
  ) {
    return [
      diagnostic(
        "combat.delivery_invalid_type",
        "Combat delivery type is invalid",
        document,
        `${path}.type`
      )
    ];
  }
  if (spec.type === "hitscan") {
    if (!positiveFinite(spec.range)) {
      diagnostics.push(
        diagnostic(
          "combat.delivery_invalid_range",
          "Combat hitscan range must be a positive finite number",
          document,
          `${path}.range`
        )
      );
    }
    if (spec.radius !== undefined && !nonNegativeFinite(spec.radius)) {
      diagnostics.push(
        diagnostic(
          "combat.delivery_invalid_radius",
          "Combat hitscan radius must be a non-negative finite number",
          document,
          `${path}.radius`
        )
      );
    }
  }
  if (spec.type === "melee" || spec.type === "area") {
    if (!spec.shape || !nonEmptyString(spec.shape.type)) {
      diagnostics.push(
        diagnostic(
          "combat.delivery_invalid_shape",
          "Combat delivery requires a Physics shape",
          document,
          `${path}.shape`
        )
      );
    }
  }
  if (spec.type === "projectile") {
    if (!spec.projectile || spec.projectile.type !== COMBAT_PROJECTILE_TYPE) {
      diagnostics.push(
        diagnostic(
          "combat.delivery_invalid_projectile",
          "Combat projectile delivery must reference combat.projectile",
          document,
          `${path}.projectile`
        )
      );
    }
  }
  if ("selection" in spec && spec.selection?.maxTargets !== undefined) {
    if (!Number.isSafeInteger(spec.selection.maxTargets) || spec.selection.maxTargets <= 0) {
      diagnostics.push(
        diagnostic(
          "combat.delivery_invalid_max_targets",
          "Combat delivery maxTargets must be a positive integer",
          document,
          `${path}.selection.maxTargets`
        )
      );
    }
  }
  return diagnostics;
}

function validatePayloads(
  payloads: CombatDeliveryDefinition["payloads"],
  document: DataDocument,
  path: string,
  allowEmpty = false
): DataDiagnostic[] {
  if (!Array.isArray(payloads) || (!allowEmpty && payloads.length === 0)) {
    return [
      diagnostic(
        "combat.delivery_missing_payloads",
        "Combat delivery requires at least one payload",
        document,
        path
      )
    ];
  }
  if (payloads.length === 0) {
    return [];
  }
  const diagnostics: DataDiagnostic[] = [];
  for (const [index, payload] of payloads.entries()) {
    if (!nonEmptyString(payload.effectId)) {
      diagnostics.push(
        diagnostic(
          "combat.payload_missing_effect",
          "Combat payload requires effectId",
          document,
          `${path}[${index}].effectId`
        )
      );
    }
    if (payload.target !== "hit-actor" && payload.target !== "source-actor") {
      diagnostics.push(
        diagnostic(
          "combat.payload_invalid_target",
          "Combat payload target must be hit-actor or source-actor",
          document,
          `${path}[${index}].target`
        )
      );
    }
  }
  return diagnostics;
}

function deliveryReferences(spec: CombatDeliverySpec): DataReferenceTarget[] {
  if (spec.type !== "projectile") {
    return [];
  }
  return [{ type: COMBAT_PROJECTILE_TYPE, id: spec.projectile.id, path: "delivery.projectile" }];
}

function payloadReferences(
  payloads: CombatDeliveryDefinition["payloads"],
  path: string
): DataReferenceTarget[] {
  return (payloads ?? []).map((payload, index) => ({
    type: "gas.effect",
    id: payload.effectId,
    path: `${path}[${index}].effectId`
  }));
}

function validateId(
  document: DataDocument<{ id?: string }>,
  code: string,
  message: string
): DataDiagnostic[] {
  return nonEmptyString(document.data.id) ? [] : [diagnostic(code, message, document, "id")];
}

function diagnostic(
  code: string,
  message: string,
  document: DataDocument,
  path: string
): DataDiagnostic {
  return { code, message, severity: "error", key: document, path };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
