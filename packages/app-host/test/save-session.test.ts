import { describe, expect, it, vi } from "vitest";
import { createMemorySaveStore, createSaveManager, type SaveEnvelope } from "@gamekits/save";
import { createSaveSessionController } from "../src";

function fixture() {
  const store = createMemorySaveStore();
  const make = (failure?: "validate" | "restore" | "activate" | "dispose") => {
    const state = { a: 1, b: 2 };
    const save = createSaveManager({
      appId: "app",
      gameId: "game",
      gameVersion: "1",
      formatVersion: "1",
      store
    });
    for (const [index, id] of ["a", "b"].entries())
      save.registerContributor({
        id,
        version: "1",
        required: true,
        order: index,
        capture: () => ({ id, version: "1", data: state[id as "a" | "b"] }),
        validate: () => ({
          issues:
            failure === "validate" && id === "b"
              ? [{ code: "invalid", severity: "error", message: "invalid b" }]
              : []
        }),
        restore: (_context, section) => {
          if (failure === "restore" && id === "b") throw new Error("restore failed");
          state[id as "a" | "b"] = section.data as number;
        }
      });
    return {
      state,
      save,
      activate: vi.fn(() => {
        if (failure === "activate") throw new Error("activate failed");
      }),
      dispose: vi.fn(() => {
        if (failure === "dispose") throw new Error("dispose failed");
      })
    };
  };
  return { make, store };
}
async function saveProgress(session: ReturnType<ReturnType<typeof fixture>["make"]>) {
  session.state.a = 10;
  session.state.b = 20;
  await session.save.save("slot", { runtime: { seed: "seed", clock: { ticks: 5, elapsed: 80 } } });
  session.state.a = 30;
  session.state.b = 40;
}
describe("staged save session recovery", () => {
  it("does not activate a candidate when disposal interrupts restoration", async () => {
    const { make } = fixture(),
      initial = make(),
      candidate = make();
    await saveProgress(initial);
    let finish!: () => void;
    const restoring = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(candidate.save, "restore").mockImplementation(() => restoring);
    const controller = createSaveSessionController({ initial, createCandidate: () => candidate });
    const pending = expect(controller.load("slot")).rejects.toMatchObject({
      code: "save.session_disposed"
    });
    await vi.waitFor(() => expect(candidate.save.restore).toHaveBeenCalledOnce());
    const disposal = controller.dispose();
    finish();
    await pending;
    await disposal;
    expect(candidate.activate).not.toHaveBeenCalled();
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(initial.dispose).toHaveBeenCalledOnce();
    await expect(controller.load("slot")).rejects.toMatchObject({ code: "save.session_disposed" });
  });
  it.each(["validate", "restore", "activate"] as const)(
    "preserves the current game after %s failure",
    async (failure) => {
      const { make } = fixture(),
        initial = make(),
        candidate = make(failure);
      await saveProgress(initial);
      const controller = createSaveSessionController({ initial, createCandidate: () => candidate });
      await expect(controller.load("slot")).rejects.toThrow();
      expect(controller.current()).toBe(initial);
      expect(initial.state).toEqual({ a: 30, b: 40 });
      expect(initial.dispose).not.toHaveBeenCalled();
      expect(candidate.dispose).toHaveBeenCalledOnce();
      if (failure === "validate") expect(candidate.state).toEqual({ a: 1, b: 2 });
      await controller.dispose();
    }
  );
  it("commits only after restore and activation, then cleans the previous session", async () => {
    const { make } = fixture(),
      initial = make(),
      candidate = make();
    await saveProgress(initial);
    const controller = createSaveSessionController({
      initial,
      createCandidate: (envelope) => {
        expect(envelope.payload.runtime.clock.ticks).toBe(5);
        return candidate;
      }
    });
    candidate.activate.mockImplementation(() => {
      expect(controller.current()).toBe(initial);
      expect(candidate.state).toEqual({ a: 10, b: 20 });
    });
    const result = await controller.load("slot");
    expect(result.restored).toBe(true);
    expect(controller.current()).toBe(candidate);
    expect(initial.dispose).toHaveBeenCalledOnce();
    await controller.dispose();
  });
  it("reports old-session cleanup separately from the committed load", async () => {
    const { make } = fixture(),
      initial = make("dispose"),
      candidate = make();
    await saveProgress(initial);
    const controller = createSaveSessionController({
      initial,
      createCandidate: () => candidate,
      onCleanupError() {
        throw new Error("observer failed");
      }
    });
    const result = await controller.load("slot");
    expect(result.cleanupError).toBeInstanceOf(Error);
    expect(controller.current()).toBe(candidate);
    await controller.dispose();
  });
  it("does not re-read a changing store while restoring the captured snapshot", async () => {
    const { make } = fixture(),
      initial = make(),
      candidate = make();
    await saveProgress(initial);
    const controller = createSaveSessionController({
      initial,
      createCandidate: async (_snapshot: SaveEnvelope) => {
        await initial.save.save("slot", {
          runtime: { seed: "seed", clock: { ticks: 10, elapsed: 160 } }
        });
        return candidate;
      }
    });
    await controller.load("slot");
    expect(candidate.state).toEqual({ a: 10, b: 20 });
    await controller.dispose();
  });
  it("rejects shared candidates without disposing the live session", async () => {
    const { make } = fixture(),
      initial = make();
    await saveProgress(initial);
    const controller = createSaveSessionController({ initial, createCandidate: () => initial });
    await expect(controller.load("slot")).rejects.toMatchObject({ code: "save.shared_candidate" });
    expect(initial.dispose).not.toHaveBeenCalled();
    await controller.dispose();
  });
});
