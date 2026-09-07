import {
  createMultiplayerLocalAuthorityLoop,
  type MultiplayerAuthorityDecision,
  type MultiplayerLocalAuthorityLoop,
  type NetworkVector2
} from "@gamekits/multiplayer-core";
import {
  applyRealtimeArenaPlayerInteract,
  applyRealtimeInputFrame,
  captureRealtimeArenaSnapshot,
  rematchRealtimeArena,
  setRealtimeArenaPlayerName,
  setRealtimeArenaPlayerReady,
  startRealtimeArenaCountdown,
  tickRealtimeArena,
  type RealtimeArenaActionResult,
  type RealtimeArenaSnapshot,
  type RealtimeArenaState,
  type RealtimeInputFrame
} from "./domain";
import { createRealtimePracticeArenaState, REALTIME_ARENA_TICK_MS } from "./config";
import type { RealtimeArenaPresentationFrame } from "./presentation";

export type RealtimeLocalGameDiagnostics = {
  inputSequence: number;
  inputSendRate: number;
  serverTickRate: number;
  lastAction?: RealtimeArenaActionResult;
};

export type RealtimeInputTarget = {
  setInputKey(code: string, down: boolean): void;
  queueInteract(): void;
  resetInputKeys(): void;
};

export type RealtimeInputSampler = Omit<RealtimeInputTarget, "queueInteract"> & {
  readonly sequence: number;
  nextFrame(now: number): RealtimeInputFrame;
  reset(): void;
  resetKeys(): void;
};

type RealtimeArenaCanvasScratch = {
  position: NetworkVector2;
  velocity: NetworkVector2;
};

const canvasScratchByElement = new WeakMap<HTMLCanvasElement, RealtimeArenaCanvasScratch>();

export type RealtimeLocalGame = {
  readonly state: RealtimeArenaState;
  readonly localPlayerId: string;
  readonly diagnostics: RealtimeLocalGameDiagnostics;
  setReady(ready: boolean): RealtimeArenaActionResult;
  setPlayerName(name: string): RealtimeArenaActionResult;
  startRound(): RealtimeArenaActionResult;
  rematch(): RealtimeArenaActionResult;
  reset(): void;
  setInputKey(code: string, down: boolean): void;
  queueInteract(): void;
  resetInputKeys(): void;
  step(now: number): void;
  snapshot(): RealtimeArenaSnapshot;
  render(canvas: HTMLCanvasElement): void;
};

type RealtimeLocalGameAction =
  | { type: "set-name"; name: string }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "interact" }
  | { type: "rematch" }
  | { type: "reset" };

export type RealtimeLocalGameOptions = {
  playerName?: string;
};

export function createRealtimeLocalGame(options: RealtimeLocalGameOptions = {}): RealtimeLocalGame {
  let localPlayerName = options.playerName;
  let state = createPracticeState(localPlayerName);
  const input = createRealtimeInputSampler();
  const diagnostics: RealtimeLocalGameDiagnostics = {
    inputSequence: 0,
    inputSendRate: 0,
    serverTickRate: 20
  };
  let lastFrameTime: number | undefined;
  let tickAccumulator = 0;
  let inputFramesSentThisSecond = 0;
  let tickCountThisSecond = 0;
  let rateWindowMs = 0;
  let resetEpoch = 0;
  const authorityLoop = createMultiplayerLocalAuthorityLoop<
    RealtimeLocalGameAction,
    RealtimeInputFrame,
    RealtimeArenaSnapshot
  >({
    binding: {
      sessionId: "local-practice",
      mode: "local",
      localPlayerId: LOCAL_PLAYER_ID
    },
    inputSequence(frame) {
      return frame.sequence;
    },
    inputSequenceKey() {
      return `local.${resetEpoch}`;
    },
    handleAction({ payload }) {
      diagnostics.lastAction = handleLocalAction(payload);
      return toAuthorityDecision(diagnostics.lastAction);
    },
    handleInput({ payload }) {
      diagnostics.lastAction = applyRealtimeInputFrame(state, LOCAL_PLAYER_ID, payload);
      return toAuthorityDecision(diagnostics.lastAction);
    },
    tick({ deltaMs }) {
      tickRealtimeArena(state, deltaMs);
    },
    captureSnapshot() {
      return captureRealtimeArenaSnapshot(state);
    }
  });

  return {
    get state() {
      return state;
    },
    localPlayerId: LOCAL_PLAYER_ID,
    diagnostics,
    setReady(ready) {
      return dispatchLocalAction(authorityLoop, { type: "ready", ready }, diagnostics);
    },
    setPlayerName(name) {
      return dispatchLocalAction(authorityLoop, { type: "set-name", name }, diagnostics);
    },
    startRound() {
      return dispatchLocalAction(authorityLoop, { type: "start" }, diagnostics);
    },
    rematch() {
      return dispatchLocalAction(authorityLoop, { type: "rematch" }, diagnostics);
    },
    reset() {
      dispatchLocalAction(authorityLoop, { type: "reset" }, diagnostics);
    },
    setInputKey(code, down) {
      input.setInputKey(code, down);
    },
    queueInteract() {
      return dispatchLocalAction(authorityLoop, { type: "interact" }, diagnostics);
    },
    resetInputKeys() {
      input.resetKeys();
    },
    step(now) {
      const deltaMs =
        lastFrameTime === undefined
          ? REALTIME_ARENA_TICK_MS
          : Math.min(250, Math.max(0, now - lastFrameTime));
      lastFrameTime = now;
      tickAccumulator += deltaMs;
      rateWindowMs += deltaMs;

      while (tickAccumulator >= REALTIME_ARENA_TICK_MS) {
        if (state.phase === "running") {
          const frame = input.nextFrame(now);
          diagnostics.inputSequence = frame.sequence;
          inputFramesSentThisSecond += 1;
          const result = authorityLoop.dispatchInput(frame);
          if (!result.allowed) {
            diagnostics.lastAction = fromAuthorityDecision(result);
          }
        }
        authorityLoop.tick(REALTIME_ARENA_TICK_MS);
        tickCountThisSecond += 1;
        tickAccumulator -= REALTIME_ARENA_TICK_MS;
      }

      if (rateWindowMs >= 1000) {
        diagnostics.inputSendRate = Math.round((inputFramesSentThisSecond * 1000) / rateWindowMs);
        diagnostics.serverTickRate = Math.round((tickCountThisSecond * 1000) / rateWindowMs);
        inputFramesSentThisSecond = 0;
        tickCountThisSecond = 0;
        rateWindowMs = 0;
      }
    },
    snapshot() {
      return authorityLoop.snapshot();
    },
    render(canvas) {
      renderRealtimeArenaCanvas(canvas, authorityLoop.snapshot(), LOCAL_PLAYER_ID);
    }
  };

  function handleLocalAction(action: RealtimeLocalGameAction): RealtimeArenaActionResult {
    switch (action.type) {
      case "set-name": {
        const result = setRealtimeArenaPlayerName(state, LOCAL_PLAYER_ID, action.name);
        if (result.accepted) {
          localPlayerName = state.players.find((player) => player.id === LOCAL_PLAYER_ID)?.label;
        }
        return result;
      }
      case "ready":
        return setRealtimeArenaPlayerReady(state, LOCAL_PLAYER_ID, action.ready);
      case "start": {
        const player = state.players.find((candidate) => candidate.id === LOCAL_PLAYER_ID);
        if (player && !player.ready && state.phase === "lobby") {
          setRealtimeArenaPlayerReady(state, LOCAL_PLAYER_ID, true);
        }
        return startRealtimeArenaCountdown(state);
      }
      case "interact":
        return applyRealtimeArenaPlayerInteract(state, LOCAL_PLAYER_ID);
      case "rematch":
        return rematchRealtimeArena(state);
      case "reset":
        state = createPracticeState(localPlayerName);
        resetEpoch += 1;
        input.reset();
        diagnostics.inputSequence = 0;
        diagnostics.inputSendRate = 0;
        diagnostics.serverTickRate = 20;
        lastFrameTime = undefined;
        tickAccumulator = 0;
        inputFramesSentThisSecond = 0;
        tickCountThisSecond = 0;
        rateWindowMs = 0;
        return { accepted: true };
    }
  }
}

function dispatchLocalAction(
  authorityLoop: MultiplayerLocalAuthorityLoop<
    RealtimeLocalGameAction,
    RealtimeInputFrame,
    RealtimeArenaSnapshot
  >,
  action: RealtimeLocalGameAction,
  diagnostics: RealtimeLocalGameDiagnostics
): RealtimeArenaActionResult {
  const decision = authorityLoop.dispatchAction(action);
  if (!decision.allowed) {
    diagnostics.lastAction = fromAuthorityDecision(decision);
  }
  return diagnostics.lastAction ?? { accepted: true };
}

function toAuthorityDecision(result: RealtimeArenaActionResult): MultiplayerAuthorityDecision {
  return result.accepted
    ? { allowed: true }
    : { allowed: false, code: result.code, reason: result.reason };
}

function fromAuthorityDecision(decision: MultiplayerAuthorityDecision): RealtimeArenaActionResult {
  return decision.allowed
    ? { accepted: true }
    : { accepted: false, code: decision.code, reason: decision.reason };
}

export function bindRealtimeLocalGameInput(game: RealtimeLocalGame, root: HTMLElement): () => void {
  return bindRealtimeInputKeys(game, root);
}

export function bindRealtimeInputKeys(target: RealtimeInputTarget, root: HTMLElement): () => void {
  const keyDown = (event: KeyboardEvent): void => {
    if (!isGameplayKey(event) || isGameplayInputBlocked()) {
      return;
    }

    event.preventDefault();
    if (event.code === "KeyE") {
      if (!event.repeat) {
        target.queueInteract();
      }
      return;
    }
    target.setInputKey(event.code, true);
  };
  const keyUp = (event: KeyboardEvent): void => {
    if (!isGameplayKey(event)) {
      return;
    }
    if (isGameplayInputBlocked()) {
      target.resetInputKeys();
      return;
    }

    event.preventDefault();
    if (event.code === "KeyE") {
      return;
    }
    target.setInputKey(event.code, false);
  };
  const blur = (): void => {
    target.resetInputKeys();
  };

  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);
  window.addEventListener("blur", blur);
  root.addEventListener("pointerdown", focusCanvasFromPointer);

  return () => {
    window.removeEventListener("keydown", keyDown);
    window.removeEventListener("keyup", keyUp);
    window.removeEventListener("blur", blur);
    root.removeEventListener("pointerdown", focusCanvasFromPointer);
  };
}

const LOCAL_PLAYER_ID = "local-runner";

function createPracticeState(playerName?: string): RealtimeArenaState {
  return createRealtimePracticeArenaState([
    {
      id: LOCAL_PLAYER_ID,
      label: playerName ?? "Runner",
      teamId: "green"
    }
  ]);
}

export function createRealtimeInputSampler(): RealtimeInputSampler {
  const keys = new Set<string>();
  let sequence = 0;
  const resetKeys = (): void => {
    keys.clear();
  };

  return {
    get sequence() {
      return sequence;
    },
    nextFrame(now) {
      sequence += 1;
      const frame: RealtimeInputFrame = {
        sequence,
        clientTime: Math.round(now),
        moveX: axis(keys, "KeyA", "ArrowLeft", "KeyD", "ArrowRight"),
        moveY: axis(keys, "KeyW", "ArrowUp", "KeyS", "ArrowDown"),
        sprint: keys.has("Space")
      };
      return frame;
    },
    setInputKey(code, down) {
      if (down) {
        keys.add(code);
      } else {
        keys.delete(code);
      }
    },
    reset() {
      resetKeys();
      sequence = 0;
    },
    resetKeys() {
      resetKeys();
    },
    resetInputKeys() {
      resetKeys();
    }
  };
}

function axis(
  keys: Set<string>,
  negativeA: string,
  negativeB: string,
  positiveA: string,
  positiveB: string
): -1 | 0 | 1 {
  const negative = keys.has(negativeA) || keys.has(negativeB);
  const positive = keys.has(positiveA) || keys.has(positiveB);
  if (negative === positive) {
    return 0;
  }
  return negative ? -1 : 1;
}

export function renderRealtimeArenaCanvas(
  canvas: HTMLCanvasElement,
  snapshot: RealtimeArenaSnapshot,
  localPlayerId: string,
  presentation?: RealtimeArenaPresentationFrame
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  resizeCanvas(canvas, snapshot.bounds.width, snapshot.bounds.height);
  const scaleX = canvas.width / snapshot.bounds.width;
  const scaleY = canvas.height / snapshot.bounds.height;
  context.save();
  context.scale(scaleX, scaleY);
  drawArenaBackground(context, snapshot);
  for (const relay of snapshot.relayNodes) {
    drawRelay(context, relay.teamId, relay.position.x, relay.position.y, relay.radius);
  }
  for (const wall of snapshot.walls) {
    drawWall(context, wall.x, wall.y, wall.width, wall.height);
  }
  const players = presentation?.players ?? snapshot.players;
  const cores = presentation?.cores ?? snapshot.cores;
  const scratch = readCanvasScratch(canvas);
  const presentedPosition = scratch.position;
  const presentedVelocity = scratch.velocity;
  for (const core of cores) {
    if (presentation === undefined) {
      writeVector2(presentedPosition, core.position);
    } else if (core.carriedByPlayerId === undefined) {
      presentation.writeCorePosition(core.id, presentedPosition, core.position);
    } else {
      const carrier = findPlayer(players, core.carriedByPlayerId);
      if (carrier === undefined) {
        presentation.writeCorePosition(core.id, presentedPosition, core.position);
      } else {
        presentation.writePlayerPosition(carrier.id, presentedPosition, carrier.position);
      }
    }
    drawCore(
      context,
      presentedPosition.x,
      presentedPosition.y,
      core.radius,
      core.carriedByPlayerId !== undefined
    );
  }
  for (const player of players) {
    if (presentation === undefined) {
      writeVector2(presentedPosition, player.position);
      writeVector2(presentedVelocity, player.velocity);
    } else {
      presentation.writePlayerPosition(player.id, presentedPosition, player.position);
      presentation.writePlayerVelocity(player.id, presentedVelocity, player.velocity);
    }
    drawPlayer(
      context,
      player,
      player.id === localPlayerId,
      snapshot.rules.playerRadius,
      presentedPosition,
      presentedVelocity
    );
  }
  drawRoundOverlay(context, snapshot, snapshot.rules.countdownMs);
  context.restore();
}

function readCanvasScratch(canvas: HTMLCanvasElement): RealtimeArenaCanvasScratch {
  let scratch = canvasScratchByElement.get(canvas);
  if (scratch === undefined) {
    scratch = {
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 }
    };
    canvasScratchByElement.set(canvas, scratch);
  }
  return scratch;
}

function findPlayer(
  players: RealtimeArenaSnapshot["players"],
  playerId: string
): RealtimeArenaSnapshot["players"][number] | undefined {
  for (const player of players) {
    if (player.id === playerId) {
      return player;
    }
  }
  return undefined;
}

function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const targetWidth = Math.max(1, Math.round((rect.width || width) * devicePixelRatio));
  const targetHeight = Math.max(1, Math.round((rect.height || height) * devicePixelRatio));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
}

function drawArenaBackground(
  context: CanvasRenderingContext2D,
  snapshot: RealtimeArenaSnapshot
): void {
  context.fillStyle = "#111612";
  context.fillRect(0, 0, snapshot.bounds.width, snapshot.bounds.height);
  context.strokeStyle = "rgba(218, 234, 222, 0.08)";
  context.lineWidth = 1;
  for (let x = 0; x <= snapshot.bounds.width; x += 40) {
    line(context, x, 0, x, snapshot.bounds.height);
  }
  for (let y = 0; y <= snapshot.bounds.height; y += 40) {
    line(context, 0, y, snapshot.bounds.width, y);
  }
  context.strokeStyle = "#59645d";
  context.lineWidth = 3;
  context.strokeRect(2, 2, snapshot.bounds.width - 4, snapshot.bounds.height - 4);
  context.fillStyle = "rgba(230, 196, 92, 0.08)";
  context.fillRect(snapshot.bounds.width / 2 - 28, 0, 56, snapshot.bounds.height);
}

function drawRelay(
  context: CanvasRenderingContext2D,
  teamId: string,
  x: number,
  y: number,
  radius: number
): void {
  const color = teamId === "green" ? "#a9e66d" : "#ff9166";
  context.fillStyle = withAlpha(color, 0.14);
  context.strokeStyle = color;
  context.lineWidth = 3;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = color;
  context.font = "700 15px 'Aptos Narrow', sans-serif";
  context.textAlign = "center";
  context.fillText(teamId.toUpperCase(), x, y + radius + 22);
}

function drawWall(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  context.fillStyle = "#26312d";
  context.strokeStyle = "#6e7a72";
  context.lineWidth = 2;
  roundRect(context, x, y, width, height, 7);
  context.fill();
  context.stroke();
}

function drawCore(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  carried: boolean
): void {
  context.fillStyle = carried ? "#f4f7ee" : "#54d6d0";
  context.strokeStyle = "#0a2e32";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(x, y, radius + 4, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = "#111612";
  context.beginPath();
  context.arc(x, y, Math.max(2, radius - 4), 0, Math.PI * 2);
  context.fill();
}

function drawPlayer(
  context: CanvasRenderingContext2D,
  player: RealtimeArenaSnapshot["players"][number],
  local: boolean,
  radius: number,
  position: NetworkVector2,
  velocity: NetworkVector2
): void {
  const color = player.teamId === "green" ? "#a9e66d" : "#ff9166";
  context.fillStyle = local ? "#f4f7ee" : color;
  context.strokeStyle = color;
  context.lineWidth = local ? 5 : 3;
  context.beginPath();
  context.arc(position.x, position.y, radius, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  const directionLength = Math.hypot(velocity.x, velocity.y);
  if (directionLength > 0.01) {
    const dx = (velocity.x / directionLength) * 22;
    const dy = (velocity.y / directionLength) * 22;
    context.strokeStyle = "#e6c45c";
    context.lineWidth = 3;
    line(context, position.x, position.y, position.x + dx, position.y + dy);
  }

  drawPlayerLabel(context, player.label, position.x, position.y - radius - 12, local);
}

function writeVector2(target: NetworkVector2, value: NetworkVector2): void {
  target.x = value.x;
  target.y = value.y;
}

function drawPlayerLabel(
  context: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  local: boolean
): void {
  const text = label.length > 16 ? `${label.slice(0, 15)}...` : label;
  context.save();
  context.font = "800 10px 'Aptos Narrow', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = Math.min(86, Math.max(28, context.measureText(text).width + 12));
  const height = 16;
  context.fillStyle = local ? "rgba(244, 247, 238, 0.9)" : "rgba(12, 15, 14, 0.78)";
  roundRect(context, x - width / 2, y - height / 2, width, height, 5);
  context.fill();
  context.fillStyle = local ? "#101512" : "#f4f7ee";
  context.fillText(text, x, y + 0.5);
  context.restore();
}

function drawRoundOverlay(
  context: CanvasRenderingContext2D,
  snapshot: RealtimeArenaSnapshot,
  countdownMs: number
): void {
  if (snapshot.phase === "running") {
    return;
  }

  const label = overlayLabel(snapshot, countdownMs);
  if (!label) {
    return;
  }

  context.fillStyle = "rgba(12, 15, 14, 0.72)";
  roundRect(context, 190, 148, 340, 124, 8);
  context.fill();
  context.strokeStyle = "rgba(244, 247, 238, 0.28)";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#f4f7ee";
  context.font = "900 34px 'Aptos Narrow', sans-serif";
  context.textAlign = "center";
  context.fillText(label.title, 360, 202);
  context.fillStyle = "#a9b7ac";
  context.font = "700 17px 'Aptos Narrow', sans-serif";
  context.fillText(label.detail, 360, 232);
}

function overlayLabel(
  snapshot: RealtimeArenaSnapshot,
  countdownMs: number
): { title: string; detail: string } | undefined {
  switch (snapshot.phase) {
    case "lobby":
      return {
        title: "READY ROOM",
        detail: "Lineup open"
      };
    case "countdown":
      return {
        title: String(Math.max(1, Math.ceil((countdownMs - snapshot.phaseElapsedMs) / 1000))),
        detail: "Round starting"
      };
    case "ending":
      return {
        title: "ROUND LOCKED",
        detail: "Final score is being sealed"
      };
    case "results":
      return {
        title: snapshot.result?.winnerTeamId
          ? `${snapshot.result.winnerTeamId.toUpperCase()} WINS`
          : "DRAW",
        detail: "Rematch or reset"
      };
    case "running":
      return undefined;
  }
}

function line(
  context: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): void {
  context.beginPath();
  context.moveTo(fromX, fromY);
  context.lineTo(toX, toY);
  context.stroke();
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function isGameplayKey(event: KeyboardEvent): boolean {
  return (
    event.code === "KeyW" ||
    event.code === "KeyA" ||
    event.code === "KeyS" ||
    event.code === "KeyD" ||
    event.code === "ArrowUp" ||
    event.code === "ArrowLeft" ||
    event.code === "ArrowDown" ||
    event.code === "ArrowRight" ||
    event.code === "Space" ||
    event.code === "KeyE"
  );
}

function isGameplayInputBlocked(): boolean {
  const element = document.activeElement;
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLButtonElement ||
    element instanceof HTMLAnchorElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

function focusCanvasFromPointer(event: PointerEvent): void {
  if (event.target instanceof HTMLCanvasElement) {
    event.target.focus();
  }
}
