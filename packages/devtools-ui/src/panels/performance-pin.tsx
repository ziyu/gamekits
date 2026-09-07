import type { DevToolsSnapshot } from "@gamekits/devtools";
import { calculateFrameBarHeight, createPerformancePanelModel } from "./performance-model";

export type PerformancePinProps = {
  collapsed?: boolean | undefined;
  snapshot: DevToolsSnapshot;
};

export function PerformancePin({ collapsed = false, snapshot }: PerformancePinProps) {
  const model = createPerformancePanelModel(snapshot);
  const latestFrame = model.latestFrame;
  const warningCount = model.liveWarnings.length;
  const status = readPerformanceStatus(snapshot, warningCount);
  const fps = latestFrame ? Math.round(1000 / Math.max(latestFrame.deltaMs, 1)) : undefined;
  const frameHistory = snapshot.profilerFrames.slice(-24);

  if (collapsed) {
    return (
      <div className="gamekits-devtools-pin-icon" data-devtools-pin-status={status}>
        <span className={`gamekits-devtools-pin-status gamekits-devtools-pin-status--${status}`} />
        <strong>{fps ?? "--"}</strong>
        <span>fps</span>
        {warningCount > 0 ? <em>{warningCount}</em> : null}
      </div>
    );
  }

  return (
    <section className="gamekits-devtools-performance-pin" data-devtools-pin-status={status}>
      <FrameGraph frames={frameHistory} maxFrameTime={model.maxFrameTime} />
      <div className="gamekits-devtools-performance-pin__header">
        <strong>PERF</strong>
        <span>
          Spans {latestFrame?.spanCount ?? 0} Warn {warningCount}
        </span>
      </div>
      <div className="gamekits-devtools-performance-pin__channels" aria-label="visible metrics">
        <Channel checked label="FPS" />
        <Channel checked label="Render" />
        <Channel checked label="Tick" />
        <Channel checked={Boolean(latestFrame?.uiMs)} label="UI" />
      </div>
      <div className="gamekits-devtools-performance-pin__readout">
        <Metric label="fps" value={fps?.toString() ?? "--"} />
        <Metric label="frame" value={formatMs(latestFrame?.durationMs)} />
        <Metric label="tick" value={formatMs(latestFrame?.runtimeMs)} />
        <Metric label="render" value={formatMs(latestFrame?.renderMs)} />
        <Metric label="ui" value={formatMs(latestFrame?.uiMs)} />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label}: <strong>{value}</strong>
    </span>
  );
}

function Channel({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span className="gamekits-devtools-performance-pin__channel">
      <span aria-hidden="true">{checked ? "✓" : ""}</span>
      {label}
    </span>
  );
}

function FrameGraph({
  frames,
  maxFrameTime
}: {
  frames: DevToolsSnapshot["profilerFrames"];
  maxFrameTime: number;
}) {
  const graphFrames = frames.length > 0 ? frames : [undefined];
  return (
    <div className="gamekits-devtools-performance-pin__graph" aria-label="frame history">
      {graphFrames.map((frame, index) => {
        const height = calculateFrameBarHeight(frame?.deltaMs, graphFrames, maxFrameTime);
        const className = [
          frame?.overBudgetCount ? "is-warning" : undefined,
          index === graphFrames.length - 1 ? "is-latest" : undefined
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <span
            className={className || undefined}
            key={frame?.id ?? `empty-${index}`}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "--" : value.toFixed(value >= 10 ? 0 : 1);
}

function readPerformanceStatus(
  snapshot: DevToolsSnapshot,
  warningCount: number
): "ok" | "warning" | "critical" {
  if (snapshot.profiler.some((sample) => sample.critical)) {
    return "critical";
  }
  if (warningCount > 0 || snapshot.profilerFrames.at(-1)?.overBudgetCount) {
    return "warning";
  }
  return "ok";
}
