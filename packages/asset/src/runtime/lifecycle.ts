import { GameError } from "@gamekits/core";
import { createUnsupportedAssetError } from "./errors";
import { createAssetLoadQueue } from "./load-queue";
import type {
  AssetDefinition,
  AssetLoadOptions,
  AssetLoadState,
  AssetManager,
  AssetScope,
  CreateAssetManagerOptions
} from "./types";

type LoadTask = {
  controller: AbortController;
  promise: Promise<AssetLoadState>;
  waiters: number;
  done: boolean;
};
type Entry = {
  id: string;
  owners: Set<symbol>;
  legacy: boolean;
  legacyWaiters: number;
  resident: boolean;
  bytes: number;
  touched: number;
  task?: LoadTask | undefined;
  unloading?: Promise<void> | undefined;
  releasing?: Promise<void> | undefined;
};
type Context = {
  get(id: string): AssetDefinition;
  assets(): AssetDefinition[];
  states: Map<string, AssetLoadState>;
  emit(type: string, id: string | undefined, payload: Record<string, unknown>): void;
};

export function createAssetLifecycle(options: CreateAssetManagerOptions, ctx: Context) {
  const queue = createAssetLoadQueue(options.maxConcurrentLoads ?? 4);
  const maxAssets = budget(options.maxResidentAssets, "maxResidentAssets");
  const maxBytes = budget(options.maxResidentBytes, "maxResidentBytes");
  const entries = new Map<string, Entry>();
  let disposed = false;
  let disposing: Promise<void> | undefined;
  let sequence = 0;
  let admission: Promise<void> = Promise.resolve();

  function assertActive(): void {
    if (disposed) throw new GameError("asset.disposed", "Asset manager is disposed");
  }
  function entryFor(id: string): Entry {
    ctx.get(id);
    let entry = entries.get(id);
    if (!entry) {
      entry = {
        id,
        owners: new Set(),
        legacy: false,
        legacyWaiters: 0,
        resident: false,
        bytes: 0,
        touched: 0
      };
      entries.set(id, entry);
    }
    return entry;
  }
  function requireUnload(): void {
    if (!options.adapter.unload) {
      throw new GameError("asset.unload_unsupported", "Asset lifecycle requires an unload adapter");
    }
  }
  function releaseNative(entry: Entry): Promise<void> {
    if (entry.unloading) return entry.unloading;
    const task = Promise.resolve()
      .then(async () => {
        if (!entry.resident) return;
        requireUnload();
        await options.adapter.unload!(ctx.get(entry.id));
        entry.resident = false;
        entry.bytes = 0;
        ctx.states.set(entry.id, { id: entry.id, status: "registered" });
        ctx.emit("asset.unloaded", entry.id, { assetId: entry.id });
      })
      .finally(() => {
        entry.unloading = undefined;
      });
    entry.unloading = task;
    return task;
  }
  async function reserve(entry: Entry, signal: AbortSignal): Promise<void> {
    const task = admission
      .catch(() => undefined)
      .then(async () => {
        signal.throwIfAborted();
        const asset = ctx.get(entry.id);
        const bytes = asset.estimatedBytes ?? 0;
        if (
          !Number.isSafeInteger(bytes) ||
          bytes < 0 ||
          (maxBytes < Infinity && asset.estimatedBytes === undefined)
        ) {
          throw new GameError("asset.invalid_size", "A byte budget requires estimatedBytes", {
            assetId: entry.id
          });
        }
        if (bytes > maxBytes || maxAssets < 1) {
          throw new GameError("asset.budget_exceeded", "Asset exceeds the resident budget", {
            assetId: entry.id
          });
        }
        const resident = () => [...entries.values()].filter((item) => item.resident);
        const fits = () =>
          resident().length < maxAssets &&
          resident().reduce((sum, item) => sum + item.bytes, bytes) <= maxBytes;
        while (!fits()) {
          const candidate = resident()
            .filter(
              (item) => item !== entry && item.owners.size === 0 && !item.task && !item.unloading
            )
            .sort((a, b) => a.touched - b.touched)[0];
          if (!candidate || !options.adapter.unload) {
            throw new GameError(
              "asset.budget_exceeded",
              "Resident assets are still owned or cannot be released",
              { assetId: entry.id }
            );
          }
          await releaseNative(candidate);
          candidate.legacy = false;
          signal.throwIfAborted();
        }
        entry.resident = true;
        entry.bytes = bytes;
      });
    admission = task;
    return task;
  }
  function waitFor(task: LoadTask, signal?: AbortSignal): Promise<AssetLoadState> {
    task.waiters++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        task.waiters--;
        if (task.waiters === 0 && !task.done) task.controller.abort();
        return true;
      };
      const cancel = () => {
        if (finish()) reject(signal?.reason);
      };
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      task.promise.then(
        (state) => {
          if (finish()) resolve({ ...state });
        },
        (error) => {
          if (finish()) reject(error);
        }
      );
    });
  }
  async function load(
    id: string,
    loadOptions: AssetLoadOptions = {},
    legacy = false
  ): Promise<AssetLoadState> {
    assertActive();
    loadOptions.signal?.throwIfAborted();
    const entry = entryFor(id);
    if (entry.releasing) {
      await entry.releasing;
      return load(id, loadOptions, legacy);
    }
    if (entry.unloading) {
      await entry.unloading;
      return load(id, loadOptions, legacy);
    }
    if (entry.task?.controller.signal.aborted) {
      await entry.task.promise.catch(() => undefined);
      return load(id, loadOptions, legacy);
    }
    entry.touched = ++sequence;
    if (ctx.states.get(id)?.status === "loaded") {
      if (legacy) entry.legacy = true;
      return { ...ctx.states.get(id)! };
    }
    if (!entry.task) {
      const asset = ctx.get(id);
      if (!options.adapter.supports(ctx.get(id)))
        throw createUnsupportedAssetError(asset, options.adapter.id);
      const controller = new AbortController();
      const task: LoadTask = { controller, waiters: 0, done: false, promise: undefined! };
      entry.task = task;
      task.promise = Promise.resolve()
        .then(() =>
          queue.run(async () => {
            if (entry.resident) await releaseNative(entry);
            await reserve(entry, controller.signal);
            controller.signal.throwIfAborted();
            ctx.states.set(id, { id, status: "loading" });
            ctx.emit("asset.loading", id, { assetId: id, assetType: asset.type });
            await options.adapter.load(asset, { signal: controller.signal });
            controller.signal.throwIfAborted();
            const state: AssetLoadState = {
              id,
              status: "loaded",
              loadedAt: (options.clock ?? Date.now)()
            };
            ctx.states.set(id, state);
            ctx.emit("asset.loaded", id, { assetId: id, assetType: asset.type });
            return state;
          }, controller.signal)
        )
        .catch(async (error: unknown) => {
          if (entry.resident) {
            if (options.adapter.unload) {
              try {
                await releaseNative(entry);
              } catch (cleanupError) {
                error = new AggregateError([error, cleanupError], "Asset load and cleanup failed");
              }
            } else {
              entry.resident = false;
              entry.bytes = 0;
            }
          }
          if (controller.signal.aborted && !entry.resident) {
            ctx.states.set(id, { id, status: "registered" });
            ctx.emit("asset.cancelled", id, { assetId: id });
            throw controller.signal.reason;
          }
          const state: AssetLoadState = {
            id,
            status: "failed",
            error: error instanceof Error ? error.message : String(error)
          };
          ctx.states.set(id, state);
          ctx.emit("asset.failed", id, { assetId: id, error: state.error });
          return state;
        })
        .finally(async () => {
          try {
            if (controller.signal.aborted && entry.resident && options.adapter.unload) {
              await releaseNative(entry);
              throw controller.signal.reason;
            }
          } finally {
            task.done = true;
            if (entry.task === task) entry.task = undefined;
          }
        });
    }
    if (legacy) entry.legacyWaiters++;
    try {
      const state = await waitFor(entry.task, loadOptions.signal);
      if (legacy && state.status === "loaded") entry.legacy = true;
      return state;
    } finally {
      if (legacy) entry.legacyWaiters--;
    }
  }
  function groupIds(group: string): string[] {
    const ids = ctx
      .assets()
      .filter((asset) => asset.group === group)
      .map((asset) => asset.id);
    if (!ids.length) ctx.emit("asset.group_missing", undefined, { group });
    return ids;
  }
  function unload(id: string): Promise<void> {
    const entry = entryFor(id);
    if (entry.releasing) return entry.releasing;
    if (entry.owners.size)
      throw new GameError("asset.in_use", "Asset is still owned", { assetId: id });
    if (entry.resident) requireUnload();
    entry.task?.controller.abort();
    entry.releasing = Promise.resolve()
      .then(async () => {
        await entry.task?.promise.catch(() => undefined);
        await releaseNative(entry);
        entry.legacy = false;
      })
      .finally(() => {
        entry.releasing = undefined;
      });
    return entry.releasing;
  }
  function createScope(id: string): AssetScope {
    assertActive();
    requireUnload();
    const owner = Symbol(id);
    const owned = new Map<string, AbortController>();
    let closed = false;
    let closing: Promise<void> | undefined;
    const scope: AssetScope = {
      id,
      async load(assetId) {
        assertActive();
        if (closed)
          return Promise.reject(new GameError("asset.scope_disposed", "Asset scope is disposed"));
        const entry = entryFor(assetId);
        let controller = owned.get(assetId);
        if (!controller) {
          controller = new AbortController();
          owned.set(assetId, controller);
          entry.owners.add(owner);
          ctx.emit("asset.retained", assetId, { scopeId: id, owners: entry.owners.size });
        }
        return load(assetId, { signal: controller.signal });
      },
      async loadGroup(group) {
        assertActive();
        if (closed) throw new GameError("asset.scope_disposed", "Asset scope is disposed");
        return Promise.all(groupIds(group).map((assetId) => scope.load(assetId)));
      },
      async release(assetId) {
        const controller = owned.get(assetId);
        if (!controller) return;
        owned.delete(assetId);
        if (disposed) {
          controller.abort();
          return;
        }
        const entry = entryFor(assetId);
        entry.owners.delete(owner);
        controller.abort();
        ctx.emit("asset.released", assetId, { scopeId: id, owners: entry.owners.size });
        if (!entry.owners.size && !entry.legacy && !entry.legacyWaiters && !disposed)
          await unload(assetId);
      },
      dispose() {
        if (closing) return closing;
        closed = true;
        closing = settleAll([...owned.keys()].map((assetId) => scope.release(assetId)));
        return closing;
      }
    };
    return scope;
  }
  const api: Pick<
    AssetManager,
    "load" | "loadGroup" | "unload" | "createScope" | "dispose" | "lifecycleSnapshot"
  > = {
    async load(id, loadOptions) {
      return load(id, loadOptions, true);
    },
    async loadGroup(group, loadOptions) {
      assertActive();
      return Promise.all(groupIds(group).map((id) => api.load(id, loadOptions)));
    },
    async unload(id) {
      assertActive();
      return unload(id);
    },
    createScope,
    dispose() {
      if (disposing) return disposing;
      disposed = true;
      for (const entry of entries.values()) {
        entry.owners.clear();
        entry.task?.controller.abort();
      }
      disposing = settleAll(
        [...entries.values()].map(async (entry) => {
          await entry.task?.promise.catch(() => undefined);
          if (options.adapter.unload) await releaseNative(entry);
        })
      ).finally(() => {
        entries.clear();
      });
      return disposing;
    },
    lifecycleSnapshot() {
      const resident = [...entries.values()].filter((entry) => entry.resident);
      return {
        disposed,
        activeLoads: queue.active,
        queuedLoads: queue.queued,
        residentAssets: resident.length,
        estimatedResidentBytes: resident.reduce((sum, entry) => sum + entry.bytes, 0),
        references: [...entries.values()]
          .filter((entry) => entry.owners.size > 0)
          .map((entry) => ({ assetId: entry.id, owners: entry.owners.size }))
      };
    }
  };
  return { ...api, assertActive };
}

function budget(value: number | undefined, name: string): number {
  if (value === undefined) return Infinity;
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  return value;
}
async function settleAll(tasks: Promise<unknown>[]): Promise<void> {
  const errors = (await Promise.allSettled(tasks)).flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (errors.length) throw new AggregateError(errors, "Asset cleanup failed");
}
