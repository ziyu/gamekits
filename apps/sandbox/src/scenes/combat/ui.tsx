import { DevToolsOverlay } from "@gamekits/devtools-ui";
import type { DevToolsRuntime } from "@gamekits/devtools";
import { GameKitsUiShell, UiFocusBridge } from "@gamekits/react-ui";
import type { UiRuntime } from "@gamekits/ui-core";
import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import type {
  CombatRangeAction,
  CombatRangeController,
  CombatRangeObjectSnapshot,
  CombatRangeSnapshot
} from "./runtime";

export type CombatRangeUi = {
  root: HTMLElement;
  reactRoot: ReactRoot;
  uiRuntime: UiRuntime;
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  targetCount: HTMLElement;
  projectileCount: HTMLElement;
  result: HTMLElement;
  feedback: HTMLOListElement;
  actionButtons: HTMLButtonElement[];
  resetButton: HTMLButtonElement;
  devtoolsRoot: HTMLElement;
  devtoolsReactRoot?: ReactRoot | undefined;
};

const ACTIONS: Array<{
  id: CombatRangeAction;
  index: string;
  label: string;
  detail: string;
}> = [
  { id: "melee", index: "01", label: "Melee Sweep", detail: "short overlap" },
  { id: "hitscan", index: "02", label: "Pulse Shot", detail: "instant ray" },
  { id: "projectile", index: "03", label: "Arc Bolt", detail: "physical projectile" },
  { id: "area", index: "04", label: "Shock Ring", detail: "multi-target area" },
  { id: "cover", index: "05", label: "Cover Test", detail: "blocker lane" },
  { id: "heal", index: "06", label: "Field Repair", detail: "ally direct" }
];

const ACTOR_ROWS = [
  ["close-target", "Close Drone"],
  ["area-target-left", "Ring Drone A"],
  ["area-target", "Ring Drone B"],
  ["area-target-right", "Ring Drone C"],
  ["covered-target", "Covered Drone"],
  ["support-drone", "Support Drone"]
] as const;

export function renderCombatRangeUi(rootElement: HTMLElement, uiRuntime: UiRuntime): CombatRangeUi {
  const canvasRef = createRef<HTMLCanvasElement>();
  const uiRootRef = createRef<HTMLElement>();
  const root = createRoot(rootElement);

  flushSync(() => {
    root.render(
      <GameKitsUiShell
        runtime={uiRuntime}
        className="combat-range-ui"
        density="compact"
        theme="combat-range"
      >
        <UiFocusBridge runtime={uiRuntime} gameViewportRef={canvasRef} uiRootRef={uiRootRef} />
        <section className="combat-range" ref={uiRootRef}>
          <header className="combat-range__header">
            <div className="combat-range__identity">
              <span className="combat-range__eyebrow">Sandbox / Combat 01</span>
              <h1>Combat Proving Ground</h1>
            </div>
            <div className="combat-range__brief">
              <span>Objective</span>
              <strong>Break the amber drones</strong>
              <small>Try each delivery pattern, then reset the range.</small>
            </div>
            <div className="combat-range__status" data-ui="combat-status">
              <span />
              booting
            </div>
          </header>

          <main className="combat-range__workspace">
            <section
              className="combat-range__stage-card"
              data-ui-panel="sandbox.combat-range.stage"
            >
              <div className="combat-range__stage-meta">
                <div>
                  <span>Lane A</span>
                  <strong>Open engagement</strong>
                </div>
                <div>
                  <span>Lane B</span>
                  <strong>Cover validation</strong>
                </div>
              </div>
              <div className="combat-range__canvas-wrap">
                <canvas ref={canvasRef} tabIndex={0} data-ui="combat-canvas" />
                <div className="combat-range__reticle" aria-hidden="true" />
                <div className="combat-range__arena-callout combat-range__arena-callout--area">
                  shock ring
                </div>
                <div className="combat-range__arena-callout combat-range__arena-callout--cover">
                  hard cover
                </div>
              </div>
              <div className="combat-range__result" aria-live="polite" data-ui="combat-result">
                Select a delivery to begin the exercise.
              </div>
            </section>

            <aside className="combat-range__deck" data-ui-panel="sandbox.combat-range.actions">
              <div className="combat-range__deck-heading">
                <span>Delivery Deck</span>
                <strong>Choose a test</strong>
              </div>
              <div className="combat-range__actions">
                {ACTIONS.map((action) => (
                  <button key={action.id} type="button" data-combat-action={action.id} disabled>
                    <span>{action.index}</span>
                    <strong>{action.label}</strong>
                    <small>{action.detail}</small>
                  </button>
                ))}
              </div>
              <button type="button" className="combat-range__reset" data-combat-reset disabled>
                Re-arm range
              </button>
            </aside>
          </main>

          <footer className="combat-range__footer">
            <section className="combat-range__roster">
              <div className="combat-range__footer-heading">
                <span>Range Roster</span>
                <div>
                  <strong data-ui="combat-target-count">5</strong>
                  <small>targets live</small>
                </div>
                <div>
                  <strong data-ui="combat-projectile-count">0</strong>
                  <small>bolts active</small>
                </div>
              </div>
              <div className="combat-range__actor-list">
                {ACTOR_ROWS.map(([id, label]) => (
                  <div key={id} className="combat-range__actor" data-combat-actor-id={id}>
                    <span>{label}</span>
                    <div>
                      <i />
                    </div>
                    <strong>--</strong>
                  </div>
                ))}
              </div>
            </section>
            <section
              className="combat-range__feedback"
              data-ui-panel="sandbox.combat-range.feedback"
            >
              <div className="combat-range__footer-heading">
                <span>Impact Feed</span>
                <small>Latest combat outcomes</small>
              </div>
              <ol data-ui="combat-feedback" />
            </section>
          </footer>
        </section>
        <div className="combat-range__devtools" data-ui="combat-devtools" />
      </GameKitsUiShell>
    );
  });

  return {
    root: rootElement,
    reactRoot: root,
    uiRuntime,
    canvas: readElement(rootElement, "combat-canvas", HTMLCanvasElement),
    status: readElement(rootElement, "combat-status", HTMLElement),
    targetCount: readElement(rootElement, "combat-target-count", HTMLElement),
    projectileCount: readElement(rootElement, "combat-projectile-count", HTMLElement),
    result: readElement(rootElement, "combat-result", HTMLElement),
    feedback: readElement(rootElement, "combat-feedback", HTMLOListElement),
    actionButtons: [...rootElement.querySelectorAll<HTMLButtonElement>("[data-combat-action]")],
    resetButton: requireElement(
      rootElement.querySelector("[data-combat-reset]"),
      HTMLButtonElement
    ),
    devtoolsRoot: readElement(rootElement, "combat-devtools", HTMLElement)
  };
}

export function bindCombatRangeUi(ui: CombatRangeUi, scene: CombatRangeController): void {
  for (const button of ui.actionButtons) {
    button.disabled = false;
    button.addEventListener("click", () => {
      const action = button.dataset.combatAction as CombatRangeAction;
      ui.uiRuntime.setFocus({
        scope: "ui",
        target: `combat.delivery.${action}`,
        reason: "sandbox.combat_action"
      });
      scene.perform(action);
      updateCombatRangeUi(ui, scene.snapshot());
    });
  }
  ui.resetButton.disabled = false;
  ui.resetButton.addEventListener("click", () => {
    scene.reset();
    updateCombatRangeUi(ui, scene.snapshot());
  });
}

export function mountCombatRangeDevTools(ui: CombatRangeUi, runtime: DevToolsRuntime): void {
  const root = ui.devtoolsReactRoot ?? createRoot(ui.devtoolsRoot);
  ui.devtoolsReactRoot = root;
  root.render(<DevToolsOverlay runtime={runtime} uiRuntime={ui.uiRuntime} />);
}

export function updateCombatRangeUi(ui: CombatRangeUi, snapshot: CombatRangeSnapshot): void {
  ui.status.classList.toggle("combat-range__status--ready", snapshot.running);
  ui.status.lastChild!.textContent = snapshot.running ? "range live" : "paused";
  ui.targetCount.textContent = String(snapshot.targetCount);
  ui.projectileCount.textContent = String(snapshot.projectiles.length);
  ui.result.textContent = describeResult(snapshot);

  for (const object of snapshot.objects) {
    const row = ui.root.querySelector<HTMLElement>(`[data-combat-actor-id="${object.id}"]`);
    if (!row || object.health === undefined) {
      continue;
    }
    const health = Math.max(0, Math.min(100, object.health));
    const meter = row.querySelector<HTMLElement>("i");
    const label = row.querySelector<HTMLElement>("strong");
    if (meter) {
      meter.style.width = `${health}%`;
    }
    if (label) {
      label.textContent = String(Math.round(health));
    }
    row.dataset.downed = health <= 0 ? "true" : "false";
  }

  ui.feedback.replaceChildren(
    ...snapshot.feedback.slice(0, 5).map((entry) => {
      const item = document.createElement("li");
      item.dataset.tone = entry.tone;
      item.textContent = entry.label;
      return item;
    })
  );
  drawCombatRange(ui.canvas, snapshot);
}

function describeResult(snapshot: CombatRangeSnapshot): string {
  if (snapshot.lastAction === "reset") {
    return "Range re-armed. All targets restored; active bolts cleared.";
  }
  const result = snapshot.lastResult;
  if (!result) {
    return "Select a delivery to begin the exercise.";
  }
  if (result.status === "rejected") {
    return `Delivery rejected: ${result.message}`;
  }
  if (result.projectile) {
    return "Arc bolt launched. Its entity now advances through the physical lane.";
  }
  if (result.blockedBy) {
    return "Cover held. The physical query stopped before the protected drone.";
  }
  if (result.hits.length === 0) {
    return "Delivery resolved without an eligible target.";
  }
  const names = result.hits.map((hit) => readableActor(hit.targetActorId)).join(", ");
  if (snapshot.lastAction === "area") {
    return `Shock Ring locked ${result.hits.length} hostile targets: ${names}.`;
  }
  return `${actionLabel(snapshot.lastAction)} connected with ${names}.`;
}

function actionLabel(action: CombatRangeSnapshot["lastAction"]): string {
  return ACTIONS.find((entry) => entry.id === action)?.label ?? "Delivery";
}

function readableActor(actorId: string): string {
  return actorId.split(".").at(-1)?.replaceAll("-", " ") ?? actorId;
}

function drawCombatRange(canvas: HTMLCanvasElement, snapshot: CombatRangeSnapshot): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(640, Math.round(rect.width * ratio));
  const height = Math.max(400, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const cssWidth = width / ratio;
  const cssHeight = height / ratio;
  context.clearRect(0, 0, cssWidth, cssHeight);
  drawArena(context, cssWidth, cssHeight);
  for (const object of snapshot.objects) {
    drawObject(context, cssWidth, cssHeight, object);
  }
  for (const projectile of snapshot.projectiles) {
    const point = worldToScreen(cssWidth, cssHeight, projectile.x, projectile.y);
    const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, 18);
    glow.addColorStop(0, "rgba(155, 255, 232, 1)");
    glow.addColorStop(0.25, "rgba(85, 229, 205, .9)");
    glow.addColorStop(1, "rgba(85, 229, 205, 0)");
    context.fillStyle = glow;
    context.beginPath();
    context.arc(point.x, point.y, 18, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#effff9";
    context.fillRect(point.x - 5, point.y - 2, 14, 4);
  }
  drawCombatCues(context, cssWidth, cssHeight, snapshot);
}

function drawArena(context: CanvasRenderingContext2D, width: number, height: number): void {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#111a18");
  gradient.addColorStop(0.55, "#0a1110");
  gradient.addColorStop(1, "#15120d");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(173, 214, 198, .075)";
  context.lineWidth = 1;
  for (let x = 0; x < width; x += 48) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y < height; y += 48) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  for (const y of [1.2, -1.6]) {
    const start = worldToScreen(width, height, -6.2, y);
    const end = worldToScreen(width, height, 6.2, y);
    context.setLineDash([10, 10]);
    context.strokeStyle = "rgba(217, 179, 95, .2)";
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }
  context.setLineDash([]);
}

function drawCombatCues(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: CombatRangeSnapshot
): void {
  const objectsByActor = new Map(
    snapshot.objects.flatMap((object) =>
      object.actorId === undefined ? [] : ([[object.actorId, object]] as const)
    )
  );
  for (const cue of snapshot.cues) {
    const progress = Math.max(0, Math.min(1, (snapshot.elapsed - cue.startedAt) / cue.durationMs));
    const source =
      cue.sourceActorId === undefined ? undefined : objectsByActor.get(cue.sourceActorId);
    const target =
      cue.targetActorId === undefined ? undefined : objectsByActor.get(cue.targetActorId);
    const sourcePoint = source && worldToScreen(width, height, source.x, source.y);
    const targetPoint =
      cue.point === undefined
        ? target && worldToScreen(width, height, target.x, target.y)
        : worldToScreen(width, height, cue.point.x, cue.point.y);

    context.save();
    context.globalAlpha = Math.max(0, 1 - progress);
    if (cue.type === "combat.attack.melee" && sourcePoint) {
      context.strokeStyle = "#b8fff0";
      context.lineWidth = 8 - progress * 5;
      context.shadowBlur = 18;
      context.shadowColor = "#70ead2";
      context.beginPath();
      context.arc(sourcePoint.x + 28, sourcePoint.y, 48 + progress * 20, -1.15, 1.15);
      context.stroke();
    } else if (
      (cue.type === "combat.attack.hitscan" || cue.type === "combat.attack.cover") &&
      sourcePoint
    ) {
      const endpoint =
        targetPoint ??
        worldToScreen(
          width,
          height,
          cue.type === "combat.attack.cover" ? 0 : -3.35,
          cue.type === "combat.attack.cover" ? -1.6 : 1.2
        );
      context.strokeStyle = cue.type === "combat.attack.cover" ? "#ffb75a" : "#b8fff0";
      context.lineWidth = 6 - progress * 4;
      context.shadowBlur = 16;
      context.shadowColor = context.strokeStyle;
      context.beginPath();
      context.moveTo(sourcePoint.x, sourcePoint.y);
      context.lineTo(endpoint.x, endpoint.y);
      context.stroke();
      if (cue.type === "combat.attack.cover") {
        drawImpactBurst(context, endpoint.x, endpoint.y, progress, "#ffb75a");
      }
    } else if (cue.type === "combat.attack.area") {
      const center = worldToScreen(width, height, 1.2, 1.5);
      const radius = worldScale(width, height) * 1.45 * (0.55 + progress * 0.45);
      context.fillStyle = "rgba(104, 238, 209, .12)";
      context.strokeStyle = "#70ead2";
      context.lineWidth = 5 - progress * 3;
      context.shadowBlur = 18;
      context.shadowColor = "#70ead2";
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      const selectedActorIds = cue.selectedActorIds ?? [];
      context.setLineDash([5, 7]);
      context.strokeStyle = "rgba(240, 173, 82, .8)";
      context.lineWidth = 1.5;
      for (let index = 0; index < selectedActorIds.length; index += 1) {
        const actorId = selectedActorIds[index];
        const selected = actorId === undefined ? undefined : objectsByActor.get(actorId);
        if (selected === undefined) {
          continue;
        }
        const point = worldToScreen(width, height, selected.x, selected.y);
        context.beginPath();
        context.moveTo(center.x, center.y);
        context.lineTo(point.x, point.y);
        context.stroke();
        drawTargetLock(context, point.x, point.y, index + 1, progress);
      }
      context.setLineDash([]);
    } else if (
      (cue.type === "combat.attack.projectile" || cue.type === "combat.attack.heal") &&
      sourcePoint
    ) {
      drawImpactBurst(context, sourcePoint.x + 24, sourcePoint.y, progress, "#70ead2");
    } else if (cue.type === "combat.impact.damage" && targetPoint) {
      drawImpactBurst(context, targetPoint.x, targetPoint.y, progress, "#ffb75a");
    } else if (cue.type === "combat.impact.repair" && targetPoint) {
      drawRepairPulse(context, targetPoint.x, targetPoint.y, progress);
    }
    context.restore();
  }
}

function drawTargetLock(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  index: number,
  progress: number
): void {
  const size = 29 + progress * 8;
  const corner = 9;
  context.save();
  context.setLineDash([]);
  context.strokeStyle = "#ffc267";
  context.fillStyle = "#ffc267";
  context.lineWidth = 2.5 - progress;
  context.shadowBlur = 14;
  context.shadowColor = "#f0ad52";
  for (const [scaleX, scaleY] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ] as const) {
    const cornerX = x + size * scaleX;
    const cornerY = y + size * scaleY;
    context.beginPath();
    context.moveTo(cornerX - corner * scaleX, cornerY);
    context.lineTo(cornerX, cornerY);
    context.lineTo(cornerX, cornerY - corner * scaleY);
    context.stroke();
  }
  context.font = "700 10px SFMono-Regular, monospace";
  context.fillText(`LOCK ${String(index).padStart(2, "0")}`, x - size, y - size - 8);
  context.restore();
}

function drawImpactBurst(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
  color: string
): void {
  context.strokeStyle = color;
  context.lineWidth = 4 - progress * 2;
  context.shadowBlur = 20;
  context.shadowColor = color;
  const inner = 10 + progress * 16;
  const outer = 24 + progress * 34;
  for (let index = 0; index < 8; index += 1) {
    const angle = (Math.PI * 2 * index) / 8;
    context.beginPath();
    context.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
    context.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    context.stroke();
  }
}

function drawRepairPulse(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number
): void {
  context.strokeStyle = "#70ead2";
  context.fillStyle = "rgba(112, 234, 210, .13)";
  context.lineWidth = 4 - progress * 2;
  context.shadowBlur = 22;
  context.shadowColor = "#70ead2";
  for (const offset of [0, 18]) {
    context.beginPath();
    context.arc(x, y, 18 + offset + progress * 30, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

function drawObject(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  object: CombatRangeObjectSnapshot
): void {
  const point = worldToScreen(width, height, object.x, object.y);
  const downed = (object.health ?? 1) <= 0;
  context.save();
  context.translate(point.x, point.y);
  context.globalAlpha = downed ? 0.34 : 1;

  if (object.role === "cover") {
    context.fillStyle = "#2d302b";
    context.strokeStyle = "#c08a45";
    context.lineWidth = 2;
    context.fillRect(-10, -42, 20, 84);
    context.strokeRect(-10, -42, 20, 84);
    for (let y = -31; y <= 31; y += 14) {
      context.fillStyle = y % 28 === 0 ? "#c08a45" : "#151714";
      context.fillRect(-7, y, 14, 6);
    }
    context.restore();
    return;
  }

  const cyan = object.team === "cyan";
  const accent = cyan ? "#70ead2" : "#f0ad52";
  context.shadowBlur = 22;
  context.shadowColor = accent;
  context.fillStyle = cyan ? "#183e38" : "#4b2d13";
  context.strokeStyle = accent;
  context.lineWidth = 2;
  context.rotate(object.role === "operator" ? Math.PI / 4 : 0);
  const size = object.role === "operator" ? 22 : 18;
  context.fillRect(-size, -size, size * 2, size * 2);
  context.strokeRect(-size, -size, size * 2, size * 2);
  context.shadowBlur = 0;
  context.fillStyle = accent;
  context.fillRect(-5, -5, 10, 10);
  context.rotate(object.role === "operator" ? -Math.PI / 4 : 0);

  context.fillStyle = "rgba(5, 8, 7, .78)";
  context.fillRect(-45, 31, 90, 20);
  context.fillStyle = "#e9eee9";
  context.font = "700 10px 'Avenir Next Condensed', sans-serif";
  context.textAlign = "center";
  context.fillText(object.label.toUpperCase(), 0, 44);
  context.restore();
}

function worldToScreen(width: number, height: number, x: number, y: number) {
  const scale = worldScale(width, height);
  return {
    x: width / 2 + x * scale,
    y: height / 2 - y * scale
  };
}

function worldScale(width: number, height: number): number {
  return Math.min(width / 15, height / 8);
}

function readElement<TElement extends Element>(
  root: HTMLElement,
  id: string,
  constructor: new (...args: never[]) => TElement
): TElement {
  return requireElement(root.querySelector(`[data-ui="${id}"]`), constructor);
}

function requireElement<TElement extends Element>(
  value: Element | null,
  constructor: new (...args: never[]) => TElement
): TElement {
  if (!(value instanceof constructor)) {
    throw new Error(`Combat range UI element is missing: ${constructor.name}`);
  }
  return value;
}
