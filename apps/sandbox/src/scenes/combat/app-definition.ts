import { defineGameApp } from "@gamekits/app-host";

export const combatRangeAppDefinition = defineGameApp({
  id: "sandbox.combat-range",
  configSources: [
    {
      id: "sandbox.combat-range.defaults",
      priority: 0,
      values: {
        platform: { profile: "web" },
        physics: { fixedDeltaMs: 1000 / 60, maxSubSteps: 4 }
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
