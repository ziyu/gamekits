import { defineGameApp } from "@gamekits/app-host";
import { ABYSS_VIEWPORT } from "./game";

export const abyssAppDefinition = defineGameApp({
  id: "abyss-delve",
  configSources: [
    {
      id: "abyss.defaults",
      priority: 0,
      values: {
        renderer: ABYSS_VIEWPORT,
        drivers: ABYSS_VIEWPORT,
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
      id: "drivers",
      config: {
        debug: false,
        width: ABYSS_VIEWPORT.width,
        height: ABYSS_VIEWPORT.height
      }
    },
    {
      id: "renderer",
      config: {
        debug: false,
        width: ABYSS_VIEWPORT.width,
        height: ABYSS_VIEWPORT.height
      },
      dependencies: ["drivers"]
    },
    { id: "assets", dependencies: ["data", "drivers", "renderer"] },
    { id: "input", dependencies: ["renderer"] },
    { id: "ui", dependencies: ["input"] },
    { id: "game", dependencies: ["data", "renderer", "input", "ui"] },
    { id: "save", dependencies: ["data", "game"] },
    { id: "devtools", dependencies: ["data", "renderer", "input", "ui", "game", "save"] }
  ]
});
