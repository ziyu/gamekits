import { DevToolsOverlay } from "@gamekits/devtools-ui";
import type { DevToolsRuntime } from "@gamekits/devtools";
import type { UiRuntime } from "@gamekits/ui-core";
import { useCallback } from "react";
import type { AbyssSnapshot } from "../game";
import { renderAbyssDevToolsPanel } from "./devtools/AbyssDevToolsPanel";

export type AbyssAppProps = {
  snapshot: AbyssSnapshot | undefined;
  rendererRoot: HTMLElement;
  uiRuntime: UiRuntime;
  devtools?: DevToolsRuntime | undefined;
  saveStatus?: string | undefined;
  onReward(rewardId: string): void;
  onSaveCheckpoint(): void;
  onLoadCheckpoint(): void;
  onGameFocus(): void;
};

export function AbyssApp({
  devtools,
  onLoadCheckpoint,
  onGameFocus,
  onReward,
  onSaveCheckpoint,
  rendererRoot,
  saveStatus,
  snapshot,
  uiRuntime
}: AbyssAppProps) {
  const player = snapshot?.player;
  const objective = snapshot?.objective;
  const attachRenderer = useCallback(
    (stage: HTMLElement | null) => {
      if (stage && !stage.contains(rendererRoot)) {
        stage.prepend(rendererRoot);
      }
    },
    [rendererRoot]
  );
  return (
    <main className="abyss-app">
      <section
        className="abyss-stage"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={onGameFocus}
        ref={attachRenderer}
      >
        <div className="abyss-vignette" />
        <header className="abyss-objective">
          <span>{objective?.label ?? "Entering chamber"}</span>
          <strong>{objective ? `${objective.remainingEnemies} enemies` : "loading"}</strong>
        </header>
        <div className="abyss-room-status">
          <span>{snapshot?.running ? "RUNNING" : "BOOTING"}</span>
          <span>{snapshot ? `TICK ${snapshot.clock.ticks}` : "TICK 0"}</span>
        </div>
        {snapshot?.pickupPrompt ? (
          <div className="abyss-pickup">E Pick up {snapshot.pickupPrompt.label}</div>
        ) : null}
        <footer className="abyss-hud">
          <div className="abyss-bars">
            <Meter
              label="Life"
              max={player?.maxHealth ?? 1}
              tone="life"
              value={player?.health ?? 0}
            />
            <Meter
              label="Energy"
              max={player?.maxEnergy ?? 1}
              tone="energy"
              value={player?.energy ?? 0}
            />
            <div className="abyss-gold">{player?.gold ?? 0}g</div>
          </div>
          <SkillBar skills={snapshot?.skills ?? []} />
        </footer>
        {snapshot?.player.inventoryOpen ? (
          <InventoryPanel
            onLoadCheckpoint={onLoadCheckpoint}
            onSaveCheckpoint={onSaveCheckpoint}
            saveStatus={saveStatus}
            snapshot={snapshot}
          />
        ) : null}
        {snapshot?.player.paused ? (
          <PausePanel
            onLoadCheckpoint={onLoadCheckpoint}
            onSaveCheckpoint={onSaveCheckpoint}
            saveStatus={saveStatus}
          />
        ) : null}
        {snapshot?.rewardOpen ? <RewardPanel onReward={onReward} snapshot={snapshot} /> : null}
      </section>
      {devtools ? (
        <DevToolsOverlay
          pins={{ enabled: true, area: "floating", refreshIntervalMs: 250 }}
          renderPanel={renderAbyssDevToolsPanel}
          runtime={devtools}
          uiRuntime={uiRuntime}
        />
      ) : null}
    </main>
  );
}

function Meter({
  label,
  max,
  tone,
  value
}: {
  label: string;
  max: number;
  tone: "life" | "energy";
  value: number;
}) {
  const ratio = Math.max(0, Math.min(1, value / Math.max(1, max)));
  return (
    <div className={`abyss-meter abyss-meter--${tone}`}>
      <span>{label}</span>
      <div>
        <i style={{ width: `${ratio * 100}%` }} />
      </div>
      <strong>
        {Math.ceil(value)} / {Math.ceil(max)}
      </strong>
    </div>
  );
}

function SkillBar({ skills }: { skills: AbyssSnapshot["skills"] }) {
  return (
    <div className="abyss-skills">
      {skills.map((skill) => (
        <div
          className={skill.ready ? "abyss-skill" : "abyss-skill abyss-skill--cooling"}
          key={skill.id}
        >
          <kbd>{skill.key}</kbd>
          <span>{skill.label}</span>
          {!skill.ready ? <em>{Math.ceil(skill.cooldownRemainingMs / 100) / 10}s</em> : null}
        </div>
      ))}
    </div>
  );
}

function InventoryPanel({
  onLoadCheckpoint,
  onSaveCheckpoint,
  saveStatus,
  snapshot
}: {
  snapshot: AbyssSnapshot;
  saveStatus?: string | undefined;
  onSaveCheckpoint(): void;
  onLoadCheckpoint(): void;
}) {
  return (
    <aside className="abyss-window abyss-window--inventory">
      <h2>Inventory</h2>
      <dl>
        <div>
          <dt>Gold</dt>
          <dd>{snapshot.player.gold}</dd>
        </div>
        <div>
          <dt>Recent Loot</dt>
          <dd>{snapshot.recentLoot.join(", ") || "none"}</dd>
        </div>
        <div>
          <dt>Combat</dt>
          <dd>
            {Math.ceil(snapshot.player.health)} HP · {Math.ceil(snapshot.player.energy)} EN
          </dd>
        </div>
      </dl>
      <CheckpointControls
        onLoadCheckpoint={onLoadCheckpoint}
        onSaveCheckpoint={onSaveCheckpoint}
        saveStatus={saveStatus}
      />
    </aside>
  );
}

function PausePanel({
  onLoadCheckpoint,
  onSaveCheckpoint,
  saveStatus
}: {
  saveStatus?: string | undefined;
  onSaveCheckpoint(): void;
  onLoadCheckpoint(): void;
}) {
  return (
    <aside className="abyss-window abyss-window--pause">
      <h2>Paused</h2>
      <p>Esc resumes the delve.</p>
      <CheckpointControls
        onLoadCheckpoint={onLoadCheckpoint}
        onSaveCheckpoint={onSaveCheckpoint}
        saveStatus={saveStatus}
      />
    </aside>
  );
}

function CheckpointControls({
  onLoadCheckpoint,
  onSaveCheckpoint,
  saveStatus
}: {
  saveStatus?: string | undefined;
  onSaveCheckpoint(): void;
  onLoadCheckpoint(): void;
}) {
  return (
    <div className="abyss-checkpoint-controls">
      <button onClick={onSaveCheckpoint} type="button">
        Save Checkpoint
      </button>
      <button onClick={onLoadCheckpoint} type="button">
        Load Checkpoint
      </button>
      {saveStatus ? <span>{saveStatus}</span> : null}
    </div>
  );
}

function RewardPanel({
  onReward,
  snapshot
}: {
  snapshot: AbyssSnapshot;
  onReward(rewardId: string): void;
}) {
  return (
    <section className="abyss-rewards" role="dialog" aria-modal="true">
      <div className="abyss-rewards__panel">
        <p>Chamber Cleared</p>
        <h2>Choose a boon</h2>
        <div className="abyss-reward-cards">
          {snapshot.rewardChoices.map((reward) => (
            <button
              className="abyss-reward-card"
              key={reward.id}
              onClick={() => onReward(reward.id)}
              type="button"
            >
              <strong>{reward.label}</strong>
              <span>{reward.detail}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
