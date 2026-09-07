import { createCodecError, createCorruptedSaveError } from "./errors";
import type { SaveCodec, SaveEnvelope } from "./types";

export type CreateJsonSaveCodecOptions = {
  checksum?: boolean;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function createJsonSaveCodec(options: CreateJsonSaveCodecOptions = {}): SaveCodec {
  const useChecksum = options.checksum !== false;

  return {
    encode(envelope) {
      try {
        const nextEnvelope = useChecksum ? withChecksum(envelope) : envelope;
        return textEncoder.encode(JSON.stringify(nextEnvelope));
      } catch (error) {
        throw createCodecError("encode", error);
      }
    },
    decode(data) {
      try {
        const envelope = JSON.parse(textDecoder.decode(data)) as SaveEnvelope;
        assertSaveEnvelope(envelope);
        if (envelope.checksum && envelope.checksum !== checksumEnvelope(envelope)) {
          throw createCorruptedSaveError("checksum mismatch");
        }
        return envelope;
      } catch (error) {
        if (error instanceof Error && error.name === "GameError") {
          throw error;
        }
        throw createCodecError("decode", error);
      }
    }
  };
}

function withChecksum(envelope: SaveEnvelope): SaveEnvelope {
  const nextEnvelope = { ...envelope };
  delete nextEnvelope.checksum;
  nextEnvelope.checksum = checksumEnvelope(nextEnvelope);
  return nextEnvelope;
}

function checksumEnvelope(envelope: SaveEnvelope): string {
  const nextEnvelope = { ...envelope };
  delete nextEnvelope.checksum;
  return fnv1a(JSON.stringify(nextEnvelope));
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function assertSaveEnvelope(value: unknown): asserts value is SaveEnvelope {
  if (!isRecord(value)) {
    throw createCorruptedSaveError("envelope is not an object");
  }
  if (value.format !== "gamekits.save") {
    throw createCorruptedSaveError("unsupported envelope format");
  }
  if (typeof value.formatVersion !== "string") {
    throw createCorruptedSaveError("missing formatVersion");
  }
  if (!isRecord(value.slot) || typeof value.slot.id !== "string") {
    throw createCorruptedSaveError("missing slot metadata");
  }
  if (
    typeof value.appId !== "string" ||
    typeof value.gameId !== "string" ||
    typeof value.gameVersion !== "string"
  ) {
    throw createCorruptedSaveError("missing app or game identity");
  }
  if (!isRecord(value.payload) || !isRecord(value.payload.sections)) {
    throw createCorruptedSaveError("missing payload sections");
  }
  for (const [id, section] of Object.entries(value.payload.sections)) {
    if (!isRecord(section) || section.id !== id || typeof section.version !== "string") {
      throw createCorruptedSaveError(`invalid section: ${id}`);
    }
  }
  const runtime = value.payload.runtime;
  if (
    !isRecord(runtime) ||
    typeof runtime.seed !== "string" ||
    !isRecord(runtime.clock) ||
    typeof runtime.clock.ticks !== "number" ||
    !Number.isSafeInteger(runtime.clock.ticks) ||
    runtime.clock.ticks < 0 ||
    typeof runtime.clock.elapsed !== "number" ||
    !Number.isFinite(runtime.clock.elapsed) ||
    runtime.clock.elapsed < 0
  ) {
    throw createCorruptedSaveError("invalid runtime clock");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
