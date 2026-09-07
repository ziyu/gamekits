import {
  createCombatKinematicProjectileRecordBuffer,
  createCombatKinematicProjectileRuntime,
  reconcileCombatKinematicProjectileRecords,
  sampleCombatKinematicProjectileRecord,
  type CombatKinematicProjectileReconciliation,
  type CombatKinematicProjectileRecord,
  type CombatKinematicProjectileRecordBuffer,
  type CombatKinematicProjectileRuntime
} from "@gamekits/combat";
import {
  createMultiplayerPredictedSpawnRegistry,
  createMultiplayerRuntime,
  type MultiplayerRuntime
} from "@gamekits/multiplayer-core";
import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";
import {
  raycast,
  shapeCast,
  type PhysicsBackendAdapter,
  type PhysicsBodyState,
  type PhysicsKinematicSweepQueries,
  type PhysicsPredictionIslandStateSnapshot,
  type PhysicsScene,
  type PhysicsVector
} from "@gamekits/physics-core";
import {
  findMultiplayerProjectileWeaponByDefinition,
  getMultiplayerProjectileWeapon,
  type MultiplayerProjectileWeapon,
  type MultiplayerProjectileWeaponId
} from "./arsenal";
import {
  createMultiplayerProjectileBattlefieldScene,
  getMultiplayerProjectileTarget,
  MULTIPLAYER_PROJECTILE_TARGETS,
  MULTIPLAYER_PROJECTILE_WORLD,
  type MultiplayerProjectileBattlefieldScene
} from "./battlefield";
import {
  createMultiplayerPhysicsProjectileRuntime,
  type MultiplayerPhysicsProjectileContactFact,
  type MultiplayerPhysicsProjectileFireCommand,
  type MultiplayerPhysicsProjectileReconciliation
} from "./physics-projectile-runtime";

export type MultiplayerProjectileLabLaneSample = {
  projectileId: string;
  position: PhysicsVector;
  previousPosition: PhysicsVector;
  x: number;
  y: number;
  active: boolean;
  finished: boolean;
  finishTick?: number | undefined;
  finishReason?: string | undefined;
  subjectId?: string | undefined;
};

export type MultiplayerProjectileLabTargetSnapshot = {
  id: string;
  callsign: string;
  role: string;
  armor: "light" | "medium" | "heavy";
  position: PhysicsVector;
  radius: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  selected: boolean;
  lastDamage: number;
  hitAgeTicks?: number | undefined;
};

export type MultiplayerProjectileLabShotSnapshot = {
  correlationId: string;
  weaponId: MultiplayerProjectileWeaponId;
  targetId: string;
  projectileIndex: number;
  firedAtTick: number;
  simulation: "kinematic" | "physics-island";
  matchStatus: string;
  reconciliation?: CombatKinematicProjectileReconciliation | undefined;
  physicsReconciliation?: MultiplayerPhysicsProjectileReconciliation | undefined;
  owner?: MultiplayerProjectileLabLaneSample | undefined;
  authority?: MultiplayerProjectileLabLaneSample | undefined;
  remote?: MultiplayerProjectileLabLaneSample | undefined;
};

export type MultiplayerProjectileLabSnapshot = {
  ready: boolean;
  tick: number;
  elapsed: number;
  generation: number;
  peers: number;
  latencyMs: number;
  faultInjection: boolean;
  autoFire: boolean;
  canFire: boolean;
  cooldownProgress: number;
  selectedWeaponId: MultiplayerProjectileWeaponId;
  selectedTargetId: string;
  aimAngle: number;
  targets: MultiplayerProjectileLabTargetSnapshot[];
  shots: MultiplayerProjectileLabShotSnapshot[];
  damageDealt: number;
  defeatedTargets: number;
  ownerWallX: number;
  authorityWallX: number;
  owner?: MultiplayerProjectileLabLaneSample | undefined;
  authority?: MultiplayerProjectileLabLaneSample | undefined;
  remote?: MultiplayerProjectileLabLaneSample | undefined;
  latestCorrelationId?: string | undefined;
  reconciliation?: CombatKinematicProjectileReconciliation | undefined;
  matchStatus?: string | undefined;
  pendingCommands: number;
  pendingRecords: number;
  ownerPenetration: number;
  diagnostics: {
    predicted: number;
    matched: number;
    corrected: number;
    stale: number;
    authoritySweeps: number;
    ownerSweeps: number;
    remoteRecords: number;
    physicsSteps: number;
    resimulatedTicks: number;
    checkpointBytes: number;
    physicsContacts: number;
  };
};

export type MultiplayerProjectileLabRuntime = {
  fire(): Promise<string>;
  update(deltaMs: number): void;
  selectWeapon(weaponId: MultiplayerProjectileWeaponId): void;
  selectTarget(targetId: string): void;
  selectTargetAt(position: PhysicsVector): string | undefined;
  setAutoFire(enabled: boolean): void;
  setLatency(latencyMs: number): void;
  setFaultInjection(enabled: boolean): void;
  reset(): void;
  snapshot(): MultiplayerProjectileLabSnapshot;
  dispose(): Promise<void>;
};

export type CreateMultiplayerProjectileLabRuntimeOptions = {
  physicsBackend: PhysicsBackendAdapter;
  latencyMs?: number | undefined;
};

type KinematicFireCommand = {
  simulation: "kinematic";
  correlationId: string;
  generation: number;
  fireTick: number;
  weaponId: MultiplayerProjectileWeaponId;
  targetId: string;
  projectileIndex: number;
  firePosition: PhysicsVector;
  fireVelocity: PhysicsVector;
};

type FireCommand = KinematicFireCommand | MultiplayerPhysicsProjectileFireCommand;

type DelayedMessage<TPayload> = {
  deliverAt: number;
  payload: TPayload;
};

type ShotMetadata = Pick<
  FireCommand,
  "simulation" | "correlationId" | "weaponId" | "targetId" | "projectileIndex" | "fireTick"
>;

type TargetState = {
  health: number;
  alive: boolean;
  lastDamage: number;
  lastHitTick?: number | undefined;
};

const FIXED_DELTA_MS = 1000 / 60;
const SESSION_ID = "sandbox.projectile-field.session";
const AUTHORITY_PEER_ID = "sandbox.projectile-field.authority";
const OWNER_PEER_ID = "sandbox.projectile-field.owner";
const REMOTE_PEER_ID = "sandbox.projectile-field.remote";
const FIRE_MESSAGE_KIND = "sandbox.projectile-field.fire";
const RECORD_MESSAGE_KIND = "sandbox.projectile-field.record";
const PHYSICS_SNAPSHOT_MESSAGE_KIND = "sandbox.projectile-field.physics-snapshot";
const CHANNEL = "reliable";
const RECORD_CAPACITY = 192;
const DEFAULT_WEAPON_ID: MultiplayerProjectileWeaponId = "pulse-carbine";
const DEFAULT_TARGET_ID = "target.gunner";

export async function createMultiplayerProjectileLabRuntime(
  options: CreateMultiplayerProjectileLabRuntimeOptions
): Promise<MultiplayerProjectileLabRuntime> {
  const backend = createMemoryMultiplayerBackend({ id: "sandbox.projectile-field.memory" });
  let elapsed = 0;
  let tick = 0;
  let accumulator = 0;
  let generation = 1;
  let sequence = 0;
  let latencyMs = normalizeLatency(options.latencyMs ?? 240);
  let faultInjection = false;
  let autoFire = false;
  let disposed = false;
  let selectedWeaponId = DEFAULT_WEAPON_ID;
  let selectedTargetId = DEFAULT_TARGET_ID;
  let cooldownStartedAtTick = 0;
  let cooldownUntilTick = 0;
  let latestCorrelationId: string | undefined;
  let corrected = 0;
  let stale = 0;
  let damageDealt = 0;
  let defeatedTargets = 0;

  const authorityNetwork = createPeerRuntime("authority", AUTHORITY_PEER_ID);
  const ownerNetwork = createPeerRuntime("owner", OWNER_PEER_ID);
  const remoteNetwork = createPeerRuntime("remote", REMOTE_PEER_ID);
  await authorityNetwork.createSession({
    id: SESSION_ID,
    authority: "server-authoritative",
    kind: "local",
    localPeer: { id: AUTHORITY_PEER_ID, role: "server", displayName: "Authority" }
  });
  await ownerNetwork.joinSession({
    sessionId: SESSION_ID,
    localPeer: { id: OWNER_PEER_ID, role: "client", displayName: "Vanguard-7" }
  });
  await remoteNetwork.joinSession({
    sessionId: SESSION_ID,
    localPeer: { id: REMOTE_PEER_ID, role: "spectator", displayName: "Remote observer" }
  });

  const ownerBattlefield = createMultiplayerProjectileBattlefieldScene(
    options.physicsBackend,
    "owner",
    false
  );
  const authorityBattlefield = createMultiplayerProjectileBattlefieldScene(
    options.physicsBackend,
    "authority",
    false
  );
  const physicsProjectileRuntime = createMultiplayerPhysicsProjectileRuntime({
    physicsBackend: options.physicsBackend,
    generation,
    tick
  });
  const ownerSimulation = createSimulation(ownerBattlefield, generation);
  const authoritySimulation = createSimulation(authorityBattlefield, generation);
  const ownerAuthorityRecords = createRecordBuffer(generation);
  const remoteRecords = createRecordBuffer(generation);
  const spawnRegistry = createMultiplayerPredictedSpawnRegistry<
    CombatKinematicProjectileRecord,
    CombatKinematicProjectileRecord
  >({
    generation,
    maxPending: 128,
    maxResolved: RECORD_CAPACITY,
    maxAgeTicks: 360,
    clonePredicted: cloneRecord,
    cloneAuthority: cloneRecord
  });
  const targetStates = new Map<string, TargetState>(
    MULTIPLAYER_PROJECTILE_TARGETS.map((target) => [
      target.id,
      { health: target.maxHealth, alive: true, lastDamage: 0 } satisfies TargetState
    ])
  );
  const syncedOwnerTargetPositions = new Map<string, PhysicsVector>();
  const syncedAuthorityTargetPositions = new Map<string, PhysicsVector>();
  const shotMetadata = new Map<string, ShotMetadata>();
  const shotOrder: string[] = [];
  const localProjectileByCorrelation = new Map<string, string>();
  const authorityProjectileByCorrelation = new Map<string, string>();
  const matchStatusByCorrelation = new Map<string, string>();
  const reconciliationByCorrelation = new Map<string, CombatKinematicProjectileReconciliation>();
  const finalReconciliationByCorrelation = new Map<string, "confirmed" | "corrected">();
  const sentAuthorityFinish = new Set<string>();
  const damagedAuthorityProjectiles = new Set<string>();
  const ownerSeenAuthorityCorrelations = new Set<string>();
  const commandQueue: Array<DelayedMessage<FireCommand>> = [];
  const ownerRecordQueue: Array<DelayedMessage<CombatKinematicProjectileRecord>> = [];
  const remoteRecordQueue: Array<DelayedMessage<CombatKinematicProjectileRecord>> = [];
  const ownerPhysicsSnapshotQueue: Array<DelayedMessage<PhysicsPredictionIslandStateSnapshot>> = [];
  const remotePhysicsSnapshotQueue: Array<DelayedMessage<PhysicsPredictionIslandStateSnapshot>> =
    [];
  const damagedPhysicsContacts = new Set<string>();

  const unsubscribeAuthority = authorityNetwork.subscribe<FireCommand>((message) => {
    if (message.kind !== FIRE_MESSAGE_KIND || message.sourcePeerId !== OWNER_PEER_ID) {
      return;
    }
    commandQueue.push({
      deliverAt: elapsed + oneWayLatency(),
      payload: cloneFireCommand(message.payload)
    });
  });
  const unsubscribeOwner = ownerNetwork.subscribe<CombatKinematicProjectileRecord>((message) => {
    if (message.kind !== RECORD_MESSAGE_KIND || message.sourcePeerId !== AUTHORITY_PEER_ID) {
      return;
    }
    ownerRecordQueue.push({
      deliverAt: elapsed + oneWayLatency(),
      payload: cloneRecord(message.payload)
    });
  });
  const unsubscribeRemote = remoteNetwork.subscribe<CombatKinematicProjectileRecord>((message) => {
    if (message.kind !== RECORD_MESSAGE_KIND || message.sourcePeerId !== AUTHORITY_PEER_ID) {
      return;
    }
    remoteRecordQueue.push({
      deliverAt: elapsed + oneWayLatency(),
      payload: cloneRecord(message.payload)
    });
  });
  const unsubscribeOwnerPhysics = ownerNetwork.subscribe<PhysicsPredictionIslandStateSnapshot>(
    (message) => {
      if (
        message.kind !== PHYSICS_SNAPSHOT_MESSAGE_KIND ||
        message.sourcePeerId !== AUTHORITY_PEER_ID
      ) {
        return;
      }
      ownerPhysicsSnapshotQueue.push({
        deliverAt: elapsed + oneWayLatency(),
        payload: clonePhysicsStateSnapshot(message.payload)
      });
    }
  );
  const unsubscribeRemotePhysics = remoteNetwork.subscribe<PhysicsPredictionIslandStateSnapshot>(
    (message) => {
      if (
        message.kind !== PHYSICS_SNAPSHOT_MESSAGE_KIND ||
        message.sourcePeerId !== AUTHORITY_PEER_ID
      ) {
        return;
      }
      remotePhysicsSnapshotQueue.push({
        deliverAt: elapsed + oneWayLatency(),
        payload: clonePhysicsStateSnapshot(message.payload)
      });
    }
  );

  const runtime: MultiplayerProjectileLabRuntime = {
    async fire() {
      assertActive();
      const fired = await fireSelectedWeapon();
      if (fired !== undefined) {
        return fired;
      }
      return latestCorrelationId ?? `cooldown-${generation}-${tick}`;
    },
    selectWeapon(weaponId) {
      assertActive();
      getMultiplayerProjectileWeapon(weaponId);
      selectedWeaponId = weaponId;
    },
    selectTarget(targetId) {
      assertActive();
      const state = targetStates.get(targetId);
      if (state?.alive !== true || getMultiplayerProjectileTarget(targetId) === undefined) {
        return;
      }
      selectedTargetId = targetId;
    },
    selectTargetAt(position) {
      assertActive();
      let closest: { id: string; distance: number } | undefined;
      for (const target of MULTIPLAYER_PROJECTILE_TARGETS) {
        if (targetStates.get(target.id)?.alive !== true) {
          continue;
        }
        const distance = vectorDistance(position, target.position);
        if (
          distance <= target.radius + 4 &&
          (closest === undefined || distance < closest.distance)
        ) {
          closest = { id: target.id, distance };
        }
      }
      if (closest !== undefined) {
        selectedTargetId = closest.id;
      }
      return closest?.id;
    },
    setAutoFire(enabled) {
      assertActive();
      autoFire = enabled;
    },
    setLatency(nextLatencyMs) {
      assertActive();
      latencyMs = normalizeLatency(nextLatencyMs);
    },
    setFaultInjection(enabled) {
      assertActive();
      if (faultInjection === enabled) {
        return;
      }
      faultInjection = enabled;
      resetState();
    },
    reset() {
      assertActive();
      resetState();
    },
    update(deltaMs) {
      updateRuntime(deltaMs);
    },
    snapshot() {
      const shots = shotOrder.slice(-96).map(createShotSnapshot);
      const latestShot = shots.at(-1);
      const selectedTarget = getMultiplayerProjectileTarget(selectedTargetId);
      const registryDiagnostics = spawnRegistry.diagnostics();
      const ownerDiagnostics = ownerSimulation.diagnostics();
      const authorityDiagnostics = authoritySimulation.diagnostics();
      const physicsDiagnostics = physicsProjectileRuntime.diagnostics();
      const selectedTargetPosition =
        selectedTarget === undefined
          ? undefined
          : (physicsProjectileRuntime.targetPosition(selectedTarget.id, "owner") ??
            selectedTarget.position);
      const cooldownDuration = Math.max(1, cooldownUntilTick - cooldownStartedAtTick);
      const cooldownRemaining = Math.max(0, cooldownUntilTick - tick);
      return {
        ready: !disposed,
        tick,
        elapsed,
        generation,
        peers: authorityNetwork.peers().filter((peer) => peer.status !== "left").length,
        latencyMs,
        faultInjection,
        autoFire,
        canFire: tick >= cooldownUntilTick && selectedTarget !== undefined,
        cooldownProgress: 1 - cooldownRemaining / cooldownDuration,
        selectedWeaponId,
        selectedTargetId,
        aimAngle:
          selectedTargetPosition === undefined
            ? 0
            : Math.atan2(
                selectedTargetPosition.y - MULTIPLAYER_PROJECTILE_WORLD.muzzle.y,
                selectedTargetPosition.x - MULTIPLAYER_PROJECTILE_WORLD.muzzle.x
              ),
        targets: MULTIPLAYER_PROJECTILE_TARGETS.map((target) => {
          const state = requireTargetState(target.id);
          const position =
            physicsProjectileRuntime.targetPosition(target.id, "owner") ?? target.position;
          return {
            id: target.id,
            callsign: target.callsign,
            role: target.role,
            armor: target.armor,
            position: { ...position },
            radius: target.radius,
            health: state.health,
            maxHealth: target.maxHealth,
            alive: state.alive,
            selected: selectedTargetId === target.id,
            lastDamage: state.lastDamage,
            ...(state.lastHitTick === undefined
              ? {}
              : { hitAgeTicks: Math.max(0, tick - state.lastHitTick) })
          };
        }),
        shots,
        damageDealt,
        defeatedTargets,
        ownerWallX: selectedTargetPosition?.x ?? MULTIPLAYER_PROJECTILE_WORLD.width,
        authorityWallX: faultInjection
          ? MULTIPLAYER_PROJECTILE_WORLD.authorityDesyncCover.position.x
          : (selectedTargetPosition?.x ?? MULTIPLAYER_PROJECTILE_WORLD.width),
        ...(latestShot?.owner === undefined ? {} : { owner: latestShot.owner }),
        ...(latestShot?.authority === undefined ? {} : { authority: latestShot.authority }),
        ...(latestShot?.remote === undefined ? {} : { remote: latestShot.remote }),
        ...(latestShot === undefined ? {} : { latestCorrelationId: latestShot.correlationId }),
        ...(latestShot?.reconciliation === undefined
          ? {}
          : { reconciliation: latestShot.reconciliation }),
        ...(latestShot === undefined ? {} : { matchStatus: latestShot.matchStatus }),
        pendingCommands: commandQueue.length,
        pendingRecords:
          ownerRecordQueue.length +
          remoteRecordQueue.length +
          ownerPhysicsSnapshotQueue.length +
          remotePhysicsSnapshotQueue.length,
        ownerPenetration: 0,
        diagnostics: {
          predicted: registryDiagnostics.registered + physicsDiagnostics.predictedSpawns.registered,
          matched: registryDiagnostics.matched + physicsDiagnostics.predictedSpawns.matched,
          corrected: corrected + physicsDiagnostics.owner.corrections,
          stale,
          authoritySweeps: authorityDiagnostics.physicsSweeps,
          ownerSweeps: ownerDiagnostics.physicsSweeps,
          remoteRecords: remoteRecords.diagnostics().records + physicsDiagnostics.remoteSnapshots,
          physicsSteps: physicsDiagnostics.owner.steps + physicsDiagnostics.authority.steps,
          resimulatedTicks: physicsDiagnostics.owner.resimulatedTicks,
          checkpointBytes:
            physicsDiagnostics.owner.historyBytes + physicsDiagnostics.authority.historyBytes,
          physicsContacts: physicsDiagnostics.ownerContacts + physicsDiagnostics.authorityContacts
        }
      };
    },
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribeAuthority();
      unsubscribeOwner();
      unsubscribeRemote();
      unsubscribeOwnerPhysics();
      unsubscribeRemotePhysics();
      commandQueue.length = 0;
      ownerRecordQueue.length = 0;
      remoteRecordQueue.length = 0;
      ownerPhysicsSnapshotQueue.length = 0;
      remotePhysicsSnapshotQueue.length = 0;
      shotMetadata.clear();
      shotOrder.length = 0;
      localProjectileByCorrelation.clear();
      authorityProjectileByCorrelation.clear();
      matchStatusByCorrelation.clear();
      reconciliationByCorrelation.clear();
      finalReconciliationByCorrelation.clear();
      sentAuthorityFinish.clear();
      damagedAuthorityProjectiles.clear();
      damagedPhysicsContacts.clear();
      syncedOwnerTargetPositions.clear();
      syncedAuthorityTargetPositions.clear();
      ownerSeenAuthorityCorrelations.clear();
      spawnRegistry.dispose();
      ownerSimulation.dispose();
      authoritySimulation.dispose();
      ownerAuthorityRecords.dispose();
      remoteRecords.dispose();
      physicsProjectileRuntime.dispose();
      ownerBattlefield.dispose();
      authorityBattlefield.dispose();
      await Promise.all([
        remoteNetwork.dispose(),
        ownerNetwork.dispose(),
        authorityNetwork.dispose()
      ]);
    }
  };

  return runtime;

  async function fireSelectedWeapon(): Promise<string | undefined> {
    if (tick < cooldownUntilTick) {
      return undefined;
    }
    ensureLivingSelectedTarget();
    const target = getMultiplayerProjectileTarget(selectedTargetId);
    if (target === undefined || requireTargetState(target.id).alive === false) {
      return undefined;
    }
    const weapon = getMultiplayerProjectileWeapon(selectedWeaponId);
    const origin = { ...MULTIPLAYER_PROJECTILE_WORLD.muzzle };
    const targetPosition =
      physicsProjectileRuntime.targetPosition(target.id, "owner") ?? target.position;
    if (weapon.simulation === "physics-island") {
      sequence += 1;
      const correlationId = `shot-${generation}-${sequence}`;
      cooldownStartedAtTick = tick;
      cooldownUntilTick = tick + weapon.cooldownTicks;
      const command = physicsProjectileRuntime.createPredictedFire({
        correlationId,
        generation,
        targetId: target.id,
        targetPosition,
        fireTick: tick
      });
      shotMetadata.set(correlationId, {
        simulation: "physics-island",
        correlationId,
        weaponId: weapon.id,
        targetId: target.id,
        projectileIndex: 0,
        fireTick: tick
      });
      shotOrder.push(correlationId);
      trimShotHistory();
      latestCorrelationId = correlationId;
      await ownerNetwork.send<FireCommand>({
        channel: CHANNEL,
        kind: FIRE_MESSAGE_KIND,
        correlationId,
        tick,
        targetPeerIds: [AUTHORITY_PEER_ID],
        payload: command
      });
      return correlationId;
    }
    const direction = normalizeVector({
      x: targetPosition.x - origin.x,
      y: targetPosition.y - origin.y
    });
    const firstCorrelationId = `shot-${generation}-${sequence + 1}`;
    cooldownStartedAtTick = tick;
    cooldownUntilTick = tick + weapon.cooldownTicks;

    for (
      let projectileIndex = 0;
      projectileIndex < weapon.projectilesPerShot;
      projectileIndex += 1
    ) {
      sequence += 1;
      const correlationId = `shot-${generation}-${sequence}`;
      const projectileId = `predicted-${correlationId}`;
      const angleOffset = projectileSpreadAngle(weapon, projectileIndex);
      const velocity = rotateAndScale(direction, angleOffset, weapon.speed);
      const result = ownerSimulation.fire({
        projectileId,
        correlationId,
        generation,
        definitionId: weapon.definition.id,
        definitionVersion: weapon.definition.version,
        fireTick: tick,
        firePosition: origin,
        fireVelocity: velocity
      });
      if (result.status !== "fired" || result.record === undefined) {
        throw new Error(`Sandbox owner projectile prediction failed: ${result.status}`);
      }
      const metadata: ShotMetadata = {
        simulation: "kinematic",
        correlationId,
        weaponId: weapon.id,
        targetId: target.id,
        projectileIndex,
        fireTick: tick
      };
      shotMetadata.set(correlationId, metadata);
      shotOrder.push(correlationId);
      trimShotHistory();
      latestCorrelationId = correlationId;
      localProjectileByCorrelation.set(correlationId, projectileId);
      matchStatusByCorrelation.set(correlationId, "predicted");
      spawnRegistry.register({
        kind: "kinematic-projectile",
        correlationId,
        generation,
        localId: projectileId,
        tick,
        value: result.record
      });
      await ownerNetwork.send<FireCommand>({
        channel: CHANNEL,
        kind: FIRE_MESSAGE_KIND,
        correlationId,
        tick,
        targetPeerIds: [AUTHORITY_PEER_ID],
        payload: {
          simulation: "kinematic",
          correlationId,
          generation,
          fireTick: tick,
          weaponId: weapon.id,
          targetId: target.id,
          projectileIndex,
          firePosition: origin,
          fireVelocity: velocity
        }
      });
    }
    return firstCorrelationId;
  }

  function createPeerRuntime(label: string, peerId: string): MultiplayerRuntime {
    return createMultiplayerRuntime({
      id: `sandbox.projectile-field.${label}`,
      backend,
      clock: () => elapsed,
      connectContext: { localPeer: { id: peerId } }
    });
  }

  function createSimulation(
    battlefield: MultiplayerProjectileBattlefieldScene,
    currentGeneration: number
  ): CombatKinematicProjectileRuntime {
    return createCombatKinematicProjectileRuntime({
      queries: sceneQueries(battlefield.scene),
      generation: currentGeneration,
      fixedDeltaMs: FIXED_DELTA_MS,
      maxActiveProjectiles: 128,
      maxRecords: RECORD_CAPACITY,
      maxCatchUpTicksPerAdvance: 360,
      resolveDefinition(id, version) {
        return findMultiplayerProjectileWeaponByDefinition(id, version)?.definition;
      },
      resolveSubject(hit) {
        const target = MULTIPLAYER_PROJECTILE_TARGETS.find(
          (candidate) => `${candidate.id}.collider` === hit.colliderId
        );
        return {
          ...(target === undefined ? {} : { actorId: target.id }),
          ...(hit.bodyId === undefined ? {} : { bodyId: hit.bodyId }),
          colliderId: hit.colliderId
        };
      }
    });
  }

  function createRecordBuffer(currentGeneration: number): CombatKinematicProjectileRecordBuffer {
    return createCombatKinematicProjectileRecordBuffer({
      generation: currentGeneration,
      capacity: RECORD_CAPACITY
    });
  }

  function processQueues(): void {
    drainQueue(commandQueue, elapsed, (command) => {
      if (command.generation !== generation) {
        stale += 1;
        return;
      }
      if (command.simulation === "physics-island") {
        applyPhysicsAuthorityContacts(physicsProjectileRuntime.applyAuthorityFire(command));
        return;
      }
      const weapon = getMultiplayerProjectileWeapon(command.weaponId);
      if (weapon.simulation !== "kinematic") {
        stale += 1;
        return;
      }
      const projectileId = `authority-${command.correlationId}`;
      authorityProjectileByCorrelation.set(command.correlationId, projectileId);
      const fired = authoritySimulation.fire({
        projectileId,
        correlationId: command.correlationId,
        generation: command.generation,
        definitionId: weapon.definition.id,
        definitionVersion: weapon.definition.version,
        fireTick: command.fireTick,
        firePosition: command.firePosition,
        fireVelocity: command.fireVelocity
      });
      if (fired.status === "fired" && fired.record !== undefined) {
        sendAuthorityRecord(fired.record);
        finishAuthorityRecords(authoritySimulation.advanceTo(tick).finished);
      }
    });
    drainQueue(ownerRecordQueue, elapsed, applyOwnerAuthorityRecord);
    drainQueue(remoteRecordQueue, elapsed, (record) => {
      if (record.generation !== generation) {
        stale += 1;
        return;
      }
      remoteRecords.upsert(record);
    });
    drainQueue(ownerPhysicsSnapshotQueue, elapsed, (snapshot) => {
      physicsProjectileRuntime.applyOwnerAuthoritySnapshot(snapshot);
    });
    drainQueue(remotePhysicsSnapshotQueue, elapsed, (snapshot) => {
      physicsProjectileRuntime.applyRemoteAuthoritySnapshot(snapshot);
    });
  }

  function applyPhysicsAuthorityContacts(
    contacts: readonly MultiplayerPhysicsProjectileContactFact[]
  ): void {
    const weapon = getMultiplayerProjectileWeapon("gravity-ricochet");
    for (const contact of contacts) {
      if (contact.kind !== "target" || contact.targetId === undefined) {
        continue;
      }
      const key = `${contact.correlationId}:${contact.targetId}`;
      if (damagedPhysicsContacts.has(key)) {
        continue;
      }
      damagedPhysicsContacts.add(key);
      damageTarget(contact.targetId, weapon.damage, contact.tick);
    }
  }

  function finishAuthorityRecords(records: CombatKinematicProjectileRecord[]): void {
    for (const record of records) {
      applyAuthorityDamage(record);
      if (!sentAuthorityFinish.has(record.projectileId)) {
        sentAuthorityFinish.add(record.projectileId);
        sendAuthorityRecord(record);
      }
    }
  }

  function applyAuthorityDamage(record: CombatKinematicProjectileRecord): void {
    if (
      record.finish?.reason !== "impact" ||
      damagedAuthorityProjectiles.has(record.projectileId)
    ) {
      return;
    }
    damagedAuthorityProjectiles.add(record.projectileId);
    const weapon = findMultiplayerProjectileWeaponByDefinition(
      record.definitionId,
      record.definitionVersion
    );
    if (weapon === undefined) {
      return;
    }
    const directTargetId = record.finish.subject?.actorId;
    if (directTargetId !== undefined) {
      damageTarget(directTargetId, weapon.damage, record.finish.tick);
    }
    if (weapon.blastRadius <= 0) {
      return;
    }
    for (const target of MULTIPLAYER_PROJECTILE_TARGETS) {
      if (target.id === directTargetId || requireTargetState(target.id).alive === false) {
        continue;
      }
      const distance = vectorDistance(record.finish.position, target.position);
      if (distance > weapon.blastRadius + target.radius) {
        continue;
      }
      const falloff = Math.max(0.25, 1 - distance / (weapon.blastRadius + target.radius));
      damageTarget(target.id, weapon.damage * falloff * 0.72, record.finish.tick);
    }
  }

  function damageTarget(targetId: string, rawDamage: number, hitTick: number): void {
    const definition = getMultiplayerProjectileTarget(targetId);
    const state = targetStates.get(targetId);
    if (definition === undefined || state?.alive !== true) {
      return;
    }
    const armorMultiplier =
      definition.armor === "heavy" ? 0.72 : definition.armor === "medium" ? 0.88 : 1;
    const damage = Math.max(1, Math.round(rawDamage * armorMultiplier));
    state.health = Math.max(0, state.health - damage);
    state.lastDamage = damage;
    state.lastHitTick = hitTick;
    damageDealt += damage;
    if (state.health <= 0) {
      state.alive = false;
      defeatedTargets += 1;
      ownerBattlefield.setTargetEnabled(targetId, false);
      authorityBattlefield.setTargetEnabled(targetId, false);
      if (selectedTargetId === targetId) {
        ensureLivingSelectedTarget();
      }
    }
  }

  function applyOwnerAuthorityRecord(record: CombatKinematicProjectileRecord): void {
    if (record.generation !== generation) {
      stale += 1;
      return;
    }
    authorityProjectileByCorrelation.set(record.correlationId, record.projectileId);
    ownerAuthorityRecords.upsert(record);
    if (!ownerSeenAuthorityCorrelations.has(record.correlationId)) {
      ownerSeenAuthorityCorrelations.add(record.correlationId);
      const match = spawnRegistry.match({
        kind: "kinematic-projectile",
        correlationId: record.correlationId,
        generation: record.generation,
        authorityId: record.projectileId,
        tick: record.fireTick,
        value: record
      });
      matchStatusByCorrelation.set(record.correlationId, match.status);
    }
  }

  function sendAuthorityRecord(record: CombatKinematicProjectileRecord): void {
    void authorityNetwork
      .send<CombatKinematicProjectileRecord>({
        channel: CHANNEL,
        kind: RECORD_MESSAGE_KIND,
        correlationId: record.correlationId,
        tick: record.finish?.tick ?? record.fireTick,
        targetPeerIds: [OWNER_PEER_ID, REMOTE_PEER_ID],
        payload: cloneRecord(record)
      })
      .catch(() => {
        stale += 1;
      });
  }

  function sendPhysicsAuthoritySnapshot(snapshot: PhysicsPredictionIslandStateSnapshot): void {
    void authorityNetwork
      .send<PhysicsPredictionIslandStateSnapshot>({
        channel: CHANNEL,
        kind: PHYSICS_SNAPSHOT_MESSAGE_KIND,
        correlationId: `physics-island-${generation}-${snapshot.tick}`,
        tick: snapshot.tick,
        targetPeerIds: [OWNER_PEER_ID, REMOTE_PEER_ID],
        payload: clonePhysicsStateSnapshot(snapshot)
      })
      .catch(() => {
        stale += 1;
      });
  }

  function syncPhysicsTargetPositions(): void {
    for (const target of MULTIPLAYER_PROJECTILE_TARGETS) {
      const ownerPosition = physicsProjectileRuntime.targetPosition(target.id, "owner");
      if (
        ownerPosition !== undefined &&
        positionChanged(syncedOwnerTargetPositions.get(target.id), ownerPosition)
      ) {
        ownerBattlefield.setTargetPosition(target.id, ownerPosition);
        syncedOwnerTargetPositions.set(target.id, { ...ownerPosition });
      }
      const authorityPosition = physicsProjectileRuntime.targetPosition(target.id, "authority");
      if (
        authorityPosition !== undefined &&
        positionChanged(syncedAuthorityTargetPositions.get(target.id), authorityPosition)
      ) {
        authorityBattlefield.setTargetPosition(target.id, authorityPosition);
        syncedAuthorityTargetPositions.set(target.id, { ...authorityPosition });
      }
    }
  }

  function refreshReconciliations(): void {
    for (const correlationId of shotOrder.slice(-96)) {
      const localId = localProjectileByCorrelation.get(correlationId);
      const authorityId = authorityProjectileByCorrelation.get(correlationId);
      if (localId === undefined || authorityId === undefined) {
        continue;
      }
      const predicted = ownerSimulation.getRecord(localId);
      const authoritative = ownerAuthorityRecords.get(authorityId);
      if (predicted === undefined || authoritative === undefined) {
        continue;
      }
      const reconciliation = reconcileCombatKinematicProjectileRecords(predicted, authoritative);
      reconciliationByCorrelation.set(correlationId, reconciliation);
      if (reconciliation.status === "pending") {
        continue;
      }
      const previous = finalReconciliationByCorrelation.get(correlationId);
      if (previous === undefined && reconciliation.status === "corrected") {
        corrected += 1;
      }
      finalReconciliationByCorrelation.set(correlationId, reconciliation.status);
    }
  }

  function createShotSnapshot(correlationId: string): MultiplayerProjectileLabShotSnapshot {
    const metadata = shotMetadata.get(correlationId);
    if (metadata === undefined) {
      throw new Error(`Missing projectile shot metadata: ${correlationId}`);
    }
    if (metadata.simulation === "physics-island") {
      const sample = physicsProjectileRuntime.sample(correlationId);
      const physicsReconciliation = physicsProjectileRuntime.diagnostics().latestReconciliation;
      return {
        correlationId,
        weaponId: metadata.weaponId,
        targetId: metadata.targetId,
        projectileIndex: metadata.projectileIndex,
        firedAtTick: metadata.fireTick,
        simulation: "physics-island",
        matchStatus: sample?.matchStatus ?? "predicted",
        ...(physicsReconciliation === undefined
          ? {}
          : { physicsReconciliation: { ...physicsReconciliation } }),
        ...(sample?.owner === undefined
          ? {}
          : { owner: samplePhysicsBody(sample.owner, tick, sample.despawnTick) }),
        ...(sample?.authority === undefined
          ? {}
          : { authority: samplePhysicsBody(sample.authority, tick, sample.despawnTick) }),
        ...(sample?.remote === undefined
          ? {}
          : { remote: samplePhysicsBody(sample.remote, tick, sample.despawnTick) })
      };
    }
    const localId = localProjectileByCorrelation.get(correlationId);
    const authorityId = authorityProjectileByCorrelation.get(correlationId);
    const ownerRecord = localId === undefined ? undefined : ownerSimulation.getRecord(localId);
    const authorityRecord =
      authorityId === undefined ? undefined : authoritySimulation.getRecord(authorityId);
    const remoteRecord = authorityId === undefined ? undefined : remoteRecords.get(authorityId);
    const remoteTick = Math.max(0, tick - remotePresentationDelayTicks());
    const owner = sampleRecord(ownerRecord, tick);
    const authority = sampleRecord(authorityRecord, tick);
    const remote = sampleRecord(remoteRecord, remoteTick);
    const reconciliation = reconciliationByCorrelation.get(correlationId);
    return {
      correlationId,
      weaponId: metadata.weaponId,
      targetId: metadata.targetId,
      projectileIndex: metadata.projectileIndex,
      firedAtTick: metadata.fireTick,
      simulation: "kinematic",
      matchStatus: matchStatusByCorrelation.get(correlationId) ?? "predicted",
      ...(reconciliation === undefined ? {} : { reconciliation: { ...reconciliation } }),
      ...(owner === undefined ? {} : { owner }),
      ...(authority === undefined ? {} : { authority }),
      ...(remote === undefined ? {} : { remote })
    };
  }

  function resetState(): void {
    generation += 1;
    latestCorrelationId = undefined;
    cooldownStartedAtTick = tick;
    cooldownUntilTick = tick;
    corrected = 0;
    stale = 0;
    damageDealt = 0;
    defeatedTargets = 0;
    commandQueue.length = 0;
    ownerRecordQueue.length = 0;
    remoteRecordQueue.length = 0;
    ownerPhysicsSnapshotQueue.length = 0;
    remotePhysicsSnapshotQueue.length = 0;
    shotMetadata.clear();
    shotOrder.length = 0;
    localProjectileByCorrelation.clear();
    authorityProjectileByCorrelation.clear();
    matchStatusByCorrelation.clear();
    reconciliationByCorrelation.clear();
    finalReconciliationByCorrelation.clear();
    sentAuthorityFinish.clear();
    damagedAuthorityProjectiles.clear();
    damagedPhysicsContacts.clear();
    ownerSeenAuthorityCorrelations.clear();
    spawnRegistry.reset(generation);
    ownerSimulation.reset(generation);
    authoritySimulation.reset(generation);
    ownerAuthorityRecords.reset(generation);
    remoteRecords.reset(generation);
    physicsProjectileRuntime.reset(generation, tick, faultInjection);
    syncedOwnerTargetPositions.clear();
    syncedAuthorityTargetPositions.clear();
    for (const target of MULTIPLAYER_PROJECTILE_TARGETS) {
      targetStates.set(target.id, {
        health: target.maxHealth,
        alive: true,
        lastDamage: 0
      });
      ownerBattlefield.setTargetEnabled(target.id, true);
      authorityBattlefield.setTargetEnabled(target.id, true);
    }
    selectedTargetId = DEFAULT_TARGET_ID;
    ownerBattlefield.setAuthorityDesyncCover(false);
    authorityBattlefield.setAuthorityDesyncCover(faultInjection);
  }

  function ensureLivingSelectedTarget(): void {
    if (targetStates.get(selectedTargetId)?.alive === true) {
      return;
    }
    selectedTargetId =
      MULTIPLAYER_PROJECTILE_TARGETS.find((target) => targetStates.get(target.id)?.alive === true)
        ?.id ?? DEFAULT_TARGET_ID;
  }

  function trimShotHistory(): void {
    while (shotOrder.length > RECORD_CAPACITY) {
      const correlationId = shotOrder.shift();
      if (correlationId === undefined) {
        return;
      }
      const localProjectileId = localProjectileByCorrelation.get(correlationId);
      const authorityProjectileId = authorityProjectileByCorrelation.get(correlationId);
      shotMetadata.delete(correlationId);
      physicsProjectileRuntime.forget(correlationId);
      localProjectileByCorrelation.delete(correlationId);
      authorityProjectileByCorrelation.delete(correlationId);
      matchStatusByCorrelation.delete(correlationId);
      reconciliationByCorrelation.delete(correlationId);
      finalReconciliationByCorrelation.delete(correlationId);
      ownerSeenAuthorityCorrelations.delete(correlationId);
      if (authorityProjectileId !== undefined) {
        sentAuthorityFinish.delete(authorityProjectileId);
        damagedAuthorityProjectiles.delete(authorityProjectileId);
      }
      if (localProjectileId !== undefined && latestCorrelationId === correlationId) {
        latestCorrelationId = undefined;
      }
    }
  }

  function requireTargetState(targetId: string): TargetState {
    const state = targetStates.get(targetId);
    if (state === undefined) {
      throw new Error(`Missing projectile lab target state: ${targetId}`);
    }
    return state;
  }

  function oneWayLatency(): number {
    return latencyMs / 2;
  }

  function remotePresentationDelayTicks(): number {
    return Math.ceil((oneWayLatency() + 40) / FIXED_DELTA_MS);
  }

  function assertActive(): void {
    if (disposed) {
      throw new Error("Sandbox multiplayer projectile lab has been disposed.");
    }
  }

  function advanceFixedTick(): void {
    tick += 1;
    ownerSimulation.advanceTo(tick);
    finishAuthorityRecords(authoritySimulation.advanceTo(tick).finished);
    const physicsAdvance = physicsProjectileRuntime.advanceTo(tick);
    applyPhysicsAuthorityContacts(physicsAdvance.authorityContacts);
    if (physicsAdvance.authoritySnapshot !== undefined) {
      sendPhysicsAuthoritySnapshot(physicsAdvance.authoritySnapshot);
    }
    syncPhysicsTargetPositions();
    spawnRegistry.expire(tick);
    if (autoFire && tick >= cooldownUntilTick) {
      void fireSelectedWeapon().catch(() => {
        stale += 1;
      });
    }
  }

  function updateRuntime(deltaMs: number): void {
    assertActive();
    const delta = Math.max(0, Math.min(100, Number.isFinite(deltaMs) ? deltaMs : 0));
    elapsed += delta;
    processQueues();
    accumulator += delta;
    while (accumulator + Number.EPSILON >= FIXED_DELTA_MS) {
      accumulator -= FIXED_DELTA_MS;
      advanceFixedTick();
    }
    processQueues();
    refreshReconciliations();
  }
}

function sceneQueries(scene: PhysicsScene): PhysicsKinematicSweepQueries {
  return {
    raycast(origin, direction, options) {
      return raycast(scene, origin, direction, options);
    },
    shapeCast(shape, position, direction, options) {
      return shapeCast(scene, shape, position, direction, options);
    }
  };
}

function sampleRecord(
  record: CombatKinematicProjectileRecord | undefined,
  sampleTick: number
): MultiplayerProjectileLabLaneSample | undefined {
  if (record === undefined || sampleTick < record.fireTick) {
    return undefined;
  }
  const sample = sampleCombatKinematicProjectileRecord(record, sampleTick);
  const previous = sampleCombatKinematicProjectileRecord(
    record,
    Math.max(record.fireTick, sampleTick - 3)
  );
  return {
    projectileId: record.projectileId,
    position: { ...sample.position },
    previousPosition: { ...previous.position },
    x: sample.position.x,
    y: sample.position.y,
    active: sample.active,
    finished: sample.finish !== undefined,
    ...(sample.finish === undefined ? {} : { finishTick: sample.finish.tick }),
    ...(sample.finish === undefined ? {} : { finishReason: sample.finish.reason }),
    ...(sample.finish?.subject?.actorId === undefined
      ? {}
      : { subjectId: sample.finish.subject.actorId })
  };
}

function samplePhysicsBody(
  body: PhysicsBodyState,
  tick: number,
  despawnTick: number
): MultiplayerProjectileLabLaneSample {
  const trailSeconds = (FIXED_DELTA_MS * 3) / 1000;
  const previousPosition = {
    x: body.position.x - body.linearVelocity.x * trailSeconds,
    y: body.position.y - body.linearVelocity.y * trailSeconds,
    ...(body.position.z === undefined
      ? {}
      : { z: body.position.z - (body.linearVelocity.z ?? 0) * trailSeconds })
  };
  return {
    projectileId: body.id,
    position: { ...body.position },
    previousPosition,
    x: body.position.x,
    y: body.position.y,
    active: tick < despawnTick,
    finished: tick >= despawnTick,
    ...(tick < despawnTick ? {} : { finishTick: despawnTick, finishReason: "expired" })
  };
}

function projectileSpreadAngle(
  weapon: MultiplayerProjectileWeapon,
  projectileIndex: number
): number {
  if (weapon.projectilesPerShot <= 1 || weapon.spreadDegrees <= 0) {
    return 0;
  }
  const unit = projectileIndex / (weapon.projectilesPerShot - 1) - 0.5;
  return (unit * weapon.spreadDegrees * Math.PI) / 180;
}

function rotateAndScale(direction: PhysicsVector, angle: number, speed: number): PhysicsVector {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: (direction.x * cosine - direction.y * sine) * speed,
    y: (direction.x * sine + direction.y * cosine) * speed
  };
}

function normalizeVector(vector: PhysicsVector): PhysicsVector {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= Number.EPSILON) {
    return { x: 1, y: 0 };
  }
  return { x: vector.x / length, y: vector.y / length };
}

function vectorDistance(left: PhysicsVector, right: PhysicsVector): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function positionChanged(previous: PhysicsVector | undefined, next: PhysicsVector): boolean {
  return previous === undefined || vectorDistance(previous, next) > 0.000_1;
}

function cloneFireCommand(command: FireCommand): FireCommand {
  return {
    ...command,
    firePosition: { ...command.firePosition },
    fireVelocity: { ...command.fireVelocity }
  };
}

function clonePhysicsStateSnapshot(
  snapshot: PhysicsPredictionIslandStateSnapshot
): PhysicsPredictionIslandStateSnapshot {
  return structuredClone(snapshot);
}

function cloneRecord(record: CombatKinematicProjectileRecord): CombatKinematicProjectileRecord {
  return {
    ...record,
    firePosition: { ...record.firePosition },
    fireVelocity: { ...record.fireVelocity },
    ...(record.finish === undefined
      ? {}
      : {
          finish: {
            ...record.finish,
            position: { ...record.finish.position },
            ...(record.finish.normal === undefined ? {} : { normal: { ...record.finish.normal } }),
            ...(record.finish.subject === undefined
              ? {}
              : { subject: { ...record.finish.subject } })
          }
        })
  };
}

function normalizeLatency(value: number): number {
  if (!Number.isFinite(value)) {
    return 240;
  }
  return Math.max(0, Math.min(1_000, Math.round(value)));
}

function drainQueue<TPayload>(
  queue: Array<DelayedMessage<TPayload>>,
  elapsed: number,
  consume: (payload: TPayload) => void
): void {
  let read = 0;
  while (read < queue.length && queue[read]!.deliverAt <= elapsed) {
    consume(queue[read]!.payload);
    read += 1;
  }
  if (read > 0) {
    queue.splice(0, read);
  }
}
