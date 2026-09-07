import { definePlatformConformanceTests } from "@gamekits/test-utils";
import { describe, expect, it } from "vitest";
import {
  TAURI_EDITOR_EXTRA_CAPABILITIES,
  TAURI_GAME_CAPABILITIES,
  createTauriPlatformFromDrivers,
  type TauriPlatformDrivers
} from "../src";

definePlatformConformanceTests("Tauri", () => createTauriPlatformFromDrivers(createFakeDrivers()));

describe("createTauriPlatformFromDrivers", () => {
  it("maps dialog, clipboard, shell, window, and app drivers", async () => {
    const drivers = createFakeDrivers();
    const platform = createTauriPlatformFromDrivers(drivers);

    await platform.services.clipboard.writeText("hello");
    await expect(platform.services.clipboard.readText()).resolves.toBe("hello");
    await platform.services.dialog.message({ message: "saved" });
    await expect(platform.services.dialog.open()).resolves.toBe("picked.txt");
    await expect(platform.services.dialog.save()).resolves.toBe("saved.txt");
    await platform.services.shell.open("https://example.com");
    await platform.services.window.setTitle("GameKits");
    await platform.services.window.setSize({ width: 800, height: 600 });

    expect(driversLog(drivers)).toContain("shell:https://example.com");
    await expect(platform.services.app.name()).resolves.toBe("Tauri Test App");
    await expect(platform.services.window.getSize()).resolves.toEqual({ width: 800, height: 600 });
  });

  it("exports minimum Tauri capability templates", () => {
    expect(TAURI_GAME_CAPABILITIES.permissions).toContain("fs:allow-app-read");
    expect(TAURI_EDITOR_EXTRA_CAPABILITIES.permissions).toContain("dialog:allow-open");
  });

  it("exposes standard capability descriptors", () => {
    const platform = createTauriPlatformFromDrivers(createFakeDrivers());

    expect(platform.capabilities.describe("dialog.open")).toMatchObject({
      service: "platform.dialog"
    });
    expect(platform.capabilities.list().map((capability) => capability.id)).toContain("shell.open");
  });
});

function createFakeDrivers(): TauriPlatformDrivers {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>();
  const log: string[] = [];
  let clipboard = "";
  let size = { width: 320, height: 240 };

  const keyFor = (path: string, options?: any) => `${String(options?.baseDir ?? "none")}:${path}`;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return {
    fs: {
      BaseDirectory: {
        AppData: "appData",
        AppConfig: "appConfig",
        AppCache: "appCache",
        Document: "document",
        Download: "download",
        Resource: "resource",
        Temp: "temp"
      },
      async readTextFile(path, options) {
        const data = files.get(keyFor(path, options));
        if (!data) {
          throw new Error(`Missing file: ${path}`);
        }
        return decoder.decode(data);
      },
      async writeTextFile(path, data, options) {
        files.set(keyFor(path, options), encoder.encode(data));
      },
      async readFile(path, options) {
        const data = files.get(keyFor(path, options));
        if (!data) {
          throw new Error(`Missing file: ${path}`);
        }
        return data;
      },
      async writeFile(path, data, options) {
        files.set(keyFor(path, options), data);
      },
      async exists(path, options) {
        const key = keyFor(path, options);
        return files.has(key) || directories.has(key);
      },
      async mkdir(path, options) {
        directories.add(keyFor(path, options));
      },
      async rename(source, target, options) {
        const dirs = options as { oldPathBaseDir: unknown; newPathBaseDir: unknown };
        const sourceKey = keyFor(source, { baseDir: dirs.oldPathBaseDir });
        const data = files.get(sourceKey);
        if (!data) throw new Error("Missing source");
        files.set(keyFor(target, { baseDir: dirs.newPathBaseDir }), data);
        files.delete(sourceKey);
      },
      async remove(path, options) {
        files.delete(keyFor(path, options));
      },
      async readDir(path, options) {
        const prefix = `${keyFor(path, options)}/`;
        return [...files.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({
            name: key.slice(prefix.length),
            isFile: true,
            isDirectory: false
          }));
      }
    },
    dialog: {
      async open() {
        return "picked.txt";
      },
      async save() {
        return "saved.txt";
      },
      async message(options) {
        log.push(`dialog:${String(options)}`);
      }
    },
    clipboard: {
      async readText() {
        return clipboard;
      },
      async writeText(text) {
        clipboard = text;
      },
      async clear() {
        clipboard = "";
      }
    },
    shell: {
      async open(target) {
        log.push(`shell:${target}`);
      }
    },
    window: {
      async getSize() {
        return size;
      },
      async setSize(nextSize) {
        size = nextSize;
      },
      async setTitle(title) {
        log.push(`title:${title}`);
      }
    },
    app: {
      async getName() {
        return "Tauri Test App";
      },
      async getVersion() {
        return "0.0.0";
      }
    },
    _log: log
  } as TauriPlatformDrivers;
}

function driversLog(drivers: TauriPlatformDrivers): string[] {
  return (drivers as TauriPlatformDrivers & { _log: string[] })._log;
}

it("maps both rename base directories without changing absolute-path semantics", async () => {
  const drivers = createFakeDrivers();
  const calls: unknown[] = [];
  drivers.fs.rename = async (source, target, options) => {
    calls.push({ source, target, options });
  };
  const {
    services: { fs }
  } = createTauriPlatformFromDrivers(drivers);
  await fs.replaceFile!("slot.tmp", "slot", { baseDir: "appData" });
  await fs.replaceFile!("/tmp/slot.tmp", "/tmp/slot");
  expect(calls).toEqual([
    {
      source: "slot.tmp",
      target: "slot",
      options: { oldPathBaseDir: "appData", newPathBaseDir: "appData" }
    },
    { source: "/tmp/slot.tmp", target: "/tmp/slot", options: {} }
  ]);
});
