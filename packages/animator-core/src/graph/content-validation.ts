import type { DataDiagnostic, DataDocument } from "@gamekits/data";

export function validateAnimatorDefinitionId<T extends { id: string }>(
  document: DataDocument<T>,
  code: string
): DataDiagnostic[] {
  return isAnimatorNonEmptyString(document.data.id)
    ? []
    : [animatorDataDiagnostic(code, "Animator definition requires an id", document, "id")];
}

export function animatorDataDiagnostic(
  code: string,
  message: string,
  document: DataDocument,
  path: string
): DataDiagnostic {
  return {
    code,
    message,
    severity: "error",
    key: { type: document.type, id: document.id },
    path,
    ...(document.sourcePackId === undefined ? {} : { sourcePackId: document.sourcePackId })
  };
}

export function isAnimatorNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isAnimatorPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isAnimatorNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
