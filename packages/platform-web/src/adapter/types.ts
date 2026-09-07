import type { PlatformFileSystem, PlatformStorage } from "@gamekits/platform-core";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};

export type WebPlatformOptions = {
  appName?: string;
  appVersion?: string;
  fs?: PlatformFileSystem;
  storage?: PlatformStorage | StorageLike;
};
