import { createDataRegistry, type DataPack } from "@gamekits/data";
import { createEventBus } from "@gamekits/event-bus";
import { createGame } from "@gamekits/game-runtime";
import { type GameWorld } from "@gamekits/world";
import { describe, expect, it } from "vitest";
import {
  createTcaHandle,
  createTcaModule,
  createTcaRuleDataType,
  createTcaRuntime,
  createTcaSaveContributor,
  createTcaTraceStore,
  type TcaActionHandler,
  type TcaConditionHandler,
  type TcaRule
} from "../src";

describe("TCA data type", () => {
  it("validates rules registered through DataRegistry", () => {
    const registry = createDataRegistry();
    registry.registerType(createTcaRuleDataType());

    const validation = registry.validatePack({
      id: "broken",
      version: "1.0.0",
      entries: [
        {
          type: "tca.rule",
          id: "rule.missing-actions",
          data: { id: "rule.missing-actions", trigger: { type: "event.type" }, actions: [] }
        }
      ]
    });

    expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "tca.rule_missing_actions"
    ]);
  });
});

describe("TCA trace store", () => {
  it("isolates observer failures from gameplay writes", () => {
    const observerError = new Error("observer failed");
    const errors: unknown[] = [];
    const traceStore = createTcaTraceStore({
      onEntry() {
        throw observerError;
      },
      onEntryError(error) {
        errors.push(error);
        throw new Error("error observer failed");
      }
    });

    expect(() =>
      traceStore.add({
        ruleId: "rule.safe",
        eventType: "gameplay.event",
        timestamp: 1,
        status: "passed",
        conditions: [],
        actions: []
      })
    ).not.toThrow();
    expect(traceStore.list()).toHaveLength(1);
    expect(errors).toEqual([observerError]);
  });
});

describe("TCA runtime", () => {
  it("indexes rules by event type and runs them by priority", () => {
    const eventBus = createEventBus({ clock: () => 1 });
    const traceStore = createTcaTraceStore();
    const calls: string[] = [];
    const action = actionHandler("test.record", (label) => {
      calls.push(label);
    });
    const runtime = createTcaRuntime({
      eventBus,
      traceStore,
      handlers: { actions: [action] },
      rules: [
        rule("low", "actor.created", "low", 1),
        rule("high", "actor.created", "high", 10),
        rule("other", "actor.removed", "other", 100)
      ]
    });

    runtime.handleEvent({
      type: "actor.created",
      payload: {},
      timestamp: 1
    });

    expect(calls).toEqual(["high", "low"]);
    expect(traceStore.list().map((entry) => entry.ruleId)).toEqual(["high", "low"]);
  });

  it("skips actions when a condition fails", () => {
    const eventBus = createEventBus({ clock: () => 1 });
    const traceStore = createTcaTraceStore();
    const calls: string[] = [];
    const runtime = createTcaRuntime({
      eventBus,
      traceStore,
      handlers: {
        conditions: [conditionHandler("test.false", false)],
        actions: [
          actionHandler("test.record", (label) => {
            calls.push(label);
          })
        ]
      },
      rules: [
        {
          id: "blocked",
          trigger: { type: "event.type", args: { eventType: "input.action" } },
          conditions: [{ type: "test.false" }],
          actions: [{ type: "test.record", args: { label: "ran" } }]
        }
      ]
    });

    runtime.handleEvent({ type: "input.action", payload: {}, timestamp: 1 });

    expect(calls).toEqual([]);
    expect(traceStore.list()[0]).toMatchObject({
      ruleId: "blocked",
      status: "skipped",
      conditions: [{ type: "test.false", passed: false }],
      actions: [{ type: "test.record", status: "skipped" }]
    });
  });

  it("captures action errors in trace", () => {
    const eventBus = createEventBus({ clock: () => 1 });
    const traceStore = createTcaTraceStore();
    const runtime = createTcaRuntime({
      eventBus,
      traceStore,
      handlers: {
        actions: [
          {
            type: "test.fail",
            execute() {
              throw new Error("boom");
            }
          }
        ]
      },
      rules: [
        {
          id: "explodes",
          trigger: { type: "event.type", args: { eventType: "input.action" } },
          actions: [{ type: "test.fail" }]
        }
      ]
    });

    runtime.handleEvent({ type: "input.action", payload: {}, timestamp: 1 });

    expect(traceStore.list()[0]).toMatchObject({
      ruleId: "explodes",
      status: "failed",
      actions: [{ type: "test.fail", status: "failed", error: "boom" }]
    });
  });

  it("executes once rules once", () => {
    const eventBus = createEventBus({ clock: () => 1 });
    const calls: string[] = [];
    const runtime = createTcaRuntime({
      eventBus,
      handlers: {
        actions: [
          actionHandler("test.record", (label) => {
            calls.push(label);
          })
        ]
      },
      rules: [{ ...rule("once", "input.action", "ran"), once: true }]
    });

    runtime.handleEvent({ type: "input.action", payload: {}, timestamp: 1 });
    runtime.handleEvent({ type: "input.action", payload: {}, timestamp: 2 });

    expect(calls).toEqual(["ran"]);
    expect(runtime.traceStore.list().map((entry) => entry.status)).toEqual(["passed", "skipped"]);
  });

  it("restores once-rule state and trace sequence from a checkpoint", () => {
    const eventBus = createEventBus({ clock: () => 1 });
    const calls: string[] = [];
    const createRuntime = () =>
      createTcaRuntime({
        eventBus,
        handlers: {
          actions: [
            actionHandler("test.record", (label) => {
              calls.push(label);
            })
          ]
        },
        rules: [{ ...rule("once", "input.action", "ran"), once: true }]
      });
    const source = createRuntime();
    source.handleEvent({ type: "input.action", payload: {}, timestamp: 1 });
    const checkpoint = source.captureCheckpoint();
    const restored = createRuntime();

    restored.restoreCheckpoint(checkpoint);
    restored.handleEvent({ type: "input.action", payload: {}, timestamp: 2 });

    expect(calls).toEqual(["ran"]);
    expect(restored.traceStore.list()[0]).toMatchObject({
      id: "tca-run-2",
      ruleId: "once",
      status: "skipped"
    });
  });

  it("emits derived events through the built-in event.emit action", () => {
    const eventBus = createEventBus({ clock: () => 1 });
    const emitted: Array<{ type: string; correlationId?: string; parentId?: string }> = [];
    const runtime = createTcaRuntime({
      eventBus,
      rules: [
        {
          id: "emit",
          trigger: { type: "event.type", args: { eventType: "input.action" } },
          actions: [
            {
              type: "event.emit",
              args: { eventType: "derived.event", payload: { ok: true } }
            }
          ]
        }
      ]
    });
    eventBus.on("derived.event", (event) => {
      emitted.push({
        type: event.type,
        correlationId: event.correlationId,
        parentId: event.parentId
      });
    });

    runtime.handleEvent({
      type: "input.action",
      payload: {},
      timestamp: 1,
      correlationId: "command-3",
      parentId: "input-trace-2"
    });

    const trace = runtime.traceStore.list()[0];
    expect(trace).toMatchObject({
      correlationId: "command-3",
      parentId: "input-trace-2"
    });
    expect(emitted).toEqual([
      {
        type: "derived.event",
        correlationId: "command-3",
        parentId: trace?.id
      }
    ]);
  });

  it("accepts external trigger, condition and action definitions", () => {
    const eventBus = createEventBus({ clock: () => 1 });
    const calls: string[] = [];
    const runtime = createTcaRuntime({
      eventBus,
      definitions: {
        triggers: [
          {
            type: "test.payload_kind",
            eventTypes() {
              return ["test.event"];
            },
            matches(ctx, config) {
              return (
                ctx.event.type === "test.event" &&
                isRecord(ctx.event.payload) &&
                ctx.event.payload.kind === config.args?.kind
              );
            }
          }
        ],
        conditions: [conditionHandler("test.true", true)],
        actions: [
          actionHandler("test.record", (label) => {
            calls.push(label);
          })
        ]
      },
      rules: [
        {
          id: "external",
          trigger: { type: "test.payload_kind", args: { kind: "signal" } },
          conditions: [{ type: "test.true" }],
          actions: [{ type: "test.record", args: { label: "ran" } }]
        }
      ]
    });

    runtime.handleEvent({
      type: "test.event",
      payload: { kind: "signal" },
      timestamp: 1
    });

    expect(calls).toEqual(["ran"]);
    expect(runtime.traceStore.list()[0]).toMatchObject({
      ruleId: "external",
      status: "passed"
    });
  });
});

describe("TCA module", () => {
  it("binds a checkpoint handle for Save contributors and releases it on dispose", async () => {
    const registry = createDataRegistry();
    registry.registerType(createTcaRuleDataType());
    registry.registerPack(tcaPack([{ ...rule("once", "input.action", "ran"), once: true }]));
    const eventBus = createEventBus({ clock: () => 1 });
    const handle = createTcaHandle();
    const game = createGame({
      modules: [
        createTcaModule({
          dataRegistry: registry,
          handle,
          handlers: { actions: [actionHandler("test.record", () => {})] }
        })
      ],
      world: createMemoryWorld(),
      eventBus,
      seed: "tca-save-handle"
    });
    eventBus.emit("input.action", {}, "test");
    const contributor = createTcaSaveContributor({ handle });
    const section = await contributor.capture({ now: 1 });

    expect(section?.data).toEqual({
      runSequence: 1,
      executedOnceRuleIds: ["once"]
    });
    game.dispose();
    expect(handle.isBound()).toBe(false);
    expect(() => handle.captureCheckpoint()).toThrowError(
      expect.objectContaining({ code: "tca.handle_unbound" })
    );
  });

  it("reads rules from DataRegistry and unsubscribes on runtime dispose", () => {
    const registry = createDataRegistry();
    registry.registerType(createTcaRuleDataType());
    registry.registerPack(tcaPack([rule("input", "input.action", "ran")]));
    const eventBus = createEventBus({ clock: () => 1 });
    const traceStore = createTcaTraceStore();
    const calls: string[] = [];
    const runtime = createGame({
      modules: [
        createTcaModule({
          dataRegistry: registry,
          traceStore,
          handlers: {
            actions: [
              actionHandler("test.record", (label) => {
                calls.push(label);
              })
            ]
          }
        })
      ],
      world: createMemoryWorld(),
      eventBus,
      seed: "seed"
    });

    eventBus.emit("input.action", {}, "test");
    runtime.dispose();
    eventBus.emit("input.action", {}, "test");

    expect(calls).toEqual(["ran"]);
    expect(traceStore.list()).toHaveLength(1);
  });
});

describe("TCA reentry", () => {
  it("reserves once rules during synchronous reentry", () => {
    const eventBus = createEventBus();
    let executions = 0;
    const runtime = createTcaRuntime({
      eventBus,
      dataRegistry: createDataRegistry(),
      rules: [
        {
          id: "once",
          once: true,
          trigger: { type: "event.type", args: { eventType: "again" } },
          actions: [{ type: "test.reenter" }]
        }
      ],
      definitions: {
        actions: [
          {
            type: "test.reenter",
            execute() {
              executions += 1;
              if (executions === 1)
                runtime.handleEvent({ type: "again", payload: {}, timestamp: 1 });
            }
          }
        ]
      }
    });
    runtime.handleEvent({ type: "again", payload: {}, timestamp: 1 });
    expect(executions).toBe(1);
  });
});

function rule(id: string, eventType: string, label: string, priority = 0): TcaRule {
  return {
    id,
    trigger: { type: "event.type", args: { eventType } },
    priority,
    actions: [{ type: "test.record", args: { label } }]
  };
}

function actionHandler(type: string, record: (label: string) => void): TcaActionHandler {
  return {
    type,
    execute(_ctx, config) {
      record(String(config.args?.label ?? ""));
    }
  };
}

function conditionHandler(type: string, result: boolean): TcaConditionHandler {
  return {
    type,
    evaluate() {
      return result;
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function tcaPack(rules: TcaRule[]): DataPack {
  return {
    id: "tca",
    version: "1.0.0",
    entries: rules.map((rule) => ({ type: "tca.rule", id: rule.id, data: rule }))
  };
}

function createMemoryWorld(): GameWorld {
  return {
    spawn() {
      return "entity";
    },
    despawn() {
      return undefined;
    },
    has() {
      return false;
    },
    add() {
      return undefined;
    },
    get() {
      return undefined;
    },
    set() {
      return undefined;
    },
    remove() {
      return undefined;
    },
    query() {
      return [];
    },
    count() {
      return 0;
    }
  };
}

it("releases once reservations after failed conditions and actions", () => {
  let condition = false;
  let attempts = 0;
  const runtime = createTcaRuntime({
    eventBus: createEventBus(),
    rules: [
      { ...rule("once", "again", "ran"), once: true, conditions: [{ type: "test.condition" }] }
    ],
    definitions: {
      conditions: [{ type: "test.condition", evaluate: () => condition }],
      actions: [
        {
          type: "test.record",
          execute: () => {
            attempts += 1;
            if (attempts === 1) throw new Error("retry");
          }
        }
      ]
    }
  });
  const event = { type: "again", timestamp: 0, payload: {} };
  runtime.handleEvent(event);
  expect(attempts).toBe(0);
  condition = true;
  runtime.handleEvent(event);
  runtime.handleEvent(event);
  runtime.handleEvent(event);
  expect(attempts).toBe(2);
});
