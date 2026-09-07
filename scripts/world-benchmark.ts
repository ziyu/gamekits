import { performance } from "node:perf_hooks";
import { defineComponent } from "@gamekits/world";
import { createKootaWorld } from "@gamekits/world-koota";

const Position = defineComponent({
  id: "bench.position",
  create: (data?: Partial<{ x: number; y: number }>) => ({
    x: data?.x ?? 0,
    y: data?.y ?? 0
  })
});

const Velocity = defineComponent({
  id: "bench.velocity",
  create: (data?: Partial<{ x: number; y: number }>) => ({
    x: data?.x ?? 0,
    y: data?.y ?? 0
  })
});

const world = createKootaWorld();
const entityCount = 10_000;

const start = performance.now();

for (let i = 0; i < entityCount; i += 1) {
  const entity = world.spawn();
  world.add(entity, Position, { x: i, y: i });
  if (i % 2 === 0) {
    world.add(entity, Velocity, { x: 1, y: -1 });
  }
}

const afterSpawn = performance.now();
const moving = world.query([Position, Velocity]);

for (const entity of moving) {
  const position = world.get(entity, Position);
  const velocity = world.get(entity, Velocity);
  if (position && velocity) {
    world.set(entity, Position, {
      x: position.x + velocity.x,
      y: position.y + velocity.y
    });
  }
}

const end = performance.now();

console.log(
  JSON.stringify(
    {
      adapter: "@gamekits/world-koota",
      entityCount,
      movingCount: moving.length,
      spawnAndAddMs: Math.round((afterSpawn - start) * 100) / 100,
      queryAndUpdateMs: Math.round((end - afterSpawn) * 100) / 100
    },
    null,
    2
  )
);
