import { defineGameApp } from "@gamekits/app-host";

export const navigationLabAppDefinition = defineGameApp({
  id: "sandbox.navigation-lab",
  configSources: [
    {
      id: "sandbox.navigation-lab.defaults",
      priority: 0,
      values: {
        platform: { profile: "web" },
        navigation: { requestsPerTick: 2 }
      }
    }
  ],
  services: [
    { id: "platform" },
    { id: "data" },
    { id: "ui" },
    { id: "game", dependencies: ["data", "ui"] },
    { id: "devtools", dependencies: ["data", "ui", "game"] }
  ]
});
