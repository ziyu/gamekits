import {
  createPlatformCapabilityRegistry,
  createPlatformServices,
  createPlatformUnsupportedError,
  PlatformAppServiceKey,
  PlatformClipboardServiceKey,
  PlatformDialogServiceKey,
  PlatformFileSystemServiceKey,
  PlatformPathServiceKey,
  PlatformPermissionsServiceKey,
  PlatformShellServiceKey,
  PlatformStorageServiceKey,
  PlatformWindowServiceKey,
  type PlatformCapabilityId,
  type PlatformRuntime,
  type PlatformStorage
} from "@gamekits/platform-core";
import { createMemoryFileSystem } from "./memory-file-system";
import { adaptStorageLike, createMemoryStorage } from "./memory-storage";
import { createWebPath } from "./path";
import type { StorageLike, WebPlatformOptions } from "./types";

export function createWebPlatform(options: WebPlatformOptions = {}): PlatformRuntime {
  const id = "web";
  const fs = options.fs ?? createMemoryFileSystem();
  const path = createWebPath();
  const storage = resolveStorage(options.storage);
  const capabilities = createPlatformCapabilityRegistry({
    queryPermission: (capability) => Promise.resolve(webPermissionState(capability)),
    descriptors: [
      { id: "storage", service: "platform.storage" },
      { id: "fs.read", service: "platform.fs", description: "Memory-backed file reads" },
      { id: "fs.write", service: "platform.fs", description: "Memory-backed file writes" },
      { id: "window", service: "platform.window" },
      { id: "dialog.message", service: "platform.dialog" },
      { id: "clipboard", service: "platform.clipboard" },
      { id: "shell.open", service: "platform.shell" }
    ]
  });
  const windowService = {
    async getSize() {
      return {
        width: typeof window === "undefined" ? 0 : window.innerWidth,
        height: typeof window === "undefined" ? 0 : window.innerHeight
      };
    },
    async setSize() {
      throw createPlatformUnsupportedError(id, "window", { operation: "setSize" });
    },
    async setTitle(title: string) {
      if (typeof document === "undefined") {
        throw createPlatformUnsupportedError(id, "window", { operation: "setTitle" });
      }
      document.title = title;
    }
  };
  const dialog = {
    async open() {
      throw createPlatformUnsupportedError(id, "dialog.open");
    },
    async save() {
      throw createPlatformUnsupportedError(id, "dialog.save");
    },
    async message(options: { message: string }) {
      if (typeof window !== "undefined" && typeof window.alert === "function") {
        window.alert(options.message);
        return;
      }
      throw createPlatformUnsupportedError(id, "dialog.message");
    }
  };
  const clipboard = {
    async readText() {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        return navigator.clipboard.readText();
      }
      throw createPlatformUnsupportedError(id, "clipboard", { operation: "readText" });
    },
    async writeText(text: string) {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        return;
      }
      throw createPlatformUnsupportedError(id, "clipboard", { operation: "writeText" });
    },
    async clear() {
      await clipboard.writeText("");
    }
  };
  const shell = {
    async open(target: string) {
      if (typeof window !== "undefined" && typeof window.open === "function") {
        window.open(target, "_blank", "noopener,noreferrer");
        return;
      }
      throw createPlatformUnsupportedError(id, "shell.open", { target });
    }
  };
  const permissions = {
    async query(capability: PlatformCapabilityId) {
      return webPermissionState(capability);
    }
  };
  const app = {
    async name() {
      return options.appName ?? "GameKits Web App";
    },
    async version() {
      return options.appVersion;
    }
  };
  const services = createPlatformServices(id, {
    fs,
    path,
    storage,
    window: windowService,
    dialog,
    clipboard,
    shell,
    permissions,
    app
  });
  const runtime: PlatformRuntime = {
    id,
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

function resolveStorage(storage: WebPlatformOptions["storage"]): PlatformStorage {
  if (storage && "getItem" in storage && storage.getItem.constructor.name === "AsyncFunction") {
    return storage as PlatformStorage;
  }
  if (storage) {
    return adaptStorageLike(storage as StorageLike);
  }
  if (typeof localStorage !== "undefined") {
    return adaptStorageLike(localStorage);
  }
  return createMemoryStorage();
}

function webPermissionState(capability: PlatformCapabilityId) {
  if (capability === "storage" || capability === "fs.read" || capability === "fs.write") {
    return "granted";
  }
  if (capability === "window" || capability === "dialog.message" || capability === "shell.open") {
    return typeof window === "undefined" ? "unsupported" : "granted";
  }
  if (capability === "clipboard") {
    return typeof navigator !== "undefined" && navigator.clipboard ? "prompt" : "unsupported";
  }
  return "unsupported";
}
