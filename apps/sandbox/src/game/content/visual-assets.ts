import type { DataPackEntry } from "@gamekits/data";

export const sandboxVisualAssetEntries: DataPackEntry[] = [
  {
    type: "asset.definition",
    id: "asset.sandbox.entity_square",
    data: {
      id: "asset.sandbox.entity_square",
      type: "image",
      source: {
        type: "url",
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='2' y='2' width='28' height='28' rx='4' fill='white'/%3E%3C/svg%3E"
      },
      group: "sandbox.preload",
      tags: ["preload", "sandbox", "tintable"]
    }
  },
  {
    type: "asset.definition",
    id: "asset.sandbox.status_ring",
    data: {
      id: "asset.sandbox.status_ring",
      type: "image",
      source: {
        type: "url",
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='24' fill='none' stroke='white' stroke-width='7'/%3E%3C/svg%3E"
      },
      group: "sandbox.preload",
      tags: ["preload", "sandbox", "tintable", "ring"]
    }
  }
];
