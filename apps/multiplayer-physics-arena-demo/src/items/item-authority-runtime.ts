import type { PhysicsVector } from "@gamekits/physics-core";

import {
  arenaGenerationKey,
  arenaItemInstanceId,
  type ArenaGeneration
} from "../shared/arena-identity";
import type {
  ArenaCompiledItemDefinition,
  ArenaCompiledItemSpawn,
  ArenaStageItemManifest
} from "./item-definition";

export type ArenaItemAuthorityState =
  | "world"
  | "pickup-pending"
  | "carried"
  | "windup"
  | "released"
  | "melee-active"
  | "triggered"
  | "spent"
  | "cooldown"
  | "respawning";

export type ArenaItemAuthorityInstance = {
  id: string;
  definitionId: string;
  spawnId: string;
  spawnPosition: PhysicsVector;
  stageInstanceId: string;
  stageGeneration: string;
  instanceGeneration: number;
  state: ArenaItemAuthorityState;
  ownerParticipantId?: string | undefined;
  sourceParticipantId?: string | undefined;
  pendingClaimId?: string | undefined;
  executionId?: string | undefined;
  stateChangedAtTick: number;
  deadlineTick?: number | undefined;
  revision: number;
};

export type ArenaItemAuthorityCommand =
  | {
      type: "claim";
      id: string;
      itemId: string;
      itemGeneration: number;
      participantId: string;
      tick: number;
    }
  | { type: "resolve-claim"; id: string; claimId: string; accepted: boolean; tick: number }
  | {
      type: "begin-action";
      id: string;
      itemId: string;
      itemGeneration: number;
      participantId: string;
      executionId: string;
      tick: number;
    }
  | { type: "commit-action"; id: string; executionId: string; tick: number }
  | {
      type: "drop";
      id: string;
      itemId: string;
      itemGeneration: number;
      participantId: string;
      tick: number;
    }
  | {
      type: "spend";
      id: string;
      itemId: string;
      itemGeneration: number;
      tick: number;
    };

export type ArenaItemAuthorityCommandResult = {
  commandId: string;
  status: "applied" | "duplicate" | "rejected";
  code: string;
  item?: ArenaItemAuthorityInstance | undefined;
};

export type ArenaItemAuthorityTraceEntry = {
  sequence: number;
  itemId: string;
  from: ArenaItemAuthorityState | "uninstalled";
  to: ArenaItemAuthorityState;
  reason: string;
  tick: number;
  revision: number;
};

export type ArenaItemAuthorityDiagnostics = {
  instances: number;
  commands: number;
  appliedCommands: number;
  duplicateCommands: number;
  rejectedCommands: number;
  commandResultDrops: number;
  transitions: number;
  resets: number;
  traceEntries: number;
  traceDrops: number;
  disposed: boolean;
};

export type ArenaItemAuthorityRuntime = {
  installStage(input: {
    stageInstanceId: string;
    generation: ArenaGeneration;
    manifest: ArenaStageItemManifest;
    tick: number;
  }): ArenaItemAuthorityInstance[];
  dispatch(command: ArenaItemAuthorityCommand): ArenaItemAuthorityCommandResult;
  advance(tick: number): ArenaItemAuthorityInstance[];
  instance(itemId: string): ArenaItemAuthorityInstance | undefined;
  list(): ArenaItemAuthorityInstance[];
  trace(): ArenaItemAuthorityTraceEntry[];
  diagnostics(): ArenaItemAuthorityDiagnostics;
  dispose(): void;
};

type StoredCommandResult = {
  signature: string;
  result: ArenaItemAuthorityCommandResult;
};

const DEFAULT_INSTANCE_CAPACITY = 32;
const DEFAULT_COMMAND_CAPACITY = 256;
const DEFAULT_TRACE_CAPACITY = 256;

export function createArenaItemAuthorityRuntime(options: {
  definitions: readonly ArenaCompiledItemDefinition[];
  instanceCapacity?: number | undefined;
  commandCapacity?: number | undefined;
  traceCapacity?: number | undefined;
}): ArenaItemAuthorityRuntime {
  const definitions = new Map(options.definitions.map((definition) => [definition.id, definition]));
  if (definitions.size !== options.definitions.length) {
    throw new Error("Arena item authority requires unique definitions");
  }
  const instanceCapacity = positiveInteger(
    options.instanceCapacity ?? DEFAULT_INSTANCE_CAPACITY,
    "instanceCapacity"
  );
  const commandCapacity = positiveInteger(
    options.commandCapacity ?? DEFAULT_COMMAND_CAPACITY,
    "commandCapacity"
  );
  const traceCapacity = positiveInteger(
    options.traceCapacity ?? DEFAULT_TRACE_CAPACITY,
    "traceCapacity"
  );
  const instances = new Map<string, ArenaItemAuthorityInstance>();
  const results = new Map<string, StoredCommandResult>();
  const traces: ArenaItemAuthorityTraceEntry[] = [];
  let currentTick = 0;
  let traceSequence = 0;
  let appliedCommands = 0;
  let duplicateCommands = 0;
  let rejectedCommands = 0;
  let commandResultDrops = 0;
  let transitions = 0;
  let resets = 0;
  let traceDrops = 0;
  let disposed = false;

  return {
    installStage(input) {
      assertActive();
      if (!validId(input.stageInstanceId) || !validTick(input.tick)) {
        throw new Error("Invalid Arena item stage installation");
      }
      if (input.manifest.spawns.length > instanceCapacity) {
        throw new Error(
          `Arena item instances exceed capacity: ${input.manifest.spawns.length}/${instanceCapacity}`
        );
      }
      const stageDefinitionIds = new Set(
        input.manifest.definitions.map((definition) => definition.id)
      );
      if (
        stageDefinitionIds.size !== input.manifest.definitions.length ||
        new Set(input.manifest.spawns.map((spawn) => spawn.id)).size !==
          input.manifest.spawns.length ||
        input.manifest.definitions.some(
          (definition) =>
            !definitions.has(definition.id) ||
            definitionSignature(definition) !== definitionSignature(definitions.get(definition.id)!)
        ) ||
        input.manifest.spawns.some(
          (spawn) =>
            !stageDefinitionIds.has(spawn.definitionId) ||
            !validId(spawn.id) ||
            !validVector(spawn.position)
        )
      ) {
        throw new Error(`Arena item manifest is incompatible: ${input.manifest.stageId}`);
      }
      currentTick = input.tick;
      instances.clear();
      results.clear();
      traces.length = 0;
      const stageGeneration = arenaGenerationKey(input.generation);
      for (const spawn of orderedSpawns(input.manifest.spawns)) {
        const item = createInstance(
          spawn,
          input.stageInstanceId,
          stageGeneration,
          input.generation,
          input.tick
        );
        instances.set(item.id, item);
        trace(item, "uninstalled", "world", "stage-installed", input.tick);
      }
      resets += 1;
      return orderedInstances().map(cloneInstance);
    },
    dispatch(command) {
      assertActive();
      const signature = commandSignature(command);
      const existing = results.get(command.id);
      if (existing !== undefined) {
        duplicateCommands += 1;
        if (existing.signature !== signature) {
          rejectedCommands += 1;
          return { commandId: command.id, status: "rejected", code: "command-id-conflict" };
        }
        return { ...structuredClone(existing.result), status: "duplicate" };
      }
      let result: ArenaItemAuthorityCommandResult;
      if (!validCommand(command) || command.tick < currentTick) {
        result = rejected(command.id, "invalid-command");
      } else {
        currentTick = command.tick;
        result = applyCommand(command);
      }
      if (result.status === "applied") appliedCommands += 1;
      else rejectedCommands += 1;
      remember(command.id, signature, result);
      return structuredClone(result);
    },
    advance(tick) {
      assertActive();
      if (!validTick(tick) || tick < currentTick) {
        throw new Error("Arena item authority cannot advance backwards");
      }
      currentTick = tick;
      for (const item of orderedInstances()) settleTimers(item, tick);
      return orderedInstances().map(cloneInstance);
    },
    instance(itemId) {
      assertActive();
      const item = instances.get(itemId);
      return item === undefined ? undefined : cloneInstance(item);
    },
    list() {
      assertActive();
      return orderedInstances().map(cloneInstance);
    },
    trace() {
      assertActive();
      return structuredClone(traces);
    },
    diagnostics() {
      return {
        instances: instances.size,
        commands: results.size,
        appliedCommands,
        duplicateCommands,
        rejectedCommands,
        commandResultDrops,
        transitions,
        resets,
        traceEntries: traces.length,
        traceDrops,
        disposed
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      instances.clear();
      results.clear();
      traces.length = 0;
      definitions.clear();
    }
  };

  function applyCommand(command: ArenaItemAuthorityCommand): ArenaItemAuthorityCommandResult {
    if (command.type === "claim") return applyClaim(command);
    if (command.type === "resolve-claim") return applyClaimResolution(command);
    if (command.type === "begin-action") return applyBeginAction(command);
    if (command.type === "commit-action") return applyCommitAction(command);
    if (command.type === "drop") return applyDrop(command);
    return applySpend(command);
  }

  function applyClaim(
    command: Extract<ArenaItemAuthorityCommand, { type: "claim" }>
  ): ArenaItemAuthorityCommandResult {
    const item = instances.get(command.itemId);
    if (item === undefined) return rejected(command.id, "item-missing");
    if (item.instanceGeneration !== command.itemGeneration) {
      return rejected(command.id, "stale-generation", item);
    }
    if (item.state !== "world") return rejected(command.id, "item-not-world", item);
    transition(item, "pickup-pending", "claim-started", command.tick, {
      pendingClaimId: command.id,
      ownerParticipantId: command.participantId
    });
    return applied(command.id, "claim-pending", item);
  }

  function applyClaimResolution(
    command: Extract<ArenaItemAuthorityCommand, { type: "resolve-claim" }>
  ): ArenaItemAuthorityCommandResult {
    const item = orderedInstances().find(
      (candidate) =>
        candidate.state === "pickup-pending" && candidate.pendingClaimId === command.claimId
    );
    if (item === undefined) return rejected(command.id, "claim-missing");
    if (command.accepted) {
      transition(item, "carried", "claim-accepted", command.tick, {
        pendingClaimId: undefined
      });
      return applied(command.id, "item-carried", item);
    }
    transition(item, "world", "claim-rejected", command.tick, {
      pendingClaimId: undefined,
      ownerParticipantId: undefined
    });
    return applied(command.id, "item-released", item);
  }

  function applyBeginAction(
    command: Extract<ArenaItemAuthorityCommand, { type: "begin-action" }>
  ): ArenaItemAuthorityCommandResult {
    const item = instances.get(command.itemId);
    if (item === undefined) return rejected(command.id, "item-missing");
    if (item.instanceGeneration !== command.itemGeneration) {
      return rejected(command.id, "stale-generation", item);
    }
    if (item.state !== "carried" || item.ownerParticipantId !== command.participantId) {
      return rejected(command.id, "owner-state-mismatch", item);
    }
    const definition = definitions.get(item.definitionId)!;
    transition(item, "windup", "action-started", command.tick, {
      executionId: command.executionId,
      deadlineTick: command.tick + definition.windupTicks
    });
    return applied(command.id, "action-windup", item);
  }

  function applyCommitAction(
    command: Extract<ArenaItemAuthorityCommand, { type: "commit-action" }>
  ): ArenaItemAuthorityCommandResult {
    const item = orderedInstances().find(
      (candidate) => candidate.state === "windup" && candidate.executionId === command.executionId
    );
    if (item === undefined) return rejected(command.id, "execution-missing");
    if (command.tick < (item.deadlineTick ?? command.tick)) {
      return rejected(command.id, "windup-incomplete", item);
    }
    const definition = definitions.get(item.definitionId)!;
    const sourceParticipantId = item.ownerParticipantId;
    item.instanceGeneration += 1;
    transition(item, definition.activeState, "action-committed", command.tick, {
      ownerParticipantId: undefined,
      sourceParticipantId,
      deadlineTick: undefined
    });
    return applied(command.id, "action-active", item);
  }

  function applySpend(
    command: Extract<ArenaItemAuthorityCommand, { type: "spend" }>
  ): ArenaItemAuthorityCommandResult {
    const item = instances.get(command.itemId);
    if (item === undefined) return rejected(command.id, "item-missing");
    if (item.instanceGeneration !== command.itemGeneration) {
      return rejected(command.id, "stale-generation", item);
    }
    if (item.state !== "released" && item.state !== "melee-active" && item.state !== "triggered") {
      return rejected(command.id, "item-not-active", item);
    }
    transition(item, "spent", "item-spent", command.tick, {
      executionId: undefined,
      deadlineTick: undefined
    });
    return applied(command.id, "item-spent", item);
  }

  function applyDrop(
    command: Extract<ArenaItemAuthorityCommand, { type: "drop" }>
  ): ArenaItemAuthorityCommandResult {
    const item = instances.get(command.itemId);
    if (item === undefined) return rejected(command.id, "item-missing");
    if (item.instanceGeneration !== command.itemGeneration) {
      return rejected(command.id, "stale-generation", item);
    }
    if (
      (item.state !== "carried" && item.state !== "windup") ||
      item.ownerParticipantId !== command.participantId
    ) {
      return rejected(command.id, "owner-state-mismatch", item);
    }
    item.instanceGeneration += 1;
    transition(item, "world", "item-dropped", command.tick, {
      ownerParticipantId: undefined,
      sourceParticipantId: command.participantId,
      pendingClaimId: undefined,
      executionId: undefined,
      deadlineTick: undefined
    });
    return applied(command.id, "item-dropped", item);
  }

  function settleTimers(item: ArenaItemAuthorityInstance, tick: number): void {
    const definition = definitions.get(item.definitionId)!;
    for (let transitionsRemaining = 3; transitionsRemaining > 0; transitionsRemaining -= 1) {
      if (item.state === "spent") {
        if (definition.respawnMode === "none") break;
        const transitionTick = item.stateChangedAtTick;
        transition(item, "cooldown", "cooldown-started", transitionTick, {
          deadlineTick: transitionTick + definition.cooldownTicks
        });
        continue;
      }
      if (item.state === "cooldown" && tick >= (item.deadlineTick ?? tick + 1)) {
        const transitionTick = item.deadlineTick!;
        transition(item, "respawning", "respawn-started", transitionTick, {
          deadlineTick: transitionTick + definition.respawnTicks,
          sourceParticipantId: undefined
        });
        continue;
      }
      if (item.state === "respawning" && tick >= (item.deadlineTick ?? tick + 1)) {
        const transitionTick = item.deadlineTick!;
        item.instanceGeneration += 1;
        transition(item, "world", "item-respawned", transitionTick, {
          deadlineTick: undefined,
          ownerParticipantId: undefined,
          pendingClaimId: undefined,
          executionId: undefined,
          sourceParticipantId: undefined
        });
        continue;
      }
      break;
    }
  }

  function transition(
    item: ArenaItemAuthorityInstance,
    to: ArenaItemAuthorityState,
    reason: string,
    tick: number,
    patch: Partial<ArenaItemAuthorityInstance> = {}
  ): void {
    const from = item.state;
    Object.assign(item, patch);
    item.state = to;
    item.stateChangedAtTick = tick;
    item.revision += 1;
    trace(item, from, to, reason, tick);
  }

  function trace(
    item: ArenaItemAuthorityInstance,
    from: ArenaItemAuthorityState | "uninstalled",
    to: ArenaItemAuthorityState,
    reason: string,
    tick: number
  ): void {
    traceSequence += 1;
    transitions += 1;
    traces.push({
      sequence: traceSequence,
      itemId: item.id,
      from,
      to,
      reason,
      tick,
      revision: item.revision
    });
    while (traces.length > traceCapacity) {
      traces.shift();
      traceDrops += 1;
    }
  }

  function remember(
    commandId: string,
    signature: string,
    result: ArenaItemAuthorityCommandResult
  ): void {
    results.set(commandId, { signature, result: structuredClone(result) });
    while (results.size > commandCapacity) {
      const oldest = results.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      results.delete(oldest);
      commandResultDrops += 1;
    }
  }

  function orderedInstances(): ArenaItemAuthorityInstance[] {
    return [...instances.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  function assertActive(): void {
    if (disposed) throw new Error("Arena item authority is disposed");
  }
}

function createInstance(
  spawn: ArenaCompiledItemSpawn,
  stageInstanceId: string,
  stageGeneration: string,
  generation: ArenaGeneration,
  tick: number
): ArenaItemAuthorityInstance {
  return {
    id: arenaItemInstanceId(spawn.definitionId, spawn.id, generation, 1),
    definitionId: spawn.definitionId,
    spawnId: spawn.id,
    spawnPosition: structuredClone(spawn.position),
    stageInstanceId,
    stageGeneration,
    instanceGeneration: 1,
    state: "world",
    stateChangedAtTick: tick,
    revision: 1
  };
}

function applied(
  commandId: string,
  code: string,
  item: ArenaItemAuthorityInstance
): ArenaItemAuthorityCommandResult {
  return { commandId, status: "applied", code, item: cloneInstance(item) };
}

function rejected(
  commandId: string,
  code: string,
  item?: ArenaItemAuthorityInstance
): ArenaItemAuthorityCommandResult {
  return {
    commandId,
    status: "rejected",
    code,
    ...(item === undefined ? {} : { item: cloneInstance(item) })
  };
}

function cloneInstance(item: Readonly<ArenaItemAuthorityInstance>): ArenaItemAuthorityInstance {
  return structuredClone(item);
}

function orderedSpawns(spawns: readonly ArenaCompiledItemSpawn[]): ArenaCompiledItemSpawn[] {
  return [...spawns].sort((left, right) => left.id.localeCompare(right.id));
}

function commandSignature(command: ArenaItemAuthorityCommand): string {
  if (command.type === "claim") {
    return [
      command.type,
      command.id,
      command.itemId,
      command.itemGeneration,
      command.participantId,
      command.tick
    ].join("|");
  }
  if (command.type === "resolve-claim") {
    return [command.type, command.id, command.claimId, command.accepted, command.tick].join("|");
  }
  if (command.type === "begin-action") {
    return [
      command.type,
      command.id,
      command.itemId,
      command.itemGeneration,
      command.participantId,
      command.executionId,
      command.tick
    ].join("|");
  }
  if (command.type === "commit-action") {
    return [command.type, command.id, command.executionId, command.tick].join("|");
  }
  if (command.type === "drop") {
    return [
      command.type,
      command.id,
      command.itemId,
      command.itemGeneration,
      command.participantId,
      command.tick
    ].join("|");
  }
  return [command.type, command.id, command.itemId, command.itemGeneration, command.tick].join("|");
}

function definitionSignature(definition: ArenaCompiledItemDefinition): string {
  return [
    definition.id,
    definition.kind,
    shapeSignature(definition.shape),
    definition.mass,
    definition.friction,
    definition.restitution,
    definition.continuousCollisionDetection,
    definition.maxLinearSpeed,
    definition.lifetimeTicks,
    definition.maxBounces,
    definition.carrySocket,
    definition.carrySpeedMultiplier,
    definition.carryJumpMultiplier,
    definition.dropPolicy,
    definition.actionMode,
    definition.windupTicks,
    definition.maxChargeTicks,
    definition.activeTicks,
    definition.cooldownTicks,
    definition.launchSpeed,
    definition.baseImpulse,
    definition.areaRadius,
    definition.impulseMode,
    definition.instabilityDelta,
    definition.staggerMultiplier,
    definition.respawnMode,
    definition.respawnTicks,
    definition.presentationId,
    definition.activeState,
    definition.networkStrategy
  ].join("|");
}

function shapeSignature(shape: ArenaCompiledItemDefinition["shape"]): string {
  return shape.type === "sphere"
    ? `sphere:${shape.radius}`
    : `box:${shape.width}:${shape.height}:${shape.depth}`;
}

function validVector(value: PhysicsVector): boolean {
  return [value.x, value.y, value.z ?? 0].every(
    (component) => typeof component === "number" && Number.isFinite(component)
  );
}

function validCommand(command: ArenaItemAuthorityCommand): boolean {
  if (!validId(command.id) || !validTick(command.tick)) return false;
  if (command.type === "resolve-claim") return validId(command.claimId);
  if (command.type === "commit-action") return validId(command.executionId);
  if (!validId(command.itemId) || !positiveIntegerValue(command.itemGeneration)) return false;
  if (command.type === "spend") return true;
  if (!validId(command.participantId)) return false;
  return command.type !== "begin-action" || validId(command.executionId);
}

function validId(value: string): boolean {
  return value.length > 0 && value.length <= 256;
}

function validTick(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveIntegerValue(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function positiveInteger(value: number, field: string): number {
  if (!positiveIntegerValue(value)) {
    throw new Error(`Arena item authority ${field} must be a positive integer`);
  }
  return value;
}
