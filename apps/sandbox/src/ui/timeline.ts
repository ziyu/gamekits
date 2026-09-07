import { createGameKitsUiAnimator } from "@gamekits/react-ui";
import type { SandboxRuntime } from "../game";
import { upper } from "./format";
import type { SandboxUiHandles, SandboxWorkbenchState } from "./types";

const timelineAnimator = createGameKitsUiAnimator({ duration: 0.24 });

export function renderTimeline(
  handles: SandboxUiHandles,
  sandbox: SandboxRuntime,
  state: SandboxWorkbenchState
): void {
  const selectionCleared = state.selectionCleared === true;
  const snapshot = sandbox.snapshot({
    selectedActorId: selectionCleared ? undefined : state.selectedActorId,
    selectedEntityId: selectionCleared ? undefined : state.selectedEntityId,
    defaultSelection: !selectionCleared
  });
  const entries =
    state.timelineFilter === "all"
      ? snapshot.timeline
      : snapshot.timeline.filter((entry) => entry.kind === state.timelineFilter);

  for (const filter of handles.timelineFilters) {
    filter.classList.toggle("is-active", filter.dataset.timelineFilter === state.timelineFilter);
  }

  const visibleEntries = entries.slice().reverse().slice(0, 18);
  handles.timelineList.replaceChildren(...visibleEntries.map(createTimelineEntryElement));

  const latestEntry = visibleEntries[0];
  if (!latestEntry || latestEntry.id === handles.lastAnimatedTimelineEntryId) {
    return;
  }

  handles.lastAnimatedTimelineEntryId = latestEntry.id;
  const latestElement = [
    ...handles.timelineList.querySelectorAll<HTMLElement>("[data-timeline-entry]")
  ].find((element) => element.dataset.timelineEntry === latestEntry.id);
  if (latestElement) {
    timelineAnimator.emphasize(latestElement);
  }
}

function formatTime(time: number): string {
  return `${Math.round(time)}ms`;
}

function createTimelineEntryElement(
  entry: ReturnType<SandboxRuntime["snapshot"]>["timeline"][number]
): HTMLElement {
  const item = document.createElement("li");
  item.className = `timeline-entry timeline-entry--${entry.kind}`;
  item.dataset.timelineEntry = entry.id;

  const meta = document.createElement("span");
  meta.className = "timeline-entry__meta";
  meta.textContent = `${upper(entry.kind)} · ${formatTime(entry.time)}`;

  const label = document.createElement("strong");
  label.className = "timeline-entry__label";
  label.textContent = entry.label;

  const source = document.createElement("code");
  source.textContent = entry.source;

  const status = document.createElement("span");
  status.className = "timeline-entry__status";
  status.textContent = `${entry.status ?? "observed"}${entry.actorId ? ` · ${entry.actorId}` : ""}`;

  item.append(meta, label, source, status);
  return item;
}
