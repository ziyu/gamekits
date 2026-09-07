import type { PlatformPath } from "@gamekits/platform-core";

export function createWebPath(): PlatformPath {
  return {
    join(...parts) {
      return normalize(parts.filter(Boolean).join("/"));
    },
    dirname(path) {
      const normalized = normalize(path);
      const index = normalized.lastIndexOf("/");
      return index <= 0 ? "" : normalized.slice(0, index);
    },
    basename(path) {
      const normalized = normalize(path);
      const index = normalized.lastIndexOf("/");
      return index < 0 ? normalized : normalized.slice(index + 1);
    },
    normalize
  };
}

function normalize(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return `${absolute ? "/" : ""}${parts.join("/")}`;
}
