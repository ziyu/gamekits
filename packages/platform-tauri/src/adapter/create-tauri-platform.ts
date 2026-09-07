import {
  createPlatformCapabilityRegistry,
  createPlatformServices,
  PlatformAppServiceKey,
  PlatformClipboardServiceKey,
  PlatformDialogServiceKey,
  PlatformFileSystemServiceKey,
  PlatformPathServiceKey,
  PlatformPermissionsServiceKey,
  PlatformShellServiceKey,
  PlatformStorageServiceKey,
  PlatformWindowServiceKey,
  type FsOptions,
  type PlatformCapabilityId,
  type PlatformRuntime
} from "@gamekits/platform-core";
import { createDefaultTauriDrivers } from "./drivers";
import { createBaseDirectoryMap, toTauriFsOptions } from "./base-dir";
import type { TauriPlatformDrivers, TauriPlatformOptions } from "./types";

export async function createTauriPlatform(
  options: TauriPlatformOptions = {}
): Promise<PlatformRuntime> {
  const drivers = options.drivers ?? (await createDefaultTauriDrivers());
  return createTauriPlatformFromDrivers(drivers);
}

export function createTauriPlatformFromDrivers(drivers: TauriPlatformDrivers): PlatformRuntime {
  const baseDirectoryMap = createBaseDirectoryMap(drivers.fs);
  const capabilities = createPlatformCapabilityRegistry({
    queryPermission: (capability) => Promise.resolve(tauriPermissionState(capability)),
    descriptors: [
      { id: "fs.read", service: "platform.fs" },
      { id: "fs.write", service: "platform.fs" },
      { id: "storage", service: "platform.storage" },
      { id: "window", service: "platform.window" },
      { id: "dialog.open", service: "platform.dialog" },
      { id: "dialog.save", service: "platform.dialog" },
      { id: "dialog.message", service: "platform.dialog" },
      { id: "clipboard", service: "platform.clipboard" },
      { id: "shell.open", service: "platform.shell" }
    ]
  });

  const fsOptions = (options?: FsOptions) =>
    toTauriFsOptions(baseDirectoryMap, options?.baseDir, options?.recursive);

  const services = createPlatformServices("tauri", {
    fs: {
      readText(path, options) {
        return drivers.fs.readTextFile(path, fsOptions(options));
      },
      writeText(path, content, options) {
        return drivers.fs.writeTextFile(path, content, fsOptions(options));
      },
      readBinary(path, options) {
        return drivers.fs.readFile(path, fsOptions(options));
      },
      writeBinary(path, data, options) {
        return drivers.fs.writeFile(path, data, fsOptions(options));
      },
      ...(drivers.fs.remove
        ? {
            remove: (path: string, options?: FsOptions) =>
              drivers.fs.remove!(path, fsOptions(options))
          }
        : {}),
      ...(drivers.fs.rename
        ? {
            replaceFile: (source: string, target: string, options?: FsOptions) =>
              drivers.fs.rename!(
                source,
                target,
                options?.baseDir
                  ? {
                      oldPathBaseDir: baseDirectoryMap[options.baseDir],
                      newPathBaseDir: baseDirectoryMap[options.baseDir]
                    }
                  : {}
              )
          }
        : {}),
      exists(path, options) {
        return drivers.fs.exists(path, fsOptions(options));
      },
      createDir(path, options) {
        return drivers.fs.mkdir(path, fsOptions(options));
      },
      async listDir(path, options) {
        const entries = await drivers.fs.readDir(path, fsOptions(options));
        return entries.map((entry) => ({
          name: entry.name,
          path: entry.name,
          isFile: entry.isFile ?? false,
          isDirectory: entry.isDirectory ?? false
        }));
      }
    },
    path: {
      join(...parts) {
        return parts.filter(Boolean).join("/").replaceAll(/\/+/g, "/");
      },
      dirname(path) {
        const normalized = path.replaceAll(/\/+/g, "/");
        const index = normalized.lastIndexOf("/");
        return index <= 0 ? "" : normalized.slice(0, index);
      },
      basename(path) {
        const normalized = path.replaceAll(/\/+/g, "/");
        const index = normalized.lastIndexOf("/");
        return index < 0 ? normalized : normalized.slice(index + 1);
      },
      normalize(path) {
        return path.replaceAll(/\/+/g, "/");
      }
    },
    storage: {
      getItem(path) {
        return drivers.fs
          .readTextFile(path, fsOptions({ baseDir: "appConfig" }))
          .catch(() => undefined);
      },
      setItem(path, value) {
        return drivers.fs.writeTextFile(path, value, fsOptions({ baseDir: "appConfig" }));
      },
      async removeItem(path) {
        if (drivers.fs.remove) {
          await drivers.fs.remove(path, fsOptions({ baseDir: "appConfig" }));
          return;
        }
        await drivers.fs.writeTextFile(path, "", fsOptions({ baseDir: "appConfig" }));
      },
      async clear() {
        // Tauri storage is path-oriented; GameKits clears concrete keys through removeItem.
      }
    },
    window: {
      getSize: drivers.window.getSize,
      setSize: drivers.window.setSize,
      setTitle: drivers.window.setTitle
    },
    dialog: {
      async open(options) {
        const result = await drivers.dialog.open(options);
        return result ?? undefined;
      },
      async save(options) {
        return (await drivers.dialog.save(options)) ?? undefined;
      },
      async message(options) {
        await drivers.dialog.message(options.message, {
          title: options.title,
          kind: options.kind
        });
      }
    },
    clipboard: {
      readText: drivers.clipboard.readText,
      writeText: drivers.clipboard.writeText,
      clear: drivers.clipboard.clear
    },
    shell: {
      open: drivers.shell.open
    },
    permissions: {
      async query(capability) {
        return tauriPermissionState(capability);
      }
    },
    app: {
      name: drivers.app.getName,
      version: drivers.app.getVersion
    }
  });
  const runtime: PlatformRuntime = {
    id: "tauri",
    services,
    capabilities
  };

  runtime.services.register(PlatformFileSystemServiceKey, runtime.services.fs);
  runtime.services.register(PlatformPathServiceKey, runtime.services.path);
  runtime.services.register(PlatformStorageServiceKey, runtime.services.storage);
  runtime.services.register(PlatformWindowServiceKey, runtime.services.window);
  runtime.services.register(PlatformDialogServiceKey, runtime.services.dialog);
  runtime.services.register(PlatformClipboardServiceKey, runtime.services.clipboard);
  runtime.services.register(PlatformShellServiceKey, runtime.services.shell);
  runtime.services.register(PlatformPermissionsServiceKey, runtime.services.permissions);
  runtime.services.register(PlatformAppServiceKey, runtime.services.app);

  return runtime;
}

function tauriPermissionState(capability: PlatformCapabilityId) {
  if (capability === "fs.read" || capability === "fs.write") {
    return "granted";
  }
  if (
    capability === "storage" ||
    capability === "window" ||
    capability === "dialog.open" ||
    capability === "dialog.save" ||
    capability === "dialog.message" ||
    capability === "clipboard" ||
    capability === "shell.open"
  ) {
    return "granted";
  }

  return "unsupported";
}
