import type { ReactNode } from "react";

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readString(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function formatScalar(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return `${value.length} items`;
  }
  if (typeof value === "object") {
    return `${Object.keys(value as Record<string, unknown>).length} fields`;
  }
  return String(value);
}

export function RawSnapshotDisclosure({ value }: { value: unknown }) {
  return (
    <details className="gamekits-devtools-raw">
      <summary>Raw snapshot</summary>
      <pre>{stringifyPreview(value)}</pre>
    </details>
  );
}

export function MiniTable({
  columns,
  empty,
  rows
}: {
  columns: string[];
  empty: string;
  rows: ReactNode[][];
}) {
  if (rows.length === 0) {
    return <p className="gamekits-devtools-empty">{empty}</p>;
  }

  return (
    <table className="gamekits-devtools-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column}>{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function stringifyPreview(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(
      value,
      (_key, entry: unknown) => {
        if (typeof entry === "function") {
          return "[Function]";
        }
        if (entry && typeof entry === "object") {
          if (seen.has(entry)) {
            return "[Circular]";
          }
          seen.add(entry);
        }
        return entry;
      },
      2
    ) ?? "undefined"
  );
}
