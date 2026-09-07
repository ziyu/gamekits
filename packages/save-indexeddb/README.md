# IndexedDB SaveStore

Transactional browser adapter for GameKits Save. Production code uses native IndexedDB and Web Crypto; it can be imported without opening a database.

```ts
import { createIndexedDbSaveStore } from "@gamekits/save-indexeddb";
import { createSaveManager } from "@gamekits/save";

const store = createIndexedDbSaveStore({
  databaseName: "my-game-saves",
  maxSaveBytes: 8 * 1024 * 1024,
  onDiagnostic: (event) => console.info(event.code, event.slotId)
});
const save = createSaveManager({
  appId: "my-app",
  gameId: "my-game",
  gameVersion: "1",
  formatVersion: "1",
  store
});
```

Read/load an existing slot before overwriting or deleting it. A stale or unread revision fails with `save.write_conflict`; `list()` and `exists()` do not authorize overwriting progress. New slots can be written immediately.

Data, metadata and one valid previous revision commit in a single transaction. `save.load(id, { backup: true })` explicitly selects the previous revision; corrupted primary records automatically fall back to a valid backup and emit `save.backup_recovered`. Failed commits preserve the prior record. `save.quota_exceeded` and `save.size_exceeded` need an application-visible response rather than an unbounded retry.

Use `createSaveSessionController` from App Host for isolated candidate restoration. Always close the store with `await store.dispose()` when its owning application ends. Old localStorage/file saves are not automatically migrated. Backup integrity is not encryption, anti-cheat, or a replacement for external backups.
