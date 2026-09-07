import type {
  TcaActionDefinition,
  TcaConditionDefinition,
  TcaDefinitionSet,
  TcaTriggerDefinition
} from "@gamekits/tca";

export function createSandboxTcaDefinitions(): TcaDefinitionSet {
  return {
    triggers: [createInputActionTrigger(), createMotionIntervalTrigger()],
    conditions: [
      createInputActionCondition(),
      createEntityCountCondition(),
      createDataTagCondition()
    ],
    actions: [createSandboxLogAction(), createSandboxDataSummaryAction()]
  };
}

function createInputActionTrigger(): TcaTriggerDefinition {
  return {
    type: "sandbox.input_action",
    description: "Matches normalized sandbox input.action events.",
    eventTypes() {
      return ["input.action"];
    },
    matches(ctx, config) {
      const payload = isRecord(ctx.event.payload) ? ctx.event.payload : {};
      return (
        matchesStringOrList(payload.actionId, config.args, "actionId", "actionIds") &&
        matchesString(payload.phase, config.args, "phase")
      );
    }
  };
}

function createMotionIntervalTrigger(): TcaTriggerDefinition {
  return {
    type: "sandbox.motion_interval",
    description: "Matches sandbox motion ticks by tick interval.",
    eventTypes() {
      return ["sandbox.motion_tick"];
    },
    matches(ctx, config) {
      const payload = isRecord(ctx.event.payload) ? ctx.event.payload : {};
      const tick = typeof payload.tick === "number" ? payload.tick : 0;
      const everyTicks = readNumber(config.args, "everyTicks") ?? 60;
      return everyTicks > 0 && tick % everyTicks === 0;
    }
  };
}

function createInputActionCondition(): TcaConditionDefinition {
  return {
    type: "sandbox.input_action",
    description: "Checks action id and phase on an input.action event payload.",
    evaluate(ctx, config) {
      const payload = isRecord(ctx.event.payload) ? ctx.event.payload : {};
      return (
        matchesStringOrList(payload.actionId, config.args, "actionId", "actionIds") &&
        matchesString(payload.phase, config.args, "phase")
      );
    }
  };
}

function createEntityCountCondition(): TcaConditionDefinition {
  return {
    type: "sandbox.entity_count",
    description: "Checks current world entity count.",
    evaluate(ctx, config) {
      const count = ctx.game?.world.count() ?? 0;
      const min = readNumber(config.args, "min") ?? Number.NEGATIVE_INFINITY;
      const max = readNumber(config.args, "max") ?? Number.POSITIVE_INFINITY;
      return count >= min && count <= max;
    }
  };
}

function createDataTagCondition(): TcaConditionDefinition {
  return {
    type: "sandbox.data_tag_exists",
    description: "Checks whether data registry contains at least one document with a tag.",
    evaluate(ctx, config) {
      const type = readString(config.args, "type");
      const tag = readString(config.args, "tag");
      if (!type || !tag || !ctx.dataRegistry?.hasType(type)) {
        return false;
      }

      return ctx.dataRegistry.list(type).some((document) => document.tags.includes(tag));
    }
  };
}

function createSandboxLogAction(): TcaActionDefinition {
  return {
    type: "sandbox.log",
    description: "Emits a sandbox-visible TCA log event.",
    execute(ctx, config) {
      ctx.eventBus.emit(
        "sandbox.tca_log",
        {
          ruleId: ctx.rule.id,
          message: readString(config.args, "message") ?? "TCA rule executed",
          eventType: ctx.event.type
        },
        "sandbox.tca"
      );
    }
  };
}

function createSandboxDataSummaryAction(): TcaActionDefinition {
  return {
    type: "sandbox.data_summary",
    description: "Emits a compact summary of a data type.",
    execute(ctx, config) {
      const type = readString(config.args, "type");
      if (!type || !ctx.dataRegistry?.hasType(type)) {
        return;
      }

      const documents = ctx.dataRegistry.list(type);
      ctx.eventBus.emit(
        "sandbox.tca_data_summary",
        {
          ruleId: ctx.rule.id,
          type,
          count: documents.length,
          ids: documents.slice(0, 4).map((document) => document.id)
        },
        "sandbox.tca"
      );
    }
  };
}

function matchesString(
  actual: unknown,
  args: Record<string, unknown> | undefined,
  key: string
): boolean {
  const expected = readString(args, key);
  return expected === undefined || actual === expected;
}

function matchesStringOrList(
  actual: unknown,
  args: Record<string, unknown> | undefined,
  stringKey: string,
  listKey: string
): boolean {
  const expected = readString(args, stringKey);
  if (expected !== undefined) {
    return actual === expected;
  }

  const expectedList = readStringArray(args, listKey);
  return (
    expectedList === undefined || (typeof actual === "string" && expectedList.includes(actual))
  );
}

function readString(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = args?.[key];
  return typeof value === "string" ? value : undefined;
}

function readStringArray(
  args: Record<string, unknown> | undefined,
  key: string
): string[] | undefined {
  const value = args?.[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function readNumber(args: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = args?.[key];
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
