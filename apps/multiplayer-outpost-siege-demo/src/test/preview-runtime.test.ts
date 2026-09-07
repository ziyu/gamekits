import { initRapier2dPhysicsBackend } from "@gamekits/physics-rapier2d";
import { createKootaWorld } from "@gamekits/world-koota";
import { beforeAll, describe, expect, it } from "vitest";
import { createOutpostDataRegistry } from "../content";
import {
  clearOutpostTransientInput,
  createOutpostInputState,
  createOutpostPreviewRuntime,
  OUTPOST_PREVIEW_PLAYER_ID,
  type OutpostInputState
} from "../gameplay";
import type { PhysicsBackendAdapter } from "@gamekits/physics-core";
import { resolveOutpostKeyboardScope } from "../profiles";

describe("Outpost physical preview runtime", () => {
  let physicsBackend: PhysicsBackendAdapter;

  beforeAll(async () => {
    physicsBackend = await initRapier2dPhysicsBackend({
      id: "outpost.preview.test.rapier2d",
      lengthUnit: 100
    });
  });

  it("materializes a data-driven player and advances it through the physics module", () => {
    const preview = createOutpostPreviewRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      physicsBackend
    });
    const initial = preview.snapshot();
    preview.input.moveX = 1;
    preview.runtime.start();
    tick(preview.runtime, 30);

    const moved = preview.snapshot();
    expect(initial.entityCount).toBe(34);
    expect(moved.player.x).toBeGreaterThan(initial.player.x + 80);
    expect(moved.player.velocityX).toBeGreaterThan(0);
    expect(moved.physics.bound).toBe(true);
    expect(moved.physics.recentTraceCount).toBeGreaterThan(0);
    expect(preview.identity.byGameplayObjectId(OUTPOST_PREVIEW_PLAYER_ID)?.entityId).toBe(
      preview.playerEntity
    );
    expect(preview.identity.byPhysicsBodyId(`${OUTPOST_PREVIEW_PLAYER_ID}.body`)?.entityId).toBe(
      preview.playerEntity
    );

    preview.runtime.dispose();
    expect(preview.physics.isBound()).toBe(false);
    expect(preview.identity.snapshot()).toEqual([]);
    expect(preview.runtime.world.count()).toBe(0);
  });

  it("provides a smooth presentation transform between fixed physics steps", () => {
    const preview = createOutpostPreviewRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      physicsBackend
    });
    preview.input.moveX = 1;
    preview.runtime.start();
    preview.runtime.tick(1000 / 60);

    const bodyId = `${OUTPOST_PREVIEW_PLAYER_ID}.body`;
    const authoritativeX = preview.snapshot().player.x;
    expect(authoritativeX).toBeGreaterThan(900);
    expect(preview.physicsInterpolation.sample(bodyId)?.position.x).toBeCloseTo(900, 4);

    preview.runtime.tick(1000 / 120);
    expect(preview.physicsInterpolation.sample(bodyId)?.position.x).toBeCloseTo(
      (900 + authoritativeX) / 2,
      3
    );
    expect(preview.physicsInterpolation.snapshot()).toMatchObject({
      alpha: 0.5,
      trackedBodyCount: 1
    });
    preview.runtime.dispose();
  });

  it("materializes the generated arena companion layout as one static body", () => {
    const preview = createOutpostPreviewRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      physicsBackend
    });
    preview.runtime.start();
    tick(preview.runtime, 1);

    expect(preview.physics.snapshot()).toMatchObject({ bodyCount: 2, colliderCount: 33 });
    expect(preview.physics.queryPoint({ x: 566, y: 474 }).map((hit) => hit.colliderId)).toContain(
      "layout.outpost.arena.architecture.cover.west.upper.collider"
    );
    preview.runtime.dispose();
  });

  it("blocks movement against authored cover instead of the background image", () => {
    const preview = createOutpostPreviewRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      physicsBackend
    });
    preview.input.moveX = 1;
    preview.runtime.start();
    tick(preview.runtime, 300);

    expect(preview.snapshot().player.x).toBeGreaterThan(1120);
    expect(preview.snapshot().player.x).toBeLessThan(1210);
    preview.runtime.dispose();
  });

  it("uses physical outer architecture instead of clamping gameplay coordinates", () => {
    const preview = createOutpostPreviewRuntime({
      dataRegistry: createOutpostDataRegistry(),
      world: createKootaWorld(),
      physicsBackend
    });
    preview.runtime.start();
    preview.input.moveY = 1;
    tick(preview.runtime, 80);
    preview.input.moveY = 0;
    preview.input.moveX = 1;
    tick(preview.runtime, 480);

    expect(preview.snapshot().player.x).toBeGreaterThan(1550);
    expect(preview.snapshot().player.x).toBeLessThan(1620);
    preview.runtime.dispose();
  });
});

describe("Outpost preview input state", () => {
  it("clears one-shot actions without clearing held movement", () => {
    const input: OutpostInputState = createOutpostInputState();
    input.held.right = true;
    input.moveX = 1;
    input.primaryRequested = true;
    input.dashRequested = true;
    input.cameraZoomDelta = -1;

    clearOutpostTransientInput(input);

    expect(input.held.right).toBe(true);
    expect(input.moveX).toBe(1);
    expect(input.primaryRequested).toBe(false);
    expect(input.dashRequested).toBe(false);
    expect(input.cameraZoomDelta).toBe(0);
  });
});

describe("Outpost browser input scope", () => {
  it("routes keyboard input away from gameplay while framework UI owns focus", () => {
    expect(resolveOutpostKeyboardScope("game", false, false)).toBe("game");
    expect(resolveOutpostKeyboardScope("none", false, true)).toBe("devtools");
    expect(resolveOutpostKeyboardScope("devtools", false, false)).toBe("devtools");
    expect(resolveOutpostKeyboardScope("modal", false, false)).toBe("modal");
    expect(resolveOutpostKeyboardScope("text-input", false, false)).toBe("text-input");
    expect(resolveOutpostKeyboardScope("game", true, false)).toBe("ui");
  });
});

function tick(runtime: { tick(delta: number): void }, count: number): void {
  for (let index = 0; index < count; index += 1) {
    runtime.tick(1000 / 60);
  }
}
