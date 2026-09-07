import {
  createWorldCheckpointController,
  defineComponent,
  type CheckpointGameWorld,
  type GameWorld
} from "@gamekits/world";
import { describe, expect, it } from "vitest";

export function defineWorldConformanceTests(name: string, createWorld: () => GameWorld): void {
  const Position = defineComponent({
    id: "test.position",
    create: (data?: Partial<{ x: number; y: number }>) => ({
      x: data?.x ?? 0,
      y: data?.y ?? 0
    })
  });

  const Velocity = defineComponent({
    id: "test.velocity",
    create: (data?: Partial<{ x: number; y: number }>) => ({
      x: data?.x ?? 0,
      y: data?.y ?? 0
    })
  });

  describe(`${name} GameWorld conformance`, () => {
    it("spawns and despawns entities", () => {
      const world = createWorld();
      const entity = world.spawn();

      expect(world.has(entity)).toBe(true);
      expect(world.count()).toBe(1);

      world.despawn(entity);

      expect(world.has(entity)).toBe(false);
      expect(world.count()).toBe(0);
    });

    it("adds, reads, sets, and removes components", () => {
      const world = createWorld();
      const entity = world.spawn();

      world.add(entity, Position, { x: 4, y: 2 });
      expect(world.get(entity, Position)).toEqual({ x: 4, y: 2 });

      world.set(entity, Position, { x: 8 });
      expect(world.get(entity, Position)).toEqual({ x: 8, y: 2 });

      world.remove(entity, Position);
      expect(world.get(entity, Position)).toBeUndefined();
    });

    it("queries entities that have all requested components", () => {
      const world = createWorld();
      const still = world.spawn();
      const moving = world.spawn();
      const hidden = world.spawn();

      world.add(still, Position, { x: 1, y: 1 });
      world.add(moving, Position, { x: 2, y: 2 });
      world.add(moving, Velocity, { x: 1, y: 0 });
      world.add(hidden, Velocity, { x: 0, y: 1 });

      expect(world.query([Position])).toEqual([still, moving]);
      expect(world.query([Position, Velocity])).toEqual([moving]);
      expect(world.query([Velocity])).toEqual([moving, hidden]);
    });
  });
}

export function defineWorldCheckpointConformanceTests(
  name: string,
  createWorld: () => CheckpointGameWorld
): void {
  const RollbackScope = defineComponent({
    id: "test.rollback-scope",
    create: (data?: Partial<{ active: boolean }>) => ({ active: data?.active ?? true })
  });
  const Position = defineComponent({
    id: "test.rollback-position",
    create: (data?: Partial<{ x: number; y: number }>) => ({
      x: data?.x ?? 0,
      y: data?.y ?? 0
    })
  });

  describe(`${name} checkpoint GameWorld conformance`, () => {
    it("restores stable ids, exact component state, membership, and scope isolation", () => {
      const world = createWorld();
      const actor = world.spawnWithId("actor-7");
      world.add(actor, RollbackScope);
      world.add(actor, Position, { x: 4, y: 2 });
      const outside = world.spawnWithId("outside-1");
      world.add(outside, Position, { x: 99, y: 99 });
      const checkpoints = createWorldCheckpointController({
        world,
        components: [RollbackScope, Position],
        selectEntities: () => world.query([RollbackScope])
      });
      const checkpoint = checkpoints.capture();

      world.despawn(actor);
      const transient = world.spawnWithId("transient-1");
      world.add(transient, RollbackScope);
      world.add(transient, Position, { x: 50, y: 50 });

      expect(checkpoints.restore(checkpoint)).toEqual({
        restoredEntities: 1,
        spawnedEntities: 1,
        despawnedEntities: 1
      });
      expect(world.has(actor)).toBe(true);
      expect(world.get(actor, Position)).toEqual({ x: 4, y: 2 });
      expect(world.has(transient)).toBe(false);
      expect(world.get(outside, Position)).toEqual({ x: 99, y: 99 });
      expect(world.spawn()).toBe("entity-0");
    });

    it("rejects schema mismatch before mutating the world", () => {
      const world = createWorld();
      const actor = world.spawnWithId("actor-1");
      world.add(actor, RollbackScope);
      world.add(actor, Position, { x: 1, y: 2 });
      const checkpoints = createWorldCheckpointController({
        world,
        components: [RollbackScope, Position],
        selectEntities: () => world.query([RollbackScope])
      });
      const checkpoint = checkpoints.capture();
      checkpoint.componentIds = [RollbackScope.id];

      expect(checkpoints.validate(checkpoint)).toMatchObject({
        valid: false,
        issues: [{ code: "component-schema-mismatch" }]
      });
      expect(() => checkpoints.restore(checkpoint)).toThrow("World checkpoint is invalid");
      expect(world.get(actor, Position)).toEqual({ x: 1, y: 2 });
    });
  });
}
