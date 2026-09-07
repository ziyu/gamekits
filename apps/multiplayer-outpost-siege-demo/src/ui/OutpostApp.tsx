import type { DevToolsRuntime } from "@gamekits/devtools";
import { DevToolsOverlay } from "@gamekits/devtools-ui";
import type { UiRuntime } from "@gamekits/ui-core";
import { useCallback } from "react";
import { OUTPOST_DASH_STAMINA_COST, OUTPOST_PLAYER_STAMINA_MAX } from "../content";
import { OutpostLobby, type OutpostConnectionView } from "./OutpostLobby";
import { WeaponHud } from "./player/WeaponHud";

export type OutpostBootPhase = "initializing" | "booting" | "running" | "failed";

export type OutpostAppProps = {
  rendererRoot: HTMLElement;
  bootPhase: OutpostBootPhase;
  bootMessage: string;
  devtools?: DevToolsRuntime | undefined;
  uiRuntime: UiRuntime;
  connection: OutpostConnectionView;
  onGameFocus(): void;
  onCreateSession(displayName: string): void;
  onJoinSession(sessionId: string, displayName: string): void;
  onReady(ready: boolean): void;
  onResetConnection(): void;
};

const abilities = [
  { key: "LMB", label: "Rifle", glyph: "◆", abilityId: "ability.outpost.rifle_fire" },
  { key: "SPACE", label: "Dash", glyph: "»", abilityId: "ability.outpost.dash" },
  { key: "Q", label: "Shock Field", glyph: "◎", abilityId: "ability.outpost.shock_field" },
  { key: "E", label: "Turret", glyph: "⌂", abilityId: "ability.outpost.deploy_turret" }
] as const;

export function OutpostApp({
  bootMessage,
  bootPhase,
  connection,
  devtools,
  onCreateSession,
  onGameFocus,
  onJoinSession,
  onReady,
  onResetConnection,
  rendererRoot,
  uiRuntime
}: OutpostAppProps) {
  const attachRenderer = useCallback(
    (stage: HTMLElement | null) => {
      if (stage && !stage.contains(rendererRoot)) {
        stage.prepend(rendererRoot);
      }
    },
    [rendererRoot]
  );
  const match = connection.match;
  const isRunning = connection.phase === "connected" && match?.phase === "running";
  const localActor = match?.combat.actors.find(
    (actor) => actor.kind === "player" && actor.objectId === connection.localPlayerId
  );
  const hostileCount = match?.combat.actors.filter((actor) => actor.kind === "enemy").length ?? 0;
  const dashNeedsStamina =
    localActor !== undefined && localActor.stamina < OUTPOST_DASH_STAMINA_COST;
  const dashStaminaRejection = latestDashStaminaRejection(match, connection.localPlayerId);
  const participants =
    match?.participants.filter((participant) => participant.status === "active") ?? [];

  return (
    <main className="outpost-app">
      <section
        aria-label="Outpost Siege game viewport"
        className={`outpost-stage ${isRunning ? "is-running" : "is-deployment"}`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={onGameFocus}
        ref={attachRenderer}
        tabIndex={0}
      >
        <div className="outpost-cinematic-frame" aria-hidden="true" />

        <header className="outpost-brand">
          <span>FRONTIER 07</span>
          <strong>
            OUTPOST
            <br />
            SIEGE
          </strong>
        </header>

        <section className="outpost-objective" aria-label="Current objective">
          <div>
            <span>{isRunning ? "WAVE 01" : "DEPLOYMENT"}</span>
            <i />
          </div>
          <strong>{isRunning ? "SECURE THE PERIMETER" : "ASSEMBLE YOUR FIRETEAM"}</strong>
          <small>
            {isRunning
              ? `${hostileCount} HOSTILES · ${match?.combat.kills ?? 0} KILLS · ${Math.round(localActor?.resource ?? 0)} SUPPLY`
              : "Create a squad channel or deploy with an existing team"}
          </small>
        </section>

        <section className="outpost-squad" aria-label="Squad status">
          <span>SQUAD</span>
          {(participants.length > 0
            ? participants
            : [{ playerId: "pending", displayName: "RANGER", ready: false }]
          ).map((participant, index) => (
            <div className="outpost-squad__member" key={participant.playerId}>
              <i>{String(index + 1).padStart(2, "0")}</i>
              <div>
                <strong>{participant.displayName ?? "RANGER"}</strong>
                <span>{participant.ready || isRunning ? "READY" : "STANDBY"}</span>
              </div>
              <b />
            </div>
          ))}
        </section>

        <section className="outpost-vitals" aria-label="Player status">
          <div className="outpost-vitals__portrait">R1</div>
          <div className="outpost-vitals__body">
            <div>
              <strong>RANGER 01</strong>
              <span>LV. 01</span>
            </div>
            <Meter label="HP" max={100} value={localActor?.health ?? 100} tone="health" />
            <Meter label="SH" max={50} value={localActor?.shield ?? 50} tone="shield" />
            <Meter
              label="STAMINA"
              low={dashNeedsStamina}
              max={OUTPOST_PLAYER_STAMINA_MAX}
              value={localActor?.stamina ?? OUTPOST_PLAYER_STAMINA_MAX}
              tone="stamina"
            />
            {dashNeedsStamina ? (
              <strong className="outpost-vitals__dash-lock">DASH LOCKED</strong>
            ) : null}
          </div>
        </section>

        <WeaponHud weapon={localActor?.weapon} elapsedMs={match?.elapsedMs ?? 0} />

        <section className="outpost-abilities" aria-label="Ability bar">
          {abilities.map((ability) => {
            const elapsedMs = match?.elapsedMs ?? 0;
            const cooldownRemainingMs = abilityCooldownRemainingMs(
              ability.abilityId,
              localActor,
              elapsedMs
            );
            return (
              <article
                className={`outpost-ability ${abilityStateClass(
                  ability.abilityId,
                  localActor,
                  elapsedMs
                )}`}
                data-ability={ability.abilityId}
                key={ability.label}
              >
                <kbd>{ability.key}</kbd>
                <span className="outpost-ability__icon">
                  <i aria-hidden="true">{ability.glyph}</i>
                  {cooldownRemainingMs > 0 ? (
                    <span
                      aria-label={`${ability.label} cooldown ${formatCooldown(
                        cooldownRemainingMs
                      )} seconds`}
                      className="outpost-ability__cooldown"
                    >
                      {formatCooldown(cooldownRemainingMs)}
                    </span>
                  ) : null}
                </span>
                <div>
                  <strong>{ability.label}</strong>
                  <span>{abilityStatus(ability.abilityId, localActor, elapsedMs)}</span>
                </div>
              </article>
            );
          })}
        </section>

        {dashStaminaRejection ? (
          <section
            aria-live="assertive"
            className="outpost-action-alert outpost-action-alert--stamina"
            role="alert"
          >
            <strong>LOW STAMINA</strong>
          </section>
        ) : null}

        <div className="outpost-control-hint">
          <kbd>WASD</kbd>
          <span>MOVE</span>
          <i /> <span>WHEEL</span>
          <span>ZOOM</span>
        </div>

        {bootPhase !== "running" ? (
          <section className={`outpost-boot outpost-boot--${bootPhase}`} role="status">
            <div className="outpost-boot__mark">
              <i />
              <i />
              <i />
            </div>
            <span>{bootPhase === "failed" ? "DEPLOYMENT FAILED" : "DEPLOYING TO OUTPOST"}</span>
            <strong>{bootMessage}</strong>
          </section>
        ) : null}

        <OutpostLobby
          connection={connection}
          onCreate={onCreateSession}
          onJoin={onJoinSession}
          onReady={onReady}
          onReset={onResetConnection}
        />
      </section>

      {devtools ? <DevToolsOverlay runtime={devtools} uiRuntime={uiRuntime} /> : null}
    </main>
  );
}

function Meter({
  label,
  low = false,
  max,
  tone,
  value
}: {
  label: string;
  low?: boolean | undefined;
  max: number;
  tone: string;
  value: number;
}) {
  const rounded = Math.max(0, Math.round(value));
  const percentage = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      aria-label={`${label} ${rounded} of ${max}`}
      className={`outpost-meter outpost-meter--${tone}${low ? " is-low" : ""}`}
    >
      <span>{label}</span>
      <div>
        <i style={{ width: `${percentage}%` }} />
      </div>
      <strong>{rounded}</strong>
    </div>
  );
}

function abilityStatus(
  abilityId: (typeof abilities)[number]["abilityId"],
  actor: NonNullable<OutpostConnectionView["match"]>["combat"]["actors"][number] | undefined,
  elapsedMs: number
): string {
  if (!actor) {
    return "SYNCING";
  }
  const remainingMs = abilityCooldownRemainingMs(abilityId, actor, elapsedMs);
  if (remainingMs > 0) {
    return abilityId === "ability.outpost.dash" ? `${OUTPOST_DASH_STAMINA_COST} ST` : "COOLDOWN";
  }
  if (abilityId === "ability.outpost.dash") {
    return actor.stamina < OUTPOST_DASH_STAMINA_COST
      ? "LOW STAMINA"
      : `${OUTPOST_DASH_STAMINA_COST} ST · READY`;
  }
  if (abilityId === "ability.outpost.deploy_turret" && actor.resource < 25) {
    return "NEED 25";
  }
  return "READY";
}

function abilityCooldownRemainingMs(
  abilityId: (typeof abilities)[number]["abilityId"],
  actor: NonNullable<OutpostConnectionView["match"]>["combat"]["actors"][number] | undefined,
  elapsedMs: number
): number {
  return Math.max(0, (actor?.cooldowns[abilityId] ?? 0) - elapsedMs);
}

function formatCooldown(remainingMs: number): string {
  return (Math.ceil(Math.max(0, remainingMs) / 100) / 10).toFixed(1);
}

function abilityStateClass(
  abilityId: (typeof abilities)[number]["abilityId"],
  actor: NonNullable<OutpostConnectionView["match"]>["combat"]["actors"][number] | undefined,
  elapsedMs: number
): string {
  if (!actor) {
    return "is-blocked";
  }
  if (abilityCooldownRemainingMs(abilityId, actor, elapsedMs) > 0) {
    return "is-cooldown";
  }
  if (
    (abilityId === "ability.outpost.dash" && actor.stamina < OUTPOST_DASH_STAMINA_COST) ||
    (abilityId === "ability.outpost.deploy_turret" && actor.resource < 25)
  ) {
    return "is-blocked";
  }
  return "is-ready";
}

function latestDashStaminaRejection(
  match: OutpostConnectionView["match"],
  localPlayerId: string | undefined
) {
  if (!match || !localPlayerId) {
    return undefined;
  }
  return [...match.combat.cues].reverse().find((cue) => {
    const ageMs = match.elapsedMs - cue.at;
    return (
      cue.kind === "action-rejected" &&
      cue.sourceObjectId === localPlayerId &&
      cue.ability === "dash" &&
      cue.reason === "costs-unavailable" &&
      ageMs >= 0 &&
      ageMs <= 1800
    );
  });
}
