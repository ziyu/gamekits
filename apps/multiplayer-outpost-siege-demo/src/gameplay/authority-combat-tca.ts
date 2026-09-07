import type { GameEvent } from "@gamekits/event-bus";
import type { GasHandle, GasOperationContext } from "@gamekits/gas";
import type { TcaDefinitionSet, TcaHandlerContext } from "@gamekits/tca";

const RECOVERY_EFFECT_ID = "effect.outpost.combat_recovery";

export type CreateOutpostCombatTcaDefinitionsOptions = {
  gas: GasHandle;
  actorKind(actorId: string): string | undefined;
};

export function createOutpostCombatTcaDefinitions(
  options: CreateOutpostCombatTcaDefinitionsOptions
): TcaDefinitionSet {
  return {
    conditions: [
      {
        type: "outpost.attribute.transition",
        evaluate(ctx, config) {
          const payload = eventPayload(ctx.event);
          if (!payload) {
            return false;
          }
          const attribute = readStringArg(config.args, "attribute");
          const to = readNumberArg(config.args, "to");
          const previousAbove = readNumberArg(config.args, "previousAbove");
          return (
            payload.attribute === attribute &&
            payload.next === to &&
            (previousAbove === undefined ||
              (typeof payload.previous === "number" && payload.previous > previousAbove))
          );
        }
      },
      {
        type: "outpost.attribute.threshold_crossed",
        evaluate(ctx, config) {
          const payload = eventPayload(ctx.event);
          if (!payload) {
            return false;
          }
          const attribute = readStringArg(config.args, "attribute");
          const threshold = readNumberArg(config.args, "belowOrEqual");
          return (
            threshold !== undefined &&
            payload.attribute === attribute &&
            typeof payload.previous === "number" &&
            typeof payload.next === "number" &&
            payload.previous > threshold &&
            payload.next <= threshold
          );
        }
      },
      {
        type: "outpost.actor.kind",
        evaluate(ctx, config) {
          const actorId = readPayloadString(ctx.event, "actorId");
          const kind = readStringArg(config.args, "kind");
          return actorId !== undefined && options.actorKind(actorId) === kind;
        }
      },
      {
        type: "outpost.actor.definition",
        evaluate(ctx, config) {
          const actorId = readPayloadString(ctx.event, "actorId");
          const definitionId = readStringArg(config.args, "definitionId");
          return (
            actorId !== undefined &&
            definitionId !== undefined &&
            options.gas.hasActor(actorId) &&
            options.gas.getActor(actorId).actor.definitionId === definitionId
          );
        }
      }
    ],
    actions: [
      {
        type: "outpost.combat.emit_fact",
        execute(ctx, config) {
          const eventType = readStringArg(config.args, "eventType");
          if (!eventType) {
            throw new Error("outpost.combat.emit_fact requires eventType");
          }
          ctx.eventBus.emit(eventType, eventPayload(ctx.event) ?? {}, "outpost.tca.combat", {
            correlationId: ctx.correlationId,
            parentId: ctx.traceId
          });
        }
      },
      {
        type: "outpost.combat.grant_kill_rewards",
        execute(ctx, config) {
          const sourceActorId = readPayloadString(ctx.event, "source");
          if (!sourceActorId || !options.gas.hasActor(sourceActorId)) {
            return;
          }
          const resource = readNumberArg(config.args, "resource") ?? 0;
          const context = tcaOperationContext(ctx);
          options.gas.modifyAttribute(
            sourceActorId,
            { attribute: "shared-resource", operation: "add", value: resource },
            "outpost.kill-reward",
            context
          );
          options.gas.applyEffect({
            effectId: RECOVERY_EFFECT_ID,
            sourceActorId,
            targetActorId: sourceActorId,
            ...context
          });
        }
      },
      {
        type: "outpost.combat.add_tag",
        execute(ctx, config) {
          const actorId = readPayloadString(ctx.event, "actorId");
          const tag = readStringArg(config.args, "tag");
          if (actorId && tag && options.gas.hasActor(actorId)) {
            options.gas.addTag(actorId, tag, ctx.rule.id, tcaOperationContext(ctx));
          }
        }
      }
    ]
  };
}

export function readPayloadString(event: GameEvent, key: string): string | undefined {
  const value = eventPayload(event)?.[key];
  return typeof value === "string" ? value : undefined;
}

function tcaOperationContext(ctx: TcaHandlerContext): GasOperationContext {
  return {
    ...(ctx.correlationId === undefined ? {} : { correlationId: ctx.correlationId }),
    parentId: ctx.traceId
  };
}

function eventPayload(event: GameEvent): Record<string, unknown> | undefined {
  return typeof event.payload === "object" &&
    event.payload !== null &&
    !Array.isArray(event.payload)
    ? (event.payload as Record<string, unknown>)
    : undefined;
}

function readStringArg(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = args?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumberArg(args: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = args?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
