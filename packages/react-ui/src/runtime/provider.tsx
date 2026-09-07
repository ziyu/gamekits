import { createContext, useContext, useSyncExternalStore } from "react";
import type { UiRuntime, UiRuntimeSnapshot } from "@gamekits/ui-core";
import type { UiRuntimeProviderProps, UiRuntimeSelector } from "./types";

const UiRuntimeContext = createContext<UiRuntime | undefined>(undefined);

export function UiRuntimeProvider({ runtime, children }: UiRuntimeProviderProps) {
  return <UiRuntimeContext.Provider value={runtime}>{children}</UiRuntimeContext.Provider>;
}

export function useUiRuntime(): UiRuntime {
  const runtime = useContext(UiRuntimeContext);
  if (!runtime) {
    throw new Error("Missing UiRuntimeProvider");
  }
  return runtime;
}

export function useUiSnapshot(): UiRuntimeSnapshot {
  const runtime = useUiRuntime();
  return useSyncExternalStore(runtime.subscribe, runtime.snapshot, runtime.snapshot);
}

export function useUiSelector<TValue>(selector: UiRuntimeSelector<TValue>): TValue {
  return selector(useUiSnapshot());
}
