import {
  renderStandardDevToolsPanel,
  type DevToolsPanelRendererProps
} from "@gamekits/devtools-ui";
import type { DevToolsSourceSnapshot } from "@gamekits/devtools";
import { ABYSS_CHAIN_PANEL_ID, ABYSS_SOURCE_ID } from "../../devtools/abyss-devtools";
import type { AbyssSnapshot, AbyssTraceEntry } from "../../game";

const CHAIN_STAGES: Array<{
  id: string;
  label: string;
  detail: string;
  matches(entry: AbyssTraceEntry): boolean;
}> = [
  {
    id: "input",
    label: "Input",
    detail: "semantic action",
    matches: (entry) => entry.kind === "input"
  },
  {
    id: "ability",
    label: "Ability",
    detail: "GAS activation",
    matches: (entry) =>
      entry.kind === "combat" &&
      ["basic attack", "cinder bolt", "void cleave", "projectile hit"].some((label) =>
        entry.label.includes(label)
      )
  },
  {
    id: "damage",
    label: "Damage",
    detail: "GAS effect",
    matches: (entry) => entry.kind === "gas" || entry.label.includes("effect_applied")
  },
  {
    id: "death",
    label: "Death",
    detail: "world event",
    matches: (entry) => entry.label.includes("defeated")
  },
  {
    id: "loot",
    label: "Loot",
    detail: "roll + pickup",
    matches: (entry) => entry.kind === "loot"
  },
  {
    id: "reward",
    label: "Reward",
    detail: "TCA room rule",
    matches: (entry) => entry.kind === "reward"
  },
  {
    id: "save",
    label: "Save",
    detail: "checkpoint",
    matches: (entry) => entry.kind === "save"
  }
];

export function renderAbyssDevToolsPanel(props: DevToolsPanelRendererProps) {
  if (props.panel.id !== ABYSS_CHAIN_PANEL_ID) {
    return renderStandardDevToolsPanel(props);
  }

  return <AbyssChainPanel snapshot={readAbyssSnapshot(props.snapshot.sourceSnapshots)} />;
}

function AbyssChainPanel({ snapshot }: { snapshot: AbyssSnapshot | undefined }) {
  if (!snapshot) {
    return (
      <section className="abyss-devtools-chain">
        <header>
          <span>Abyss Chain</span>
          <strong>Waiting for run snapshot</strong>
        </header>
      </section>
    );
  }

  const timeline = [...snapshot.timeline].reverse();
  return (
    <section className="abyss-devtools-chain">
      <header>
        <span>Abyss Chain</span>
        <strong>{snapshot.objective.label}</strong>
        <em>
          Room {snapshot.objective.roomIndex + 1} · {snapshot.objective.remainingEnemies} enemies
        </em>
      </header>

      <div className="abyss-devtools-chain__stages">
        {CHAIN_STAGES.map((stage) => {
          const entry = timeline.find(stage.matches);
          return (
            <article
              className={
                entry ? "abyss-devtools-chain__stage is-complete" : "abyss-devtools-chain__stage"
              }
              key={stage.id}
            >
              <span>{stage.label}</span>
              <strong>{entry?.label ?? "pending"}</strong>
              <em>{stage.detail}</em>
            </article>
          );
        })}
      </div>

      <div className="abyss-devtools-chain__grid">
        <section>
          <h3>Run State</h3>
          <dl>
            <Metric label="Tick" value={snapshot.clock.ticks} />
            <Metric label="Gold" value={snapshot.player.gold} />
            <Metric label="Recent Loot" value={snapshot.recentLoot.join(", ") || "none"} />
            <Metric label="Checkpoint" value={`v${snapshot.checkpoint.version}`} />
          </dl>
        </section>
        <section>
          <h3>Actor</h3>
          <ActorSummary snapshot={snapshot} />
        </section>
        <section>
          <h3>Rules</h3>
          <dl>
            <Metric label="GAS traces" value={snapshot.gasTraces.length} />
            <Metric label="TCA traces" value={snapshot.tcaTraces.length} />
            <Metric
              label="Reward"
              value={snapshot.rewardChoices.find((choice) => choice.selected)?.label ?? "pending"}
            />
          </dl>
        </section>
      </div>

      <section className="abyss-devtools-chain__timeline">
        <h3>Recent Link Events</h3>
        <ol>
          {snapshot.timeline.slice(0, 10).map((entry) => (
            <li key={entry.id}>
              <span>{entry.kind}</span>
              <strong>{entry.label}</strong>
              {entry.actorId ? <code>{entry.actorId}</code> : null}
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}

function ActorSummary({ snapshot }: { snapshot: AbyssSnapshot }) {
  const player = snapshot.actorInspectors.find((actor) => actor.actorId === "abyss.player");
  if (!player) {
    return <p className="abyss-devtools-muted">No player actor inspector.</p>;
  }

  return (
    <dl>
      <Metric label="Actor" value={player.actorId} />
      <Metric label="Tags" value={player.tags.join(", ") || "none"} />
      <Metric label="Effects" value={player.activeEffects.length} />
      <Metric label="Abilities" value={player.abilities.length} />
    </dl>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function readAbyssSnapshot(
  sources: DevToolsSourceSnapshot[] | undefined
): AbyssSnapshot | undefined {
  const source = sources?.find((entry) => entry.id === ABYSS_SOURCE_ID);
  if (!source || source.error || !isAbyssSnapshot(source.snapshot)) {
    return undefined;
  }
  return source.snapshot;
}

function isAbyssSnapshot(value: unknown): value is AbyssSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "objective" in value &&
    "timeline" in value &&
    "actorInspectors" in value
  );
}
