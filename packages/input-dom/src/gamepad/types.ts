import type { InputScopeId, NormalizedInputEvent } from "@gamekits/input-core";

export type WebGamepadButtonSnapshot = {
  pressed: boolean;
  touched?: boolean;
  value: number;
};

export type WebGamepadSnapshot = {
  axes: ArrayLike<number>;
  buttons: ArrayLike<WebGamepadButtonSnapshot>;
  connected: boolean;
  id: string;
  index: number;
  mapping: string;
  timestamp?: number;
};

export type WebGamepadSnapshotProvider = {
  getGamepads(): ArrayLike<WebGamepadSnapshot | null>;
};

export type WebGamepadInputScopeResolver = () => InputScopeId | undefined;

export type WebGamepadInputDiagnosticKind =
  | "connected"
  | "disconnected"
  | "provider-unavailable"
  | "poll-failed"
  | "invalid-snapshot"
  | "unsupported-mapping"
  | "capacity-exceeded";

export type WebGamepadInputDiagnostic = {
  kind: WebGamepadInputDiagnosticKind;
  message: string;
  source: string;
  timestamp: number;
  gamepadIndex?: number;
  gamepadId?: string;
};

export type WebGamepadInputAdapterOptions = {
  onInput(event: NormalizedInputEvent): void;
  scope?: InputScopeId | WebGamepadInputScopeResolver;
  source?: string;
  clock?: () => number;
  provider?: WebGamepadSnapshotProvider;
  deadZone?: number;
  buttonPressThreshold?: number;
  changeEpsilon?: number;
  maxGamepads?: number;
  onDiagnostic?(event: WebGamepadInputDiagnostic): void;
};
