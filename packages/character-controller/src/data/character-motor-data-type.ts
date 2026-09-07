import { GameError } from "@gamekits/core";
import type { DataDiagnostic, DataDocument, DataTypeDefinition } from "@gamekits/data";
import type { CharacterMotorDefinition, CompiledCharacterMotorDefinition } from "../contracts";

export const CHARACTER_MOTOR_DATA_TYPE = "character.motor";

type NumericRule = {
  key: keyof CharacterMotorDefinition;
  minimum: number;
  maximum: number;
};

const NUMERIC_RULES: readonly NumericRule[] = [
  { key: "capsuleRadius", minimum: 0.01, maximum: 8 },
  { key: "capsuleHeight", minimum: 0.02, maximum: 24 },
  { key: "maxGroundSpeed", minimum: 0, maximum: 100 },
  { key: "groundAcceleration", minimum: 0, maximum: 1_000 },
  { key: "groundBraking", minimum: 0, maximum: 1_000 },
  { key: "maxAirSpeed", minimum: 0, maximum: 100 },
  { key: "airAcceleration", minimum: 0, maximum: 1_000 },
  { key: "airBraking", minimum: 0, maximum: 1_000 },
  { key: "maxSlopeRadians", minimum: 0, maximum: Math.PI / 2 },
  { key: "stepHeight", minimum: 0, maximum: 8 },
  { key: "groundProbeDistance", minimum: 0, maximum: 8 },
  { key: "groundSnapDistance", minimum: 0, maximum: 8 },
  { key: "ceilingClearance", minimum: 0, maximum: 8 },
  { key: "coyoteTimeMs", minimum: 0, maximum: 5_000 },
  { key: "jumpBufferMs", minimum: 0, maximum: 5_000 },
  { key: "jumpSpeed", minimum: 0, maximum: 100 },
  { key: "jumpHoldDurationMs", minimum: 0, maximum: 5_000 },
  { key: "jumpHoldAcceleration", minimum: 0, maximum: 1_000 },
  { key: "diveSpeed", minimum: 0, maximum: 100 },
  { key: "diveVerticalSpeed", minimum: -100, maximum: 100 },
  { key: "minimumDiveAirTimeMs", minimum: 0, maximum: 5_000 },
  { key: "diveDurationMs", minimum: 0, maximum: 5_000 },
  { key: "recoveryDurationMs", minimum: 0, maximum: 5_000 },
  { key: "diveCooldownMs", minimum: 0, maximum: 10_000 },
  { key: "diveSteeringScale", minimum: 0, maximum: 1 },
  { key: "staggerControlScale", minimum: 0, maximum: 1 },
  { key: "recoveryControlScale", minimum: 0, maximum: 1 },
  { key: "maxPlatformSpeed", minimum: 0, maximum: 100 },
  { key: "platformDepartureVelocityScale", minimum: 0, maximum: 1 },
  { key: "maxFacingRateRadiansPerSecond", minimum: 0, maximum: Math.PI * 8 }
];

export function createCharacterMotorDataType(): DataTypeDefinition<CharacterMotorDefinition> {
  return {
    type: CHARACTER_MOTOR_DATA_TYPE,
    validate(document) {
      return validateCharacterMotorDefinition(document.data).map((issue) =>
        diagnostic(issue.code, issue.message, document, issue.path)
      );
    }
  };
}

export function createCharacterControllerDataTypes(): Array<
  DataTypeDefinition<CharacterMotorDefinition>
> {
  return [createCharacterMotorDataType()];
}

export type CharacterMotorDefinitionIssue = {
  code: string;
  message: string;
  path: string;
};

export function validateCharacterMotorDefinition(
  definition: CharacterMotorDefinition
): CharacterMotorDefinitionIssue[] {
  const issues: CharacterMotorDefinitionIssue[] = [];
  if (typeof definition.id !== "string" || !definition.id.trim()) {
    issues.push(issue("character.motor_missing_id", "Motor id must not be empty", "id"));
  }
  if (typeof definition.version !== "string" || !definition.version.trim()) {
    issues.push(
      issue("character.motor_missing_version", "Motor version must not be empty", "version")
    );
  }
  for (const rule of NUMERIC_RULES) {
    const value = definition[rule.key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(
        issue(
          "character.motor_value_not_finite",
          `${String(rule.key)} must be finite`,
          String(rule.key)
        )
      );
    } else if (value < rule.minimum || value > rule.maximum) {
      issues.push(
        issue(
          "character.motor_value_out_of_range",
          `${String(rule.key)} must be between ${rule.minimum} and ${rule.maximum}`,
          String(rule.key)
        )
      );
    }
  }
  if (definition.capsuleHeight < definition.capsuleRadius * 2) {
    issues.push(
      issue(
        "character.motor_capsule_invalid",
        "capsuleHeight must be at least twice capsuleRadius",
        "capsuleHeight"
      )
    );
  }
  if (definition.stepHeight > definition.capsuleHeight) {
    issues.push(
      issue(
        "character.motor_step_too_high",
        "stepHeight must not exceed capsuleHeight",
        "stepHeight"
      )
    );
  }
  if (definition.groundSnapDistance > definition.groundProbeDistance) {
    issues.push(
      issue(
        "character.motor_snap_exceeds_probe",
        "groundSnapDistance must not exceed groundProbeDistance",
        "groundSnapDistance"
      )
    );
  }
  return issues;
}

export function compileCharacterMotorDefinition(
  definition: CharacterMotorDefinition
): CompiledCharacterMotorDefinition {
  const issues = validateCharacterMotorDefinition(definition);
  if (issues.length > 0) {
    throw new GameError(
      "character.motor_definition_invalid",
      `Character motor definition ${definition.id || "<missing>"} is invalid`,
      { issues }
    );
  }
  return Object.freeze({ ...definition });
}

function issue(code: string, message: string, path: string): CharacterMotorDefinitionIssue {
  return { code, message, path };
}

function diagnostic(
  code: string,
  message: string,
  document: DataDocument<CharacterMotorDefinition>,
  path: string
): DataDiagnostic {
  return {
    code,
    message,
    severity: "error",
    key: { type: document.type, id: document.id },
    path: `data.${path}`,
    ...(document.sourcePackId === undefined ? {} : { sourcePackId: document.sourcePackId })
  };
}
