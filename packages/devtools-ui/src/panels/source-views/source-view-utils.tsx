import { asRecord, readString } from "../value-format";

export function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord).filter((entry) => entry !== undefined) : [];
}

export function StatusPill({ value }: { value: string }) {
  return (
    <span className={`gamekits-devtools-status gamekits-devtools-status--${value}`}>{value}</span>
  );
}

export function countBy<TValue>(
  values: TValue[],
  getKey: (value: TValue) => string
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = getKey(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function enabledCapabilityNames(value: unknown): string[] {
  return Object.entries(asRecord(value) ?? {})
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key);
}

export function recordId(value: Record<string, unknown> | undefined): string {
  return readString(value?.id);
}
