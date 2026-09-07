export const TAURI_GAME_CAPABILITIES = {
  identifier: "gamekits-game-runtime",
  description: "Minimum filesystem and platform access for a GameKits runtime build.",
  permissions: [
    "fs:allow-read-resource",
    "fs:allow-app-read",
    "fs:allow-app-write",
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-write-text",
    "shell:allow-open"
  ],
  windows: ["main"]
} as const;

export const TAURI_EDITOR_EXTRA_CAPABILITIES = {
  identifier: "gamekits-editor-extra",
  description: "Additional file dialog access for DataPack import/export workflows.",
  permissions: ["dialog:allow-open", "dialog:allow-save"],
  windows: ["main"]
} as const;
