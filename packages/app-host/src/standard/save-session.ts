import { GameError } from "@gamekits/core";
import type { LoadOptions, LoadResult, SaveEnvelope, SaveManager } from "@gamekits/save";

export type SaveSession = {
  save: SaveManager;
  /** Candidate activation must complete before this session becomes current. */
  activate?(): void | Promise<void>;
  dispose(): void | Promise<void>;
};
export type SaveSessionControllerOptions<TSession extends SaveSession> = {
  initial: TSession;
  /** Build isolated mutable state; seed/clock can be initialized from this snapshot. */
  createCandidate(envelope: SaveEnvelope): TSession | Promise<TSession>;
  onCleanupError?(error: unknown): void;
};
export type SaveSessionLoadResult<TSession extends SaveSession> = LoadResult & {
  session: TSession;
  /** The new session is committed even if disposal of the previous one failed. */
  cleanupError?: unknown;
};
export type SaveSessionController<TSession extends SaveSession> = {
  current(): TSession;
  load(
    slotId: string,
    options?: Omit<LoadOptions, "restore">
  ): Promise<SaveSessionLoadResult<TSession>>;
  dispose(): Promise<void>;
};

export function createSaveSessionController<TSession extends SaveSession>(
  options: SaveSessionControllerOptions<TSession>
): SaveSessionController<TSession> {
  let current = options.initial;
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  let disposal: Promise<void> | undefined;
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = queue.catch(() => undefined).then(operation);
    queue = task;
    return task;
  }
  function assertOpen(): void {
    if (closed) throw new GameError("save.session_disposed", "Save session controller is disposed");
  }
  return {
    current() {
      assertOpen();
      return current;
    },
    load(slotId, loadOptions = {}) {
      return enqueue(async () => {
        assertOpen();
        const previous = current;
        const loaded = await previous.save.load(slotId, { ...loadOptions, restore: false });
        assertOpen();
        const candidate = await options.createCandidate(structuredClone(loaded.envelope));
        if (candidate === previous || candidate.save === previous.save) {
          throw new GameError(
            "save.shared_candidate",
            "Candidate must have an independent session and SaveManager"
          );
        }
        try {
          assertOpen();
          await candidate.save.restore(loaded.envelope, { contributors: loadOptions.contributors });
          assertOpen();
          await candidate.activate?.();
          assertOpen();
        } catch (error) {
          try {
            await candidate.dispose();
          } catch (cleanup) {
            throw new AggregateError([error, cleanup], "Candidate restore and cleanup failed");
          }
          throw error;
        }
        // The only commit point. Tick/UI consumers read current() instead of retaining old sessions.
        current = candidate;
        try {
          await previous.dispose();
        } catch (cleanupError) {
          try {
            options.onCleanupError?.(cleanupError);
          } catch {
            /* Commit already succeeded. */
          }
          return { ...loaded, restored: true, session: candidate, cleanupError };
        }
        return { ...loaded, restored: true, session: candidate };
      });
    },
    dispose() {
      if (disposal) return disposal;
      closed = true;
      disposal = enqueue(async () => {
        await current.dispose();
      });
      return disposal;
    }
  };
}
