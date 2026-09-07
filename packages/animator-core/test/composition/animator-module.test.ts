import type { GameInstallContext } from "@gamekits/game-runtime";
import { describe, expect, it } from "vitest";
import { createAnimatorHandle, createAnimatorModule } from "../../src";
import { createMemoryAnimationPlaybackAdapter } from "../../src/testing";
import { animatorController, createAnimatorTestRegistry } from "../fixtures/animator-fixture";

describe("Animator GameModule", () => {
  it("binds and invalidates its handle with the module lifecycle", () => {
    const adapter = createMemoryAnimationPlaybackAdapter();
    const handle = createAnimatorHandle();
    const systems: Array<{ update(context: { delta: number; elapsed: number }): void }> = [];
    const module = createAnimatorModule({
      dataRegistry: createAnimatorTestRegistry(),
      adapter,
      handle
    });
    const installed = module.install({
      systems: { register: (system) => systems.push(system) }
    } as unknown as GameInstallContext);
    expect(handle.isBound()).toBe(true);
    handle.bind(animatorController("module"));
    systems[0]?.update({ delta: 16, elapsed: 16 });
    expect(adapter.frame("module")?.layers[0]?.clipId).toBe("clip.idle");
    if (typeof installed === "function") {
      installed();
    } else {
      installed?.dispose?.();
    }
    expect(handle.isBound()).toBe(false);
    expect(() => handle.hasController("module")).toThrowError(
      expect.objectContaining({ code: "animator.handle_unbound" })
    );
  });
});
