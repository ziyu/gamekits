import type { EntityId } from "@gamekits/world";
import type { OutpostGameplayIdentity, OutpostNetworkIdentity } from "./types";

export type OutpostIdentityRegistry = {
  register(identity: OutpostGameplayIdentity): void;
  remove(gameplayObjectId: string): boolean;
  byGameplayObjectId(gameplayObjectId: string): OutpostGameplayIdentity | undefined;
  byEntityId(entityId: EntityId): OutpostGameplayIdentity | undefined;
  byActorId(actorId: string): OutpostGameplayIdentity | undefined;
  byPhysicsBodyId(physicsBodyId: string): OutpostGameplayIdentity | undefined;
  byPhysicsColliderId(physicsColliderId: string): OutpostGameplayIdentity | undefined;
  byNetworkIdentity(network: OutpostNetworkIdentity): OutpostGameplayIdentity | undefined;
  byRenderObjectId(renderObjectId: string): OutpostGameplayIdentity | undefined;
  snapshot(): OutpostGameplayIdentity[];
  clear(): void;
};

export function createOutpostIdentityRegistry(): OutpostIdentityRegistry {
  const identities = new Map<string, OutpostGameplayIdentity>();
  const entityIndex = new Map<string, string>();
  const actorIndex = new Map<string, string>();
  const physicsBodyIndex = new Map<string, string>();
  const physicsColliderIndex = new Map<string, string>();
  const networkIndex = new Map<string, string>();
  const renderObjectIndex = new Map<string, string>();

  return {
    register(identity) {
      const normalized = cloneIdentity(identity);
      assertIdentity(normalized);
      assertAvailable("gameplayObjectId", normalized.gameplayObjectId, identities);
      assertAvailable("entityId", entityKey(normalized.entityId), entityIndex);
      assertOptionalAvailable("actorId", normalized.actorId, actorIndex);
      assertOptionalAvailable("physicsBodyId", normalized.physicsBodyId, physicsBodyIndex);
      for (const colliderId of normalized.physicsColliderIds ?? []) {
        assertAvailable("physicsColliderId", colliderId, physicsColliderIndex);
      }
      assertOptionalAvailable(
        "network",
        normalized.network === undefined ? undefined : networkKey(normalized.network),
        networkIndex
      );
      assertOptionalAvailable("renderObjectId", normalized.renderObjectId, renderObjectIndex);

      identities.set(normalized.gameplayObjectId, normalized);
      entityIndex.set(entityKey(normalized.entityId), normalized.gameplayObjectId);
      setOptional(actorIndex, normalized.actorId, normalized.gameplayObjectId);
      setOptional(physicsBodyIndex, normalized.physicsBodyId, normalized.gameplayObjectId);
      for (const colliderId of normalized.physicsColliderIds ?? []) {
        physicsColliderIndex.set(colliderId, normalized.gameplayObjectId);
      }
      setOptional(
        networkIndex,
        normalized.network === undefined ? undefined : networkKey(normalized.network),
        normalized.gameplayObjectId
      );
      setOptional(renderObjectIndex, normalized.renderObjectId, normalized.gameplayObjectId);
    },
    remove(gameplayObjectId) {
      const identity = identities.get(gameplayObjectId);
      if (!identity) {
        return false;
      }
      identities.delete(gameplayObjectId);
      entityIndex.delete(entityKey(identity.entityId));
      deleteOptional(actorIndex, identity.actorId);
      deleteOptional(physicsBodyIndex, identity.physicsBodyId);
      for (const colliderId of identity.physicsColliderIds ?? []) {
        physicsColliderIndex.delete(colliderId);
      }
      deleteOptional(
        networkIndex,
        identity.network === undefined ? undefined : networkKey(identity.network)
      );
      deleteOptional(renderObjectIndex, identity.renderObjectId);
      return true;
    },
    byGameplayObjectId(gameplayObjectId) {
      return readIdentity(identities, gameplayObjectId);
    },
    byEntityId(entityId) {
      return readIndexedIdentity(identities, entityIndex, entityKey(entityId));
    },
    byActorId(actorId) {
      return readIndexedIdentity(identities, actorIndex, actorId);
    },
    byPhysicsBodyId(physicsBodyId) {
      return readIndexedIdentity(identities, physicsBodyIndex, physicsBodyId);
    },
    byPhysicsColliderId(physicsColliderId) {
      return readIndexedIdentity(identities, physicsColliderIndex, physicsColliderId);
    },
    byNetworkIdentity(network) {
      return readIndexedIdentity(identities, networkIndex, networkKey(network));
    },
    byRenderObjectId(renderObjectId) {
      return readIndexedIdentity(identities, renderObjectIndex, renderObjectId);
    },
    snapshot() {
      return [...identities.values()];
    },
    clear() {
      identities.clear();
      entityIndex.clear();
      actorIndex.clear();
      physicsBodyIndex.clear();
      physicsColliderIndex.clear();
      networkIndex.clear();
      renderObjectIndex.clear();
    }
  };
}

function assertIdentity(identity: OutpostGameplayIdentity): void {
  if (identity.gameplayObjectId.length === 0) {
    throw new Error("Outpost identity requires gameplayObjectId");
  }
  if (
    identity.network !== undefined &&
    (!Number.isInteger(identity.network.generation) || identity.network.generation < 0)
  ) {
    throw new Error("Outpost network identity generation must be a non-negative integer");
  }
  const colliderIds = identity.physicsColliderIds ?? [];
  if (new Set(colliderIds).size !== colliderIds.length) {
    throw new Error(`Duplicate Outpost identity physicsColliderId: ${identity.gameplayObjectId}`);
  }
}

function assertOptionalAvailable(
  field: string,
  value: string | undefined,
  index: Map<string, string>
): void {
  if (value !== undefined) {
    assertAvailable(field, value, index);
  }
}

function assertAvailable(field: string, value: string, index: Map<string, unknown>): void {
  if (index.has(value)) {
    throw new Error(`Duplicate Outpost identity ${field}: ${value}`);
  }
}

function setOptional(index: Map<string, string>, key: string | undefined, value: string): void {
  if (key !== undefined) {
    index.set(key, value);
  }
}

function deleteOptional(index: Map<string, string>, key: string | undefined): void {
  if (key !== undefined) {
    index.delete(key);
  }
}

function readIndexedIdentity(
  identities: Map<string, OutpostGameplayIdentity>,
  index: Map<string, string>,
  key: string
): OutpostGameplayIdentity | undefined {
  const gameplayObjectId = index.get(key);
  return gameplayObjectId === undefined ? undefined : readIdentity(identities, gameplayObjectId);
}

function readIdentity(
  identities: Map<string, OutpostGameplayIdentity>,
  gameplayObjectId: string
): OutpostGameplayIdentity | undefined {
  const identity = identities.get(gameplayObjectId);
  return identity;
}

function cloneIdentity(identity: OutpostGameplayIdentity): OutpostGameplayIdentity {
  const cloned = {
    ...identity,
    ...(identity.physicsColliderIds === undefined
      ? {}
      : { physicsColliderIds: Object.freeze([...identity.physicsColliderIds]) }),
    ...(identity.network === undefined ? {} : { network: Object.freeze({ ...identity.network }) })
  };
  return Object.freeze(cloned);
}

function entityKey(entityId: EntityId): string {
  return `${typeof entityId}:${String(entityId)}`;
}

function networkKey(network: OutpostNetworkIdentity): string {
  return `${network.entityId}:${network.generation}`;
}
