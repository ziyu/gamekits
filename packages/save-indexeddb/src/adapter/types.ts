import type { SaveSlotSummary, SaveStore } from "@gamekits/save";

export type IndexedDbSaveDiagnostic = {
  code: string;
  slotId?: string;
  message: string;
};
export type IndexedDbSaveStoreOptions = {
  databaseName: string;
  /** Native browser factory; injectable for adapter conformance tests. */
  indexedDB?: IDBFactory;
  maxSaveBytes?: number;
  onDiagnostic?(event: IndexedDbSaveDiagnostic): void;
};
export type IndexedDbSaveStore = SaveStore & {
  readBackup(slotId: string): Promise<Uint8Array>;
  dispose(): Promise<void>;
};
export type StoredVersion = {
  data: Uint8Array;
  metadata: SaveSlotSummary;
  digest: string;
};
export type StoredSlot = {
  id: string;
  revision: string;
  current: StoredVersion;
  backup?: StoredVersion;
};
