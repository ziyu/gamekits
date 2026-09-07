import type { PhysicsPredictionIslandStateSnapshot } from "@gamekits/physics-core";

import type { ArenaHazardPhase } from "../shared/arena-stage-course";
import type { ArenaSnapshot } from "../shared/protocol";
import type { ArenaVisualInspection } from "./arena-visual";

export type ArenaHazardAudit = {
  root: HTMLElement;
  selectedMemberId(): string | undefined;
  update(input: {
    snapshot: ArenaSnapshot | undefined;
    predictedState: PhysicsPredictionIslandStateSnapshot | undefined;
    stateSource: "predicted" | "authority-fallback" | "unavailable";
    hazards: Array<{
      memberId: string;
      kind: string;
      phase: ArenaHazardPhase;
      nextTransitionTick: number;
    }>;
    list(stageIndex: number): string[];
    select(memberId?: string): void;
    visuals: readonly ArenaVisualInspection[];
  }): void;
  destroy(): void;
};

export function createArenaHazardAudit(parent: HTMLElement): ArenaHazardAudit | undefined {
  if (new URLSearchParams(window.location.search).get("hazard-audit") !== "1") {
    return undefined;
  }
  const root = element("section", "arena-hazard-audit");
  root.setAttribute("aria-label", "Interactive member audit");
  const kicker = element("span", "arena-hazard-audit__kicker", "REAL INTERACTION AUDIT");
  const title = element("strong", "arena-hazard-audit__title", "WAITING FOR STAGE");
  const status = element("span", "arena-hazard-audit__status", "NO REPLICATED BODY");
  const select = document.createElement("select");
  select.className = "arena-hazard-audit__select";
  select.setAttribute("aria-label", "Interactive member");
  const previous = button("PREV");
  const next = button("NEXT");
  const actions = element("div", "arena-hazard-audit__actions");
  actions.append(previous, next);
  root.append(kicker, title, status, select, actions);
  parent.append(root);

  let selected: string | undefined;
  let stageIndex = -1;
  let selectHazard: ((memberId?: string) => void) | undefined;
  select.addEventListener("change", () => {
    selected = select.value || undefined;
    selectHazard?.(selected);
  });
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));

  return {
    root,
    selectedMemberId: () => selected,
    update(input) {
      selectHazard = input.select;
      const nextStageIndex = input.snapshot?.match.stageIndex ?? -1;
      if (nextStageIndex !== stageIndex) {
        stageIndex = nextStageIndex;
        const ids = stageIndex < 0 ? [] : input.list(stageIndex);
        select.replaceChildren(...ids.map((id) => option(id)));
        selected = ids[0];
        if (selected !== undefined) select.value = selected;
        input.select(selected);
      }
      const ids = [...select.options].map(({ value }) => value);
      if (selected !== undefined && !ids.includes(selected)) selected = ids[0];
      const body = input.predictedState?.members.find(({ id }) => id === selected)?.body;
      const authorityBody = input.snapshot?.frame.members.find(({ id }) => id === selected)?.body;
      const hazard = input.hazards.find(({ memberId }) => memberId === selected);
      const visual = input.visuals.find(({ memberId }) => memberId === selected);
      title.textContent = selected ?? "WAITING FOR STAGE";
      status.textContent =
        body === undefined
          ? "NO REPLICATED BODY"
          : `${stateSourceLabel(input.stateSource)} · ${hazard?.kind.toUpperCase() ?? propLabel(body.userData)} · ${hazard?.phase.toUpperCase() ?? "PHYSICS"} · T${input.predictedState?.tick ?? 0} · X ${body.position.x.toFixed(2)} · Y ${body.position.y.toFixed(2)} · Z ${(body.position.z ?? 0).toFixed(2)} · R ${rotationLabel(body.rotation)}`;
      root.dataset.memberId = selected ?? "";
      root.dataset.stageIndex = String(stageIndex);
      root.dataset.bodyPosition =
        body === undefined
          ? ""
          : `${body.position.x.toFixed(3)},${body.position.y.toFixed(3)},${(body.position.z ?? 0).toFixed(3)}`;
      root.dataset.bodyRotation = rotationLabel(body?.rotation);
      root.dataset.authorityPosition =
        authorityBody === undefined
          ? ""
          : `${authorityBody.position.x.toFixed(3)},${authorityBody.position.y.toFixed(3)},${(authorityBody.position.z ?? 0).toFixed(3)}`;
      root.dataset.authorityRotation = rotationLabel(authorityBody?.rotation);
      root.dataset.authorityTick = String(input.snapshot?.frame.tick ?? "");
      root.dataset.predictionTick = String(input.predictedState?.tick ?? "");
      root.dataset.phase = hazard?.phase ?? "physics";
      root.dataset.kind =
        hazard?.kind ?? propLabel(body?.userData).toLowerCase().replaceAll(" ", "-");
      root.dataset.stateSource = input.stateSource;
      root.dataset.visual = visual === undefined ? "" : visualLabel(visual);
      root.dataset.evidence = JSON.stringify(
        ids.map((memberId) => {
          const predicted = input.predictedState?.members.find(({ id }) => id === memberId)?.body;
          const authority = input.snapshot?.frame.members.find(({ id }) => id === memberId)?.body;
          const memberHazard = input.hazards.find((candidate) => candidate.memberId === memberId);
          const memberVisual = input.visuals.find((candidate) => candidate.memberId === memberId);
          return {
            memberId,
            kind:
              memberHazard?.kind ??
              propLabel(predicted?.userData).toLowerCase().replaceAll(" ", "-"),
            phase: memberHazard?.phase ?? "physics",
            stateSource: input.stateSource,
            predictionTick: input.predictedState?.tick,
            predicted: bodyEvidence(predicted),
            authorityTick: input.snapshot?.frame.tick,
            authority: bodyEvidence(authority),
            visual: memberVisual === undefined ? undefined : visualLabel(memberVisual)
          };
        })
      );
      previous.disabled = ids.length < 2;
      next.disabled = ids.length < 2;
    },
    destroy() {
      selectHazard?.(undefined);
      root.remove();
    }
  };

  function step(direction: -1 | 1): void {
    const ids = [...select.options].map(({ value }) => value);
    if (ids.length === 0) return;
    const current = Math.max(0, ids.indexOf(selected ?? ""));
    selected = ids[(current + direction + ids.length) % ids.length];
    select.value = selected!;
    selectHazard?.(selected);
  }
}

function stateSourceLabel(
  source: Parameters<ArenaHazardAudit["update"]>[0]["stateSource"]
): string {
  if (source === "predicted") return "PREDICTED";
  if (source === "authority-fallback") return "AUTHORITY FALLBACK";
  return "UNAVAILABLE";
}

function bodyEvidence(
  body: PhysicsPredictionIslandStateSnapshot["members"][number]["body"] | undefined
) {
  return body === undefined
    ? undefined
    : {
        position: [body.position.x, body.position.y, body.position.z ?? 0],
        rotation: rotationLabel(body.rotation)
      };
}

function rotationLabel(rotation: unknown): string {
  if (typeof rotation === "number") return rotation.toFixed(2);
  if (typeof rotation !== "object" || rotation === null) return "--";
  const value = rotation as Record<string, unknown>;
  return ["x", "y", "z", "w"]
    .flatMap((axis) =>
      typeof value[axis] === "number" ? [(value[axis] as number).toFixed(2)] : []
    )
    .join("/");
}

function propLabel(userData: Record<string, unknown> | undefined): string {
  return typeof userData?.presentationId === "string" ? "DYNAMIC PROP" : "UNKNOWN";
}

function visualLabel(visual: ArenaVisualInspection) {
  const { position, rotation, scale } = visual;
  const root = `${visual.rootName}|p:${triplet(position)}|r:${triplet(rotation)}|s:${triplet(scale)}|v:${visual.visible}`;
  const part = visual.animatedPart;
  return part === undefined
    ? root
    : `${root}|part:${part.name}|p:${triplet(part.position)}|r:${triplet(part.rotation)}|s:${triplet(part.scale)}|v:${part.visible}`;
}

function triplet(value: { x: number; y: number; z: number }): string {
  return `${value.x.toFixed(3)},${value.y.toFixed(3)},${value.z.toFixed(3)}`;
}

function option(value: string): HTMLOptionElement {
  const target = document.createElement("option");
  target.value = value;
  target.textContent = value;
  return target;
}

function button(label: string): HTMLButtonElement {
  const target = document.createElement("button");
  target.type = "button";
  target.textContent = label;
  return target;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const target = document.createElement(tag);
  if (className !== undefined) target.className = className;
  if (text !== undefined) target.textContent = text;
  return target;
}
