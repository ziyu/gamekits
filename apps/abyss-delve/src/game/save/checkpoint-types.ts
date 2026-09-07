import type { GasActorRuntimeState } from "@gamekits/gas";
import type { ActorRole, CombatState, EnemyAiState, LootKind, PositionState } from "../components";

export const ABYSS_CHECKPOINT_SECTION_ID = "abyss.run_checkpoint";
export const ABYSS_CHECKPOINT_SECTION_VERSION = "1.0.0";

export type AbyssCheckpointPhase = "combat" | "reward" | "complete";

export type AbyssCheckpointActorGasState = Pick<
  GasActorRuntimeState,
  "actor" | "attributes" | "tags" | "abilities" | "effects"
>;

export type AbyssCheckpointPlayer = {
  actorId: string;
  definitionId: string;
  archetypeId: string;
  label: string;
  position: PositionState;
  combat: CombatState;
  gas?: AbyssCheckpointActorGasState | undefined;
};

export type AbyssCheckpointEnemy = {
  actorId: string;
  definitionId: string;
  archetypeId: string;
  label: string;
  role: ActorRole;
  position: PositionState;
  combat: CombatState;
  ai: EnemyAiState;
  gas?: AbyssCheckpointActorGasState | undefined;
};

export type AbyssCheckpointLoot = {
  lootId: string;
  label: string;
  kind: LootKind;
  amount: number;
  sourceActorId?: string | undefined;
  position: PositionState;
  renderKey: string;
  layer: number;
};

export type AbyssCheckpointData = {
  version: 1;
  runId: string;
  seed: string;
  checkpointVersion: number;
  roomIndex: number;
  currentRoomId: string;
  activeWaveId?: string | undefined;
  activeRewardPoolId?: string | undefined;
  phase: AbyssCheckpointPhase;
  completedRoomIds: string[];
  selectedRewardIds: string[];
  selectedReward?: string | undefined;
  gold: number;
  recentLoot: string[];
  rewardChoices: Array<{
    id: string;
    selected: boolean;
  }>;
  player: AbyssCheckpointPlayer;
  enemies: AbyssCheckpointEnemy[];
  loot: AbyssCheckpointLoot[];
};
