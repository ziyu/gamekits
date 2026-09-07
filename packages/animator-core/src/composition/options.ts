import type { DataRegistry } from "@gamekits/data";
import type { EventBus } from "@gamekits/event-bus";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type { AnimatorHandle, AnimatorRuntime } from "../controller/animator-controller";
import type { AnimatorMarkerEvent } from "../marker/marker-event";
import type { AnimatorTraceEntry } from "../observability/animator-trace";
import type { AnimationPlaybackAdapter } from "../playback/animation-playback-adapter";

export type CreateAnimatorRuntimeOptions = {
  id?: string | undefined;
  dataRegistry: DataRegistry;
  adapter: AnimationPlaybackAdapter;
  eventBus?: EventBus | undefined;
  maxControllers?: number | undefined;
  maxQueuedOneShotsPerController?: number | undefined;
  markerHistoryLimit?: number | undefined;
  maxMarkerEventsPerControllerUpdate?: number | undefined;
  traceLimit?: number | undefined;
  onMarker?: ((marker: AnimatorMarkerEvent) => void) | undefined;
  onMarkerError?: ((error: unknown, marker: AnimatorMarkerEvent) => void) | undefined;
  onTrace?: ((entry: AnimatorTraceEntry) => void) | undefined;
  onTraceError?: ((error: unknown, entry: AnimatorTraceEntry) => void) | undefined;
};

export type CreateAnimatorModuleOptions = CreateAnimatorRuntimeOptions & {
  handle?: AnimatorHandle | undefined;
  onRuntime?: ((runtime: AnimatorRuntime, context: GameInstallContext) => void) | undefined;
};
