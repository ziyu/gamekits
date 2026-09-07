import { defineGameApp } from "@gamekits/app-host";

export const aiLabAppDefinition = defineGameApp({
  id: "sandbox.ai-lab",
  configSources: [
    {
      id: "sandbox.ai-lab.defaults",
      priority: 0,
      values: {
        platform: { profile: "web" },
        ai: { maxDecisionsPerTick: 5, maxSensorSamplesPerTick: 6 }
      }
    }
  ],
  services: [
    { id: "data" },
    { id: "ui" },
    { id: "game", dependencies: ["data", "ui"] },
    { id: "devtools", dependencies: ["data", "ui", "game"] }
  ]
});
