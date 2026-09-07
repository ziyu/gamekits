import { defineGameApp } from "@gamekits/app-host";
import { SANDBOX_ASSET_GROUP, SANDBOX_RENDER_SIZE } from "./game";

export const sandboxAppDefinition = defineGameApp({
  id: "sandbox",
  configSources: [
    {
      id: "sandbox.defaults",
      priority: 0,
      values: {
        renderer: SANDBOX_RENDER_SIZE,
        assets: {
          preloadGroups: [SANDBOX_ASSET_GROUP]
        },
        platform: {
          profile: "web"
        }
      }
    }
  ],
  services: [
    { id: "platform" },
    { id: "data" },
    {
      id: "renderer",
      config: {
        debug: true,
        width: SANDBOX_RENDER_SIZE.width,
        height: SANDBOX_RENDER_SIZE.height
      },
      dependencies: ["drivers"]
    },
    {
      id: "drivers",
      config: {
        debug: true,
        width: SANDBOX_RENDER_SIZE.width,
        height: SANDBOX_RENDER_SIZE.height
      }
    },
    {
      id: "assets",
      config: {
        preloadGroups: [SANDBOX_ASSET_GROUP]
      },
      dependencies: ["data", "drivers", "renderer"]
    },
    {
      id: "input",
      dependencies: ["renderer"]
    },
    {
      id: "ui",
      dependencies: ["input"]
    },
    {
      id: "game",
      dependencies: ["data", "assets", "renderer", "input", "ui"]
    },
    {
      id: "save",
      dependencies: ["data", "assets", "game"]
    },
    {
      id: "devtools",
      dependencies: ["data", "assets", "renderer", "input", "ui", "game", "save"]
    }
  ]
});
