import { GameError } from "@gamekits/core";
import { commitSlot, conflict, openSaveDatabase, readSlot, readSlots } from "./database";
import { createStoredVersion, validVersion } from "./integrity";
import type {
  IndexedDbSaveDiagnostic,
  IndexedDbSaveStore,
  IndexedDbSaveStoreOptions,
  StoredSlot,
  StoredVersion
} from "./types";

export function createIndexedDbSaveStore(options: IndexedDbSaveStoreOptions): IndexedDbSaveStore {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) throw new GameError("save.indexeddb_unavailable", "IndexedDB is unavailable");
  if (!options.databaseName.trim()) throw new TypeError("databaseName must not be empty");
  if (
    options.maxSaveBytes !== undefined &&
    (!Number.isSafeInteger(options.maxSaveBytes) || options.maxSaveBytes < 1)
  ) {
    throw new RangeError("maxSaveBytes must be a positive safe integer");
  }
  const revisions = new Map<string, string | undefined>();
  let opening: Promise<IDBDatabase> | undefined;
  let closed = false;
  let mutations: Promise<unknown> = Promise.resolve();
  function emit(event: IndexedDbSaveDiagnostic): void {
    try {
      options.onDiagnostic?.({ ...event });
    } catch {
      /* Diagnostics never change a commit. */
    }
  }
  function assertOpen(): void {
    if (closed) throw new GameError("save.store_disposed", "Save store is disposed");
  }
  async function database(): Promise<IDBDatabase> {
    assertOpen();
    if (!opening) {
      opening = openSaveDatabase(factory, options.databaseName)
        .then((db) => {
          if (closed) {
            db.close();
            throw new GameError("save.store_disposed", "Save store is disposed");
          }
          db.onversionchange = () => {
            db.close();
            opening = undefined;
          };
          return db;
        })
        .catch((error) => {
          opening = undefined;
          throw error;
        });
    }
    return opening;
  }
  function validateRecord(
    record: StoredSlot | undefined,
    id: string
  ): asserts record is StoredSlot {
    if (!record) throw new GameError("save.missing_slot", "Missing save slot", { slotId: id });
    if (record.id !== id || typeof record.revision !== "string") {
      throw new GameError("save.corrupted", "Invalid save slot record", { slotId: id });
    }
  }
  async function selectVersion(record: StoredSlot, backupOnly = false): Promise<StoredVersion> {
    if (!backupOnly && (await validVersion(record.current, record.id))) return record.current;
    if (await validVersion(record.backup, record.id)) {
      emit({
        code: "save.backup_recovered",
        slotId: record.id,
        message: "Loaded the previous valid save revision"
      });
      return record.backup!;
    }
    throw new GameError(
      backupOnly ? "save.missing_backup" : "save.corrupted",
      "No valid save revision is available",
      { slotId: record.id }
    );
  }
  async function read(id: string, backupOnly = false): Promise<Uint8Array> {
    const record = await readSlot(await database(), id);
    revisions.set(id, record?.revision);
    validateRecord(record, id);
    return new Uint8Array((await selectVersion(record, backupOnly)).data);
  }
  function mutate(operation: () => Promise<void>): Promise<void> {
    assertOpen();
    const task = mutations
      .catch(() => undefined)
      .then(operation)
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "QuotaExceededError") {
          error = new GameError(
            "save.quota_exceeded",
            "Storage is full; the previous save is unchanged"
          );
        }
        emit({
          code: error instanceof GameError ? error.code : "save.storage_failed",
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      });
    mutations = task;
    return task;
  }
  return {
    async list() {
      const records = await readSlots(await database());
      const summaries = [];
      for (const record of records) {
        try {
          validateRecord(record, record.id);
          summaries.push(structuredClone((await selectVersion(record)).metadata));
        } catch {
          emit({
            code: "save.corrupted",
            slotId: record.id,
            message: "No readable revision for this slot"
          });
        }
      }
      return summaries;
    },
    read,
    readBackup(id) {
      return read(id, true);
    },
    write(id, data, metadata) {
      const copy = new Uint8Array(data),
        summary = structuredClone({ ...metadata, id });
      return mutate(async () => {
        if (options.maxSaveBytes !== undefined && copy.byteLength > options.maxSaveBytes) {
          throw new GameError("save.size_exceeded", "Save exceeds maxSaveBytes", { slotId: id });
        }
        const db = await database();
        const previous = await readSlot(db, id);
        if (previous?.revision !== revisions.get(id)) throw conflict(id);
        const current = await createStoredVersion(copy, summary);
        const backup = previous ? await selectVersion(previous) : undefined;
        const next: StoredSlot = {
          id,
          revision: crypto.randomUUID(),
          current,
          ...(backup ? { backup } : {})
        };
        await commitSlot(db, id, previous?.revision, next);
        revisions.set(id, next.revision);
        emit({ code: "save.committed", slotId: id, message: "Committed save and backup" });
      });
    },
    delete(id) {
      return mutate(async () => {
        const db = await database();
        const record = await readSlot(db, id);
        validateRecord(record, id);
        if (record.revision !== revisions.get(id)) throw conflict(id);
        await commitSlot(db, id, record.revision);
        revisions.delete(id);
      });
    },
    async exists(id) {
      const record = await readSlot(await database(), id);
      // Existence checks do not authorize overwriting an unread revision.
      return record !== undefined;
    },
    async dispose() {
      if (closed) return;
      closed = true;
      await mutations.catch(() => undefined);
      const db = await opening?.catch(() => undefined);
      db?.close();
      opening = undefined;
      revisions.clear();
    }
  };
}
