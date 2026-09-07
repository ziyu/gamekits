import type { PlatformRuntime, PlatformRuntimeId } from "@gamekits/platform-core";
import { createMemoryFileSystem } from "./memory-file-system";
import { createMemoryStorage } from "./memory-storage";
import { createWebPlatform } from "./create-web-platform";
import type { WebPlatformOptions } from "./types";

export type MemoryPlatformOptions = Omit<WebPlatformOptions, "fs" | "storage"> & {
  id?: PlatformRuntimeId | undefined;
};

/**
 * Creates an explicitly memory-backed PlatformRuntime for deterministic,
 * headless, and SSR composition tests without consulting browser storage.
 */
export function createMemoryPlatform(options: MemoryPlatformOptions = {}): PlatformRuntime {
  const runtime = createWebPlatform({
    ...(options.appName === undefined ? {} : { appName: options.appName }),
    ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
    fs: createMemoryFileSystem(),
    storage: createMemoryStorage()
  });

  return {
    ...runtime,
    id: options.id ?? "memory"
  };
}
