import {
  createStandardMultiplayerPhysicsPredictionDomain,
  type StandardMultiplayerPhysicsPredictionDomain
} from "@gamekits/app-host";
import {
  createPhysicsPredictionIsland,
  type PhysicsBackendAdapter,
  type PhysicsBodyState,
  type PhysicsPredictionIsland,
  type PhysicsPredictionIslandContact,
  type PhysicsPredictionIslandMemberDefinition,
  type PhysicsPredictionIslandMemberState,
  type PhysicsPredictionIslandReconcileResult,
  type PhysicsPredictionIslandStateSnapshot,
  type PhysicsVector
} from "@gamekits/physics-core";
import { getMultiplayerProjectileWeapon, type MultiplayerPhysicsProjectileWeapon } from "./arsenal";
import {
  MULTIPLAYER_PROJECTILE_OBSTACLES,
  MULTIPLAYER_PROJECTILE_TARGETS,
  MULTIPLAYER_PROJECTILE_WORLD
} from "./battlefield";

export type MultiplayerPhysicsProjectileFireCommand = {
  simulation: "physics-island";
  correlationId: string;
  generation: number;
  weaponId: "gravity-ricochet";
  targetId: string;
  projectileIndex: 0;
  fireTick: number;
  spawnTick: number;
  despawnTick: number;
  spawnSequence: number;
  despawnSequence: number;
  firePosition: PhysicsVector;
  fireVelocity: PhysicsVector;
};

export type MultiplayerPhysicsProjectileContactFact = {
  correlationId: string;
  tick: number;
  kind: "target" | "environment" | "projectile";
  targetId?: string | undefined;
};

export type MultiplayerPhysicsProjectileReconciliation = PhysicsPredictionIslandReconcileResult & {
  authorityTick: number;
};

export type MultiplayerPhysicsProjectileShotSample = {
  owner?: PhysicsBodyState | undefined;
  authority?: PhysicsBodyState | undefined;
  remote?: PhysicsBodyState | undefined;
  matchStatus: string;
  spawnTick: number;
  despawnTick: number;
};

export type MultiplayerPhysicsProjectileDiagnostics = {
  owner: ReturnType<PhysicsPredictionIsland["diagnostics"]>;
  authority: ReturnType<PhysicsPredictionIsland["diagnostics"]>;
  predictedSpawns: ReturnType<
    StandardMultiplayerPhysicsPredictionDomain["diagnostics"]
  >["lifecycle"]["spawns"];
  ownerContacts: number;
  authorityContacts: number;
  deferredSnapshots: number;
  remoteSnapshots: number;
  latestReconciliation?: MultiplayerPhysicsProjectileReconciliation | undefined;
};

export type MultiplayerPhysicsProjectileAdvanceResult = {
  authorityContacts: MultiplayerPhysicsProjectileContactFact[];
  authoritySnapshot?: PhysicsPredictionIslandStateSnapshot | undefined;
};

export type MultiplayerPhysicsProjectileRuntime = {
  createPredictedFire(options: {
    correlationId: string;
    generation: number;
    targetId: string;
    targetPosition?: PhysicsVector | undefined;
    fireTick: number;
  }): MultiplayerPhysicsProjectileFireCommand;
  applyAuthorityFire(
    command: MultiplayerPhysicsProjectileFireCommand
  ): MultiplayerPhysicsProjectileContactFact[];
  advanceTo(tick: number): MultiplayerPhysicsProjectileAdvanceResult;
  applyOwnerAuthoritySnapshot(
    snapshot: PhysicsPredictionIslandStateSnapshot
  ): MultiplayerPhysicsProjectileReconciliation | "deferred";
  applyRemoteAuthoritySnapshot(snapshot: PhysicsPredictionIslandStateSnapshot): void;
  sample(correlationId: string): MultiplayerPhysicsProjectileShotSample | undefined;
  forget(correlationId: string): void;
  targetPosition(
    targetId: string,
    view: "owner" | "authority" | "remote"
  ): PhysicsVector | undefined;
  reset(generation: number, tick: number, faultInjection: boolean): void;
  diagnostics(): MultiplayerPhysicsProjectileDiagnostics;
  dispose(): void;
};

type PhysicalShot = {
  correlationId: string;
  memberId: string;
  colliderId: string;
  targetId: string;
  spawnTick: number;
  despawnTick: number;
};

const PHYSICS_WEAPON = getMultiplayerProjectileWeapon("gravity-ricochet");
if (PHYSICS_WEAPON.simulation !== "physics-island") {
  throw new Error("Rook Physics Round must use the physics-island simulation.");
}
const WEAPON: MultiplayerPhysicsProjectileWeapon = PHYSICS_WEAPON;

const FIXED_DELTA_MS = 1000 / 60;
const AUTHORITY_SNAPSHOT_INTERVAL_TICKS = 6;
const TARGET_MATERIAL_ID = "sandbox.physics-projectile.target";
const PROJECTILE_MATERIAL_ID = "sandbox.physics-projectile.ballistic";
const ENVIRONMENT_MATERIAL_ID = "sandbox.physics-projectile.environment";

export function createMultiplayerPhysicsProjectileRuntime(options: {
  physicsBackend: PhysicsBackendAdapter;
  generation: number;
  tick: number;
}): MultiplayerPhysicsProjectileRuntime {
  let generation = options.generation;
  let commandSequence = 0;
  let remoteSnapshot: PhysicsPredictionIslandStateSnapshot | undefined;
  let latestReconciliation: MultiplayerPhysicsProjectileReconciliation | undefined;
  let ownerContacts = 0;
  let authorityContacts = 0;
  let deferredSnapshots = 0;
  let remoteSnapshots = 0;
  const shots = new Map<string, PhysicalShot>();
  const projectileByCollider = new Map<string, string>();
  const shotByMemberId = new Map<string, PhysicalShot>();
  const targetByCollider = new Map(
    MULTIPLAYER_PROJECTILE_TARGETS.map((target) => [targetColliderId(target.id), target.id])
  );
  const matchStatusByCorrelation = new Map<string, string>();
  const ownerIsland = createIsland("owner", generation, options.tick);
  const authorityIsland = createIsland("authority", generation, options.tick);
  const predictionDomain = createStandardMultiplayerPhysicsPredictionDomain({
    kind: "physics-projectile",
    generation,
    stepMs: FIXED_DELTA_MS,
    island: ownerIsland,
    maxPending: 64,
    maxResolved: 128,
    maxAgeTicks: 300,
    maxBindings: 128,
    resolveAuthoritySpawn(member) {
      const shot = shotByMemberId.get(member.id);
      return shot === undefined
        ? undefined
        : { correlationId: shot.correlationId, tick: shot.spawnTick };
    }
  });

  return {
    createPredictedFire(fireOptions) {
      if (fireOptions.generation !== generation) {
        throw new Error("Physics projectile fire generation does not match the active island.");
      }
      const target = MULTIPLAYER_PROJECTILE_TARGETS.find(
        (candidate) => candidate.id === fireOptions.targetId
      );
      if (target === undefined) {
        throw new Error(`Unknown physics projectile target: ${fireOptions.targetId}`);
      }
      commandSequence += 1;
      const spawnSequence = commandSequence;
      commandSequence += 1;
      const despawnSequence = commandSequence;
      const spawnTick = fireOptions.fireTick + 1;
      const despawnTick = spawnTick + WEAPON.physics.lifetimeTicks;
      const member = createProjectileMember(
        fireOptions.correlationId,
        MULTIPLAYER_PROJECTILE_WORLD.muzzle,
        ballisticVelocity(
          MULTIPLAYER_PROJECTILE_WORLD.muzzle,
          fireOptions.targetPosition ?? target.position
        )
      );
      const command: MultiplayerPhysicsProjectileFireCommand = {
        simulation: "physics-island",
        correlationId: fireOptions.correlationId,
        generation,
        weaponId: "gravity-ricochet",
        targetId: fireOptions.targetId,
        projectileIndex: 0,
        fireTick: fireOptions.fireTick,
        spawnTick,
        despawnTick,
        spawnSequence,
        despawnSequence,
        firePosition: { ...MULTIPLAYER_PROJECTILE_WORLD.muzzle },
        fireVelocity: { ...member.body.linearVelocity! }
      };
      queueShot(ownerIsland, command, member);
      rememberShot(command, member);
      predictionDomain.registerPredicted({
        correlationId: command.correlationId,
        tick: spawnTick,
        member
      });
      matchStatusByCorrelation.set(command.correlationId, "predicted");
      return cloneFireCommand(command);
    },
    applyAuthorityFire(command) {
      if (command.generation !== generation) {
        return [];
      }
      const member = createProjectileMember(
        command.correlationId,
        command.firePosition,
        command.fireVelocity
      );
      rememberShot(command, member);
      const spawn = authorityIsland.queue({
        type: "spawn",
        tick: command.spawnTick,
        sequence: command.spawnSequence,
        member
      });
      authorityIsland.queue({
        type: "despawn",
        tick: command.despawnTick,
        sequence: command.despawnSequence,
        memberId: member.id
      });
      const facts = classifyContacts(spawn.contacts);
      authorityContacts += facts.length;
      return facts;
    },
    advanceTo(tick) {
      const ownerAdvance = ownerIsland.advanceTo(tick);
      const authorityAdvance = authorityIsland.advanceTo(tick);
      ownerContacts += classifyContacts(ownerAdvance.contacts).length;
      const contacts = classifyContacts(authorityAdvance.contacts);
      authorityContacts += contacts.length;
      predictionDomain.expire(tick);
      let hasActiveShot = false;
      for (const shot of shots.values()) {
        if (tick >= shot.spawnTick && tick < shot.despawnTick) {
          hasActiveShot = true;
          break;
        }
      }
      return {
        authorityContacts: contacts,
        ...(hasActiveShot && tick % AUTHORITY_SNAPSHOT_INTERVAL_TICKS === 0
          ? { authoritySnapshot: authorityIsland.state() }
          : {})
      };
    },
    applyOwnerAuthoritySnapshot(snapshot) {
      if (!sameMemberIds(ownerIsland.state(), snapshot)) {
        deferredSnapshots += 1;
        return "deferred";
      }
      const managed = predictionDomain.reconcile(snapshot);
      for (const match of managed.lifecycle.matches) {
        matchStatusByCorrelation.set(match.binding.correlationId, match.match.status);
      }
      const reconciliation = managed.reconciliation;
      latestReconciliation = {
        ...reconciliation,
        authorityTick: snapshot.tick
      };
      return { ...latestReconciliation };
    },
    applyRemoteAuthoritySnapshot(snapshot) {
      if (snapshot.generation !== generation) {
        return;
      }
      remoteSnapshot = cloneStateSnapshot(snapshot);
      remoteSnapshots += 1;
    },
    sample(correlationId) {
      const shot = shots.get(correlationId);
      if (shot === undefined) {
        return undefined;
      }
      return {
        ...(ownerIsland.body(shot.memberId) === undefined
          ? {}
          : { owner: ownerIsland.body(shot.memberId) }),
        ...(authorityIsland.body(shot.memberId) === undefined
          ? {}
          : { authority: authorityIsland.body(shot.memberId) }),
        ...(findRemoteMember(shot.memberId) === undefined
          ? {}
          : { remote: findRemoteMember(shot.memberId) }),
        matchStatus: matchStatusByCorrelation.get(correlationId) ?? "predicted",
        spawnTick: shot.spawnTick,
        despawnTick: shot.despawnTick
      };
    },
    forget(correlationId) {
      const shot = shots.get(correlationId);
      if (shot === undefined) {
        return;
      }
      shots.delete(correlationId);
      shotByMemberId.delete(shot.memberId);
      projectileByCollider.delete(shot.colliderId);
      matchStatusByCorrelation.delete(correlationId);
    },
    targetPosition(targetId, view) {
      const memberId = targetMemberId(targetId);
      const body =
        view === "owner"
          ? ownerIsland.body(memberId)
          : view === "authority"
            ? authorityIsland.body(memberId)
            : findRemoteMember(memberId);
      return body === undefined ? undefined : { ...body.position };
    },
    reset(nextGeneration, tick, faultInjection) {
      generation = nextGeneration;
      commandSequence = 0;
      remoteSnapshot = undefined;
      latestReconciliation = undefined;
      ownerContacts = 0;
      authorityContacts = 0;
      deferredSnapshots = 0;
      remoteSnapshots = 0;
      shots.clear();
      shotByMemberId.clear();
      projectileByCollider.clear();
      matchStatusByCorrelation.clear();
      predictionDomain.reset(generation, tick);
      authorityIsland.reset(generation, tick);
      if (faultInjection) {
        commandSequence += 1;
        authorityIsland.queue({
          type: "patch",
          tick: tick + 1,
          sequence: commandSequence,
          memberId: targetMemberId("target.gunner"),
          patch: { position: { x: 99, y: 36 }, linearVelocity: { x: 0, y: 0 } }
        });
      }
    },
    diagnostics() {
      return {
        owner: ownerIsland.diagnostics(),
        authority: authorityIsland.diagnostics(),
        predictedSpawns: predictionDomain.diagnostics().lifecycle.spawns,
        ownerContacts,
        authorityContacts,
        deferredSnapshots,
        remoteSnapshots,
        ...(latestReconciliation === undefined
          ? {}
          : { latestReconciliation: { ...latestReconciliation } })
      };
    },
    dispose() {
      shots.clear();
      shotByMemberId.clear();
      projectileByCollider.clear();
      matchStatusByCorrelation.clear();
      remoteSnapshot = undefined;
      predictionDomain.dispose();
      authorityIsland.dispose();
    }
  };

  function createIsland(
    label: string,
    islandGeneration: number,
    tick: number
  ): PhysicsPredictionIsland {
    return createPhysicsPredictionIsland({
      backend: options.physicsBackend,
      generation: islandGeneration,
      initialTick: tick,
      fixedDeltaMs: FIXED_DELTA_MS,
      maxHistoryTicks: 180,
      maxMembers: 72,
      maxCommands: 256,
      scene: {
        id: `sandbox.physics-projectile.${label}`,
        dimension: "2d",
        gravity: { x: 0, y: WEAPON.physics.gravity },
        materialDefinitions: [
          {
            id: PROJECTILE_MATERIAL_ID,
            friction: 0.08,
            restitution: WEAPON.physics.restitution,
            density: WEAPON.physics.density,
            combine: { restitution: "max" }
          },
          {
            id: TARGET_MATERIAL_ID,
            friction: 0.7,
            restitution: 0.16,
            density: 9,
            combine: { restitution: "max" }
          },
          {
            id: ENVIRONMENT_MATERIAL_ID,
            friction: 0.62,
            restitution: 0.48,
            combine: { restitution: "max" }
          }
        ]
      },
      environment: createEnvironment(),
      initialMembers: MULTIPLAYER_PROJECTILE_TARGETS.map(createTargetMember)
    });
  }

  function queueShot(
    island: PhysicsPredictionIsland,
    command: MultiplayerPhysicsProjectileFireCommand,
    member: PhysicsPredictionIslandMemberDefinition
  ): void {
    const spawn = island.queue({
      type: "spawn",
      tick: command.spawnTick,
      sequence: command.spawnSequence,
      member
    });
    if (spawn.status !== "queued") {
      throw new Error(`Owner physics projectile spawn failed: ${spawn.status}`);
    }
    const despawn = island.queue({
      type: "despawn",
      tick: command.despawnTick,
      sequence: command.despawnSequence,
      memberId: member.id
    });
    if (despawn.status !== "queued") {
      throw new Error(`Owner physics projectile despawn failed: ${despawn.status}`);
    }
  }

  function rememberShot(
    command: MultiplayerPhysicsProjectileFireCommand,
    member: PhysicsPredictionIslandMemberDefinition
  ): void {
    if (shots.has(command.correlationId)) {
      return;
    }
    const colliderId = member.colliders?.[0]?.id;
    if (colliderId === undefined) {
      throw new Error(`Physics projectile is missing its collider: ${command.correlationId}`);
    }
    const shot = {
      correlationId: command.correlationId,
      memberId: member.id,
      colliderId,
      targetId: command.targetId,
      spawnTick: command.spawnTick,
      despawnTick: command.despawnTick
    };
    shots.set(command.correlationId, shot);
    shotByMemberId.set(member.id, shot);
    projectileByCollider.set(colliderId, command.correlationId);
  }

  function classifyContacts(
    contacts: readonly PhysicsPredictionIslandContact[]
  ): MultiplayerPhysicsProjectileContactFact[] {
    const facts: MultiplayerPhysicsProjectileContactFact[] = [];
    for (const contact of contacts) {
      if (contact.phase !== "enter") {
        continue;
      }
      const projectileA = projectileByCollider.get(contact.colliderA);
      const projectileB = projectileByCollider.get(contact.colliderB);
      for (const [correlationId, otherCollider] of [
        [projectileA, contact.colliderB],
        [projectileB, contact.colliderA]
      ] as const) {
        if (correlationId === undefined) {
          continue;
        }
        const targetId = targetByCollider.get(otherCollider);
        facts.push({
          correlationId,
          tick: contact.tick,
          kind:
            targetId !== undefined
              ? "target"
              : projectileByCollider.has(otherCollider)
                ? "projectile"
                : "environment",
          ...(targetId === undefined ? {} : { targetId })
        });
      }
    }
    return facts;
  }

  function findRemoteMember(memberId: string): PhysicsBodyState | undefined {
    const member = remoteSnapshot?.members.find((candidate) => candidate.id === memberId);
    return member === undefined ? undefined : cloneBodyState(member.body);
  }
}

function createEnvironment(): {
  bodies: Array<{ id: string; kind: "static"; position: PhysicsVector }>;
  colliders: Array<{
    id: string;
    bodyId: string;
    shape: { type: "box"; width: number; height: number };
    material: string;
  }>;
} {
  const bodies = MULTIPLAYER_PROJECTILE_OBSTACLES.map((obstacle) => ({
    id: `physics.obstacle.${obstacle.id}.body`,
    kind: "static" as const,
    position: { ...obstacle.position }
  }));
  const colliders = MULTIPLAYER_PROJECTILE_OBSTACLES.map((obstacle) => ({
    id: `physics.obstacle.${obstacle.id}.collider`,
    bodyId: `physics.obstacle.${obstacle.id}.body`,
    shape: { type: "box" as const, width: obstacle.width, height: obstacle.height },
    material: ENVIRONMENT_MATERIAL_ID
  }));
  bodies.push({
    id: "physics.range-floor.body",
    kind: "static",
    position: { x: MULTIPLAYER_PROJECTILE_WORLD.width / 2, y: 72 }
  });
  colliders.push({
    id: "physics.range-floor.collider",
    bodyId: "physics.range-floor.body",
    shape: { type: "box", width: MULTIPLAYER_PROJECTILE_WORLD.width, height: 2 },
    material: ENVIRONMENT_MATERIAL_ID
  });
  return { bodies, colliders };
}

function createTargetMember(
  target: (typeof MULTIPLAYER_PROJECTILE_TARGETS)[number]
): PhysicsPredictionIslandMemberDefinition {
  return {
    id: targetMemberId(target.id),
    body: {
      id: targetBodyId(target.id),
      kind: "dynamic",
      position: { ...target.position },
      gravityScale: 0,
      damping: { linear: 1.7, angular: 1.3 },
      lockedAxes: ["y", "rotation"],
      userData: { actorId: target.id }
    },
    colliders: [
      {
        id: targetColliderId(target.id),
        shape: { type: "circle", radius: target.radius },
        material: TARGET_MATERIAL_ID,
        userData: { actorId: target.id }
      }
    ]
  };
}

function createProjectileMember(
  correlationId: string,
  position: PhysicsVector,
  velocity: PhysicsVector
): PhysicsPredictionIslandMemberDefinition {
  const memberId = projectileMemberId(correlationId);
  return {
    id: memberId,
    body: {
      id: `${memberId}.body`,
      kind: "dynamic",
      position: { ...position },
      linearVelocity: { ...velocity },
      angularVelocity: 11,
      damping: { linear: 0.015, angular: 0.08 },
      continuousCollisionDetection: true,
      userData: { correlationId }
    },
    colliders: [
      {
        id: `${memberId}.collider`,
        shape: { type: "circle", radius: WEAPON.projectileRadius },
        material: PROJECTILE_MATERIAL_ID,
        userData: { correlationId }
      }
    ]
  };
}

function ballisticVelocity(origin: PhysicsVector, target: PhysicsVector): PhysicsVector {
  const horizontalDistance = Math.max(1, target.x - origin.x);
  const time = horizontalDistance / WEAPON.speed;
  const verticalVelocity =
    (target.y - origin.y - 0.5 * WEAPON.physics.gravity * time * time) / time;
  return {
    x: WEAPON.speed,
    y: Math.max(-42, Math.min(24, verticalVelocity))
  };
}

function projectileMemberId(correlationId: string): string {
  return `physics.${correlationId}`;
}

function targetMemberId(targetId: string): string {
  return `physics.${targetId}`;
}

function targetBodyId(targetId: string): string {
  return `${targetMemberId(targetId)}.body`;
}

function targetColliderId(targetId: string): string {
  return `${targetMemberId(targetId)}.collider`;
}

function cloneFireCommand(
  command: MultiplayerPhysicsProjectileFireCommand
): MultiplayerPhysicsProjectileFireCommand {
  return {
    ...command,
    firePosition: { ...command.firePosition },
    fireVelocity: { ...command.fireVelocity }
  };
}

function cloneMemberState(
  member: PhysicsPredictionIslandMemberState
): PhysicsPredictionIslandMemberState {
  return { id: member.id, body: cloneBodyState(member.body) };
}

function cloneStateSnapshot(
  snapshot: PhysicsPredictionIslandStateSnapshot
): PhysicsPredictionIslandStateSnapshot {
  return {
    generation: snapshot.generation,
    tick: snapshot.tick,
    members: snapshot.members.map(cloneMemberState)
  };
}

function cloneBodyState(body: PhysicsBodyState): PhysicsBodyState {
  return structuredClone(body);
}

function sameMemberIds(
  left: PhysicsPredictionIslandStateSnapshot,
  right: PhysicsPredictionIslandStateSnapshot
): boolean {
  const leftIds = left.members.map((member) => member.id).sort();
  const rightIds = right.members.map((member) => member.id).sort();
  return leftIds.length === rightIds.length && leftIds.every((id, index) => id === rightIds[index]);
}
