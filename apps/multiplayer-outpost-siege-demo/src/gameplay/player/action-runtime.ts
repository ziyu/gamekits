import { defineGameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type { GasHandle } from "@gamekits/gas";

import type {
  OutpostAuthorityCombatCommand,
  OutpostAuthorityCombatCommandResult
} from "../authority-combat-types";
import type { OutpostAuthorityPlayerActionCommand } from "./action-types";
import {
  cancelOutpostAuthorityPlayerReload,
  reconcileOutpostAuthorityPlayerWeapon,
  rejectOutpostAuthorityPlayerReload,
  requestOutpostAuthorityPlayerReload,
  updateOutpostAuthorityPlayerWeapon,
  type OutpostAuthorityPlayerWeapon,
  type OutpostAuthorityPlayerWeaponControl
} from "./weapon-runtime";

export type OutpostAuthorityPlayerActionActor = {
  playerId: string;
  actorId: string;
  input: OutpostAuthorityPlayerWeaponControl;
  weapon: OutpostAuthorityPlayerWeapon;
};

export type CreateOutpostAuthorityPlayerActionModuleOptions = {
  gas: GasHandle;
  players(): Iterable<OutpostAuthorityPlayerActionActor>;
  actions(): readonly OutpostAuthorityPlayerActionCommand[];
  combat: {
    activatePlayerAction(
      command: OutpostAuthorityCombatCommand
    ): OutpostAuthorityCombatCommandResult;
    rejectPlayerAction(
      command: OutpostAuthorityCombatCommand,
      reason: string
    ): OutpostAuthorityCombatCommandResult;
  };
};

export function createOutpostAuthorityPlayerActionModule(
  options: CreateOutpostAuthorityPlayerActionModuleOptions
) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.authority.players.actions",
    install(ctx) {
      ctx.systems.register({
        id: "outpost.authority.players.actions.update",
        update({ delta, elapsed }) {
          const players = new Map(
            Array.from(options.players(), (player) => [player.playerId, player] as const)
          );
          for (const player of players.values()) {
            reconcileOutpostAuthorityPlayerWeapon(player.weapon, options.gas, elapsed);
          }
          for (const command of options.actions()) {
            const player = players.get(command.playerId);
            if (player === undefined) {
              continue;
            }
            handleDiscreteAction(options, player, command, elapsed, delta);
          }
          for (const player of players.values()) {
            if (!playerAvailable(options.gas, player)) {
              continue;
            }
            updateOutpostAuthorityPlayerWeapon({
              playerId: player.playerId,
              actorId: player.actorId,
              elapsed,
              control: player.input,
              gas: options.gas,
              weapon: player.weapon,
              fire: options.combat.activatePlayerAction
            });
          }
        }
      });
    }
  });
}

function handleDiscreteAction(
  options: CreateOutpostAuthorityPlayerActionModuleOptions,
  player: OutpostAuthorityPlayerActionActor,
  command: OutpostAuthorityPlayerActionCommand,
  elapsed: number,
  deltaMs: number
): void {
  const correlationId = command.correlationId ?? command.id;
  if (!playerAvailable(options.gas, player)) {
    if (command.action === "reload") {
      rejectOutpostAuthorityPlayerReload(
        player.weapon,
        elapsed,
        "player-unavailable",
        correlationId
      );
    } else {
      options.combat.rejectPlayerAction(toCombatCommand(command), "player-unavailable");
    }
    return;
  }
  if (command.action === "reload") {
    if (hasActiveFullAction(options.gas, player.actorId)) {
      rejectOutpostAuthorityPlayerReload(
        player.weapon,
        elapsed,
        "full-action-channel-busy",
        correlationId
      );
      return;
    }
    requestOutpostAuthorityPlayerReload({
      actorId: player.actorId,
      elapsed,
      gas: options.gas,
      weapon: player.weapon,
      request: {
        id: command.id,
        correlationId,
        parentId: command.parentId ?? command.id
      }
    });
    return;
  }
  if (command.action === "rifle") {
    if (command.fireSequence === undefined || command.fireHeld === undefined) {
      options.combat.rejectPlayerAction(toCombatCommand(command), "missing-fire-sequence");
      return;
    }
    player.input.aimX = command.aimX;
    player.input.aimY = command.aimY;
    player.input.fireSequence = command.fireSequence;
    player.input.fireHeld = command.fireHeld;
    return;
  }
  if (command.action === "dash") {
    const result = options.combat.activatePlayerAction(toCombatCommand(command, deltaMs));
    if (result.status === "rejected") {
      return;
    }
    cancelOutpostAuthorityPlayerReload({
      gas: options.gas,
      weapon: player.weapon,
      elapsed,
      reason: "interrupted-by-dash",
      correlationId,
      parentId: command.parentId ?? command.id
    });
    cancelPreparingFullActions(options.gas, player.actorId, command);
    return;
  }
  if (player.weapon.phase === "reloading") {
    options.combat.rejectPlayerAction(toCombatCommand(command), "full-action-channel-busy");
    return;
  }
  options.combat.activatePlayerAction(toCombatCommand(command));
}

function playerAvailable(gas: GasHandle, player: OutpostAuthorityPlayerActionActor): boolean {
  return (
    gas.hasActor(player.actorId) &&
    (gas.getActor(player.actorId).attributes.current.health ?? 0) > 0
  );
}

function toCombatCommand(
  command: OutpostAuthorityPlayerActionCommand,
  simulationStepMs?: number
): OutpostAuthorityCombatCommand {
  if (command.action === "reload") {
    throw new Error("Reload must be handled by the Outpost weapon runtime.");
  }
  return {
    id: command.id,
    playerId: command.playerId,
    ability: command.action,
    aimX: command.aimX,
    aimY: command.aimY,
    ...(command.dashSequence === undefined ? {} : { dashSequence: command.dashSequence }),
    ...(simulationStepMs === undefined ? {} : { simulationStepMs }),
    ...(command.correlationId === undefined ? {} : { correlationId: command.correlationId }),
    ...(command.parentId === undefined ? {} : { parentId: command.parentId })
  };
}

function hasActiveFullAction(gas: GasHandle, actorId: string): boolean {
  return gas
    .listAbilityExecutions({ actorId })
    .some((execution) => execution.abilityId === "ability.outpost.shock_field");
}

function cancelPreparingFullActions(
  gas: GasHandle,
  actorId: string,
  command: OutpostAuthorityPlayerActionCommand
): void {
  for (const execution of gas.listAbilityExecutions({ actorId })) {
    if (
      execution.abilityId !== "ability.outpost.shock_field" ||
      (execution.phase !== "requested" && execution.phase !== "preparing")
    ) {
      continue;
    }
    gas.cancelAbilityExecution({
      executionId: execution.id,
      reason: "interrupted-by-dash",
      correlationId: command.correlationId ?? command.id,
      parentId: command.parentId ?? command.id
    });
  }
}
