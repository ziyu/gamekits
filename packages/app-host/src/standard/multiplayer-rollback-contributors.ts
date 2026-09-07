import type { Rng } from "@gamekits/core";
import {
  createMultiplayerRngRollbackContributor,
  createMultiplayerRollbackCoordinator,
  hashMultiplayerRollbackValue,
  measureMultiplayerRollbackValue,
  type CreateMultiplayerRngRollbackContributorOptions,
  type MultiplayerRollbackContributor,
  type MultiplayerRollbackCoordinator,
  type MultiplayerRollbackCoordinatorOptions
} from "@gamekits/multiplayer-core";
import type {
  PhysicsCheckpointRestoreOptions,
  PhysicsHandle,
  PhysicsRuntimeCheckpoint
} from "@gamekits/physics-core";
import {
  createWorldCheckpointController,
  type CreateWorldCheckpointControllerOptions,
  type WorldCheckpointController,
  type WorldRuntimeCheckpoint
} from "@gamekits/world";

export type StandardMultiplayerWorldRollbackContributorOptions = {
  controller: WorldCheckpointController;
  id?: string | undefined;
  order?: number | undefined;
};

export type StandardMultiplayerPhysicsRollbackContributorOptions = {
  handle: PhysicsHandle;
  id?: string | undefined;
  order?: number | undefined;
  resolveEntityId?: PhysicsCheckpointRestoreOptions["resolveEntityId"] | undefined;
};

export type StandardMultiplayerRollbackDomainOptions = Omit<
  MultiplayerRollbackCoordinatorOptions,
  "contributors"
> & {
  world?: CreateWorldCheckpointControllerOptions & {
    contributor?: Omit<StandardMultiplayerWorldRollbackContributorOptions, "controller">;
  };
  rng?: {
    source: Rng;
    contributor?: CreateMultiplayerRngRollbackContributorOptions;
  };
  physics?: StandardMultiplayerPhysicsRollbackContributorOptions;
  contributors?: readonly MultiplayerRollbackContributor[];
};

/**
 * Standard App Host composition for a same-tick World → RNG → Physics rollback domain.
 * Apps declare domain-owned state and budgets without rebuilding contributor ordering.
 */
export function createStandardMultiplayerRollbackDomain(
  options: StandardMultiplayerRollbackDomainOptions
): MultiplayerRollbackCoordinator {
  const contributors: MultiplayerRollbackContributor[] = [];
  if (options.world !== undefined) {
    const { contributor, ...controllerOptions } = options.world;
    contributors.push(
      createStandardMultiplayerWorldRollbackContributor({
        controller: createWorldCheckpointController(controllerOptions),
        ...contributor
      })
    );
  }
  if (options.rng !== undefined) {
    contributors.push(
      createMultiplayerRngRollbackContributor(options.rng.source, options.rng.contributor)
    );
  }
  if (options.physics !== undefined) {
    contributors.push(createStandardMultiplayerPhysicsRollbackContributor(options.physics));
  }
  contributors.push(...(options.contributors ?? []));
  return createMultiplayerRollbackCoordinator({
    generation: options.generation,
    contributors,
    ...(options.maxHistoryTicks === undefined ? {} : { maxHistoryTicks: options.maxHistoryTicks }),
    ...(options.maxCheckpointBytes === undefined
      ? {}
      : { maxCheckpointBytes: options.maxCheckpointBytes }),
    ...(options.maxHistoryBytes === undefined ? {} : { maxHistoryBytes: options.maxHistoryBytes })
  });
}

export function createStandardMultiplayerWorldRollbackContributor(
  options: StandardMultiplayerWorldRollbackContributorOptions
): MultiplayerRollbackContributor<WorldRuntimeCheckpoint> {
  return {
    id: options.id ?? "world",
    order: options.order ?? 100,
    capture() {
      return options.controller.capture();
    },
    validate(checkpoint) {
      return options.controller.validate(checkpoint).valid;
    },
    restore(checkpoint) {
      options.controller.restore(checkpoint);
    },
    measureBytes: measureMultiplayerRollbackValue,
    hash: hashMultiplayerRollbackValue
  };
}

export function createStandardMultiplayerPhysicsRollbackContributor(
  options: StandardMultiplayerPhysicsRollbackContributorOptions
): MultiplayerRollbackContributor<PhysicsRuntimeCheckpoint> {
  return {
    id: options.id ?? "physics",
    order: options.order ?? 200,
    capture() {
      return options.handle.captureCheckpoint();
    },
    validate(checkpoint) {
      return validPhysicsRuntimeCheckpoint(checkpoint, options.resolveEntityId);
    },
    restore(checkpoint) {
      options.handle.restoreCheckpoint(
        checkpoint,
        options.resolveEntityId === undefined
          ? undefined
          : { resolveEntityId: options.resolveEntityId }
      );
    },
    measureBytes: measureMultiplayerRollbackValue,
    hash: hashMultiplayerRollbackValue
  };
}

function validPhysicsRuntimeCheckpoint(
  checkpoint: PhysicsRuntimeCheckpoint,
  resolveEntityId: PhysicsCheckpointRestoreOptions["resolveEntityId"] | undefined
): boolean {
  if (
    checkpoint === null ||
    typeof checkpoint !== "object" ||
    !Number.isFinite(checkpoint.accumulator) ||
    checkpoint.accumulator < 0 ||
    !Array.isArray(checkpoint.entities)
  ) {
    return false;
  }
  const entityIds = new Set<string>();
  for (const entity of checkpoint.entities) {
    if (
      entity === null ||
      typeof entity !== "object" ||
      ((typeof entity.entityId !== "string" || entity.entityId.trim().length === 0) &&
        (typeof entity.entityId !== "number" || !Number.isSafeInteger(entity.entityId)))
    ) {
      return false;
    }
    const resolvedEntityId = resolveEntityId?.(entity.entityId) ?? entity.entityId;
    if (
      (typeof resolvedEntityId !== "string" || resolvedEntityId.trim().length === 0) &&
      (typeof resolvedEntityId !== "number" || !Number.isSafeInteger(resolvedEntityId))
    ) {
      return false;
    }
    const identity = `${typeof resolvedEntityId}:${String(resolvedEntityId)}`;
    if (entityIds.has(identity)) {
      return false;
    }
    entityIds.add(identity);
  }
  return true;
}
