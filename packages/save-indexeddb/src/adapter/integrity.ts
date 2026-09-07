import type { SaveSlotSummary } from "@gamekits/save";
import type { StoredVersion } from "./types";

export async function createStoredVersion(
  data: Uint8Array,
  metadata: SaveSlotSummary
): Promise<StoredVersion> {
  const version = { data: new Uint8Array(data), metadata: structuredClone(metadata), digest: "" };
  version.digest = await digest(version);
  return version;
}
export async function validVersion(value: unknown, id: string): Promise<boolean> {
  // The caller uses a typed stored record; native IndexedDB content is still validated at runtime.
  if (!value || typeof value !== "object") return false;
  const version = value as StoredVersion;
  if (
    !(version.data instanceof Uint8Array) ||
    !version.metadata ||
    version.metadata.id !== id ||
    typeof version.digest !== "string"
  )
    return false;
  try {
    return version.digest === (await digest(version));
  } catch {
    // Native records may contain corrupt, non-JSON metadata. Allow backup selection to continue.
    return false;
  }
}
async function digest(version: Omit<StoredVersion, "digest">): Promise<string> {
  const metadata = new TextEncoder().encode(JSON.stringify(version.metadata));
  const bytes = new Uint8Array(4 + metadata.length + version.data.length);
  new DataView(bytes.buffer).setUint32(0, metadata.length);
  bytes.set(metadata, 4);
  bytes.set(version.data, 4 + metadata.length);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
