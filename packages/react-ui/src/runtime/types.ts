import type { CSSProperties, ReactNode } from "react";
import type { UiOpenPanel, UiRuntime, UiRuntimeSnapshot } from "@gamekits/ui-core";

export type UiPanelRenderer = (panel: UiOpenPanel) => ReactNode;

export type GameKitsUiDensity = "compact" | "comfortable" | "spacious";

export type GameKitsUiMotionPreference = "system" | "reduced" | "full";

export type GameKitsStyleProviderProps = {
  children?: ReactNode;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  density?: GameKitsUiDensity | undefined;
  motion?: GameKitsUiMotionPreference | undefined;
  theme?: string | undefined;
};

export type GameKitsUiShellProps = {
  runtime: UiRuntime;
  children?: ReactNode;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  density?: GameKitsUiDensity | undefined;
  motion?: GameKitsUiMotionPreference | undefined;
  theme?: string | undefined;
};

export type UiRuntimeProviderProps = {
  runtime: UiRuntime;
  children: ReactNode;
};

export type UiHostProps = {
  renderPanel?: UiPanelRenderer | undefined;
  className?: string | undefined;
};

export type UiTipSide = "top" | "right" | "bottom" | "left";

export type UiTipProps = {
  children: ReactNode;
  content: ReactNode;
  side?: UiTipSide | undefined;
  className?: string | undefined;
};

export type FocusBridgeProps = {
  runtime: UiRuntime;
  gameViewportRef?: React.RefObject<HTMLElement> | undefined;
  uiRootRef?: React.RefObject<HTMLElement> | undefined;
};

export type UiRuntimeSelector<TValue> = (snapshot: UiRuntimeSnapshot) => TValue;

export type GameKitsUiAnimationOptions = {
  reducedMotion?: boolean | undefined;
  duration?: number | undefined;
};

export type GameKitsUiExitAnimationOptions = GameKitsUiAnimationOptions & {
  onComplete?: (() => void) | undefined;
};

export type GameKitsUiAnimator = {
  enter(element: Element, options?: GameKitsUiAnimationOptions): void;
  exit(element: Element, options?: GameKitsUiExitAnimationOptions): void;
  emphasize(element: Element, options?: GameKitsUiAnimationOptions): void;
};
