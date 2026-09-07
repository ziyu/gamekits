import { defineGameApp } from "@gamekits/app-host";

export const outpostAppDefinition = defineGameApp({
  id: "multiplayer-outpost-siege-demo",
  configSources: [
    {
      id: "outpost.defaults",
      priority: 0,
      values: {
        drivers: { width: 1280, height: 720, debug: false },
        renderer: { width: 1280, height: 720, debug: false },
        assets: { preloadGroups: ["boot", "match", "combat"] },
        platform: { profile: "browser-web" }
      }
    }
  ],
  services: [
    { id: "platform" },
    { id: "drivers", dependencies: ["platform"] },
    { id: "data" },
    { id: "renderer", dependencies: ["drivers"] },
    { id: "assets", dependencies: ["data", "drivers", "renderer"] },
    { id: "audio", dependencies: ["assets", "drivers"] },
    { id: "input", dependencies: ["renderer"] },
    { id: "multiplayer", dependencies: ["platform"] },
    { id: "ui", dependencies: ["input"] },
    {
      id: "game",
      dependencies: ["data", "assets", "audio", "renderer", "input", "multiplayer", "ui"]
    },
    { id: "save", dependencies: ["data", "game"] },
    {
      id: "devtools",
      dependencies: ["data", "assets", "audio", "renderer", "input", "multiplayer", "game", "save"]
    }
  ]
});
