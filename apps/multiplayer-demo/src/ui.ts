import type { MultiplayerDemoAppSnapshot } from "./domain";
import type { MultiplayerDemoClient } from "./client";
import type { ColyseusNativeStateBridgeDiagnostics } from "@gamekits/multiplayer-colyseus";
import type { RealtimeArenaAuthorityPath } from "./realtime/authority-path";
import type { RealtimeArenaSnapshot, RealtimeArenaState } from "./realtime/domain";
import type { RealtimeLocalGameDiagnostics } from "./realtime/local-game";
import type { RealtimeArenaPresentationDiagnostics } from "./realtime/presentation";
import type { RealtimeArenaPredictionDiagnostics } from "./realtime/prediction";
import type {
  RealtimeArenaAuthorityInputDiagnostics,
  RealtimeArenaParticipant,
  RealtimeArenaParticipantSummary
} from "./realtime/protocol";

type RealtimeArenaViewState = RealtimeArenaState | RealtimeArenaSnapshot;

const INTERACT_SHORTCUT_KEY = "E";
const INTERACT_BUTTON_LABEL = `Interact [${INTERACT_SHORTCUT_KEY}]`;
const DELIVER_BUTTON_LABEL = `Deliver [${INTERACT_SHORTCUT_KEY}]`;

export type MultiplayerDemoRunMode =
  | "local-offline"
  | "host"
  | "client"
  | "host-not-joined"
  | "hosted-not-joined";

export type MultiplayerDemoRoomControls = {
  host: boolean;
  join: boolean;
  leave: boolean;
  resetRoom: boolean;
};

export type MultiplayerDemoJoinRole = "host" | "client";

export type RealtimeArenaControlPermissions = {
  ready: boolean;
  startRound: boolean;
  interact: boolean;
  rematch: boolean;
  resetArena: boolean;
};

export type RealtimeNetworkConditionSettings = {
  enabled: boolean;
  latencyMs: number;
  jitterMs: number;
  lossPercent: number;
};

export type RealtimeArenaUiDiagnostics = RealtimeLocalGameDiagnostics & {
  presentation?: RealtimeArenaPresentationDiagnostics;
  prediction?: RealtimeArenaPredictionDiagnostics;
  authorityInput?: RealtimeArenaAuthorityInputDiagnostics;
  participant?: RealtimeArenaParticipant;
  participantSummary?: RealtimeArenaParticipantSummary;
  nativeState?: ColyseusNativeStateBridgeDiagnostics;
};

export type MultiplayerDemoConfig = {
  endpoint: string;
  roomName: string;
  defaultSessionId: string;
  authoritativePath: RealtimeArenaAuthorityPath;
  sessions: string[];
};

export type MultiplayerDemoSessionInfo = {
  endpoint: string;
  roomName: string;
  sessionId: string;
  hostPeerId: string;
  authoritativePath: RealtimeArenaAuthorityPath;
  snapshot: MultiplayerDemoAppSnapshot;
};

export type MultiplayerDemoUi = {
  root: HTMLElement;
  status: HTMLElement;
  mode: HTMLElement;
  backend: HTMLElement;
  session: HTMLElement;
  peers: HTMLElement;
  sent: HTMLElement;
  received: HTMLElement;
  applied: HTMLElement;
  rejected: HTMLElement;
  timeline: HTMLElement;
  messages: HTMLElement;
  playerNameInput: HTMLInputElement;
  roomInput: HTMLInputElement;
  hostButton: HTMLButtonElement;
  connectButton: HTMLButtonElement;
  disconnectButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  networkEnabledInput: HTMLInputElement;
  networkLatencyInput: HTMLInputElement;
  networkJitterInput: HTMLInputElement;
  networkLossInput: HTMLInputElement;
  forgeInputButton: HTMLButtonElement;
  networkSummary: HTMLElement;
  arenaCanvas: HTMLCanvasElement;
  arenaPhase: HTMLElement;
  arenaTimer: HTMLElement;
  arenaScore: HTMLElement;
  arenaPlayer: HTMLElement;
  arenaInput: HTMLElement;
  arenaHint: HTMLElement;
  readyButton: HTMLButtonElement;
  startRoundButton: HTMLButtonElement;
  interactButton: HTMLButtonElement;
  rematchButton: HTMLButtonElement;
  resetArenaButton: HTMLButtonElement;
};

export function renderMultiplayerDemoShell(root: HTMLElement): MultiplayerDemoUi {
  root.className = "multiplayer-demo";

  const shell = createElement("section", "multiplayer-demo__shell");
  const main = createElement("section", "multiplayer-demo__main");
  const side = createElement("aside", "multiplayer-demo__side");
  const header = createElement("header", "multiplayer-demo__header");
  const eyebrow = createElement("p", "multiplayer-demo__eyebrow", "GameKits Multiplayer");
  const title = createElement("h1", "multiplayer-demo__title", "Relay Arena");
  const status = createElement("p", "multiplayer-demo__status", "Booting demo server");
  header.replaceChildren(eyebrow, title, status);

  const arena = createRealtimeArenaPanel();

  const metrics = createElement("section", "multiplayer-demo__metrics");
  const mode = createMetric("Mode");
  const backend = createMetric("Backend");
  const session = createMetric("Session");
  const peers = createMetric("Peers");
  const sent = createMetric("Sent");
  const received = createMetric("Received");
  const applied = createMetric("Accepted");
  const rejected = createMetric("Rejected");
  metrics.replaceChildren(
    mode.root,
    backend.root,
    session.root,
    peers.root,
    sent.root,
    received.root,
    applied.root,
    rejected.root
  );

  const controls = createElement("section", "multiplayer-demo__controls");
  const playerNameInput = createPlayerNameInput();
  const roomInput = createRoomInput();
  const hostButton = createButton("Host & Join");
  const connectButton = createButton("Join", "multiplayer-demo__primary");
  const disconnectButton = createButton("Leave");
  const resetButton = createButton("Reset");
  const networkConditions = createNetworkConditionControls();

  controls.replaceChildren(
    createElement("h2", "multiplayer-demo__section-title", "Room"),
    createRoomControls(playerNameInput, roomInput, [
      hostButton,
      connectButton,
      disconnectButton,
      resetButton
    ])
  );

  const timeline = createElement("ol", "multiplayer-demo__timeline");
  const messages = createElement("ol", "multiplayer-demo__messages");
  const eventsPanel = createElement("section", "multiplayer-demo__feed-panel");
  eventsPanel.replaceChildren(
    createElement("h2", "multiplayer-demo__section-title", "Events"),
    timeline
  );
  const messagesPanel = createElement("section", "multiplayer-demo__feed-panel");
  messagesPanel.replaceChildren(
    createElement("h2", "multiplayer-demo__section-title", "Messages"),
    messages
  );
  side.replaceChildren(controls, networkConditions.root, metrics, eventsPanel, messagesPanel);

  main.replaceChildren(header, arena.root);
  shell.replaceChildren(main, side);
  root.replaceChildren(shell);

  return {
    root,
    status,
    mode: mode.value,
    backend: backend.value,
    session: session.value,
    peers: peers.value,
    sent: sent.value,
    received: received.value,
    applied: applied.value,
    rejected: rejected.value,
    timeline,
    messages,
    playerNameInput,
    roomInput,
    hostButton,
    connectButton,
    disconnectButton,
    resetButton,
    networkEnabledInput: networkConditions.enabledInput,
    networkLatencyInput: networkConditions.latencyInput,
    networkJitterInput: networkConditions.jitterInput,
    networkLossInput: networkConditions.lossInput,
    forgeInputButton: networkConditions.forgeInputButton,
    networkSummary: networkConditions.summary,
    arenaCanvas: arena.canvas,
    arenaPhase: arena.phase,
    arenaTimer: arena.timer,
    arenaScore: arena.score,
    arenaPlayer: arena.player,
    arenaInput: arena.input,
    arenaHint: arena.hint,
    readyButton: arena.readyButton,
    startRoundButton: arena.startRoundButton,
    interactButton: arena.interactButton,
    rematchButton: arena.rematchButton,
    resetArenaButton: arena.resetArenaButton
  };
}

export function bindMultiplayerDemoControls(
  ui: MultiplayerDemoUi,
  actions: {
    host(): void;
    connect(): void;
    disconnect(): void;
    reset(): void;
  }
): void {
  ui.hostButton.addEventListener("click", actions.host);
  ui.connectButton.addEventListener("click", actions.connect);
  ui.disconnectButton.addEventListener("click", actions.disconnect);
  ui.resetButton.addEventListener("click", actions.reset);
  ui.roomInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !ui.hostButton.disabled) {
      actions.host();
    }
  });
}

export function bindRealtimeArenaControls(
  ui: MultiplayerDemoUi,
  actions: {
    ready(): void;
    startRound(): void;
    interact(): void;
    rematch(): void;
    resetArena(): void;
  }
): void {
  ui.readyButton.addEventListener("click", actions.ready);
  ui.startRoundButton.addEventListener("click", actions.startRound);
  ui.interactButton.addEventListener("click", actions.interact);
  ui.rematchButton.addEventListener("click", actions.rematch);
  ui.resetArenaButton.addEventListener("click", actions.resetArena);
}

export function bindRealtimeNetworkConditionControls(
  ui: MultiplayerDemoUi,
  action: (settings: RealtimeNetworkConditionSettings) => void
): void {
  const update = (): void => {
    const settings = readRealtimeNetworkConditionSettings(ui);
    renderRealtimeNetworkConditionSettings(ui, settings);
    action(settings);
  };

  ui.networkEnabledInput.addEventListener("change", update);
  ui.networkLatencyInput.addEventListener("input", update);
  ui.networkJitterInput.addEventListener("input", update);
  ui.networkLossInput.addEventListener("input", update);
  update();
}

export function readRealtimeNetworkConditionSettings(
  ui: MultiplayerDemoUi
): RealtimeNetworkConditionSettings {
  return {
    enabled: ui.networkEnabledInput.checked,
    latencyMs: clampInteger(ui.networkLatencyInput.valueAsNumber, 0, 1000),
    jitterMs: clampInteger(ui.networkJitterInput.valueAsNumber, 0, 1000),
    lossPercent: clampInteger(ui.networkLossInput.valueAsNumber, 0, 100)
  };
}

export function renderRealtimeNetworkConditionSettings(
  ui: MultiplayerDemoUi,
  settings: RealtimeNetworkConditionSettings
): void {
  ui.networkEnabledInput.checked = settings.enabled;
  ui.networkLatencyInput.value = String(settings.latencyMs);
  ui.networkJitterInput.value = String(settings.jitterMs);
  ui.networkLossInput.value = String(settings.lossPercent);
  ui.networkLatencyInput.disabled = !settings.enabled;
  ui.networkJitterInput.disabled = !settings.enabled;
  ui.networkLossInput.disabled = !settings.enabled;
  ui.networkSummary.textContent = settings.enabled
    ? `${settings.latencyMs}ms + ${settings.jitterMs}ms jitter / ${settings.lossPercent}% loss`
    : "off";
}

export function renderServerReady(ui: MultiplayerDemoUi, config: MultiplayerDemoConfig): void {
  ui.status.textContent = "Server ready";
  ui.mode.textContent = runModeLabel("local-offline");
  ui.backend.textContent = formatAuthorityBackend(config.authoritativePath);
  ui.session.textContent = ui.roomInput.value.trim() || config.defaultSessionId;
  ui.peers.textContent = "0";
  ui.peers.title = "0 active / 0 tracked";
  ui.sent.textContent = "0";
  ui.received.textContent = "0";
  ui.applied.textContent = "0";
  ui.rejected.textContent = "0";
  ui.timeline.replaceChildren();
}

export function renderSessionInfo(ui: MultiplayerDemoUi, info: MultiplayerDemoSessionInfo): void {
  ui.status.textContent = "Room hosted";
  renderSnapshot(ui, info.snapshot);
}

export function renderClientState(
  ui: MultiplayerDemoUi,
  client: MultiplayerDemoClient | undefined,
  options: {
    activeSessionId?: string;
    selectedSessionId?: string;
    busy?: boolean;
    mode: MultiplayerDemoRunMode;
  }
): void {
  const busy = options.busy === true;
  const controls = resolveMultiplayerDemoRoomControls(options.mode, busy);

  ui.root.dataset.multiplayerMode = options.mode;
  ui.mode.textContent = runModeLabel(options.mode);
  if (client) {
    ui.backend.textContent = formatAuthorityBackend(client.authoritativePath);
  }
  ui.disconnectButton.textContent = options.mode === "host" ? "Close Host" : "Leave";
  ui.hostButton.disabled = !controls.host;
  ui.connectButton.disabled = !controls.join;
  ui.disconnectButton.disabled = !controls.leave || client === undefined;
  ui.resetButton.disabled = !controls.resetRoom;
  ui.forgeInputButton.disabled = busy || (options.mode !== "host" && options.mode !== "client");
  ui.messages.replaceChildren();

  for (const message of [...(client?.messages ?? [])].reverse().slice(0, 8)) {
    const item = createElement("li", "multiplayer-demo__message");
    const title = createElement("strong", undefined, message.kind);
    const detail = createElement(
      "span",
      undefined,
      `${message.sourcePeerId} -> ${message.targetPeerIds?.join(",") ?? "broadcast"}`
    );
    item.replaceChildren(title, detail);
    ui.messages.append(item);
  }
}

export function renderRealtimeArenaUi(
  ui: MultiplayerDemoUi,
  state: RealtimeArenaViewState,
  diagnostics: RealtimeArenaUiDiagnostics,
  localPlayerId: string,
  permissions: RealtimeArenaControlPermissions = resolveRealtimeArenaControlPermissions(
    "local-offline"
  )
): void {
  const localPlayer = state.players.find((player) => player.id === localPlayerId);
  ui.arenaPhase.textContent = state.phase;
  ui.arenaTimer.textContent = formatRoundTime(state);
  ui.arenaScore.textContent = formatScore(state.score);
  ui.arenaPlayer.textContent =
    localPlayer === undefined
      ? diagnostics.participant === undefined
        ? "none"
        : `${diagnostics.participant.displayName ?? diagnostics.participant.peerId} / ${diagnostics.participant.status}`
      : `${localPlayer.label} / ${localPlayer.teamId} / ${localPlayer.carryingCoreId ?? "empty"} / ${localPlayer.deliveredCores}`;
  ui.arenaInput.textContent = formatRealtimeArenaDiagnostics(diagnostics);
  ui.arenaInput.title = formatRealtimeArenaDiagnosticsTitle(diagnostics);
  ui.arenaHint.textContent = arenaHint(state, diagnostics, localPlayer);

  ui.readyButton.disabled =
    !permissions.ready || state.phase !== "lobby" || localPlayer === undefined;
  ui.readyButton.textContent = localPlayer?.ready ? "Unready" : "Ready";
  ui.startRoundButton.disabled =
    !permissions.startRound || state.phase !== "lobby" || localPlayer?.ready !== true;
  ui.interactButton.disabled =
    !permissions.interact || state.phase !== "running" || localPlayer === undefined;
  ui.interactButton.textContent = formatInteractButtonLabel(localPlayer?.carryingCoreId);
  ui.rematchButton.disabled = !permissions.rematch || state.phase !== "results";
  ui.resetArenaButton.disabled = !permissions.resetArena;

  ui.timeline.replaceChildren();
  for (const entry of [...state.events].reverse().slice(0, 12)) {
    const item = createElement("li", `multiplayer-demo__timeline-item is-${eventTone(entry.type)}`);
    const title = createElement("strong", undefined, entry.label);
    const detail = createElement(
      "span",
      undefined,
      entry.code ?? entry.teamId ?? entry.playerId ?? "round"
    );
    item.replaceChildren(title, detail);
    ui.timeline.append(item);
  }
}

export function formatRealtimeArenaDiagnostics(diagnostics: RealtimeArenaUiDiagnostics): string {
  const frameRate = diagnostics.presentation?.frameRate ?? 0;
  const delay = Math.round(diagnostics.presentation?.interpolationDelayMs ?? 0);
  const jitter = Math.round(diagnostics.presentation?.estimatedJitterMs ?? 0);
  const queuedInputs = diagnostics.authorityInput?.queuedInputs ?? 0;
  const participants = diagnostics.participantSummary;
  const ack = diagnostics.prediction?.inputAckSequence;
  const correction = diagnostics.prediction?.lastCorrectionMagnitude ?? 0;
  const sequence =
    ack === undefined ? `${diagnostics.inputSequence}` : `${diagnostics.inputSequence}->${ack}`;
  const participantText =
    participants === undefined ? "" : ` / p${participants.active}/${participants.round}`;
  const nativeStateText =
    diagnostics.nativeState?.lastStateVersion === undefined
      ? ""
      : ` / sv${diagnostics.nativeState.lastStateVersion}`;
  return `${sequence} / ${diagnostics.inputSendRate}hz / ${diagnostics.serverTickRate}tps / ${frameRate}fps / d${delay} / j${jitter} / q${queuedInputs}${participantText} / c${Math.round(correction)}${nativeStateText}`;
}

export function formatRealtimeArenaDiagnosticsTitle(
  diagnostics: RealtimeArenaUiDiagnostics
): string {
  const presentation = diagnostics.presentation;
  if (!presentation) {
    return "input sequence / input ack / input send rate / server tick rate / presentation frame rate";
  }

  const status = presentation.lastSampleStatus ?? "waiting";
  const age =
    presentation.lastSampleAgeMs === undefined
      ? "age --"
      : `age ${Math.round(presentation.lastSampleAgeMs)}ms`;
  const delay =
    presentation.lastSampleDelayMs === undefined
      ? "delay --"
      : `delay ${Math.round(presentation.lastSampleDelayMs)}ms`;
  const jitter = presentation.adaptiveDelayEnabled
    ? `jitter ${Math.round(presentation.estimatedJitterMs)}ms; target ${Math.round(presentation.targetDelayMs)}ms`
    : "jitter fixed";
  const prediction = diagnostics.prediction;
  const authorityInput = diagnostics.authorityInput;
  const authorityInputText =
    authorityInput === undefined
      ? "authority input --"
      : `authority input queued ${authorityInput.queuedInputs}; peak ${authorityInput.maxQueuedInputs}; coalesced ${authorityInput.coalescedInputs}`;
  const participantSummary = diagnostics.participantSummary;
  const participantText =
    participantSummary === undefined
      ? "participants --"
      : `participants active ${participantSummary.active}; tracked ${participantSummary.tracked}; round ${participantSummary.round}; waiting ${participantSummary.waiting}; disconnected ${participantSummary.disconnected}`;
  const predictionText =
    prediction === undefined
      ? "prediction --"
      : [
          `ack ${prediction.inputAckSequence ?? "--"}`,
          `pending ${prediction.pendingInputs}`,
          `lead ${prediction.inputLead ?? "--"}`,
          `rtt ${formatOptionalMs(prediction.roundTripTimeMs)}`,
          `snapshot ${formatOptionalMs(prediction.snapshotAgeMs)}`,
          `correction ${formatOptionalNumber(prediction.lastCorrectionMagnitude)}`,
          `smoothing ${prediction.correctionSmoothingActive ? `${Math.round(prediction.correctionSmoothingElapsedMs)}ms` : "off"}`,
          `smoothed ${prediction.smoothedCorrections}`,
          `prediction phase ${Math.round(prediction.presentationAlpha * 100)}% (${formatOptionalMs(prediction.presentationElapsedMs)})`,
          `presentation clamps ${prediction.clampedPresentationFrames}`
        ].join("; ");
  const nativeState = diagnostics.nativeState;
  const nativeStateText =
    nativeState === undefined
      ? "authority state gamekits-envelope"
      : `authority state ${nativeState.authoritativePath}; version ${nativeState.lastStateVersion ?? "--"}; schema ${nativeState.lastVersion ?? "--"}; bytes ${nativeState.lastStateBytes ?? "--"}; applied ${nativeState.appliedUpdates}; rejected ${nativeState.rejectedUpdates}; resyncs ${nativeState.resyncs}`;
  return `presentation ${status}; ${presentation.bufferLength} buffered; ${age}; ${delay}; ${jitter}; ${authorityInputText}; ${participantText}; ${predictionText}; ${nativeStateText}`;
}

function formatAuthorityBackend(authoritativePath: RealtimeArenaAuthorityPath): string {
  return authoritativePath === "colyseus-schema" ? "colyseus / schema" : "colyseus / envelope";
}

function formatOptionalMs(value: number | undefined): string {
  return value === undefined ? "--" : `${Math.round(value)}ms`;
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "--" : String(Math.round(value * 10) / 10);
}

export function resolveMultiplayerDemoRoomControls(
  mode: MultiplayerDemoRunMode,
  busy = false
): MultiplayerDemoRoomControls {
  if (busy) {
    return {
      host: false,
      join: false,
      leave: false,
      resetRoom: false
    };
  }

  switch (mode) {
    case "local-offline":
      return {
        host: true,
        join: true,
        leave: false,
        resetRoom: false
      };
    case "host":
      return {
        host: false,
        join: false,
        leave: true,
        resetRoom: true
      };
    case "client":
      return {
        host: false,
        join: false,
        leave: true,
        resetRoom: false
      };
    case "host-not-joined":
      return {
        host: false,
        join: true,
        leave: false,
        resetRoom: true
      };
    case "hosted-not-joined":
      return {
        host: false,
        join: true,
        leave: false,
        resetRoom: false
      };
  }
}

export function resolveMultiplayerDemoJoinRole(
  mode: MultiplayerDemoRunMode
): MultiplayerDemoJoinRole {
  return mode === "host-not-joined" ? "host" : "client";
}

export function resolveRealtimeArenaControlPermissions(
  mode: MultiplayerDemoRunMode
): RealtimeArenaControlPermissions {
  switch (mode) {
    case "local-offline":
    case "host":
      return {
        ready: true,
        startRound: true,
        interact: true,
        rematch: true,
        resetArena: true
      };
    case "client":
      return {
        ready: true,
        startRound: false,
        interact: true,
        rematch: false,
        resetArena: false
      };
    case "host-not-joined":
    case "hosted-not-joined":
      return {
        ready: false,
        startRound: false,
        interact: false,
        rematch: false,
        resetArena: false
      };
  }
}

export function runModeLabel(mode: MultiplayerDemoRunMode): string {
  switch (mode) {
    case "local-offline":
      return "local offline";
    case "host":
      return "host";
    case "client":
      return "client";
    case "host-not-joined":
      return "host / not joined";
    case "hosted-not-joined":
      return "not joined";
  }
}

export function renderSnapshot(ui: MultiplayerDemoUi, snapshot: MultiplayerDemoAppSnapshot): void {
  const activePeers = snapshot.multiplayer.peers.filter((peer) =>
    isActivePeerStatus(peer.status)
  ).length;

  ui.backend.textContent = snapshot.multiplayer.backendId;
  ui.session.textContent = snapshot.multiplayer.session?.id ?? "none";
  ui.peers.textContent = String(activePeers);
  ui.peers.title = `${activePeers} active / ${snapshot.multiplayer.peers.length} tracked`;
  ui.sent.textContent = String(snapshot.multiplayer.sent);
  ui.received.textContent = String(snapshot.multiplayer.received);
  ui.applied.textContent = String(snapshot.state.appliedCommands);
  ui.rejected.textContent = String(snapshot.state.rejectedCommands);

  ui.timeline.replaceChildren();
  for (const entry of snapshot.state.timeline) {
    const item = createElement("li", `multiplayer-demo__timeline-item is-${entry.type}`);
    const title = createElement("strong", undefined, entry.label);
    const detail = createElement("span", undefined, entry.code ?? entry.peerId ?? "host");
    item.replaceChildren(title, detail);
    ui.timeline.append(item);
  }
}

export function renderBootError(root: HTMLElement, error: unknown): void {
  root.className = "multiplayer-demo";
  const panel = createElement("section", "multiplayer-demo__boot-error");
  panel.replaceChildren(
    createElement("h1", undefined, "Multiplayer demo failed to boot"),
    createElement("p", undefined, error instanceof Error ? error.message : String(error))
  );
  root.replaceChildren(panel);
}

function createMetric(label: string): { root: HTMLElement; value: HTMLElement } {
  const root = createElement("div", "multiplayer-demo__metric");
  const labelElement = createElement("span", undefined, label);
  const value = createElement("strong", undefined, "...");
  root.replaceChildren(labelElement, value);
  return { root, value };
}

function createRealtimeArenaPanel(): {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  phase: HTMLElement;
  timer: HTMLElement;
  score: HTMLElement;
  player: HTMLElement;
  input: HTMLElement;
  hint: HTMLElement;
  readyButton: HTMLButtonElement;
  startRoundButton: HTMLButtonElement;
  interactButton: HTMLButtonElement;
  rematchButton: HTMLButtonElement;
  resetArenaButton: HTMLButtonElement;
} {
  const root = createElement("section", "multiplayer-demo__arena");
  const stage = createElement("div", "multiplayer-demo__arena-stage");
  const canvas = document.createElement("canvas");
  canvas.className = "multiplayer-demo__arena-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Relay Arena");
  const hud = createElement("div", "multiplayer-demo__arena-hud");
  const phase = createHudMetric("Phase");
  const timer = createHudMetric("Timer");
  const score = createHudMetric("Score");
  const player = createHudMetric("Runner");
  const input = createHudMetric("Net / FPS");
  hud.replaceChildren(phase.root, timer.root, score.root, player.root, input.root);
  stage.replaceChildren(canvas, hud);

  const controls = createElement("div", "multiplayer-demo__round-controls");
  const readyButton = createButton("Ready");
  const startRoundButton = createButton("Start Round", "multiplayer-demo__primary");
  const interactButton = createButton(INTERACT_BUTTON_LABEL);
  interactButton.setAttribute("aria-keyshortcuts", INTERACT_SHORTCUT_KEY);
  interactButton.title = `Shortcut: ${INTERACT_SHORTCUT_KEY}`;
  const rematchButton = createButton("Rematch");
  const resetArenaButton = createButton("Reset Arena");
  controls.replaceChildren(
    readyButton,
    startRoundButton,
    interactButton,
    rematchButton,
    resetArenaButton
  );
  const hint = createElement("p", "multiplayer-demo__arena-hint", "Local arena ready");
  root.replaceChildren(stage, controls, hint);

  return {
    root,
    canvas,
    phase: phase.value,
    timer: timer.value,
    score: score.value,
    player: player.value,
    input: input.value,
    hint,
    readyButton,
    startRoundButton,
    interactButton,
    rematchButton,
    resetArenaButton
  };
}

function createHudMetric(label: string): { root: HTMLElement; value: HTMLElement } {
  const root = createElement("div", "multiplayer-demo__hud-metric");
  const labelElement = createElement("span", undefined, label);
  const value = createElement("strong", undefined, "...");
  root.replaceChildren(labelElement, value);
  return { root, value };
}

function createRoomControls(
  playerNameInput: HTMLInputElement,
  roomInput: HTMLInputElement,
  buttons: HTMLButtonElement[]
): HTMLElement {
  const group = createElement("div", "multiplayer-demo__room-controls");
  const playerLabel = document.createElement("label");
  playerLabel.className = "multiplayer-demo__room-label";
  playerLabel.htmlFor = playerNameInput.id;
  playerLabel.textContent = "Player";
  const label = document.createElement("label");
  label.className = "multiplayer-demo__room-label";
  label.htmlFor = roomInput.id;
  label.textContent = "Room";
  const buttonRow = createElement("div", "multiplayer-demo__room-buttons");
  buttonRow.replaceChildren(...buttons);
  group.replaceChildren(playerLabel, playerNameInput, label, roomInput, buttonRow);
  return group;
}

function createNetworkConditionControls(): {
  root: HTMLElement;
  enabledInput: HTMLInputElement;
  latencyInput: HTMLInputElement;
  jitterInput: HTMLInputElement;
  lossInput: HTMLInputElement;
  forgeInputButton: HTMLButtonElement;
  summary: HTMLElement;
} {
  const root = createElement("section", "multiplayer-demo__controls");
  const enabledInput = document.createElement("input");
  enabledInput.id = "multiplayer-demo-network-enabled";
  enabledInput.className = "multiplayer-demo__net-checkbox";
  enabledInput.type = "checkbox";
  const enabledLabel = document.createElement("label");
  enabledLabel.className = "multiplayer-demo__net-toggle";
  enabledLabel.htmlFor = enabledInput.id;
  enabledLabel.replaceChildren(enabledInput, document.createTextNode("Artificial Net"));

  const latencyInput = createNetworkNumberInput("multiplayer-demo-network-latency", 0, 1000, 25);
  const jitterInput = createNetworkNumberInput("multiplayer-demo-network-jitter", 0, 1000, 25);
  const lossInput = createNetworkNumberInput("multiplayer-demo-network-loss", 0, 100, 1);
  latencyInput.value = "120";
  jitterInput.value = "40";
  lossInput.value = "0";

  const fields = createElement("div", "multiplayer-demo__net-grid");
  fields.replaceChildren(
    createNetworkField("Latency", "ms", latencyInput),
    createNetworkField("Jitter", "ms", jitterInput),
    createNetworkField("Loss", "%", lossInput)
  );
  const forgeInputButton = createButton("Forge Stale");
  forgeInputButton.title = "Send a stale input frame";
  const summary = createElement("p", "multiplayer-demo__net-summary", "off");
  root.replaceChildren(
    createElement("h2", "multiplayer-demo__section-title", "Network"),
    enabledLabel,
    fields,
    forgeInputButton,
    summary
  );
  return {
    root,
    enabledInput,
    latencyInput,
    jitterInput,
    lossInput,
    forgeInputButton,
    summary
  };
}

function createNetworkField(label: string, suffix: string, input: HTMLInputElement): HTMLElement {
  const field = createElement("label", "multiplayer-demo__net-field");
  field.htmlFor = input.id;
  const labelElement = createElement("span", undefined, label);
  const suffixElement = createElement("small", undefined, suffix);
  field.replaceChildren(labelElement, input, suffixElement);
  return field;
}

function createNetworkNumberInput(
  id: string,
  min: number,
  max: number,
  step: number
): HTMLInputElement {
  const input = document.createElement("input");
  input.id = id;
  input.className = "multiplayer-demo__net-input";
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.inputMode = "numeric";
  return input;
}

function createPlayerNameInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.id = "multiplayer-demo-player-name";
  input.className = "multiplayer-demo__room-input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = 18;
  input.placeholder = "Runner";
  return input;
}

function createRoomInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.id = "multiplayer-demo-room";
  input.className = "multiplayer-demo__room-input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = 48;
  input.placeholder = "multiplayer-demo-session";
  return input;
}

function createButton(label: string, className?: string): HTMLButtonElement {
  const button = document.createElement("button");
  if (className) {
    button.className = className;
  }
  button.type = "button";
  button.textContent = label;
  return button;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function formatRoundTime(state: RealtimeArenaViewState): string {
  if (state.phase === "running") {
    return formatMilliseconds(Math.max(0, state.rules.roundDurationMs - state.roundElapsedMs));
  }
  if (state.phase === "countdown") {
    return formatMilliseconds(Math.max(0, state.rules.countdownMs - state.phaseElapsedMs));
  }
  if (state.phase === "ending") {
    return formatMilliseconds(Math.max(0, state.rules.endingDurationMs - state.phaseElapsedMs));
  }
  return formatMilliseconds(state.rules.roundDurationMs);
}

function formatMilliseconds(milliseconds: number): string {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatScore(score: Record<string, number>): string {
  return Object.entries(score)
    .map(([teamId, value]) => `${teamId}:${value}`)
    .join(" ");
}

function formatInteractButtonLabel(carryingCoreId?: string): string {
  return carryingCoreId ? DELIVER_BUTTON_LABEL : INTERACT_BUTTON_LABEL;
}

function arenaHint(
  state: RealtimeArenaViewState,
  diagnostics: RealtimeArenaUiDiagnostics,
  localPlayer?: RealtimeArenaViewState["players"][number]
): string {
  if (diagnostics.lastAction && !diagnostics.lastAction.accepted) {
    return diagnostics.lastAction.reason;
  }
  if (diagnostics.participant?.status === "next-round") {
    return "Watching this round; joining the next lobby";
  }
  if (diagnostics.participant?.status === "spectator") {
    return "Spectating this round";
  }
  if (diagnostics.participant?.status === "disconnected") {
    return "Disconnected; this round slot is reserved for the same peer id";
  }
  if (state.phase === "results") {
    if (state.result?.winnerTeamId) {
      return `${state.result.winnerTeamId} wins in ${formatMilliseconds(state.result.durationMs)}`;
    }
    return "Draw";
  }
  if (state.phase === "lobby") {
    return "Lobby ready";
  }
  if (state.phase === "countdown") {
    return "Countdown";
  }
  if (state.phase === "ending") {
    return "Ending";
  }

  if (!localPlayer) {
    return "Waiting for player snapshot";
  }
  if (localPlayer.carryingCoreId) {
    const relay = state.relayNodes.find((node) => node.teamId === localPlayer.teamId);
    if (
      relay &&
      distance(localPlayer.position, relay.position) <= relay.radius + state.rules.deliverRadius
    ) {
      return "Relay in range";
    }

    return "Carry core to your relay";
  }

  const core = state.cores.find(
    (candidate) =>
      candidate.carriedByPlayerId === undefined &&
      distance(localPlayer.position, candidate.position) <=
        candidate.radius + state.rules.pickupRadius
  );
  return core ? "Core in range" : "Secure a core";
}

function distance(
  a: RealtimeArenaViewState["players"][number]["position"],
  b: RealtimeArenaViewState["players"][number]["position"]
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eventTone(type: string): string {
  if (type === "input.rejected") {
    return "rejected";
  }
  if (type === "core.delivered" || type === "round.results") {
    return "result";
  }
  return "accepted";
}

function isActivePeerStatus(status: string): boolean {
  return status === "joining" || status === "connected" || status === "ready";
}
