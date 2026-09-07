import type { GameKitsStyleProviderProps } from "./types";

export function GameKitsStyleProvider({
  children,
  className,
  density = "comfortable",
  motion = "system",
  style,
  theme = "gamekits"
}: GameKitsStyleProviderProps) {
  return (
    <div
      className={className ?? "gamekits-ui-shell"}
      data-gamekits-density={density}
      data-gamekits-motion={motion}
      data-gamekits-theme={theme}
      data-gamekits-ui-shell=""
      style={style}
    >
      {children}
    </div>
  );
}
