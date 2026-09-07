import { defineGameApp } from "@gamekits/app-host";

export const ANIMATOR_LAB_RENDER_SIZE = Object.freeze({ width: 720, height: 400 });

export const animatorLabAppDefinition = defineGameApp({
  id: "sandbox.animator-lab",
  configSources: [
    {
      id: "sandbox.animator-lab.defaults",
      priority: 0,
      values: {
        renderer: { ...ANIMATOR_LAB_RENDER_SIZE, debug: true },
        assets: { preloadGroups: ["sandbox.animator-lab"] },
        platform: { profile: "web" }
      }
    }
  ],
  services: [
    { id: "data" },
    {
      id: "drivers",
      config: { ...ANIMATOR_LAB_RENDER_SIZE, debug: true }
    },
    {
      id: "renderer",
      config: { ...ANIMATOR_LAB_RENDER_SIZE, debug: true },
      dependencies: ["drivers"]
    },
    {
      id: "assets",
      config: { preloadGroups: ["sandbox.animator-lab"] },
      dependencies: ["data", "drivers", "renderer"]
    },
    { id: "ui", dependencies: ["renderer"] },
    { id: "game", dependencies: ["data", "assets", "renderer", "ui"] },
    {
      id: "devtools",
      dependencies: ["data", "assets", "renderer", "ui", "game"]
    }
  ]
});
