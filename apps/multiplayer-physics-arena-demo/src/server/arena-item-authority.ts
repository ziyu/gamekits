import type {
  PhysicsMaterialDefinition,
  PhysicsPredictionIsland,
  PhysicsPredictionIslandCommand,
  PhysicsPredictionIslandMemberDefinition,
  PhysicsPredictionIslandMemberState,
  PhysicsVector
} from "@gamekits/physics-core";

import type { CompiledArenaStage } from "../content/registry";
import type { ArenaItemAction } from "../items/item-action";
import {
  createArenaItemAuthorityRuntime,
  type ArenaItemAuthorityDiagnostics,
  type ArenaItemAuthorityInstance
} from "../items/item-authority-runtime";
import {
  createArenaItemCarryContributor,
  createArenaItemCarryPredictionCommand
} from "../items/item-carry-contributor";
import {
  compileArenaItemCatalog,
  type ArenaCompiledItemDefinition
} from "../items/item-definition";
import {
  commitArenaItemClaimBatch,
  selectArenaItemTarget,
  type ArenaItemClaimRequest
} from "../items/item-interaction";
import {
  arenaItemPhysicsMemberId,
  createArenaItemPhysicsMaterial,
  createArenaItemPhysicsMember,
  planArenaItemPickup,
  planArenaItemRelease
} from "../items/item-physics";
import type { ArenaParticipantRegistry } from "../match/participant-registry";
import type { ArenaGeneration } from "../shared/arena-identity";
import type { ArenaActorControlFrame } from "../shared/config";
import type { ArenaPublicItemAction, ArenaPublicItemState } from "../shared/protocol";

export type ArenaItemAuthorityCoordinatorDiagnostics = {
  runtime: ArenaItemAuthorityDiagnostics;
  pendingActions: number;
  publicActions: number;
  pendingExecutions: number;
  disposed: boolean;
};

export type ArenaCommittedItemCombatAction = {
  commandId: string;
  executionId: string;
  itemId: string;
  itemGeneration: number;
  definitionId: string;
  sourceParticipantId: string;
  tick: number;
  charge: number;
  aim: PhysicsVector;
  actionMode: ArenaCompiledItemDefinition["actionMode"];
  areaRadius: number;
};

export type ArenaActiveItemCombatProfile = {
  executionId: string;
  itemId: string;
  itemGeneration: number;
  definitionId: string;
  sourceParticipantId: string;
  actionMode: ArenaCompiledItemDefinition["actionMode"];
  areaRadius: number;
  charge: number;
  aim: PhysicsVector;
};

export type ArenaItemAuthorityCoordinator = {
  initialMembers(): PhysicsPredictionIslandMemberDefinition[];
  materialDefinitions(): PhysicsMaterialDefinition[];
  combatDefinitions(): ArenaCompiledItemDefinition[];
  auxiliaryContributor: ReturnType<typeof createArenaItemCarryContributor>;
  hasAction(commandId: string): boolean;
  pendingActionCount(): number;
  queueAction(participantId: string, action: ArenaItemAction): void;
  installStage(input: {
    stageIndex: number;
    stageInstanceId: string;
    generation: ArenaGeneration;
    tick: number;
  }): void;
  advancePhysics(input: {
    authorityTick: number;
    targetTick: number;
    island: PhysicsPredictionIsland;
    controlsByMemberId: ReadonlyMap<string, ArenaActorControlFrame>;
    nextSequence(): number;
    commands: PhysicsPredictionIslandCommand[];
  }): void;
  queueCarryModifier(input: {
    memberId: string;
    control: ArenaActorControlFrame;
    tick: number;
    nextSequence(): number;
    commands: PhysicsPredictionIslandCommand[];
  }): void;
  combatProfileForMember(memberId: string): ArenaActiveItemCombatProfile | undefined;
  drainCommittedCombatActions(): ArenaCommittedItemCombatAction[];
  publicItems(members: readonly PhysicsPredictionIslandMemberState[]): ArenaPublicItemState[];
  publicActions(): ArenaPublicItemAction[];
  diagnostics(): ArenaItemAuthorityCoordinatorDiagnostics;
  dispose(): void;
};

type PendingArenaItemAction = {
  participantId: string;
  action: ArenaItemAction;
};

type PendingArenaItemExecution = {
  commandId: string;
  participantId: string;
  itemId: string;
  executionId: string;
  aim: PhysicsVector;
  charge: number;
};

const MAX_PUBLIC_ITEM_ACTIONS = 64;
const ITEM_PICKUP_RANGE = 2.8;

export function createArenaItemAuthorityCoordinator(options: {
  stages: readonly Readonly<CompiledArenaStage>[];
  participants: ArenaParticipantRegistry;
  initialStageInstanceId: string;
  initialStageIndex?: number | undefined;
  initialGeneration: ArenaGeneration;
  initialTick: number;
}): ArenaItemAuthorityCoordinator {
  const catalog = compileArenaItemCatalog(options.stages);
  const definitionsById = new Map(
    catalog.definitions.map((definition) => [definition.id, definition])
  );
  const runtime = createArenaItemAuthorityRuntime({
    definitions: catalog.definitions,
    instanceCapacity: 32,
    commandCapacity: 256,
    traceCapacity: 256
  });
  const auxiliaryContributor = createArenaItemCarryContributor();
  const itemActionResults = new Map<string, ArenaPublicItemAction>();
  const pendingItemActions: PendingArenaItemAction[] = [];
  const pendingItemActionIds = new Set<string>();
  const pendingItemExecutions = new Map<string, PendingArenaItemExecution>();
  const activeCombatProfilesByMemberId = new Map<string, ArenaActiveItemCombatProfile>();
  const committedCombatActions: ArenaCommittedItemCombatAction[] = [];
  const initialItems = runtime.installStage({
    stageInstanceId: options.initialStageInstanceId,
    generation: options.initialGeneration,
    manifest: catalog.manifests[options.initialStageIndex ?? 0]!,
    tick: options.initialTick
  });
  let stageItemsNeedReset = false;
  let disposed = false;

  return {
    initialMembers() {
      assertActive();
      return initialItems.map((item) =>
        createArenaItemPhysicsMember({
          definition: definitionsById.get(item.definitionId)!,
          item,
          position: item.spawnPosition
        })
      );
    },
    materialDefinitions() {
      assertActive();
      return catalog.definitions.map(createArenaItemPhysicsMaterial);
    },
    combatDefinitions() {
      assertActive();
      return catalog.definitions.map((definition) => structuredClone(definition));
    },
    auxiliaryContributor,
    hasAction(commandId) {
      assertActive();
      return itemActionResults.has(commandId) || pendingItemActionIds.has(commandId);
    },
    pendingActionCount() {
      assertActive();
      return pendingItemActions.length;
    },
    queueAction(participantId, action) {
      assertActive();
      if (pendingItemActionIds.has(action.commandId)) return;
      pendingItemActions.push({ participantId, action: structuredClone(action) });
      pendingItemActionIds.add(action.commandId);
    },
    installStage(input) {
      assertActive();
      runtime.installStage({
        stageInstanceId: input.stageInstanceId,
        generation: input.generation,
        manifest: catalog.manifests[input.stageIndex]!,
        tick: input.tick
      });
      pendingItemActions.length = 0;
      pendingItemActionIds.clear();
      pendingItemExecutions.clear();
      activeCombatProfilesByMemberId.clear();
      committedCombatActions.length = 0;
      itemActionResults.clear();
      stageItemsNeedReset = true;
    },
    advancePhysics(input) {
      assertActive();
      const scheduledSpawnMemberIds = new Set<string>();
      const queueSpawn = (member: PhysicsPredictionIslandMemberDefinition) => {
        if (input.island.body(member.id) !== undefined || scheduledSpawnMemberIds.has(member.id)) {
          return;
        }
        input.commands.push({
          type: "spawn",
          tick: input.targetTick,
          sequence: input.nextSequence(),
          member
        });
        scheduledSpawnMemberIds.add(member.id);
      };
      const queueDespawn = (memberId: string) => {
        input.commands.push({
          type: "despawn",
          tick: input.targetTick,
          sequence: input.nextSequence(),
          memberId
        });
      };
      const physics = {
        pickup(item: ArenaItemAuthorityInstance) {
          input.commands.push(
            planArenaItemPickup({
              item,
              tick: input.targetTick,
              sequence: input.nextSequence()
            })
          );
        },
        release(
          item: ArenaItemAuthorityInstance,
          participantId: string,
          aim: PhysicsVector,
          charge: number,
          mode: "drop" | "throw"
        ) {
          const participant = options.participants.participant(participantId);
          const ownerBody =
            participant?.actorMemberId === undefined
              ? undefined
              : input.island.body(participant.actorMemberId);
          const position = ownerBody?.position ?? item.spawnPosition;
          input.commands.push(
            planArenaItemRelease({
              definition: definitionsById.get(item.definitionId)!,
              item,
              position: {
                x: position.x + aim.x * 0.9,
                y: position.y + 0.65,
                z: (position.z ?? 0) + (aim.z ?? 0) * 0.9
              },
              aim,
              inheritedVelocity: ownerBody?.linearVelocity ?? { x: 0, y: 0, z: 0 },
              charge,
              tick: input.targetTick,
              sequence: input.nextSequence(),
              mode
            })
          );
          scheduledSpawnMemberIds.add(arenaItemPhysicsMemberId(item));
        },
        despawn: queueDespawn,
        spawn(item: ArenaItemAuthorityInstance) {
          queueSpawn(
            createArenaItemPhysicsMember({
              definition: definitionsById.get(item.definitionId)!,
              item,
              position: item.spawnPosition
            })
          );
        }
      };

      if (stageItemsNeedReset) {
        for (const member of input.island.state().members) {
          if (typeof member.body.userData?.itemId === "string") queueDespawn(member.id);
        }
        for (const item of runtime.list()) {
          if (item.state === "world") physics.spawn(item);
        }
        stageItemsNeedReset = false;
      }
      processPendingItemActions(input, physics);
      commitReadyItemExecutions(input, physics);
      expireAndRespawnItems(input, physics);
    },
    queueCarryModifier(input) {
      assertActive();
      const participant = options.participants.byActorMemberId(input.memberId);
      if (participant === undefined) return;
      const carried = runtime
        .list()
        .find(
          (item) =>
            item.ownerParticipantId === participant.id &&
            (item.state === "carried" || item.state === "windup")
        );
      if (carried === undefined) return;
      const definition = definitionsById.get(carried.definitionId)!;
      input.commands.push({
        ...createArenaItemCarryPredictionCommand({
          memberId: input.memberId,
          speedMultiplier: definition.carrySpeedMultiplier,
          jumpMultiplier: definition.carryJumpMultiplier,
          jumpPressed: input.control.jump
        }),
        tick: input.tick,
        sequence: input.nextSequence()
      });
    },
    combatProfileForMember(memberId) {
      assertActive();
      const profile = activeCombatProfilesByMemberId.get(memberId);
      return profile === undefined ? undefined : structuredClone(profile);
    },
    drainCommittedCombatActions() {
      assertActive();
      return committedCombatActions.splice(0).map((action) => structuredClone(action));
    },
    publicItems(members) {
      assertActive();
      const memberIds = new Set(members.map((member) => member.id));
      return runtime.list().map((item) => {
        const bodyMemberId = arenaItemPhysicsMemberId(item);
        return {
          id: item.id,
          definitionId: item.definitionId,
          instanceGeneration: item.instanceGeneration,
          state: item.state,
          ...(item.ownerParticipantId === undefined
            ? {}
            : { ownerParticipantId: item.ownerParticipantId }),
          ...(item.sourceParticipantId === undefined
            ? {}
            : { sourceParticipantId: item.sourceParticipantId }),
          ...(item.executionId === undefined ? {} : { executionId: item.executionId }),
          stateChangedAtTick: item.stateChangedAtTick,
          ...(item.deadlineTick === undefined ? {} : { deadlineTick: item.deadlineTick }),
          revision: item.revision,
          ...(memberIds.has(bodyMemberId) ? { bodyMemberId } : {})
        };
      });
    },
    publicActions() {
      assertActive();
      return [...itemActionResults.values()].map((action) => structuredClone(action));
    },
    diagnostics() {
      return {
        runtime: runtime.diagnostics(),
        pendingActions: pendingItemActions.length,
        publicActions: itemActionResults.size,
        pendingExecutions: pendingItemExecutions.size,
        disposed
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      runtime.dispose();
      pendingItemActions.length = 0;
      pendingItemActionIds.clear();
      pendingItemExecutions.clear();
      activeCombatProfilesByMemberId.clear();
      committedCombatActions.length = 0;
      itemActionResults.clear();
    }
  };

  function processPendingItemActions(
    input: Parameters<ArenaItemAuthorityCoordinator["advancePhysics"]>[0],
    physics: ItemPhysicsPlan
  ): void {
    const actions = pendingItemActions
      .splice(0)
      .sort(
        (left, right) =>
          left.action.inputSequence - right.action.inputSequence ||
          left.participantId.localeCompare(right.participantId) ||
          left.action.commandId.localeCompare(right.action.commandId)
      );
    pendingItemActionIds.clear();
    const claims: ArenaItemClaimRequest[] = [];
    const claimActions = new Map<string, PendingArenaItemAction>();
    for (const entry of actions.filter((candidate) => candidate.action.type === "interact")) {
      const target = selectItemTarget(entry.participantId, entry.action, input);
      if (target === undefined) {
        rememberItemAction(entry, "rejected", "item-target-missing", input.authorityTick);
        continue;
      }
      claims.push({
        id: entry.action.commandId,
        itemId: target.itemId,
        itemGeneration: target.itemGeneration,
        participantId: entry.participantId,
        tick: input.authorityTick,
        sequence: entry.action.inputSequence,
        distance: target.distance
      });
      claimActions.set(entry.action.commandId, entry);
    }
    if (claims.length > 0) {
      const committed = commitArenaItemClaimBatch({
        runtime,
        requests: claims,
        currentGenerationByItemId: Object.fromEntries(
          runtime.list().map((item) => [item.id, item.instanceGeneration])
        )
      });
      for (const decision of committed.decisions) {
        const entry = claimActions.get(decision.requestId)!;
        const item = runtime.instance(decision.itemId);
        const accepted =
          decision.status === "winner" &&
          committed.authorityResults.some(
            (result) =>
              result.commandId === `${decision.requestId}:resolve` && result.status === "applied"
          );
        if (accepted && item !== undefined) physics.pickup(item);
        rememberItemAction(
          entry,
          accepted ? "confirmed" : "rejected",
          accepted ? "item-carried" : decision.code,
          input.authorityTick,
          item
        );
      }
    }
    for (const entry of actions.filter((candidate) => candidate.action.type !== "interact")) {
      processOwnedItemAction(entry, input, physics);
    }
  }

  function processOwnedItemAction(
    entry: PendingArenaItemAction,
    input: Parameters<ArenaItemAuthorityCoordinator["advancePhysics"]>[0],
    physics: ItemPhysicsPlan
  ): void {
    const owned = runtime
      .list()
      .find(
        (item) =>
          item.ownerParticipantId === entry.participantId &&
          (item.state === "carried" || item.state === "windup")
      );
    if (owned === undefined) {
      rememberItemAction(entry, "rejected", "carried-item-missing", input.authorityTick);
      return;
    }
    const aim = normalizeActionAim(entry.action, entry.participantId, input.controlsByMemberId);
    if (entry.action.type === "drop") {
      const result = runtime.dispatch({
        type: "drop",
        id: entry.action.commandId,
        itemId: owned.id,
        itemGeneration: owned.instanceGeneration,
        participantId: entry.participantId,
        tick: input.authorityTick
      });
      if (result.status === "applied" && result.item !== undefined) {
        physics.release(result.item, entry.participantId, aim, 0, "drop");
      }
      rememberItemAction(
        entry,
        result.status === "applied" ? "confirmed" : "rejected",
        result.code,
        input.authorityTick,
        result.item ?? owned
      );
      return;
    }
    if (owned.state !== "carried") {
      rememberItemAction(entry, "rejected", "item-action-in-progress", input.authorityTick, owned);
      return;
    }
    const executionId = `${entry.action.commandId}:execution`;
    const result = runtime.dispatch({
      type: "begin-action",
      id: entry.action.commandId,
      itemId: owned.id,
      itemGeneration: owned.instanceGeneration,
      participantId: entry.participantId,
      executionId,
      tick: input.authorityTick
    });
    if (result.status === "applied" && result.item !== undefined) {
      pendingItemExecutions.set(executionId, {
        commandId: entry.action.commandId,
        participantId: entry.participantId,
        itemId: owned.id,
        executionId,
        aim,
        charge: entry.action.charge
      });
    }
    rememberItemAction(
      entry,
      result.status === "applied" ? "windup" : "rejected",
      result.code,
      input.authorityTick,
      result.item ?? owned,
      executionId
    );
  }

  function commitReadyItemExecutions(
    input: Parameters<ArenaItemAuthorityCoordinator["advancePhysics"]>[0],
    physics: ItemPhysicsPlan
  ): void {
    for (const execution of [...pendingItemExecutions.values()].sort((left, right) =>
      left.executionId.localeCompare(right.executionId)
    )) {
      const item = runtime.instance(execution.itemId);
      if (
        item === undefined ||
        item.state !== "windup" ||
        item.executionId !== execution.executionId
      ) {
        pendingItemExecutions.delete(execution.executionId);
        updateItemActionResult(
          execution.commandId,
          "rejected",
          "execution-stale",
          input.authorityTick
        );
        continue;
      }
      if (input.authorityTick < (item.deadlineTick ?? input.authorityTick + 1)) continue;
      const result = runtime.dispatch({
        type: "commit-action",
        id: `${execution.commandId}:commit`,
        executionId: execution.executionId,
        tick: input.authorityTick
      });
      pendingItemExecutions.delete(execution.executionId);
      if (result.status === "applied" && result.item !== undefined) {
        const definition = definitionsById.get(result.item.definitionId)!;
        const combatAction: ArenaCommittedItemCombatAction = {
          commandId: execution.commandId,
          executionId: execution.executionId,
          itemId: result.item.id,
          itemGeneration: result.item.instanceGeneration,
          definitionId: result.item.definitionId,
          sourceParticipantId: execution.participantId,
          tick: input.authorityTick,
          charge: execution.charge,
          aim: structuredClone(execution.aim),
          actionMode: definition.actionMode,
          areaRadius: definition.areaRadius
        };
        committedCombatActions.push(combatAction);
        if (definition.actionMode !== "melee") {
          physics.release(
            result.item,
            execution.participantId,
            execution.aim,
            execution.charge,
            "throw"
          );
          activeCombatProfilesByMemberId.set(arenaItemPhysicsMemberId(result.item), {
            executionId: execution.executionId,
            itemId: result.item.id,
            itemGeneration: result.item.instanceGeneration,
            definitionId: result.item.definitionId,
            sourceParticipantId: execution.participantId,
            actionMode: definition.actionMode,
            areaRadius: definition.areaRadius,
            charge: execution.charge,
            aim: structuredClone(execution.aim)
          });
        }
      }
      updateItemActionResult(
        execution.commandId,
        result.status === "applied" ? "confirmed" : "rejected",
        result.code,
        input.authorityTick,
        result.item
      );
    }
  }

  function expireAndRespawnItems(
    input: Parameters<ArenaItemAuthorityCoordinator["advancePhysics"]>[0],
    physics: ItemPhysicsPlan
  ): void {
    for (const item of runtime.list()) {
      if (
        item.state !== "released" &&
        item.state !== "triggered" &&
        item.state !== "melee-active"
      ) {
        continue;
      }
      const definition = definitionsById.get(item.definitionId)!;
      const body = input.island.body(arenaItemPhysicsMemberId(item));
      if (
        input.authorityTick < item.stateChangedAtTick + definition.activeTicks &&
        !(body !== undefined && body.position.y < -4)
      ) {
        continue;
      }
      const spent = runtime.dispatch({
        type: "spend",
        id: `${item.id}:g${item.instanceGeneration}:spend`,
        itemId: item.id,
        itemGeneration: item.instanceGeneration,
        tick: input.authorityTick
      });
      if (spent.status === "applied" && body !== undefined) {
        activeCombatProfilesByMemberId.delete(arenaItemPhysicsMemberId(item));
        physics.despawn(arenaItemPhysicsMemberId(item));
      }
    }
    const before = new Map(runtime.list().map((item) => [item.id, item]));
    for (const item of runtime.advance(input.authorityTick)) {
      if (item.state === "world" && before.get(item.id)?.state !== "world") physics.spawn(item);
    }
  }

  function selectItemTarget(
    participantId: string,
    action: ArenaItemAction,
    input: Parameters<ArenaItemAuthorityCoordinator["advancePhysics"]>[0]
  ) {
    const participant = options.participants.participant(participantId);
    const actor =
      participant?.actorMemberId === undefined
        ? undefined
        : input.island.body(participant.actorMemberId);
    if (actor === undefined) return undefined;
    const aim = normalizeActionAim(action, participantId, input.controlsByMemberId);
    return selectArenaItemTarget(
      runtime.list().map((item) => {
        const body = input.island.body(arenaItemPhysicsMemberId(item));
        const dx = (body?.position.x ?? item.spawnPosition.x) - actor.position.x;
        const dz = (body?.position.z ?? item.spawnPosition.z ?? 0) - (actor.position.z ?? 0);
        const distance = Math.hypot(dx, dz);
        return {
          itemId: item.id,
          itemGeneration: item.instanceGeneration,
          distance,
          viewAlignment:
            distance <= 0.0001
              ? 1
              : Math.max(-1, Math.min(1, (dx * aim.x + dz * (aim.z ?? 0)) / distance)),
          priority: definitionsById.get(item.definitionId)?.baseImpulse ?? 0,
          visible: body !== undefined,
          inRange: distance <= ITEM_PICKUP_RANGE,
          state: item.state === "world" ? ("world" as const) : ("unavailable" as const)
        };
      })
    );
  }

  function normalizeActionAim(
    action: ArenaItemAction,
    participantId: string,
    controlsByMemberId: ReadonlyMap<string, ArenaActorControlFrame>
  ): PhysicsVector {
    let x = action.aimX;
    let z = action.aimZ;
    if (Math.hypot(x, z) <= 0.0001) {
      const actorMemberId = options.participants.participant(participantId)?.actorMemberId;
      const control =
        actorMemberId === undefined ? undefined : controlsByMemberId.get(actorMemberId);
      x = control?.moveX ?? 0;
      z = control?.moveZ ?? -1;
    }
    let length = Math.hypot(x, z);
    if (length <= 0.0001) {
      x = 0;
      z = -1;
      length = 1;
    }
    return { x: x / length, y: action.type === "drop" ? 0.05 : 0.12, z: z / length };
  }

  function rememberItemAction(
    entry: PendingArenaItemAction,
    status: ArenaPublicItemAction["status"],
    code: string,
    tick: number,
    item?: ArenaItemAuthorityInstance,
    executionId?: string
  ): void {
    itemActionResults.set(entry.action.commandId, {
      id: entry.action.commandId,
      participantId: entry.participantId,
      type: entry.action.type,
      status,
      code,
      tick,
      ...(item === undefined ? {} : { itemId: item.id, itemGeneration: item.instanceGeneration }),
      ...(executionId === undefined ? {} : { executionId })
    });
    while (itemActionResults.size > MAX_PUBLIC_ITEM_ACTIONS) {
      const oldest = itemActionResults.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      itemActionResults.delete(oldest);
    }
  }

  function updateItemActionResult(
    commandId: string,
    status: ArenaPublicItemAction["status"],
    code: string,
    tick: number,
    item?: ArenaItemAuthorityInstance
  ): void {
    const current = itemActionResults.get(commandId);
    if (current === undefined) return;
    itemActionResults.set(commandId, {
      ...current,
      status,
      code,
      tick,
      ...(item === undefined ? {} : { itemId: item.id, itemGeneration: item.instanceGeneration })
    });
  }

  function assertActive(): void {
    if (disposed) throw new Error("Arena item authority coordinator is disposed");
  }
}

type ItemPhysicsPlan = {
  pickup(item: ArenaItemAuthorityInstance): void;
  release(
    item: ArenaItemAuthorityInstance,
    participantId: string,
    aim: PhysicsVector,
    charge: number,
    mode: "drop" | "throw"
  ): void;
  despawn(memberId: string): void;
  spawn(item: ArenaItemAuthorityInstance): void;
};
