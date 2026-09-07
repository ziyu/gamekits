import type { MultiplayerMessageEnvelope } from "@gamekits/multiplayer-core";

export type ArenaItemActionType = "interact" | "use" | "drop";

export type ArenaItemAction = {
  type: ArenaItemActionType;
  commandId: string;
  inputSequence: number;
  aimX: number;
  aimZ: number;
  charge: number;
  authorityEpoch?: string | undefined;
  targetItemId?: string | undefined;
  targetItemGeneration?: number | undefined;
};

export function readArenaItemAction(
  value: unknown,
  message?: MultiplayerMessageEnvelope
): ArenaItemAction | undefined {
  if (
    !isRecord(value) ||
    !isActionType(value.type) ||
    !boundedId(value.commandId) ||
    (message !== undefined && value.commandId !== message.id) ||
    !nonNegativeSafeInteger(value.inputSequence) ||
    !axis(value.aimX) ||
    !axis(value.aimZ) ||
    !inclusiveRatio(value.charge) ||
    (value.authorityEpoch !== undefined && !boundedId(value.authorityEpoch)) ||
    (value.targetItemId !== undefined && !boundedId(value.targetItemId)) ||
    (value.targetItemGeneration !== undefined &&
      !positiveSafeInteger(value.targetItemGeneration)) ||
    (value.targetItemId === undefined) !== (value.targetItemGeneration === undefined)
  ) {
    return undefined;
  }
  return {
    type: value.type,
    commandId: value.commandId,
    inputSequence: value.inputSequence,
    aimX: value.aimX,
    aimZ: value.aimZ,
    charge: value.charge,
    ...(value.authorityEpoch === undefined ? {} : { authorityEpoch: value.authorityEpoch }),
    ...(value.targetItemId === undefined ? {} : { targetItemId: value.targetItemId }),
    ...(value.targetItemGeneration === undefined
      ? {}
      : { targetItemGeneration: value.targetItemGeneration })
  };
}

function isActionType(value: unknown): value is ArenaItemActionType {
  return value === "interact" || value === "use" || value === "drop";
}

function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function axis(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1;
}

function inclusiveRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
