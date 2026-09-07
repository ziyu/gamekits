import { defineGameApp } from "@gamekits/app-host";

export const CHARACTER_CONTROLLER_LAB_DRIVER_ID = "sandbox.character-controller-lab.three";

export const CHARACTER_CONTROLLER_LAB_RENDER_SIZE = Object.freeze({
  width: 1180,
  height: 760
});

export const characterControllerLabAppDefinition = defineGameApp({
  id: "sandbox.character-controller-lab",
  configSources: [
    {
      id: "sandbox.character-controller-lab.defaults",
      priority: 0,
      values: {
        renderer: { ...CHARACTER_CONTROLLER_LAB_RENDER_SIZE, debug: true },
        platform: { profile: "web" }
      }
    }
  ],
  services: [
    { id: "platform" },
    {
      id: "drivers",
      config: { ...CHARACTER_CONTROLLER_LAB_RENDER_SIZE, debug: true }
    },
    { id: "renderer", dependencies: ["drivers"] }
  ]
});
