import type { ArenaSnapshot } from "../shared/protocol";
import {
  ARENA_RANDOM_STAGE_SELECTION,
  arenaStageSelectionOptions
} from "../shared/arena-stage-selection";
import type { ArenaEffectPresentationEvent } from "./arena-effects";
import {
  buildArenaUiViewModel,
  createArenaUiAnnouncementTracker,
  type ArenaFeedEntry,
  type ArenaInputDevice,
  type ArenaUiCameraState
} from "./arena-ui-model";

export type ArenaUi = {
  root: HTMLElement;
  viewport: HTMLElement;
  sessionInput: HTMLInputElement;
  nameInput: HTMLInputElement;
  stageSelect: HTMLSelectElement;
  createButton: HTMLButtonElement;
  joinButton: HTMLButtonElement;
  disconnectButton: HTMLButtonElement;
  spectatorPreviousButton: HTMLButtonElement;
  spectatorNextButton: HTMLButtonElement;
  phase: HTMLElement;
  timer: HTMLElement;
  connection: HTMLElement;
  localPlayer: HTMLElement;
  diagnostics: HTMLElement;
  hint: HTMLElement;
  log: HTMLOListElement;
  round: HTMLElement;
  stageName: HTMLElement;
  stageFormat: HTMLElement;
  objective: HTMLElement;
  position: HTMLElement;
  progressLabel: HTMLElement;
  progress: HTMLElement;
  progressFill: HTMLElement;
  roster: HTMLElement;
  itemName: HTMLElement;
  itemState: HTMLElement;
  instabilityValue: HTMLElement;
  instabilityFill: HTMLElement;
  lobbyPanel: HTMLElement;
  lobbyTitle: HTMLElement;
  lobbyDetail: HTMLElement;
  lobbyRoster: HTMLElement;
  phaseOverlay: HTMLElement;
  overlayKicker: HTMLElement;
  overlayTitle: HTMLElement;
  overlayDetail: HTMLElement;
  spectatorPanel: HTMLElement;
  spectatorTarget: HTMLElement;
  spectatorDetail: HTMLElement;
  resultsPanel: HTMLElement;
  resultsKicker: HTMLElement;
  resultsTitle: HTMLElement;
  resultsDetail: HTMLElement;
  resultsPlacements: HTMLElement;
  authorityTick: HTMLElement;
  replayTicks: HTMLElement;
  pendingInputs: HTMLElement;
  effectState: HTMLElement;
  payloadSize: HTMLElement;
  effectFlash: HTMLElement;
  setConnection(status: "offline" | "connecting" | "online" | "error", detail: string): void;
  setBusy(busy: boolean): void;
  pushLog(message: string): void;
  pushFeed(entry: ArenaFeedEntry): void;
  syncAnnouncements(snapshot: ArenaSnapshot | undefined): void;
  showEffect(event: ArenaEffectPresentationEvent): void;
};

export type ArenaUiUpdateContext = {
  camera: ArenaUiCameraState;
  inputDevice: ArenaInputDevice;
  localPeerId?: string | undefined;
};

export function renderArenaUi(root: HTMLElement): ArenaUi {
  root.className = "arena-app";
  root.dataset.connection = "offline";
  root.dataset.phase = "offline";

  const shell = element("section", "arena-shell");
  const viewport = element("div", "arena-viewport");
  viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "Knockout Circuit 3D game viewport");

  const atmosphere = element("div", "arena-atmosphere");
  const scanline = element("div", "arena-scanline");
  const effectFlash = element("div", "arena-effect-flash");
  atmosphere.setAttribute("aria-hidden", "true");
  scanline.setAttribute("aria-hidden", "true");
  effectFlash.setAttribute("aria-hidden", "true");

  const broadcast = element("header", "arena-broadcast");
  const brand = element("div", "arena-brand");
  const brandMark = element("span", "arena-brand__mark", "KC");
  const brandCopy = element("div", "arena-brand__copy");
  brandCopy.append(
    element("span", "arena-brand__eyebrow", "GAMEKITS SPORTS NETWORK"),
    element("h1", "arena-brand__title", "KNOCKOUT CIRCUIT")
  );
  brand.append(brandMark, brandCopy);

  const scoreboard = element("div", "arena-scoreboard");
  const round = element("span", "arena-scoreboard__round", "STAGE --");
  const phase = element("strong", "arena-scoreboard__phase", "STANDBY");
  const timer = element("span", "arena-scoreboard__timer", "--:--");
  scoreboard.append(round, phase, timer);

  const signal = element("div", "arena-signal");
  signal.append(
    element("span", "arena-signal__dot"),
    element("span", undefined, "AUTHORITY OFFLINE")
  );
  broadcast.append(brand, scoreboard, signal);

  const objectiveCard = element("section", "arena-objective");
  const objectiveCopy = element("div", "arena-objective__copy");
  const stageFormat = element("span", "arena-objective__format", "PHYSICS PARTY");
  const stageName = element("strong", "arena-objective__name", "KNOCKOUT CIRCUIT");
  const objective = element("span", "arena-objective__detail", "Create a room or join a friend");
  objectiveCopy.append(stageFormat, stageName, objective);
  const objectiveBadge = element("span", "arena-objective__badge", "03 STAGES");
  objectiveCard.append(objectiveCopy, objectiveBadge);

  const raceHud = element("section", "arena-race-hud");
  const racePosition = element("div", "arena-race-hud__position-block");
  racePosition.append(
    element("span", "arena-race-hud__label", "CURRENT POSITION"),
    ((): HTMLElement => {
      const target = element("strong", "arena-race-hud__position", "-- / --");
      return target;
    })()
  );
  const position = racePosition.lastElementChild as HTMLElement;
  const raceProgress = element("div", "arena-race-hud__progress-block");
  const progressLabel = element("span", "arena-race-hud__progress-label", "COURSE STATUS");
  const roster = element("span", "arena-race-hud__roster", "WAITING FOR GRID");
  const progressTrack = element("div", "arena-progress");
  const progressFill = element("span", "arena-progress__fill");
  const progress = element("span", "arena-progress__value", "0%");
  progressTrack.append(progressFill);
  raceProgress.append(progressLabel, roster, progressTrack, progress);
  const equipment = element("div", "arena-equipment");
  const itemBlock = element("div", "arena-equipment__item");
  const itemName = element("strong", "arena-equipment__name", "EMPTY HANDS");
  const itemState = element("span", "arena-equipment__state", "FIND A PICKUP");
  itemBlock.append(element("span", "arena-equipment__label", "EQUIPMENT"), itemName, itemState);
  const instabilityBlock = element("div", "arena-instability");
  const instabilityHeader = element("div", "arena-instability__header");
  const instabilityValue = element("strong", undefined, "0%");
  instabilityHeader.append(element("span", undefined, "INSTABILITY"), instabilityValue);
  const instabilityTrack = element("div", "arena-instability__track");
  const instabilityFill = element("span", "arena-instability__fill");
  instabilityTrack.append(instabilityFill);
  instabilityBlock.append(instabilityHeader, instabilityTrack);
  equipment.append(itemBlock, instabilityBlock);
  raceHud.append(racePosition, raceProgress, equipment);

  const hint = element("div", "arena-hint");

  const sessionCard = element("section", "arena-session-card");
  sessionCard.tabIndex = 0;
  sessionCard.setAttribute("aria-label", "Room controls");
  const sessionHeader = element("div", "arena-session-card__header");
  sessionHeader.append(
    element("span", "arena-kicker", "PLAYER ACCESS"),
    element("strong", undefined, "ENTER THE CIRCUIT"),
    element("p", undefined, "Create a private grid or join the same room code on another screen.")
  );
  const sessionInput = input("text", "knockout-arena", "Session code");
  sessionInput.maxLength = 32;
  const nameInput = input("text", randomName(), "Display name");
  nameInput.maxLength = 18;
  const stageSelect = document.createElement("select");
  stageSelect.setAttribute("aria-label", "Starting scene");
  for (const option of arenaStageSelectionOptions()) {
    const target = document.createElement("option");
    target.value = option.value;
    target.textContent = option.label;
    stageSelect.append(target);
  }
  stageSelect.value = ARENA_RANDOM_STAGE_SELECTION;
  const fieldGrid = element("div", "arena-fields");
  const stageField = field("OPENING SCENE", stageSelect);
  stageField.classList.add("is-wide");
  fieldGrid.append(field("ROOM CODE", sessionInput), field("CALLSIGN", nameInput), stageField);
  const createButton = button("CREATE ROOM", "is-primary");
  const joinButton = button("JOIN RACE");
  const disconnectButton = button("LEAVE CIRCUIT", "is-quiet");
  disconnectButton.disabled = true;
  const actions = element("div", "arena-actions");
  actions.append(createButton, joinButton, disconnectButton);
  const connection = element("p", "arena-connection is-offline", "AUTHORITY READY");
  const localPlayer = element("p", "arena-local-player", "LOCAL SLOT · UNBOUND");
  sessionCard.append(sessionHeader, fieldGrid, actions, connection, localPlayer);

  const lobbyPanel = element("section", "arena-lobby-panel");
  const lobbyHeader = element("div", "arena-lobby-panel__header");
  const lobbyTitle = element("strong", undefined, "GRID ASSEMBLED");
  const lobbyDetail = element("span", undefined, "AUTO START WHEN AUTHORITY IS READY");
  lobbyHeader.append(element("span", "arena-kicker", "STARTING GRID"), lobbyTitle, lobbyDetail);
  const lobbyRoster = element("ol", "arena-lobby-roster");
  lobbyPanel.append(lobbyHeader, lobbyRoster);

  const phaseOverlay = element("section", "arena-phase-overlay");
  phaseOverlay.setAttribute("aria-live", "assertive");
  const overlayKicker = element("span", "arena-phase-overlay__kicker");
  const overlayTitle = element("strong", "arena-phase-overlay__title");
  const overlayDetail = element("span", "arena-phase-overlay__detail");
  phaseOverlay.append(overlayKicker, overlayTitle, overlayDetail);

  const spectatorPanel = element("section", "arena-spectator");
  const spectatorCopy = element("div", "arena-spectator__copy");
  const spectatorTarget = element("strong", undefined, "AUTO CAMERA");
  const spectatorDetail = element("span");
  spectatorCopy.append(
    element("span", "arena-kicker", "SPECTATING"),
    spectatorTarget,
    spectatorDetail
  );
  const spectatorActions = element("div", "arena-spectator__actions");
  const spectatorPreviousButton = button("‹ PREV", "is-compact");
  const spectatorNextButton = button("NEXT ›", "is-compact");
  spectatorActions.append(spectatorPreviousButton, spectatorNextButton);
  spectatorPanel.append(spectatorCopy, spectatorActions);

  const resultsPanel = element("section", "arena-results");
  resultsPanel.setAttribute("aria-live", "polite");
  const resultsHeader = element("div", "arena-results__header");
  const resultsKicker = element("span", "arena-results__kicker");
  const resultsTitle = element("strong", "arena-results__title");
  const resultsDetail = element("span", "arena-results__detail");
  resultsHeader.append(resultsKicker, resultsTitle, resultsDetail);
  const resultsPlacements = element("ol", "arena-results__placements");
  const resultsFooter = element("div", "arena-results__footer");
  resultsFooter.append(
    element("span", undefined, "AUTHORITY AUTO-QUEUES THE NEXT HEAT"),
    element("span", undefined, "NO RESPAWNS MID-STAGE")
  );
  resultsPanel.append(resultsHeader, resultsPlacements, resultsFooter);

  const telemetry = document.createElement("details");
  telemetry.className = "arena-telemetry";
  const telemetrySummary = document.createElement("summary");
  telemetrySummary.append(
    element("span", "arena-telemetry__pulse"),
    element("span", undefined, "NETCODE // LIVE TELEMETRY"),
    element("span", "arena-telemetry__toggle", "OPEN")
  );
  const metrics = element("div", "arena-metrics");
  const authorityTick = metric(metrics, "AUTH TICK", "0");
  const replayTicks = metric(metrics, "RESIM", "0");
  const pendingInputs = metric(metrics, "INPUT LEAD", "0");
  const effectState = metric(metrics, "FX SETTLED", "0 / 0");
  const payloadSize = metric(metrics, "FRAME", "0 KB");
  const diagnostics = element("pre", "arena-diagnostics", "Awaiting authority frame…");
  telemetry.append(telemetrySummary, metrics, diagnostics);

  const feed = element("aside", "arena-feed");
  const feedHeader = element("div", "arena-feed__header");
  feedHeader.append(
    element("span", "arena-feed__live"),
    element("span", undefined, "KNOCKOUT FEED")
  );
  const log = element("ol", "arena-log") as HTMLOListElement;
  log.setAttribute("aria-live", "polite");
  feed.append(feedHeader, log);

  viewport.append(
    atmosphere,
    scanline,
    effectFlash,
    broadcast,
    objectiveCard,
    raceHud,
    hint,
    sessionCard,
    lobbyPanel,
    phaseOverlay,
    spectatorPanel,
    resultsPanel,
    telemetry,
    feed
  );
  shell.append(viewport);
  root.replaceChildren(shell);

  const announcements = createArenaUiAnnouncementTracker();
  const feedIds = new Set<string>();
  let logSequence = 0;
  const ui: ArenaUi = {
    root,
    viewport,
    sessionInput,
    nameInput,
    stageSelect,
    createButton,
    joinButton,
    disconnectButton,
    spectatorPreviousButton,
    spectatorNextButton,
    phase,
    timer,
    connection,
    localPlayer,
    diagnostics,
    hint,
    log,
    round,
    stageName,
    stageFormat,
    objective,
    position,
    progressLabel,
    progress,
    progressFill,
    roster,
    itemName,
    itemState,
    instabilityValue,
    instabilityFill,
    lobbyPanel,
    lobbyTitle,
    lobbyDetail,
    lobbyRoster,
    phaseOverlay,
    overlayKicker,
    overlayTitle,
    overlayDetail,
    spectatorPanel,
    spectatorTarget,
    spectatorDetail,
    resultsPanel,
    resultsKicker,
    resultsTitle,
    resultsDetail,
    resultsPlacements,
    authorityTick,
    replayTicks,
    pendingInputs,
    effectState,
    payloadSize,
    effectFlash,
    setConnection(status, detail) {
      root.dataset.connection = status;
      connection.className = `arena-connection is-${status}`;
      connection.textContent = detail;
      const signalText = signal.lastElementChild;
      if (signalText) signalText.textContent = detail;
      signal.className = `arena-signal is-${status}`;
      if (status === "offline") announcements.reset();
    },
    setBusy(busy) {
      root.dataset.busy = String(busy);
      createButton.disabled = busy;
      joinButton.disabled = busy;
      disconnectButton.disabled = busy || root.dataset.connection !== "online";
      sessionInput.disabled = busy;
      nameInput.disabled = busy;
      stageSelect.disabled = busy;
    },
    pushLog(message) {
      logSequence += 1;
      ui.pushFeed({
        id: `client:${logSequence}`,
        tone: classifyLogMessage(message),
        kicker: "RACE CONTROL",
        title: message,
        detail: "LOCAL CLIENT"
      });
    },
    pushFeed(entry) {
      if (feedIds.has(entry.id)) return;
      feedIds.add(entry.id);
      const item = element("li", `is-${entry.tone}`);
      item.dataset.feedId = entry.id;
      item.append(
        element("span", "arena-log__kicker", entry.kicker),
        element("strong", "arena-log__title", entry.title),
        element("span", "arena-log__detail", entry.detail)
      );
      log.prepend(item);
      while (log.childElementCount > 6) {
        const last = log.lastElementChild as HTMLElement | null;
        const id = last?.dataset.feedId;
        if (id !== undefined) feedIds.delete(id);
        last?.remove();
      }
    },
    syncAnnouncements(snapshot) {
      for (const entry of announcements.update(snapshot)) ui.pushFeed(entry);
    },
    showEffect(event) {
      if (event.phase === "cancel") return;
      effectFlash.className = "arena-effect-flash";
      void effectFlash.offsetWidth;
      effectFlash.classList.add("is-active", `is-${event.kind}`, `is-${event.phase}`);
    }
  };
  return ui;
}

export function updateArenaUi(
  ui: ArenaUi,
  snapshot: ArenaSnapshot | undefined,
  localMemberId: string | undefined,
  telemetry: Record<string, unknown>,
  context: ArenaUiUpdateContext = {
    camera: { mode: "broadcast" },
    inputDevice: "keyboard"
  }
): void {
  updateTelemetry(ui, snapshot, telemetry);
  ui.syncAnnouncements(snapshot);
  const model = buildArenaUiViewModel({
    snapshot,
    localMemberId,
    camera: context.camera,
    inputDevice: context.inputDevice,
    localPeerId: context.localPeerId
  });

  ui.root.dataset.phase = model.phase;
  ui.root.dataset.inputDevice = context.inputDevice;
  ui.root.dataset.timerUrgent = String(model.timerUrgent);
  ui.phase.textContent = phaseLabel(model.phase);
  ui.timer.textContent = model.timer;
  ui.round.textContent =
    model.stage.number === 0
      ? "STAGE --"
      : `STAGE ${String(model.stage.number).padStart(2, "0")} / ${String(model.stage.count).padStart(2, "0")}`;
  ui.stageName.textContent = model.stage.name;
  ui.stageFormat.textContent = model.stage.format;
  ui.objective.textContent = model.stage.objective;
  ui.position.textContent = model.position;
  ui.progressLabel.textContent = model.progressLabel;
  ui.roster.textContent = model.roster;
  ui.progress.textContent = `${model.progress}%`;
  ui.progressFill.style.setProperty("--race-progress", `${model.progress}%`);
  ui.itemName.textContent = model.item.name;
  ui.itemState.textContent = model.item.state;
  ui.itemName.parentElement?.classList.toggle("is-active", model.item.active);
  ui.instabilityValue.textContent = `${model.instability}%`;
  ui.instabilityFill.style.setProperty("--instability", `${model.instability}%`);
  ui.localPlayer.textContent = `LOCAL SLOT · ${localMemberId ?? "SPECTATOR"} · ${model.localStatus}`;

  ui.lobbyPanel.classList.toggle("is-visible", model.lobby.visible);
  ui.lobbyTitle.textContent = model.lobby.title;
  ui.lobbyDetail.textContent = model.lobby.detail;
  ui.lobbyRoster.replaceChildren(
    ...model.lobby.participants.map((participant, index) => {
      const item = element("li", participant.status === "ACTIVE" ? "is-active" : undefined);
      item.append(
        element("span", "arena-lobby-roster__slot", String(index + 1).padStart(2, "0")),
        element("strong", undefined, participant.name),
        element("span", undefined, participant.detail),
        element("em", undefined, participant.status)
      );
      return item;
    })
  );

  ui.phaseOverlay.className = `arena-phase-overlay is-${model.overlay.tone}${model.overlay.visible ? " is-visible" : ""}`;
  ui.overlayKicker.textContent = model.overlay.kicker;
  ui.overlayTitle.textContent = model.overlay.title;
  ui.overlayDetail.textContent = model.overlay.detail;

  ui.spectatorPanel.classList.toggle("is-visible", model.spectator.visible);
  ui.spectatorTarget.textContent = model.spectator.target;
  ui.spectatorDetail.textContent = model.spectator.detail;
  ui.spectatorPreviousButton.disabled = !model.spectator.visible;
  ui.spectatorNextButton.disabled = !model.spectator.visible;

  ui.resultsPanel.classList.toggle("is-visible", model.results.visible);
  ui.resultsKicker.textContent = model.results.kicker;
  ui.resultsTitle.textContent = model.results.title;
  ui.resultsDetail.textContent = model.results.detail;
  ui.resultsPlacements.replaceChildren(
    ...model.results.placements.map((placement) => {
      const item = element("li", `is-${placement.outcome.toLowerCase()}`);
      item.append(
        element("span", "arena-results__rank", String(placement.rank).padStart(2, "0")),
        element("strong", undefined, placement.name),
        element("em", undefined, placement.outcome)
      );
      return item;
    })
  );

  ui.hint.replaceChildren(
    ...model.prompts.flatMap(({ key, action }) => [keycap(key), element("span", undefined, action)])
  );
}

function updateTelemetry(
  ui: ArenaUi,
  snapshot: ArenaSnapshot | undefined,
  telemetry: Record<string, unknown>
): void {
  const replication = recordValue(telemetry.replication);
  const island = recordValue(telemetry.island);
  const effects = recordValue(telemetry.effects);
  const journal = recordValue(effects.journal);
  const presentation = recordValue(effects.presentation);
  const authority = recordValue(telemetry.authority);
  ui.authorityTick.textContent = compactNumber(
    numberValue(telemetry.authorityTick, snapshot?.frame.tick ?? 0)
  );
  ui.replayTicks.textContent = compactNumber(numberValue(island.resimulatedTicks, 0));
  ui.pendingInputs.textContent = compactNumber(numberValue(replication.pendingInputs, 0));
  ui.effectState.textContent = `${compactNumber(numberValue(presentation.confirmed, 0))} / ${compactNumber(numberValue(journal.pending, 0))}`;
  ui.payloadSize.textContent = `${(numberValue(authority.payloadBytes, 0) / 1024).toFixed(1)} KB`;
  ui.diagnostics.textContent = JSON.stringify(telemetry, null, 2);
}

function field(label: string, control: HTMLElement): HTMLElement {
  const root = element("label", "arena-field");
  root.append(element("span", undefined, label), control);
  return root;
}

function input(type: string, value: string, label: string): HTMLInputElement {
  const target = document.createElement("input");
  target.type = type;
  target.value = value;
  target.setAttribute("aria-label", label);
  target.autocomplete = "off";
  return target;
}

function button(label: string, modifier?: string): HTMLButtonElement {
  const target = document.createElement("button");
  target.type = "button";
  target.className = `arena-button${modifier ? ` ${modifier}` : ""}`;
  target.textContent = label;
  return target;
}

function keycap(label: string): HTMLElement {
  return element("kbd", "arena-keycap", label);
}

function metric(parent: HTMLElement, label: string, initial: string): HTMLElement {
  const value = element("strong", "arena-metric__value", initial);
  const item = element("div", "arena-metric");
  item.append(element("span", "arena-metric__label", label), value);
  parent.append(item);
  return value;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const target = document.createElement(tag);
  if (className) target.className = className;
  if (text !== undefined) target.textContent = text;
  return target;
}

function phaseLabel(phase: ArenaSnapshot["phase"] | "offline"): string {
  if (phase === "offline") return "STANDBY";
  if (phase === "lobby") return "GRID OPEN";
  if (phase === "countdown") return "GET READY";
  if (phase === "running") return "RACE LIVE";
  return "RESULTS";
}

function compactNumber(value: number): string {
  return value >= 10_000
    ? `${(value / 1000).toFixed(1)}K`
    : Math.round(value).toLocaleString("en-US");
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function classifyLogMessage(message: string): ArenaFeedEntry["tone"] {
  const normalized = message.toLowerCase();
  if (normalized.includes("reject") || normalized.includes("error")) return "knockout";
  if (normalized.includes("accepted") || normalized.includes("ready")) return "qualified";
  return "system";
}

function randomName(): string {
  const names = ["TURBO BEAN", "NIGHT COMET", "RAMP RAT", "PUSH UNIT", "SOFT IMPACT"];
  return names[Math.floor(Math.random() * names.length)] ?? "TURBO BEAN";
}
