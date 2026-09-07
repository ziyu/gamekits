import { createSeededRng } from "@gamekits/core";
import {
  createMultiplayerRngRollbackContributor,
  createMultiplayerRollbackCoordinator,
  hashMultiplayerRollbackValue,
  measureMultiplayerRollbackValue,
  serializeMultiplayerRollbackValue,
  type MultiplayerRollbackContributor
} from "../src";
import { describe, expect, it } from "vitest";

describe("multiplayer rollback coordinator", () => {
  it("captures, hashes, and restores World, RNG, and simulation state in stable order", () => {
    const calls: string[] = [];
    const world = { playerX: 2 };
    const physics = { velocityX: 3 };
    const rng = createSeededRng("rollback-seed");
    const coordinator = createMultiplayerRollbackCoordinator({
      generation: "round-1",
      contributors: [
        numberContributor("physics", 30, physics, "velocityX", calls),
        createMultiplayerRngRollbackContributor(rng, { order: 20 }),
        numberContributor("world", 10, world, "playerX", calls)
      ],
      maxHistoryTicks: 4,
      maxCheckpointBytes: 256,
      maxHistoryBytes: 1_024
    });

    expect(coordinator.capture(0)).toMatchObject({
      status: "captured",
      tick: 0,
      bytes: expect.any(Number),
      hash: expect.stringMatching(/^[0-9a-f]{16}$/),
      contributors: ["world", "rng", "physics"]
    });
    const expectedRandom = rng.next();
    world.playerX = 10;
    physics.velocityX = 12;
    expect(coordinator.capture(1)).toMatchObject({ status: "captured", tick: 1 });
    world.playerX = 99;
    physics.velocityX = 88;
    rng.next();

    expect(coordinator.restore(0)).toMatchObject({ status: "restored", tick: 0 });
    expect(world.playerX).toBe(2);
    expect(physics.velocityX).toBe(3);
    expect(rng.next()).toBe(expectedRandom);
    expect(calls).toEqual([
      "capture:world:0",
      "capture:physics:0",
      "capture:world:1",
      "capture:physics:1",
      "validate:world:0",
      "validate:physics:0",
      "restore:world:0",
      "restore:physics:0"
    ]);
    expect(coordinator.diagnostics()).toMatchObject({
      captures: 2,
      restores: 1,
      checkpoints: 1,
      earliestTick: 0,
      latestTick: 0
    });
  });

  it("validates every contributor before restore and bounds checkpoint history and bytes", () => {
    const state = { value: 1 };
    let valid = true;
    const contributor: MultiplayerRollbackContributor<number> = {
      id: "world",
      capture: () => state.value,
      validate: () => valid,
      restore: (value) => {
        state.value = value;
      },
      measureBytes: () => 8,
      hash: (value) => String(value)
    };
    const coordinator = createMultiplayerRollbackCoordinator({
      generation: 1,
      contributors: [contributor],
      maxHistoryTicks: 1,
      maxCheckpointBytes: 8,
      maxHistoryBytes: 16
    });
    coordinator.capture(0);
    state.value = 2;
    coordinator.capture(1);
    state.value = 3;
    expect(coordinator.capture(2)).toMatchObject({
      status: "captured",
      evictedTicks: [0]
    });
    state.value = 10;
    valid = false;

    expect(coordinator.restore(1)).toMatchObject({
      status: "validation-failed",
      contributorId: "world"
    });
    expect(state.value).toBe(10);
    expect(coordinator.restore(0)).toMatchObject({ status: "missing" });
    expect(coordinator.diagnostics()).toMatchObject({
      validationFailures: 1,
      missingRestores: 1,
      evictedCheckpoints: 1,
      checkpoints: 2,
      historyBytes: 16
    });

    const oversized = createMultiplayerRollbackCoordinator({
      generation: 1,
      contributors: [{ ...contributor, measureBytes: () => 9 }],
      maxCheckpointBytes: 8
    });
    expect(oversized.capture(0)).toMatchObject({
      status: "checkpoint-capacity",
      bytes: 9
    });
  });

  it("uses canonical checkpoint encoding independent of object key insertion order", () => {
    const first = { z: [1, undefined, 3], a: { y: true, x: "value" } };
    const second = { a: { x: "value", y: true }, z: [1, undefined, 3] };

    expect(serializeMultiplayerRollbackValue(first)).toBe(
      '{"a":{"x":"value","y":true},"z":[1,null,3]}'
    );
    expect(hashMultiplayerRollbackValue(first)).toBe(hashMultiplayerRollbackValue(second));
    expect(measureMultiplayerRollbackValue(first)).toBe(
      new TextEncoder().encode(serializeMultiplayerRollbackValue(first)).byteLength
    );
    expect(() => hashMultiplayerRollbackValue({ value: Number.NaN })).toThrow("must be finite");
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => hashMultiplayerRollbackValue(cyclic)).toThrow("must not contain cyclic data");
  });
});

function numberContributor<TKey extends string>(
  id: string,
  order: number,
  state: Record<TKey, number>,
  key: TKey,
  calls: string[]
): MultiplayerRollbackContributor<number> {
  return {
    id,
    order,
    capture({ tick }) {
      calls.push(`capture:${id}:${tick}`);
      return state[key];
    },
    validate(_checkpoint, { tick }) {
      calls.push(`validate:${id}:${tick}`);
      return true;
    },
    restore(checkpoint, { tick }) {
      calls.push(`restore:${id}:${tick}`);
      state[key] = checkpoint;
    },
    measureBytes: () => 8,
    hash: (value) => String(value)
  };
}
