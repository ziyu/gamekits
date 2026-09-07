import { defineGameModule } from "@gamekits/core";
import { createEventBus } from "@gamekits/event-bus";
import { defineComponent, type GameWorld } from "@gamekits/world";
import { describe, expect, it } from "vitest";
import { createGame, type GameInstallContext } from "../src/index";

const Counter = defineComponent({
  id: "test.counter",
  create: (data?: Partial<{ value: number }>) => ({ value: data?.value ?? 0 })
});

function createMemoryWorld(): GameWorld {
  let nextId = 0;
  const componentsByEntity = new Map<string, Map<string, unknown>>();

  return {
    spawn() {
      const id = `entity-${nextId}`;
      nextId += 1;
      componentsByEntity.set(id, new Map());
      return id;
    },
    despawn(entity) {
      componentsByEntity.delete(String(entity));
    },
    has(entity) {
      return componentsByEntity.has(String(entity));
    },
    add(entity, component, data) {
      componentsByEntity.get(String(entity))?.set(component.id, component.create(data));
    },
    get(entity, component) {
      return componentsByEntity.get(String(entity))?.get(component.id) as any;
    },
    set(entity, component, data) {
      const current = this.get(entity, component);
      if (current) {
        Object.assign(current, data);
      }
    },
    remove(entity, component) {
      componentsByEntity.get(String(entity))?.delete(component.id);
    },
    query(components = []) {
      return [...componentsByEntity.entries()]
        .filter(([, entityComponents]) =>
          components.every((component) => entityComponents.has(component.id))
        )
        .map(([entity]) => entity);
    },
    count() {
      return componentsByEntity.size;
    }
  };
}

describe("createGame", () => {
  it("installs modules once and runs systems in registration order", () => {
    const world = createMemoryWorld();
    const eventBus = createEventBus({ clock: () => 0 });
    const calls: string[] = [];
    const entity = world.spawn();
    world.add(entity, Counter, { value: 0 });

    const module = defineGameModule<GameInstallContext>({
      id: "test.module",
      install(ctx) {
        calls.push("install");
        ctx.systems.register({
          id: "a",
          update() {
            calls.push("a");
          }
        });
        ctx.systems.register({
          id: "b",
          update() {
            calls.push("b");
          }
        });
      }
    });

    const runtime = createGame({ modules: [module], world, eventBus, seed: "seed" });
    runtime.start();
    runtime.tick(16);
    runtime.tick(16);

    expect(calls).toEqual(["install", "a", "b", "a", "b"]);
  });

  it("does not update systems while stopped", () => {
    const world = createMemoryWorld();
    const eventBus = createEventBus({ clock: () => 0 });
    let updates = 0;

    const module = defineGameModule<GameInstallContext>({
      id: "test.module",
      install(ctx) {
        ctx.systems.register({
          id: "counter",
          update() {
            updates += 1;
          }
        });
      }
    });

    const runtime = createGame({ modules: [module], world, eventBus, seed: "seed" });
    runtime.tick(16);
    runtime.start();
    runtime.tick(16);
    runtime.stop();
    runtime.tick(16);

    expect(updates).toBe(1);
  });

  it("runs module cleanup in reverse install order on dispose", () => {
    const world = createMemoryWorld();
    const eventBus = createEventBus({ clock: () => 0 });
    const calls: string[] = [];

    const first = defineGameModule<GameInstallContext>({
      id: "first",
      install() {
        calls.push("first.install");
        return () => {
          calls.push("first.cleanup");
        };
      }
    });
    const second = defineGameModule<GameInstallContext>({
      id: "second",
      install() {
        calls.push("second.install");
        return {
          dispose() {
            calls.push("second.dispose");
          }
        };
      }
    });

    const runtime = createGame({ modules: [first, second], world, eventBus, seed: "seed" });
    runtime.dispose();
    runtime.dispose();

    expect(calls).toEqual(["first.install", "second.install", "second.dispose", "first.cleanup"]);
  });

  it("does not run module cleanup on stop", () => {
    const world = createMemoryWorld();
    const eventBus = createEventBus({ clock: () => 0 });
    const calls: string[] = [];
    const module = defineGameModule<GameInstallContext>({
      id: "cleanup.module",
      install() {
        return () => {
          calls.push("cleanup");
        };
      }
    });

    const runtime = createGame({ modules: [module], world, eventBus, seed: "seed" });
    runtime.start();
    runtime.stop();

    expect(calls).toEqual([]);

    runtime.dispose();

    expect(calls).toEqual(["cleanup"]);
  });
});

describe("runtime failure cleanup", () => {
  it("releases previous module subscriptions when installation fails", () => {
    const eventBus = createEventBus();
    const calls: string[] = [];
    expect(() =>
      createGame({
        world: createMemoryWorld(),
        eventBus,
        seed: "seed",
        modules: [
          { id: "a", install: (ctx) => ctx.eventBus.on("test", () => calls.push("leaked")) },
          {
            id: "b",
            install: () => {
              throw new Error("install failed");
            }
          }
        ]
      })
    ).toThrow("install failed");
    eventBus.emit("test", {});
    expect(calls).toEqual([]);
  });

  it("attempts all cleanups even when stopped listeners and module disposal throw", () => {
    const calls: string[] = [];
    const eventBus = createEventBus();
    eventBus.on("runtime.stopped", () => {
      throw new Error("listener failed");
    });
    const runtime = createGame({
      world: createMemoryWorld(),
      eventBus,
      seed: "seed",
      modules: ["a", "b", "c"].map((id) => ({
        id,
        install: () => () => {
          calls.push(id);
          if (id === "b") throw new Error("cleanup failed");
        }
      }))
    });
    runtime.start();
    expect(() => runtime.dispose()).toThrow(AggregateError);
    expect(calls).toEqual(["c", "b", "a"]);
    expect(runtime.isRunning()).toBe(false);
    runtime.dispose();
    expect(calls).toHaveLength(3);
  });
});
