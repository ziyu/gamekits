import type { CombatKinematicProjectileReconciliation } from "@gamekits/combat";
import type { PhysicsVector } from "@gamekits/physics-core";

export type MultiplayerProjectileLabNetworkConfig = {
  latencyMs: number;
  jitterMs: number;
  reorderMs: number;
  duplicateEvery: number;
  partitioned: boolean;
};

export type MultiplayerProjectileLabScenarioConfig = {
  id: string;
  label: string;
  description: string;
  collisionMode: "ray-sweep" | "shape-sweep";
  projectileRadius: number;
  lifetimeTicks: number;
  firePosition: PhysicsVector;
  fireVelocity: PhysicsVector;
  ownerWallX: number;
  authorityWallX: number;
  ownerWallEnabled: boolean;
  authorityWallEnabled: boolean;
  burstCount: number;
  burstIntervalTicks: number;
  releasePartitionAfterMs?: number | undefined;
  expected: {
    reconciliation: "confirmed" | "corrected";
    finishReason: "impact" | "expired";
  };
  network: MultiplayerProjectileLabNetworkConfig;
};

export type MultiplayerProjectileLabConfigPatch = Partial<
  Omit<MultiplayerProjectileLabScenarioConfig, "network" | "expected">
> & {
  network?: Partial<MultiplayerProjectileLabNetworkConfig> | undefined;
};

export type MultiplayerProjectileLabLaneSample = {
  projectileId: string;
  position: PhysicsVector;
  active: boolean;
  finished: boolean;
  finishReason?: string | undefined;
};

export type MultiplayerProjectileLabShotSnapshot = {
  correlationId: string;
  index: number;
  selected: boolean;
  matchStatus: string;
  reconciliation?: CombatKinematicProjectileReconciliation | undefined;
  owner?: MultiplayerProjectileLabLaneSample | undefined;
  authority?: MultiplayerProjectileLabLaneSample | undefined;
  remote?: MultiplayerProjectileLabLaneSample | undefined;
};

export type MultiplayerProjectileLabInvariant = {
  id: string;
  label: string;
  status: "pending" | "pass" | "fail";
  detail: string;
};

export type MultiplayerProjectileLabAcceptanceResult = {
  presetId: string;
  label: string;
  passed: boolean;
  durationMs: number;
  failedInvariants: string[];
};

export type MultiplayerProjectileLabSnapshot = {
  ready: boolean;
  paused: boolean;
  suiteRunning: boolean;
  settled: boolean;
  tick: number;
  elapsed: number;
  generation: number;
  peers: number;
  config: MultiplayerProjectileLabScenarioConfig;
  shots: MultiplayerProjectileLabShotSnapshot[];
  selectedCorrelationId?: string | undefined;
  acceptanceResults: MultiplayerProjectileLabAcceptanceResult[];
  invariants: MultiplayerProjectileLabInvariant[];
  pendingCommands: number;
  pendingRecords: number;
  heldPackets: number;
  ownerPenetration: number;
  diagnostics: {
    predicted: number;
    matched: number;
    corrected: number;
    stale: number;
    authoritySweeps: number;
    ownerSweeps: number;
    remoteRecords: number;
    packetsScheduled: number;
    packetsDelivered: number;
    packetsDuplicated: number;
    packetsReordered: number;
  };
  // Compatibility summary for callers that only inspect the selected shot.
  latencyMs: number;
  faultInjection: boolean;
  ownerWallX: number;
  authorityWallX: number;
  owner?: MultiplayerProjectileLabLaneSample | undefined;
  authority?: MultiplayerProjectileLabLaneSample | undefined;
  remote?: MultiplayerProjectileLabLaneSample | undefined;
  latestCorrelationId?: string | undefined;
  reconciliation?: CombatKinematicProjectileReconciliation | undefined;
  matchStatus?: string | undefined;
};
