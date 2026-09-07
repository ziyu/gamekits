import { GameError } from "@gamekits/core";
import type { StoredSlot } from "./types";

export const SLOT_STORE = "slots";

export function openSaveDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let failed = false;
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SLOT_STORE)) {
        request.result.createObjectStore(SLOT_STORE, { keyPath: "id" });
      }
    };
    request.onblocked = () => {
      failed = true;
      reject(
        new GameError("save.database_blocked", "Close other tabs using an older save database")
      );
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (failed) request.result.close();
      else resolve(request.result);
    };
  });
}

export function readSlot(db: IDBDatabase, id: string): Promise<StoredSlot | undefined> {
  return readRequest(db, (store) => store.get(id));
}
export function readSlots(db: IDBDatabase): Promise<StoredSlot[]> {
  return readRequest(db, (store) => store.getAll());
}
function readRequest<T>(
  db: IDBDatabase,
  read: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SLOT_STORE, "readonly");
    const request = read(transaction.objectStore(SLOT_STORE));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error ?? new Error("Save read aborted"));
    transaction.onerror = () => {
      /* onabort owns the result. */
    };
  });
}

/** The revision check and replacement share one native read/write transaction across all tabs. */
export function commitSlot(
  db: IDBDatabase,
  id: string,
  expected: string | undefined,
  next?: StoredSlot
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SLOT_STORE, "readwrite", { durability: "strict" });
    const store = transaction.objectStore(SLOT_STORE);
    let failure: unknown;
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        if (request.result?.revision !== expected) throw conflict(id);
        if (next) store.put(next);
        else store.delete(id);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(failure ?? transaction.error ?? new Error("Save commit aborted"));
    transaction.onerror = () => {
      /* onabort owns the result. */
    };
  });
}
export function conflict(id: string): GameError {
  return new GameError(
    "save.write_conflict",
    "The slot changed in another session; reload before saving",
    { slotId: id }
  );
}
