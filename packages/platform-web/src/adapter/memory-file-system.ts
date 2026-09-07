import type { FsOptions, PlatformDirEntry, PlatformFileSystem } from "@gamekits/platform-core";
import { createWebPath } from "./path";

type FileEntry = {
  kind: "file";
  data: Uint8Array;
};

type DirectoryEntry = {
  kind: "directory";
};

type Entry = FileEntry | DirectoryEntry;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function createMemoryFileSystem(): PlatformFileSystem {
  const path = createWebPath();
  const entries = new Map<string, Entry>();

  const keyFor = (targetPath: string, options?: FsOptions): string => {
    return path.join(options?.baseDir ?? "appData", targetPath);
  };

  const ensureParentDirectory = (key: string): void => {
    const dirname = path.dirname(key);
    if (dirname && !entries.has(dirname)) {
      entries.set(dirname, { kind: "directory" });
    }
  };

  return {
    async readText(targetPath, options) {
      return textDecoder.decode(await this.readBinary(targetPath, options));
    },
    async writeText(targetPath, content, options) {
      await this.writeBinary(targetPath, textEncoder.encode(content), options);
    },
    async readBinary(targetPath, options) {
      const entry = entries.get(keyFor(targetPath, options));
      if (!entry || entry.kind !== "file") {
        throw new Error(`Missing file: ${targetPath}`);
      }

      return new Uint8Array(entry.data);
    },
    async writeBinary(targetPath, data, options) {
      const key = keyFor(targetPath, options);
      ensureParentDirectory(key);
      entries.set(key, { kind: "file", data: new Uint8Array(data) });
    },
    async replaceFile(source, target, options) {
      const sourceKey = keyFor(source, options);
      const entry = entries.get(sourceKey);
      if (!entry || entry.kind !== "file") throw new Error(`Missing file: ${source}`);
      entries.set(keyFor(target, options), entry);
      if (sourceKey !== keyFor(target, options)) entries.delete(sourceKey);
    },
    async remove(targetPath, options) {
      entries.delete(keyFor(targetPath, options));
    },
    async exists(targetPath, options) {
      return entries.has(keyFor(targetPath, options));
    },
    async createDir(targetPath, options) {
      const key = keyFor(targetPath, options);
      if (options?.recursive) {
        const parts = key.split("/");
        for (let i = 1; i <= parts.length; i += 1) {
          entries.set(parts.slice(0, i).join("/"), { kind: "directory" });
        }
        return;
      }

      ensureParentDirectory(key);
      entries.set(key, { kind: "directory" });
    },
    async listDir(targetPath, options) {
      const root = keyFor(targetPath, options);
      const prefix = root ? `${root}/` : "";
      const results: PlatformDirEntry[] = [];

      for (const [key, entry] of entries) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const rest = key.slice(prefix.length);
        if (!rest || rest.includes("/")) {
          continue;
        }
        results.push({
          name: path.basename(key),
          path: key,
          isFile: entry.kind === "file",
          isDirectory: entry.kind === "directory"
        });
      }

      return results.sort((a, b) => a.name.localeCompare(b.name));
    }
  };
}
