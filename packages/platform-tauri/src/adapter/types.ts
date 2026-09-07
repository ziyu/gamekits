import type { FsBaseDir } from "@gamekits/platform-core";

export type TauriFsDriver = {
  BaseDirectory: Record<string, unknown>;
  readTextFile(path: string, options?: unknown): Promise<string>;
  writeTextFile(path: string, data: string, options?: unknown): Promise<void>;
  readFile(path: string, options?: unknown): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, options?: unknown): Promise<void>;
  exists(path: string, options?: unknown): Promise<boolean>;
  mkdir(path: string, options?: unknown): Promise<void>;
  rename?(oldPath: string, newPath: string, options?: unknown): Promise<void>;
  remove?(path: string, options?: unknown): Promise<void>;
  readDir(path: string, options?: unknown): Promise<Array<TauriDirEntry>>;
};

export type TauriDirEntry = {
  name: string;
  isFile?: boolean;
  isDirectory?: boolean;
};

export type TauriDialogDriver = {
  open(options?: unknown): Promise<string | string[] | null>;
  save(options?: unknown): Promise<string | null>;
  message(message: string, options?: unknown): Promise<void>;
};

export type TauriClipboardDriver = {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  clear(): Promise<void>;
};

export type TauriShellDriver = {
  open(target: string): Promise<void>;
};

export type TauriWindowDriver = {
  getSize(): Promise<{ width: number; height: number }>;
  setSize(size: { width: number; height: number }): Promise<void>;
  setTitle(title: string): Promise<void>;
};

export type TauriAppDriver = {
  getName(): Promise<string>;
  getVersion(): Promise<string>;
};

export type TauriPlatformDrivers = {
  fs: TauriFsDriver;
  dialog: TauriDialogDriver;
  clipboard: TauriClipboardDriver;
  shell: TauriShellDriver;
  window: TauriWindowDriver;
  app: TauriAppDriver;
};

export type TauriPlatformOptions = {
  drivers?: TauriPlatformDrivers;
};

export type TauriBaseDirectoryMap = Record<FsBaseDir, unknown>;
