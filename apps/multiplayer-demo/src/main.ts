import "./styles.css";
import { createMultiplayerDemoClient, type MultiplayerDemoClient } from "./client";
import { REALTIME_ARENA_TICK_MS } from "./realtime/config";
import {
  bindRealtimeInputKeys,
  createRealtimeInputSampler,
  createRealtimeLocalGame,
  renderRealtimeArenaCanvas,
  type RealtimeLocalGameDiagnostics
} from "./realtime/local-game";
import {
  createRealtimeArenaPresentation,
  type RealtimeArenaPresentationDiagnostics
} from "./realtime/presentation";
import type { RealtimeArenaPredictionDiagnostics } from "./realtime/prediction";
import {
  createRealtimeArenaClientReplication,
  type RealtimeArenaClientReplication
} from "./realtime/client-replication";
import { normalizeRealtimeArenaPlayerLabel, type RealtimeInputFrame } from "./realtime/domain";
import type {
  RealtimeArenaAuthorityInputDiagnostics,
  RealtimeArenaNetworkAction,
  RealtimeArenaParticipant,
  RealtimeArenaParticipantSummary,
  RealtimeArenaSnapshotPayload
} from "./realtime/protocol";
import {
  bindRealtimeArenaControls,
  bindMultiplayerDemoControls,
  bindRealtimeNetworkConditionControls,
  formatRealtimeArenaDiagnostics,
  formatRealtimeArenaDiagnosticsTitle,
  renderBootError,
  renderClientState,
  renderMultiplayerDemoShell,
  renderRealtimeArenaUi,
  renderServerReady,
  renderSessionInfo,
  resolveMultiplayerDemoJoinRole,
  resolveRealtimeArenaControlPermissions,
  runModeLabel,
  type MultiplayerDemoConfig,
  type MultiplayerDemoRunMode,
  type MultiplayerDemoSessionInfo,
  type RealtimeNetworkConditionSettings,
  type RealtimeArenaUiDiagnostics
} from "./ui";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app element");
}

void bootMultiplayerDemo(root).catch((error) => {
  renderBootError(root, error);
});

async function bootMultiplayerDemo(rootElement: HTMLElement): Promise<void> {
  const ui = renderMultiplayerDemoShell(rootElement);
  const config = await fetchConfig();
  const hostOwnerId = readMultiplayerDemoHostOwnerId();
  const localPeerId = readMultiplayerDemoPeerId();
  const initialPlayerName = readMultiplayerDemoPlayerName();
  let sessionInfo: MultiplayerDemoSessionInfo | undefined;
  let client: MultiplayerDemoClient | undefined;
  let clientSessionId: string | undefined;
  let localRoomRole: "host" | "client" | undefined;
  let busyLabel: string | undefined;
  let lastError: string | undefined;
  let playerNameInputDirty = false;
  const realtimeGame = createRealtimeLocalGame({ playerName: initialPlayerName });
  const localPresentation = createRealtimeArenaPresentation({
    interpolationDelayMs: 0,
    adaptiveDelay: false
  });
  const remoteInput = createRealtimeInputSampler();
  let remoteReplication: RealtimeArenaClientReplication | undefined;
  const remoteDiagnostics: RealtimeLocalGameDiagnostics = {
    inputSequence: 0,
    inputSendRate: 0,
    serverTickRate: 20
  };
  let networkConditions: RealtimeNetworkConditionSettings = {
    enabled: false,
    latencyMs: 120,
    jitterMs: 40,
    lossPercent: 0
  };
  const scheduledInputTimers = new Set<number>();
  const disposeRealtimeInput = bindRealtimeInputKeys(
    {
      setInputKey(code, down) {
        if (isRemoteSessionActive()) {
          remoteInput.setInputKey(code, down);
        } else if (isLocalPracticeActive()) {
          realtimeGame.setInputKey(code, down);
        }
      },
      queueInteract() {
        if (isRemoteSessionActive()) {
          void sendRealtimeAction({ type: "interact" });
        } else if (isLocalPracticeActive()) {
          realtimeGame.queueInteract();
        }
      },
      resetInputKeys() {
        remoteInput.resetInputKeys();
        realtimeGame.resetInputKeys();
      }
    },
    ui.root
  );
  let animationFrame = 0;
  let lastRenderFrameTime: number | undefined;
  let lastArenaUiRender = 0;
  let remoteLastFrameTime: number | undefined;
  let remoteRateWindowMs = 0;
  let remoteInputsSentThisSecond = 0;
  let remoteLastSentInputCount = 0;
  let remoteTicksSeenThisSecond = 0;
  let remoteLastSnapshotTick: number | undefined;

  ui.roomInput.value = config.defaultSessionId;
  ui.playerNameInput.value = initialPlayerName;
  renderAll();
  ui.roomInput.addEventListener("input", renderAll);
  ui.playerNameInput.addEventListener("input", () => {
    playerNameInputDirty = true;
  });
  ui.playerNameInput.addEventListener("change", () => {
    void applyPlayerNameSetting();
  });
  ui.playerNameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    void applyPlayerNameSetting();
    ui.arenaCanvas.focus();
  });

  bindMultiplayerDemoControls(ui, {
    host() {
      const sessionId = readRoomId();
      const playerName = commitPlayerNameInput();
      void runAction("Hosting room", async () => {
        await hostAndConnectClient(sessionId, playerName);
      });
    },
    connect() {
      const sessionId = readRoomId();
      const playerName = commitPlayerNameInput();
      void runAction("Connecting client", async () => {
        await connectClient(sessionId, playerName);
      });
    },
    disconnect() {
      void runAction("Disconnecting client", async () => {
        await disconnectClient();
      });
    },
    reset() {
      void runAction("Resetting room", async () => {
        await resetRoom(readRoomId());
      });
    }
  });
  bindRealtimeNetworkConditionControls(ui, (settings) => {
    networkConditions = settings;
  });
  ui.forgeInputButton.addEventListener("click", () => {
    void sendForgedRealtimeInput();
  });
  bindRealtimeArenaControls(ui, {
    ready() {
      const mode = readRunMode();
      if (!resolveRealtimeArenaControlPermissions(mode).ready) {
        rejectDisallowedArenaAction(disallowedArenaActionReason(mode));
        return;
      }
      const remote = currentRemoteSnapshot();
      if (remote) {
        const localPlayerId = readRemotePlayerId(remote);
        const localPlayer = remote.snapshot.players.find((player) => player.id === localPlayerId);
        void sendRealtimeAction({ type: "ready", ready: localPlayer?.ready !== true });
      } else if (isRemoteSessionActive()) {
        void sendRealtimeAction({ type: "ready", ready: true });
      } else if (!isLocalPracticeActive()) {
        rejectDisallowedArenaAction(disallowedArenaActionReason(readRunMode()));
      } else {
        const localPlayer = realtimeGame.state.players.find(
          (player) => player.id === realtimeGame.localPlayerId
        );
        realtimeGame.setReady(localPlayer?.ready !== true);
      }
      renderArena();
    },
    startRound() {
      const mode = readRunMode();
      if (!resolveRealtimeArenaControlPermissions(mode).startRound) {
        rejectDisallowedArenaAction(disallowedArenaActionReason(mode));
        return;
      }
      if (isRemoteSessionActive()) {
        void sendRealtimeAction({ type: "start" });
      } else if (isLocalPracticeActive()) {
        realtimeGame.startRound();
      } else {
        rejectDisallowedArenaAction(disallowedArenaActionReason(mode));
      }
      ui.arenaCanvas.focus();
      renderArena();
    },
    rematch() {
      const mode = readRunMode();
      if (!resolveRealtimeArenaControlPermissions(mode).rematch) {
        rejectDisallowedArenaAction(disallowedArenaActionReason(mode));
        return;
      }
      if (isRemoteSessionActive()) {
        void sendRealtimeAction({ type: "rematch" });
      } else if (isLocalPracticeActive()) {
        realtimeGame.rematch();
      } else {
        rejectDisallowedArenaAction(disallowedArenaActionReason(mode));
      }
      ui.arenaCanvas.focus();
      renderArena();
    },
    interact() {
      const mode = readRunMode();
      if (!resolveRealtimeArenaControlPermissions(mode).interact) {
        rejectDisallowedArenaAction(disallowedArenaActionReason(mode));
        return;
      }
      if (isRemoteSessionActive()) {
        void sendRealtimeAction({ type: "interact" });
      } else if (isLocalPracticeActive()) {
        realtimeGame.queueInteract();
      } else {
        rejectDisallowedArenaAction(disallowedArenaActionReason(mode));
      }
      ui.arenaCanvas.focus();
      renderArena();
    },
    resetArena() {
      const mode = readRunMode();
      if (!resolveRealtimeArenaControlPermissions(mode).resetArena) {
        rejectDisallowedArenaAction(disallowedArenaActionReason(mode));
        return;
      }
      if (isRemoteSessionActive()) {
        void sendRealtimeAction({ type: "reset" });
      } else if (isLocalPracticeActive()) {
        realtimeGame.reset();
        localPresentation.reset();
      } else {
        rejectDisallowedArenaAction(disallowedArenaActionReason(mode));
      }
      ui.arenaCanvas.focus();
      renderArena();
    }
  });

  animationFrame = window.requestAnimationFrame(animateArena);

  const refreshHandle = window.setInterval(async () => {
    if (!sessionInfo || busyLabel) {
      return;
    }

    try {
      sessionInfo = await fetchSessionInfo(sessionInfo.sessionId);
    } catch (error) {
      if (error instanceof DemoApiError && error.status === 404) {
        sessionInfo = undefined;
        await disposeClient();
      } else {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    renderAll();
  }, 500);

  window.addEventListener("beforeunload", cleanup, { once: true });

  function animateArena(now: number): void {
    const renderDeltaMs =
      lastRenderFrameTime === undefined
        ? REALTIME_ARENA_TICK_MS
        : Math.min(250, Math.max(0, now - lastRenderFrameTime));
    lastRenderFrameTime = now;

    if (isRemoteSessionActive()) {
      stepRemoteArena(now);
      renderRemoteArenaCanvas();
    } else if (isLocalPracticeActive()) {
      realtimeGame.step(now);
      const snapshot = realtimeGame.snapshot();
      const presentationFrame = localPresentation.sample(snapshot, renderDeltaMs);
      renderRealtimeArenaCanvas(
        ui.arenaCanvas,
        presentationFrame.snapshot,
        realtimeGame.localPlayerId,
        presentationFrame
      );
    } else {
      clearArenaCanvas();
    }
    if (now - lastArenaUiRender >= 100) {
      renderArena();
      lastArenaUiRender = now;
    }
    animationFrame = window.requestAnimationFrame(animateArena);
  }

  async function runAction(label: string, action: () => Promise<void>): Promise<void> {
    if (busyLabel) {
      return;
    }

    busyLabel = label;
    lastError = undefined;
    renderAll();

    try {
      await action();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(error);
    } finally {
      busyLabel = undefined;
      renderAll();
    }
  }

  function renderAll(): void {
    const mode = readRunMode();
    if (sessionInfo) {
      renderSessionInfo(ui, sessionInfo);
    } else {
      renderServerReady(ui, config);
    }

    const clientOptions =
      sessionInfo === undefined
        ? { busy: busyLabel !== undefined, selectedSessionId: readSelectedSessionId() }
        : {
            activeSessionId: sessionInfo.sessionId,
            busy: busyLabel !== undefined,
            selectedSessionId: readSelectedSessionId()
          };
    renderClientState(ui, client, { ...clientOptions, mode });
    renderArena();

    if (busyLabel) {
      ui.status.textContent = busyLabel;
    } else if (lastError) {
      ui.status.textContent = lastError;
    } else {
      ui.status.textContent = runStatusLabel(mode);
    }
  }

  function renderArena(): void {
    const mode = readRunMode();
    const permissions = resolveRealtimeArenaControlPermissions(mode);
    const remote = currentRemoteSnapshot();
    if (remote) {
      syncPlayerNameInput(remote.snapshot, readRemotePlayerId(remote));
      renderRealtimeArenaUi(
        ui,
        remote.snapshot,
        withRealtimeDiagnostics(
          remoteDiagnostics,
          remoteReplication?.diagnostics().presentation ?? localPresentation.diagnostics(),
          remoteReplication?.diagnostics().prediction,
          remote.authorityInput,
          remote.participantsByPeerId?.[client?.peerId ?? ""],
          remote.participantSummary
        ),
        readRemotePlayerId(remote),
        permissions
      );
      return;
    }
    if (isRemoteSessionActive()) {
      renderPendingRemoteArena();
      return;
    }
    if (!isLocalPracticeActive()) {
      renderHostedDisconnectedArena();
      return;
    }

    syncPlayerNameInput(realtimeGame.state, realtimeGame.localPlayerId);
    renderRealtimeArenaUi(
      ui,
      realtimeGame.state,
      withRealtimeDiagnostics(realtimeGame.diagnostics, localPresentation.diagnostics()),
      realtimeGame.localPlayerId,
      permissions
    );
  }

  function renderPendingRemoteArena(): void {
    ui.arenaPhase.textContent = "syncing";
    ui.arenaTimer.textContent = "--";
    ui.arenaScore.textContent = "--";
    ui.arenaPlayer.textContent = "joining";
    const diagnostics = withRealtimeDiagnostics(
      remoteDiagnostics,
      remoteReplication?.diagnostics().presentation ?? localPresentation.diagnostics(),
      remoteReplication?.diagnostics().prediction
    );
    ui.arenaInput.textContent = formatRealtimeArenaDiagnostics(diagnostics);
    ui.arenaInput.title = formatRealtimeArenaDiagnosticsTitle(diagnostics);
    ui.arenaHint.textContent = "Waiting for host snapshot";
    ui.readyButton.disabled = true;
    ui.startRoundButton.disabled = true;
    ui.interactButton.disabled = true;
    ui.rematchButton.disabled = true;
    ui.resetArenaButton.disabled =
      !resolveRealtimeArenaControlPermissions(readRunMode()).resetArena;
  }

  function renderHostedDisconnectedArena(): void {
    const mode = readRunMode();
    ui.arenaPhase.textContent = "room";
    ui.arenaTimer.textContent = "--";
    ui.arenaScore.textContent = "--";
    ui.arenaPlayer.textContent = "not joined";
    ui.arenaInput.textContent = "--";
    ui.arenaInput.title = "";
    ui.arenaHint.textContent =
      mode === "host-not-joined"
        ? "Host room is open; join before playing"
        : "Join the hosted room before playing";
    ui.readyButton.disabled = true;
    ui.startRoundButton.disabled = true;
    ui.interactButton.disabled = true;
    ui.rematchButton.disabled = true;
    ui.resetArenaButton.disabled = true;
  }

  function stepRemoteArena(now: number): void {
    const remote = currentRemoteSnapshot();
    const deltaMs =
      remoteLastFrameTime === undefined
        ? REALTIME_ARENA_TICK_MS
        : Math.min(250, Math.max(0, now - remoteLastFrameTime));
    remoteLastFrameTime = now;
    remoteRateWindowMs += deltaMs;
    remoteReplication?.update({ delta: deltaMs, elapsed: now });

    const replicationDiagnostics = remoteReplication?.diagnostics();
    if (replicationDiagnostics !== undefined) {
      const sentInputs = replicationDiagnostics.replication.sentInputs;
      remoteInputsSentThisSecond += Math.max(0, sentInputs - remoteLastSentInputCount);
      remoteLastSentInputCount = sentInputs;
      remoteDiagnostics.inputSequence =
        replicationDiagnostics.prediction.lastPredictedSequence ?? remoteDiagnostics.inputSequence;
    }

    if (remote && remote.snapshot.tick !== remoteLastSnapshotTick) {
      if (remoteLastSnapshotTick !== undefined) {
        remoteTicksSeenThisSecond += Math.max(0, remote.snapshot.tick - remoteLastSnapshotTick);
      }
      remoteLastSnapshotTick = remote.snapshot.tick;
    }

    if (remoteRateWindowMs >= 1000) {
      remoteDiagnostics.inputSendRate = Math.round(
        (remoteInputsSentThisSecond * 1000) / remoteRateWindowMs
      );
      remoteDiagnostics.serverTickRate = Math.round(
        (remoteTicksSeenThisSecond * 1000) / remoteRateWindowMs
      );
      remoteInputsSentThisSecond = 0;
      remoteTicksSeenThisSecond = 0;
      remoteRateWindowMs = 0;
    }
  }

  function renderRemoteArenaCanvas(): void {
    const remote = currentRemoteSnapshot();
    if (!remote) {
      clearArenaCanvas();
      return;
    }

    const presentedSnapshot = remoteReplication?.presentedSnapshot() ?? remote.snapshot;
    renderRealtimeArenaCanvas(ui.arenaCanvas, presentedSnapshot, readRemotePlayerId(remote));
  }

  function clearArenaCanvas(): void {
    const context = ui.arenaCanvas.getContext("2d");
    if (!context) {
      return;
    }

    const rect = ui.arenaCanvas.getBoundingClientRect();
    const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round((rect.width || 720) * devicePixelRatio));
    const height = Math.max(1, Math.round((rect.height || 420) * devicePixelRatio));
    if (ui.arenaCanvas.width !== width || ui.arenaCanvas.height !== height) {
      ui.arenaCanvas.width = width;
      ui.arenaCanvas.height = height;
    }
    context.fillStyle = "#111612";
    context.fillRect(0, 0, ui.arenaCanvas.width, ui.arenaCanvas.height);
  }

  function scheduleRealtimeInput(
    currentClient: MultiplayerDemoClient,
    frame: RealtimeInputFrame
  ): Promise<void> {
    if (!currentClient || currentClient.runtime.phase() !== "in-session") {
      return Promise.resolve();
    }

    if (!networkConditions.enabled) {
      return sendRealtimeInput(currentClient, frame);
    }

    if (Math.random() * 100 < networkConditions.lossPercent) {
      remoteDiagnostics.lastAction = {
        accepted: false,
        code: "debug-input-dropped",
        reason: "Artificial network loss dropped an input frame."
      };
      return Promise.resolve();
    }

    const delayMs = Math.max(
      0,
      networkConditions.latencyMs + randomJitter(networkConditions.jitterMs)
    );
    const timer = window.setTimeout(() => {
      scheduledInputTimers.delete(timer);
      if (client !== currentClient || currentClient.runtime.phase() !== "in-session") {
        return;
      }
      void sendRealtimeInput(currentClient, frame);
    }, delayMs);
    scheduledInputTimers.add(timer);
    return Promise.resolve();
  }

  async function sendRealtimeInput(
    currentClient: MultiplayerDemoClient,
    frame: RealtimeInputFrame
  ): Promise<void> {
    try {
      await currentClient.sendRealtimeInput(frame);
    } catch (error) {
      remoteDiagnostics.lastAction = {
        accepted: false,
        code: "input-send-failed",
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  function clearScheduledInputTimers(): void {
    for (const timer of scheduledInputTimers) {
      window.clearTimeout(timer);
    }
    scheduledInputTimers.clear();
  }

  function randomJitter(jitterMs: number): number {
    if (jitterMs <= 0) {
      return 0;
    }
    return (Math.random() * 2 - 1) * jitterMs;
  }

  async function sendForgedRealtimeInput(): Promise<void> {
    const currentClient = client;
    const remote = currentRemoteSnapshot();
    if (!currentClient || currentClient.runtime.phase() !== "in-session" || !remote) {
      return;
    }

    const acknowledgedSequence =
      remote.inputAcksByPeerId[currentClient.peerId] ??
      remote.snapshot.players.find((player) => player.id === readRemotePlayerId(remote))
        ?.lastInputSequence ??
      0;
    const frame: RealtimeInputFrame = {
      sequence: acknowledgedSequence,
      clientTime: Math.round(performance.now()),
      moveX: 1,
      moveY: 0,
      sprint: false
    };

    try {
      await currentClient.sendRealtimeInput(frame);
      remoteDiagnostics.lastAction = {
        accepted: false,
        code: "debug-input-forged",
        reason: `Sent forged stale input sequence ${frame.sequence}.`
      };
    } catch (error) {
      remoteDiagnostics.lastAction = {
        accepted: false,
        code: "debug-input-forge-failed",
        reason: error instanceof Error ? error.message : String(error)
      };
    }
    renderArena();
  }

  async function sendRealtimeAction(action: RealtimeArenaNetworkAction): Promise<void> {
    const currentClient = client;
    if (!currentClient || currentClient.runtime.phase() !== "in-session") {
      return;
    }

    try {
      await currentClient.sendRealtimeAction(action);
    } catch (error) {
      remoteDiagnostics.lastAction = {
        accepted: false,
        code: "action-send-failed",
        reason: error instanceof Error ? error.message : String(error)
      };
      lastError = remoteDiagnostics.lastAction.reason;
      renderAll();
    }
  }

  function currentRemoteSnapshot(): RealtimeArenaSnapshotPayload | undefined {
    if (!isRemoteSessionActive()) {
      return undefined;
    }

    return client?.latestRealtimeSnapshot();
  }

  function readRunMode(): MultiplayerDemoRunMode {
    if (isRemoteSessionActive()) {
      return localRoomRole === "host" ? "host" : "client";
    }
    if (!sessionInfo) {
      return "local-offline";
    }
    return localRoomRole === "host" ? "host-not-joined" : "hosted-not-joined";
  }

  function runStatusLabel(mode: MultiplayerDemoRunMode): string {
    switch (mode) {
      case "local-offline":
        return "Local offline practice";
      case "host":
        return "Host session joined";
      case "client":
        return "Client session joined";
      case "host-not-joined":
        return "Host room open; join to play";
      case "hosted-not-joined":
        return "Hosted room found; join to play";
    }
  }

  function disallowedArenaActionReason(mode: MultiplayerDemoRunMode): string {
    if (mode === "client") {
      return "Only the host can start, rematch, or reset the round.";
    }
    if (mode === "host-not-joined" || mode === "hosted-not-joined") {
      return "Join the hosted room before using game controls.";
    }
    return `${runModeLabel(mode)} cannot use this game control right now.`;
  }

  function isRemoteSessionActive(): boolean {
    return client?.runtime.phase() === "in-session" && clientSessionId !== undefined;
  }

  function isLocalPracticeActive(): boolean {
    return readRunMode() === "local-offline";
  }

  function rejectDisallowedArenaAction(reason: string): void {
    lastError = reason;
    renderAll();
  }

  function readRemotePlayerId(remote: RealtimeArenaSnapshotPayload): string {
    return remote.playersByPeerId[client?.peerId ?? ""] ?? "";
  }

  function resetRemoteSync(): void {
    remoteReplication?.dispose();
    remoteReplication = undefined;
    remoteInput.reset();
    remoteDiagnostics.inputSequence = 0;
    remoteDiagnostics.inputSendRate = 0;
    remoteDiagnostics.serverTickRate = 20;
    delete remoteDiagnostics.lastAction;
    remoteLastFrameTime = undefined;
    remoteRateWindowMs = 0;
    remoteInputsSentThisSecond = 0;
    remoteLastSentInputCount = 0;
    remoteTicksSeenThisSecond = 0;
    remoteLastSnapshotTick = undefined;
    clearScheduledInputTimers();
  }

  function withRealtimeDiagnostics(
    diagnostics: RealtimeLocalGameDiagnostics,
    presentation: RealtimeArenaPresentationDiagnostics,
    prediction?: RealtimeArenaPredictionDiagnostics,
    authorityInput?: RealtimeArenaAuthorityInputDiagnostics,
    participant?: RealtimeArenaParticipant,
    participantSummary?: RealtimeArenaParticipantSummary
  ): RealtimeArenaUiDiagnostics {
    const nativeState = client?.nativeStateDiagnostics();
    return {
      ...diagnostics,
      presentation,
      ...(prediction === undefined ? {} : { prediction }),
      ...(authorityInput === undefined ? {} : { authorityInput }),
      ...(participant === undefined ? {} : { participant }),
      ...(participantSummary === undefined ? {} : { participantSummary }),
      ...(nativeState === undefined ? {} : { nativeState })
    };
  }

  async function applyPlayerNameSetting(): Promise<void> {
    const playerName = commitPlayerNameInput();
    if (isRemoteSessionActive()) {
      await sendRealtimeAction({ type: "set-name", name: playerName });
    } else if (isLocalPracticeActive()) {
      realtimeGame.setPlayerName(playerName);
    }
    renderArena();
  }

  function commitPlayerNameInput(): string {
    const playerName = normalizeRealtimeArenaPlayerLabel(ui.playerNameInput.value);
    playerNameInputDirty = false;
    ui.playerNameInput.value = playerName;
    writeMultiplayerDemoPlayerName(playerName);
    realtimeGame.setPlayerName(playerName);
    return playerName;
  }

  function syncPlayerNameInput(
    state: { players: Array<{ id: string; label: string }> },
    playerId: string
  ): void {
    if (playerNameInputDirty || document.activeElement === ui.playerNameInput) {
      return;
    }

    const player = state.players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return;
    }

    realtimeGame.setPlayerName(player.label);
    if (ui.playerNameInput.value === player.label) {
      return;
    }
    ui.playerNameInput.value = player.label;
    writeMultiplayerDemoPlayerName(player.label);
  }

  function readRoomId(): string {
    return ui.roomInput.value;
  }

  function readSelectedSessionId(): string {
    return ui.roomInput.value.trim();
  }

  async function hostRoom(sessionId: string): Promise<MultiplayerDemoSessionInfo> {
    const response = await fetch("/api/multiplayer-demo/session", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({ sessionId, hostOwnerId })
    });
    if (!response.ok) {
      throw await createApiError(response, "Unable to host multiplayer demo session");
    }

    sessionInfo = (await response.json()) as MultiplayerDemoSessionInfo;
    localRoomRole = "host";
    ui.roomInput.value = sessionInfo.sessionId;
    return sessionInfo;
  }

  async function hostAndConnectClient(sessionId: string, playerName: string): Promise<void> {
    try {
      const hosted = await hostRoom(sessionId);
      await connectHostedClient(hosted, "host", playerName);
    } catch (error) {
      if (error instanceof DemoApiError && error.status === 409) {
        try {
          await loadHostedSession(sessionId);
        } catch {
          // Keep the original ownership error visible when the follow-up refresh fails.
        }
      }
      throw error;
    }
  }

  async function loadHostedSession(sessionId: string): Promise<MultiplayerDemoSessionInfo> {
    sessionInfo = await fetchSessionInfo(sessionId);
    ui.roomInput.value = sessionInfo.sessionId;
    return sessionInfo;
  }

  async function connectClient(sessionId: string, playerName: string): Promise<void> {
    const hosted = await loadHostedSession(sessionId);
    await connectHostedClient(hosted, resolveMultiplayerDemoJoinRole(readRunMode()), playerName);
  }

  async function connectHostedClient(
    hosted: MultiplayerDemoSessionInfo,
    role: "host" | "client",
    playerName: string
  ): Promise<void> {
    if (client && client.runtime.phase() === "in-session" && clientSessionId === hosted.sessionId) {
      localRoomRole = role;
      await client.sendRealtimeAction({ type: "set-name", name: playerName });
      return;
    }

    await disposeClient();
    const nextClient = createMultiplayerDemoClient({
      endpoint: hosted.endpoint,
      roomName: hosted.roomName,
      sessionId: hosted.sessionId,
      hostPeerId: hosted.hostPeerId,
      peerId: localPeerId,
      displayName: playerName,
      authoritativePath: hosted.authoritativePath
    });
    let nextReplication: RealtimeArenaClientReplication | undefined;
    try {
      nextReplication = createRealtimeArenaClientReplication({
        runtime: nextClient.runtime,
        authority: nextClient.authorityBinding,
        peerId: nextClient.peerId,
        ...(nextClient.snapshotSource === undefined
          ? {}
          : { snapshotSource: nextClient.snapshotSource }),
        readInput(elapsed) {
          return remoteInput.nextFrame(elapsed);
        },
        sendInput(frame) {
          return scheduleRealtimeInput(nextClient, frame);
        },
        onSendError(error) {
          remoteDiagnostics.lastAction = {
            accepted: false,
            code: "input-send-failed",
            reason: error instanceof Error ? error.message : String(error)
          };
        }
      });
      await nextClient.connect();
      await nextClient.sendRealtimeAction({ type: "set-name", name: playerName });
      client = nextClient;
      remoteReplication = nextReplication;
      clientSessionId = hosted.sessionId;
      localRoomRole = role;
    } catch (error) {
      nextReplication?.dispose();
      await nextClient.dispose();
      throw error;
    }
  }

  async function disconnectClient(): Promise<void> {
    if (readRunMode() === "host") {
      await resetRoom(clientSessionId ?? readRoomId());
      return;
    }

    await disposeClient();
    sessionInfo = undefined;
  }

  async function resetRoom(sessionId: string): Promise<void> {
    const response = await fetch(
      `/api/multiplayer-demo/session?sessionId=${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: {
          accept: "application/json"
        }
      }
    );
    if (!response.ok) {
      throw await createApiError(response, "Unable to reset multiplayer demo session");
    }

    const result = (await response.json()) as { sessionId: string; disposed: boolean };
    if (clientSessionId === result.sessionId) {
      await disposeClient();
    }
    if (sessionInfo?.sessionId === result.sessionId) {
      sessionInfo = undefined;
      localRoomRole = undefined;
    }
    ui.roomInput.value = result.sessionId;
  }

  async function disposeClient(options: { preserveHostRoom?: boolean } = {}): Promise<void> {
    const currentClient = client;
    client = undefined;
    clientSessionId = undefined;
    if (options.preserveHostRoom !== true) {
      localRoomRole = undefined;
    }
    resetRemoteSync();
    await currentClient?.dispose();
  }

  function cleanup(): void {
    window.clearInterval(refreshHandle);
    window.cancelAnimationFrame(animationFrame);
    clearScheduledInputTimers();
    disposeRealtimeInput();
    void disposeClient();
  }
}

async function fetchConfig(): Promise<MultiplayerDemoConfig> {
  const response = await fetch("/api/multiplayer-demo/config", {
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw await createApiError(response, "Unable to load multiplayer demo config");
  }

  return (await response.json()) as MultiplayerDemoConfig;
}

const MULTIPLAYER_DEMO_HOST_OWNER_STORAGE_KEY = "gamekits.multiplayerDemo.hostOwnerId";
const MULTIPLAYER_DEMO_PEER_ID_STORAGE_KEY = "gamekits.multiplayerDemo.peerId";
const MULTIPLAYER_DEMO_PLAYER_NAME_STORAGE_KEY = "gamekits.multiplayerDemo.playerName";
const FALLBACK_MULTIPLAYER_DEMO_HOST_OWNER_ID = createMultiplayerDemoHostOwnerId();
const FALLBACK_MULTIPLAYER_DEMO_PEER_ID = createMultiplayerDemoPeerId();
const FALLBACK_MULTIPLAYER_DEMO_PLAYER_NAME = createDefaultMultiplayerDemoPlayerName();

function readMultiplayerDemoHostOwnerId(): string {
  try {
    const existing = window.sessionStorage.getItem(MULTIPLAYER_DEMO_HOST_OWNER_STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const next = createMultiplayerDemoHostOwnerId();
    window.sessionStorage.setItem(MULTIPLAYER_DEMO_HOST_OWNER_STORAGE_KEY, next);
    return next;
  } catch {
    return FALLBACK_MULTIPLAYER_DEMO_HOST_OWNER_ID;
  }
}

function createMultiplayerDemoHostOwnerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `window-${crypto.randomUUID().slice(0, 12)}`;
  }

  return `window-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000000).toString(36)}`;
}

function readMultiplayerDemoPeerId(): string {
  try {
    const existing = window.sessionStorage.getItem(MULTIPLAYER_DEMO_PEER_ID_STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const next = createMultiplayerDemoPeerId();
    window.sessionStorage.setItem(MULTIPLAYER_DEMO_PEER_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return FALLBACK_MULTIPLAYER_DEMO_PEER_ID;
  }
}

function createMultiplayerDemoPeerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `browser-${crypto.randomUUID().slice(0, 12)}`;
  }

  return `browser-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000000).toString(36)}`;
}

function readMultiplayerDemoPlayerName(): string {
  try {
    const existing = window.sessionStorage.getItem(MULTIPLAYER_DEMO_PLAYER_NAME_STORAGE_KEY);
    if (existing) {
      return normalizeRealtimeArenaPlayerLabel(existing);
    }

    const next = FALLBACK_MULTIPLAYER_DEMO_PLAYER_NAME;
    window.sessionStorage.setItem(MULTIPLAYER_DEMO_PLAYER_NAME_STORAGE_KEY, next);
    return next;
  } catch {
    return FALLBACK_MULTIPLAYER_DEMO_PLAYER_NAME;
  }
}

function writeMultiplayerDemoPlayerName(playerName: string): void {
  try {
    window.sessionStorage.setItem(
      MULTIPLAYER_DEMO_PLAYER_NAME_STORAGE_KEY,
      normalizeRealtimeArenaPlayerLabel(playerName)
    );
  } catch {
    // Session storage can be unavailable in locked-down browser contexts.
  }
}

function createDefaultMultiplayerDemoPlayerName(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return normalizeRealtimeArenaPlayerLabel(`Runner ${crypto.randomUUID().slice(0, 4)}`);
  }

  return normalizeRealtimeArenaPlayerLabel(
    `Runner ${Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, "0")}`
  );
}

async function fetchSessionInfo(sessionId: string): Promise<MultiplayerDemoSessionInfo> {
  const response = await fetch(
    `/api/multiplayer-demo/session?sessionId=${encodeURIComponent(sessionId)}`,
    {
      headers: {
        accept: "application/json"
      }
    }
  );
  if (!response.ok) {
    throw await createApiError(response, "Unable to load multiplayer demo session");
  }

  return (await response.json()) as MultiplayerDemoSessionInfo;
}

class DemoApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function createApiError(response: Response, fallback: string): Promise<DemoApiError> {
  let message = `${fallback}: ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") {
      message = body.error;
    }
  } catch {
    // Keep the HTTP fallback when the dev server did not return a JSON problem body.
  }

  return new DemoApiError(message, response.status);
}
