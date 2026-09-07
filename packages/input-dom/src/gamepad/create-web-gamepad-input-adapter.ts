import type {
  InputFrame,
  InputPhase,
  InputScopeId,
  InputSourceAdapter,
  NormalizedInputEvent
} from "@gamekits/input-core";
import { STANDARD_GAMEPAD_CONTROL } from "./controls";
import type {
  WebGamepadButtonSnapshot,
  WebGamepadInputAdapterOptions,
  WebGamepadInputDiagnostic,
  WebGamepadInputDiagnosticKind,
  WebGamepadSnapshot,
  WebGamepadSnapshotProvider
} from "./types";

const DEFAULT_DEAD_ZONE = 0.18;
const DEFAULT_BUTTON_PRESS_THRESHOLD = 0.5;
const DEFAULT_CHANGE_EPSILON = 0.01;
const DEFAULT_MAX_GAMEPADS = 4;
const MAX_GAMEPADS = 4;
const MAX_DIAGNOSTIC_KEYS = 64;

const CONTROL_CODES = [
  STANDARD_GAMEPAD_CONTROL.buttonSouth,
  STANDARD_GAMEPAD_CONTROL.buttonEast,
  STANDARD_GAMEPAD_CONTROL.buttonWest,
  STANDARD_GAMEPAD_CONTROL.buttonNorth,
  STANDARD_GAMEPAD_CONTROL.leftBumper,
  STANDARD_GAMEPAD_CONTROL.rightBumper,
  STANDARD_GAMEPAD_CONTROL.leftTrigger,
  STANDARD_GAMEPAD_CONTROL.rightTrigger,
  STANDARD_GAMEPAD_CONTROL.select,
  STANDARD_GAMEPAD_CONTROL.start,
  STANDARD_GAMEPAD_CONTROL.leftStick,
  STANDARD_GAMEPAD_CONTROL.rightStick,
  STANDARD_GAMEPAD_CONTROL.dpadUp,
  STANDARD_GAMEPAD_CONTROL.dpadDown,
  STANDARD_GAMEPAD_CONTROL.dpadLeft,
  STANDARD_GAMEPAD_CONTROL.dpadRight,
  STANDARD_GAMEPAD_CONTROL.home,
  STANDARD_GAMEPAD_CONTROL.leftXNegative,
  STANDARD_GAMEPAD_CONTROL.leftXPositive,
  STANDARD_GAMEPAD_CONTROL.leftYNegative,
  STANDARD_GAMEPAD_CONTROL.leftYPositive,
  STANDARD_GAMEPAD_CONTROL.rightXNegative,
  STANDARD_GAMEPAD_CONTROL.rightXPositive,
  STANDARD_GAMEPAD_CONTROL.rightYNegative,
  STANDARD_GAMEPAD_CONTROL.rightYPositive
] as const;

const BUTTON_CONTROL_COUNT = 17;
const LEFT_X_NEGATIVE = 17;
const LEFT_X_POSITIVE = 18;
const LEFT_Y_NEGATIVE = 19;
const LEFT_Y_POSITIVE = 20;
const RIGHT_X_NEGATIVE = 21;
const RIGHT_X_POSITIVE = 22;
const RIGHT_Y_NEGATIVE = 23;
const RIGHT_Y_POSITIVE = 24;

type GamepadConnectionState = {
  browserId: string;
  deviceId: string;
  scope: InputScopeId | undefined;
  active: Uint8Array;
  blockedUntilNeutral: Uint8Array;
  values: Float64Array;
  sampledValues: Float64Array;
};

type ResolvedWebGamepadOptions = {
  source: string;
  clock: () => number;
  provider: WebGamepadSnapshotProvider | undefined;
  deadZone: number;
  buttonPressThreshold: number;
  changeEpsilon: number;
  maxGamepads: number;
};

export function createWebGamepadInputAdapter(
  options: WebGamepadInputAdapterOptions
): InputSourceAdapter {
  const resolved = resolveOptions(options);
  const connections = Array.from<GamepadConnectionState | undefined>({
    length: resolved.maxGamepads
  });
  const generations = new Uint32Array(resolved.maxGamepads);
  const diagnosticKeys = new Set<string>();
  const diagnosticKeyOrder: string[] = [];
  let started = false;
  let destroyed = false;
  let sequence = 0;
  let scopeInitialized = false;
  let activeScope: InputScopeId | undefined;

  const emitDiagnostic = (
    kind: WebGamepadInputDiagnosticKind,
    message: string,
    timestamp: number,
    details: { index?: number; id?: string; dedupeKey?: string } = {}
  ): void => {
    if (
      details.dedupeKey &&
      !rememberDiagnosticKey(diagnosticKeys, diagnosticKeyOrder, details.dedupeKey)
    ) {
      return;
    }
    const event: WebGamepadInputDiagnostic = {
      kind,
      message,
      source: resolved.source,
      timestamp,
      ...(details.index === undefined ? {} : { gamepadIndex: details.index }),
      ...(details.id === undefined ? {} : { gamepadId: details.id })
    };
    options.onDiagnostic?.(event);
  };

  const emitControl = (
    state: GamepadConnectionState,
    controlIndex: number,
    phase: InputPhase,
    value: number,
    timestamp: number,
    scope = state.scope
  ): void => {
    const code = CONTROL_CODES[controlIndex];
    if (code === undefined) {
      return;
    }
    const event: NormalizedInputEvent = {
      id: `${resolved.source}:${++sequence}`,
      device: "gamepad",
      deviceId: state.deviceId,
      phase,
      code,
      value,
      timestamp,
      source: resolved.source,
      ...(scope === undefined ? {} : { scope })
    };
    options.onInput(event);
  };

  const cancelConnection = (
    state: GamepadConnectionState,
    timestamp: number,
    rearm: boolean
  ): void => {
    for (let controlIndex = 0; controlIndex < CONTROL_CODES.length; controlIndex += 1) {
      if (state.active[controlIndex] === 0) {
        continue;
      }
      if (rearm) {
        state.blockedUntilNeutral[controlIndex] = 1;
      }
      emitControl(state, controlIndex, "cancelled", 0, timestamp);
      state.active[controlIndex] = 0;
      state.values[controlIndex] = 0;
    }
  };

  const disconnect = (browserIndex: number, timestamp: number): void => {
    const state = connections[browserIndex];
    if (!state) {
      return;
    }
    cancelConnection(state, timestamp, false);
    connections[browserIndex] = undefined;
    emitDiagnostic("disconnected", "Web gamepad disconnected", timestamp, {
      index: browserIndex,
      id: state.browserId
    });
  };

  const cancelAll = (timestamp: number): void => {
    for (let browserIndex = 0; browserIndex < connections.length; browserIndex += 1) {
      disconnect(browserIndex, timestamp);
    }
  };

  const cancelAllActive = (timestamp: number, rearm: boolean): void => {
    for (const state of connections) {
      if (state) {
        cancelConnection(state, timestamp, rearm);
      }
    }
  };

  const poll = (frame: InputFrame): void => {
    if (!started || destroyed || !resolved.provider) {
      return;
    }

    let scope: InputScopeId | undefined;
    try {
      scope = typeof options.scope === "function" ? options.scope() : options.scope;
      forgetDiagnosticKey(diagnosticKeys, diagnosticKeyOrder, "scope-failed");
    } catch (error) {
      emitDiagnostic(
        "poll-failed",
        `Web gamepad scope resolution failed: ${errorMessage(error)}`,
        frame.timestamp,
        { dedupeKey: "scope-failed" }
      );
      cancelAllActive(frame.timestamp, true);
      scopeInitialized = false;
      return;
    }
    if (!scopeInitialized) {
      for (const state of connections) {
        if (state) {
          state.scope = scope;
        }
      }
    } else if (activeScope !== scope) {
      for (const state of connections) {
        if (!state) {
          continue;
        }
        cancelConnection(state, frame.timestamp, true);
        state.scope = scope;
      }
    }
    activeScope = scope;
    scopeInitialized = true;

    let snapshots: ArrayLike<WebGamepadSnapshot | null>;
    try {
      snapshots = resolved.provider.getGamepads();
    } catch (error) {
      emitDiagnostic(
        "poll-failed",
        `Web gamepad polling failed: ${errorMessage(error)}`,
        frame.timestamp,
        {
          dedupeKey: "poll-failed"
        }
      );
      cancelAllActive(frame.timestamp, true);
      return;
    }
    if (!isArrayLike(snapshots)) {
      emitDiagnostic(
        "invalid-snapshot",
        "Web gamepad provider returned an invalid collection",
        frame.timestamp,
        {
          dedupeKey: "invalid-collection"
        }
      );
      cancelAllActive(frame.timestamp, true);
      return;
    }
    forgetDiagnosticKey(diagnosticKeys, diagnosticKeyOrder, "poll-failed");
    forgetDiagnosticKey(diagnosticKeys, diagnosticKeyOrder, "invalid-collection");

    if (snapshots.length > resolved.maxGamepads) {
      emitDiagnostic(
        "capacity-exceeded",
        `Web gamepad provider exposed more than ${resolved.maxGamepads} slots`,
        frame.timestamp,
        { dedupeKey: "capacity-exceeded" }
      );
    }

    for (let browserIndex = 0; browserIndex < resolved.maxGamepads; browserIndex += 1) {
      const snapshot = snapshots[browserIndex];
      if (snapshot == null || !isWebGamepadSnapshot(snapshot) || !snapshot.connected) {
        if (snapshot != null && !isWebGamepadSnapshot(snapshot)) {
          emitDiagnostic(
            "invalid-snapshot",
            "Web gamepad provider returned an invalid slot",
            frame.timestamp,
            {
              index: browserIndex,
              dedupeKey: `invalid-slot:${browserIndex}`
            }
          );
        }
        disconnect(browserIndex, frame.timestamp);
        continue;
      }
      if (snapshot.index !== browserIndex) {
        emitDiagnostic(
          "invalid-snapshot",
          "Web gamepad snapshot index does not match its provider slot",
          frame.timestamp,
          { index: browserIndex, id: snapshot.id, dedupeKey: `index-mismatch:${browserIndex}` }
        );
        disconnect(browserIndex, frame.timestamp);
        continue;
      }
      forgetDiagnosticKey(diagnosticKeys, diagnosticKeyOrder, `invalid-slot:${browserIndex}`);
      forgetDiagnosticKey(diagnosticKeys, diagnosticKeyOrder, `index-mismatch:${browserIndex}`);
      if (snapshot.mapping !== "standard") {
        emitDiagnostic(
          "unsupported-mapping",
          "Only the W3C standard gamepad mapping is supported",
          frame.timestamp,
          {
            index: browserIndex,
            id: snapshot.id,
            dedupeKey: `unsupported:${browserIndex}:${snapshot.id}`
          }
        );
        disconnect(browserIndex, frame.timestamp);
        continue;
      }

      let state = connections[browserIndex];
      if (state && state.browserId !== snapshot.id) {
        disconnect(browserIndex, frame.timestamp);
        state = undefined;
      }
      if (!state) {
        const generation = (generations[browserIndex] = generations[browserIndex]! + 1);
        state = createConnectionState(
          snapshot.id,
          `${resolved.source}:${browserIndex}:${generation}`,
          scope
        );
        connections[browserIndex] = state;
        emitDiagnostic("connected", "Web gamepad connected", frame.timestamp, {
          index: browserIndex,
          id: snapshot.id
        });
      }

      sampleStandardControls(
        snapshot,
        state.sampledValues,
        resolved.deadZone,
        resolved.buttonPressThreshold
      );
      applySample(state, frame.timestamp, resolved.changeEpsilon, emitControl);
    }
  };

  return {
    start() {
      if (started || destroyed) {
        return;
      }
      started = true;
      if (!resolved.provider) {
        emitDiagnostic(
          "provider-unavailable",
          "Web Gamepad API is unavailable in this runtime",
          resolved.clock(),
          { dedupeKey: "provider-unavailable" }
        );
      }
    },
    stop() {
      if (!started) {
        return;
      }
      started = false;
      cancelAll(resolved.clock());
      scopeInitialized = false;
      activeScope = undefined;
    },
    poll,
    destroy() {
      this.stop();
      destroyed = true;
    }
  };
}

function resolveOptions(options: WebGamepadInputAdapterOptions): ResolvedWebGamepadOptions {
  return {
    source: options.source ?? "input.web.gamepad",
    clock: options.clock ?? defaultClock,
    provider: options.provider ?? createNavigatorGamepadProvider(),
    deadZone: requireRange(options.deadZone ?? DEFAULT_DEAD_ZONE, "deadZone", 0, 1, false),
    buttonPressThreshold: requireRange(
      options.buttonPressThreshold ?? DEFAULT_BUTTON_PRESS_THRESHOLD,
      "buttonPressThreshold",
      0,
      1,
      true,
      true
    ),
    changeEpsilon: requireRange(
      options.changeEpsilon ?? DEFAULT_CHANGE_EPSILON,
      "changeEpsilon",
      0,
      1,
      false,
      true
    ),
    maxGamepads: requireGamepadCapacity(options.maxGamepads ?? DEFAULT_MAX_GAMEPADS)
  };
}

function createNavigatorGamepadProvider(): WebGamepadSnapshotProvider | undefined {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
    return undefined;
  }
  return {
    getGamepads() {
      return navigator.getGamepads() as unknown as ArrayLike<WebGamepadSnapshot | null>;
    }
  };
}

function createConnectionState(
  browserId: string,
  deviceId: string,
  scope: InputScopeId | undefined
): GamepadConnectionState {
  return {
    browserId,
    deviceId,
    scope,
    active: new Uint8Array(CONTROL_CODES.length),
    blockedUntilNeutral: new Uint8Array(CONTROL_CODES.length),
    values: new Float64Array(CONTROL_CODES.length),
    sampledValues: new Float64Array(CONTROL_CODES.length)
  };
}

function sampleStandardControls(
  snapshot: WebGamepadSnapshot,
  target: Float64Array,
  deadZone: number,
  buttonPressThreshold: number
): void {
  target.fill(0);
  for (let buttonIndex = 0; buttonIndex < BUTTON_CONTROL_COUNT; buttonIndex += 1) {
    target[buttonIndex] = readButtonValue(snapshot.buttons[buttonIndex], buttonPressThreshold);
  }
  writeStick(
    target,
    readAxis(snapshot.axes[0]),
    readAxis(snapshot.axes[1]),
    deadZone,
    LEFT_X_NEGATIVE,
    LEFT_X_POSITIVE,
    LEFT_Y_NEGATIVE,
    LEFT_Y_POSITIVE
  );
  writeStick(
    target,
    readAxis(snapshot.axes[2]),
    readAxis(snapshot.axes[3]),
    deadZone,
    RIGHT_X_NEGATIVE,
    RIGHT_X_POSITIVE,
    RIGHT_Y_NEGATIVE,
    RIGHT_Y_POSITIVE
  );
}

function writeStick(
  target: Float64Array,
  x: number,
  y: number,
  deadZone: number,
  xNegative: number,
  xPositive: number,
  yNegative: number,
  yPositive: number
): void {
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadZone || magnitude === 0) {
    return;
  }
  const normalizedMagnitude = (Math.min(1, magnitude) - deadZone) / (1 - deadZone);
  const scale = normalizedMagnitude / magnitude;
  const conditionedX = x * scale;
  const conditionedY = y * scale;
  target[xNegative] = Math.max(0, -conditionedX);
  target[xPositive] = Math.max(0, conditionedX);
  target[yNegative] = Math.max(0, -conditionedY);
  target[yPositive] = Math.max(0, conditionedY);
}

function applySample(
  state: GamepadConnectionState,
  timestamp: number,
  changeEpsilon: number,
  emit: (
    state: GamepadConnectionState,
    controlIndex: number,
    phase: InputPhase,
    value: number,
    timestamp: number
  ) => void
): void {
  for (let controlIndex = 0; controlIndex < CONTROL_CODES.length; controlIndex += 1) {
    const sampledValue = state.sampledValues[controlIndex]!;
    if (state.blockedUntilNeutral[controlIndex] !== 0) {
      if (sampledValue === 0) {
        state.blockedUntilNeutral[controlIndex] = 0;
      }
      continue;
    }
    if (state.active[controlIndex] !== 0 && sampledValue === 0) {
      emit(state, controlIndex, "released", 0, timestamp);
      state.active[controlIndex] = 0;
      state.values[controlIndex] = 0;
    }
  }

  for (let controlIndex = 0; controlIndex < CONTROL_CODES.length; controlIndex += 1) {
    const sampledValue = state.sampledValues[controlIndex]!;
    if (state.blockedUntilNeutral[controlIndex] !== 0 || sampledValue === 0) {
      continue;
    }
    if (state.active[controlIndex] === 0) {
      emit(state, controlIndex, "pressed", sampledValue, timestamp);
      state.active[controlIndex] = 1;
      state.values[controlIndex] = sampledValue;
      continue;
    }
    if (Math.abs(sampledValue - state.values[controlIndex]!) > changeEpsilon) {
      emit(state, controlIndex, "moved", sampledValue, timestamp);
      state.values[controlIndex] = sampledValue;
    }
  }
}

function readButtonValue(
  button: WebGamepadButtonSnapshot | undefined,
  pressThreshold: number
): number {
  if (typeof button !== "object" || button === null) {
    return 0;
  }
  const value = Number.isFinite(button.value) ? clamp(button.value, 0, 1) : 0;
  if (!button.pressed && value < pressThreshold) {
    return 0;
  }
  return Math.max(value, button.pressed ? pressThreshold : 0);
}

function readAxis(value: number | undefined): number {
  return Number.isFinite(value) ? clamp(value!, -1, 1) : 0;
}

function isWebGamepadSnapshot(value: unknown): value is WebGamepadSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const snapshot = value as Partial<WebGamepadSnapshot>;
  return (
    Number.isInteger(snapshot.index) &&
    typeof snapshot.id === "string" &&
    typeof snapshot.connected === "boolean" &&
    typeof snapshot.mapping === "string" &&
    isArrayLike(snapshot.axes) &&
    isArrayLike(snapshot.buttons)
  );
}

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { length?: unknown }).length === "number" &&
    Number.isInteger((value as { length: number }).length) &&
    (value as { length: number }).length >= 0
  );
}

function rememberDiagnosticKey(keys: Set<string>, order: string[], key: string): boolean {
  if (keys.has(key)) {
    return false;
  }
  keys.add(key);
  order.push(key);
  if (order.length > MAX_DIAGNOSTIC_KEYS) {
    keys.delete(order.shift()!);
  }
  return true;
}

function forgetDiagnosticKey(keys: Set<string>, order: string[], key: string): void {
  if (!keys.delete(key)) {
    return;
  }
  const index = order.indexOf(key);
  if (index >= 0) {
    order.splice(index, 1);
  }
}

function requireRange(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
  excludeMinimum: boolean,
  includeMaximum = false
): number {
  const minimumAccepted = excludeMinimum ? value > minimum : value >= minimum;
  const maximumAccepted = includeMaximum ? value <= maximum : value < maximum;
  if (!Number.isFinite(value) || !minimumAccepted || !maximumAccepted) {
    throw new RangeError(
      `${name} must be ${excludeMinimum ? ">" : ">="} ${minimum} and ${includeMaximum ? "<=" : "<"} ${maximum}`
    );
  }
  return value;
}

function requireGamepadCapacity(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_GAMEPADS) {
    throw new RangeError(`maxGamepads must be an integer between 1 and ${MAX_GAMEPADS}`);
  }
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function defaultClock(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
