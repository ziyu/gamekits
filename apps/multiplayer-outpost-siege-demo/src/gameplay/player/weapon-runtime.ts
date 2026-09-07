import type { GasHandle } from "@gamekits/gas";

import type {
  OutpostReplicatedWeaponFeedback,
  OutpostReplicatedWeaponState,
  OutpostWeaponDefinition
} from "../../domain";
import type {
  OutpostAuthorityCombatCommand,
  OutpostAuthorityCombatCommandResult
} from "../authority-combat-types";

export type OutpostAuthorityPlayerWeaponControl = {
  fireHeld: boolean;
  fireSequence: number;
  aimX: number;
  aimY: number;
};

export type OutpostAuthorityPlayerReloadRequest = {
  id: string;
  correlationId?: string | undefined;
  parentId?: string | undefined;
};

export type OutpostAuthorityPlayerWeaponActionResult =
  | { status: "accepted" }
  | { status: "rejected"; reason: string };

export type OutpostAuthorityPlayerWeapon = {
  definition: OutpostWeaponDefinition;
  magazine: number;
  reserveAmmo: number;
  phase: OutpostReplicatedWeaponState["phase"];
  shotSequence: number;
  lastShotCorrelationId?: string | undefined;
  nextShotAt: number;
  lastFireSequence: number;
  fireHeld: boolean;
  pendingFireSequence?: number | undefined;
  reloadSequence: number;
  reloadExecutionId?: string | undefined;
  reloadRequestId?: string | undefined;
  reloadCorrelationId?: string | undefined;
  reloadStartedAt?: number | undefined;
  reloadEndsAt?: number | undefined;
  reloadCommitted: boolean;
  feedbackSequence: number;
  lastFeedback?: OutpostReplicatedWeaponFeedback | undefined;
};

export type UpdateOutpostAuthorityPlayerWeaponOptions = {
  playerId: string;
  actorId: string;
  elapsed: number;
  control: OutpostAuthorityPlayerWeaponControl;
  gas: GasHandle;
  weapon: OutpostAuthorityPlayerWeapon;
  fire(command: OutpostAuthorityCombatCommand): OutpostAuthorityCombatCommandResult;
};

export function createOutpostAuthorityPlayerWeapon(
  definition: OutpostWeaponDefinition
): OutpostAuthorityPlayerWeapon {
  return {
    definition,
    magazine: definition.magazineSize,
    reserveAmmo: definition.reserveAmmo,
    phase: "ready",
    shotSequence: 0,
    nextShotAt: 0,
    lastFireSequence: 0,
    fireHeld: false,
    reloadSequence: 0,
    reloadCommitted: false,
    feedbackSequence: 0
  };
}

export function updateOutpostAuthorityPlayerWeapon(
  options: UpdateOutpostAuthorityPlayerWeaponOptions
): void {
  const { weapon } = options;
  reconcileOutpostAuthorityPlayerWeapon(weapon, options.gas, options.elapsed);
  const pressed = isNewerFireSequence(options.control.fireSequence, weapon.lastFireSequence);
  if (pressed) {
    weapon.lastFireSequence = options.control.fireSequence;
    weapon.pendingFireSequence = options.control.fireSequence;
    weapon.fireHeld = options.control.fireHeld;
  } else if (options.control.fireSequence === weapon.lastFireSequence) {
    weapon.fireHeld = options.control.fireHeld;
  }

  if (weapon.phase === "reloading") {
    if (weapon.pendingFireSequence === undefined || weapon.magazine === 0) {
      if (pressed && weapon.magazine === 0) {
        delete weapon.pendingFireSequence;
      }
      return;
    }
    const shotId = nextShotId(options.playerId, weapon);
    const cancellation = cancelOutpostAuthorityPlayerReload({
      gas: options.gas,
      weapon,
      elapsed: options.elapsed,
      reason: "interrupted-by-rifle",
      correlationId: shotId,
      parentId: shotId
    });
    if (cancellation.status !== "accepted") {
      delete weapon.pendingFireSequence;
      return;
    }
  }
  if (weapon.magazine === 0) {
    weapon.phase = "empty";
    if (weapon.reserveAmmo > 0 && (weapon.fireHeld || weapon.pendingFireSequence !== undefined)) {
      delete weapon.pendingFireSequence;
      requestOutpostAuthorityPlayerReload({
        actorId: options.actorId,
        elapsed: options.elapsed,
        gas: options.gas,
        weapon,
        request: {
          id: `${options.playerId}.reload.${weapon.reloadSequence + 1}`
        }
      });
    }
    return;
  }
  weapon.phase = "ready";
  if (
    (!weapon.fireHeld && weapon.pendingFireSequence === undefined) ||
    options.elapsed < weapon.nextShotAt
  ) {
    return;
  }
  if (
    options.gas
      .listAbilityExecutions({
        actorId: options.actorId,
        abilityId: weapon.definition.ability.id
      })
      .some((execution) => execution.phase !== "completed" && execution.phase !== "cancelled")
  ) {
    return;
  }

  const shotSequence = weapon.shotSequence + 1;
  const id = nextShotId(options.playerId, weapon);
  const result = options.fire({
    id,
    playerId: options.playerId,
    ability: "rifle",
    aimX: options.control.aimX,
    aimY: options.control.aimY,
    correlationId: id,
    parentId: id
  });
  if (result.status === "rejected") {
    recordWeaponFeedback(weapon, {
      kind: "rejected",
      action: "rifle",
      reason: result.reason,
      at: options.elapsed,
      correlationId: id
    });
    weapon.nextShotAt = options.elapsed + weapon.definition.fireIntervalMs;
    delete weapon.pendingFireSequence;
    return;
  }
  weapon.magazine -= 1;
  weapon.shotSequence = shotSequence;
  weapon.lastShotCorrelationId = id;
  weapon.nextShotAt = options.elapsed + weapon.definition.fireIntervalMs;
  delete weapon.pendingFireSequence;
}

function isNewerFireSequence(candidate: number, current: number): boolean {
  const distance = (candidate - current) >>> 0;
  return distance !== 0 && distance < 0x8000_0000;
}

export function requestOutpostAuthorityPlayerReload(options: {
  actorId: string;
  elapsed: number;
  gas: GasHandle;
  weapon: OutpostAuthorityPlayerWeapon;
  request: OutpostAuthorityPlayerReloadRequest;
}): OutpostAuthorityPlayerWeaponActionResult {
  const { weapon } = options;
  reconcileOutpostAuthorityPlayerWeapon(weapon, options.gas, options.elapsed);
  const correlationId = options.request.correlationId ?? options.request.id;
  if (weapon.phase === "reloading") {
    if (weapon.reloadRequestId === options.request.id) {
      return { status: "accepted" };
    }
    return rejectWeaponAction(
      weapon,
      "reload",
      "full-action-channel-busy",
      options.elapsed,
      correlationId
    );
  }
  if (weapon.magazine >= weapon.definition.magazineSize) {
    return rejectWeaponAction(weapon, "reload", "magazine-full", options.elapsed, correlationId);
  }
  if (weapon.reserveAmmo === 0) {
    weapon.phase = "empty";
    return rejectWeaponAction(weapon, "reload", "reserve-empty", options.elapsed, correlationId);
  }
  weapon.reloadSequence += 1;
  const result = options.gas.requestAbilityExecution({
    actorId: options.actorId,
    abilityId: weapon.definition.reloadAbility.id,
    requestId: options.request.id,
    correlationId,
    parentId: options.request.parentId ?? options.request.id
  });
  if (result.status === "rejected") {
    return rejectWeaponAction(weapon, "reload", result.reason, options.elapsed, correlationId);
  }
  weapon.phase = "reloading";
  weapon.reloadExecutionId = result.execution.id;
  weapon.reloadRequestId = options.request.id;
  weapon.reloadCorrelationId = correlationId;
  weapon.reloadStartedAt = options.elapsed;
  weapon.reloadEndsAt = options.elapsed + weapon.definition.reloadDurationMs;
  weapon.reloadCommitted = false;
  return { status: "accepted" };
}

export function rejectOutpostAuthorityPlayerReload(
  weapon: OutpostAuthorityPlayerWeapon,
  elapsed: number,
  reason: string,
  correlationId?: string
): OutpostAuthorityPlayerWeaponActionResult {
  return rejectWeaponAction(weapon, "reload", reason, elapsed, correlationId);
}

export function cancelOutpostAuthorityPlayerReload(options: {
  gas: GasHandle;
  weapon: OutpostAuthorityPlayerWeapon;
  elapsed: number;
  reason: string;
  correlationId?: string | undefined;
  parentId?: string | undefined;
}): OutpostAuthorityPlayerWeaponActionResult {
  const executionId = options.weapon.reloadExecutionId;
  if (executionId === undefined) {
    return { status: "accepted" };
  }
  const result = options.gas.cancelAbilityExecution({
    executionId,
    reason: options.reason,
    ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
    ...(options.parentId === undefined ? {} : { parentId: options.parentId })
  });
  if (result.status === "rejected") {
    return { status: "rejected", reason: result.reason };
  }
  recordWeaponFeedback(options.weapon, {
    kind: "cancelled",
    action: "reload",
    reason: options.reason,
    at: options.elapsed,
    ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId })
  });
  finishReload(options.weapon);
  return { status: "accepted" };
}

export function reconcileOutpostAuthorityPlayerWeapon(
  weapon: OutpostAuthorityPlayerWeapon,
  gas: GasHandle,
  elapsed: number
): void {
  if (!weapon.reloadExecutionId) {
    return;
  }
  const execution = gas.getAbilityExecution(weapon.reloadExecutionId);
  if (!execution) {
    finishReload(weapon);
    return;
  }
  if (!weapon.reloadCommitted && execution.committedAt !== undefined) {
    const transfer = Math.min(weapon.definition.magazineSize - weapon.magazine, weapon.reserveAmmo);
    weapon.magazine += transfer;
    weapon.reserveAmmo -= transfer;
    weapon.reloadCommitted = true;
  }
  if (execution.phase === "cancelled") {
    recordWeaponFeedback(weapon, {
      kind: "cancelled",
      action: "reload",
      reason: execution.cancellationReason ?? "reload-cancelled",
      at: elapsed,
      ...(execution.correlationId === undefined ? {} : { correlationId: execution.correlationId })
    });
    finishReload(weapon);
  } else if (execution.phase === "completed") {
    finishReload(weapon);
  }
}

export function captureOutpostPlayerWeaponSnapshot(
  weapon: OutpostAuthorityPlayerWeapon
): OutpostReplicatedWeaponState {
  return {
    weaponId: weapon.definition.id,
    magazine: weapon.magazine,
    magazineSize: weapon.definition.magazineSize,
    reserveAmmo: weapon.reserveAmmo,
    phase: weapon.phase,
    shotSequence: weapon.shotSequence,
    ...(weapon.lastShotCorrelationId === undefined
      ? {}
      : { lastShotCorrelationId: weapon.lastShotCorrelationId }),
    ...(weapon.reloadStartedAt === undefined ? {} : { reloadStartedAt: weapon.reloadStartedAt }),
    ...(weapon.reloadEndsAt === undefined ? {} : { reloadEndsAt: weapon.reloadEndsAt }),
    ...(weapon.reloadRequestId === undefined ? {} : { reloadRequestId: weapon.reloadRequestId }),
    ...(weapon.reloadCorrelationId === undefined
      ? {}
      : { reloadCorrelationId: weapon.reloadCorrelationId }),
    ...(weapon.lastFeedback === undefined ? {} : { lastFeedback: { ...weapon.lastFeedback } })
  };
}

function finishReload(weapon: OutpostAuthorityPlayerWeapon): void {
  weapon.phase = weapon.magazine > 0 ? "ready" : "empty";
  delete weapon.reloadExecutionId;
  delete weapon.reloadRequestId;
  delete weapon.reloadCorrelationId;
  delete weapon.reloadStartedAt;
  delete weapon.reloadEndsAt;
  weapon.reloadCommitted = false;
}

function nextShotId(playerId: string, weapon: OutpostAuthorityPlayerWeapon): string {
  return `${playerId}.rifle.${weapon.shotSequence + 1}`;
}

function rejectWeaponAction(
  weapon: OutpostAuthorityPlayerWeapon,
  action: OutpostReplicatedWeaponFeedback["action"],
  reason: string,
  elapsed: number,
  correlationId?: string
): OutpostAuthorityPlayerWeaponActionResult {
  recordWeaponFeedback(weapon, {
    kind: "rejected",
    action,
    reason,
    at: elapsed,
    ...(correlationId === undefined ? {} : { correlationId })
  });
  return { status: "rejected", reason };
}

function recordWeaponFeedback(
  weapon: OutpostAuthorityPlayerWeapon,
  feedback: Omit<OutpostReplicatedWeaponFeedback, "sequence">
): void {
  weapon.feedbackSequence += 1;
  weapon.lastFeedback = { sequence: weapon.feedbackSequence, ...feedback };
}
