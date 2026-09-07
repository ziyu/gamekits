import { GameError } from "@gamekits/core";
import { describeDiagnostic } from "./diagnostics";
import type { DataDiagnostic } from "./types";

export class DataRegistryError extends GameError {
  readonly diagnostics: DataDiagnostic[];

  constructor(code: string, message: string, diagnostics: DataDiagnostic[]) {
    super(code, message, { diagnostics });
    this.name = "DataRegistryError";
    this.diagnostics = diagnostics;
  }
}

export function createDataRegistryError(
  code: string,
  message: string,
  diagnostics: DataDiagnostic[]
): DataRegistryError {
  const detail = diagnostics.length > 0 ? ` ${diagnostics.map(describeDiagnostic).join("; ")}` : "";
  return new DataRegistryError(code, `${message}.${detail}`, diagnostics);
}

export function createDataDuplicateTypeError(type: string): GameError {
  return new GameError("data.duplicate_type", `Duplicate data type: ${type}`, { type });
}

export function createDataMissingTypeError(type: string): GameError {
  return new GameError("data.missing_type", `Missing data type: ${type}`, { type });
}

export function createDataMissingDocumentError(type: string, id: string): GameError {
  return new GameError("data.missing_document", `Missing data document: ${type}:${id}`, {
    type,
    id
  });
}
