import { GameError } from "@gamekits/core";

export function createInputDuplicateActionError(actionId: string): GameError {
  return new GameError("input.duplicate_action", `Input action already registered: ${actionId}`, {
    actionId
  });
}

export function createInputMissingActionError(actionId: string): GameError {
  return new GameError("input.missing_action", `Input action is not registered: ${actionId}`, {
    actionId
  });
}

export function createInputDuplicateContextError(contextId: string): GameError {
  return new GameError(
    "input.duplicate_context",
    `Input context already registered: ${contextId}`,
    {
      contextId
    }
  );
}

export function createInputMissingContextError(contextId: string): GameError {
  return new GameError("input.missing_context", `Input context is not registered: ${contextId}`, {
    contextId
  });
}

export function createInputInvalidValueError(value: number, inputId: string): GameError {
  return new GameError("input.invalid_value", "Normalized input value must be finite", {
    inputId,
    value
  });
}
