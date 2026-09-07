import { defineGameApp } from "@gamekits/app-host";

export const THREE_DEMO_RENDER_SIZE = {
  width: 960,
  height: 620
} as const;

export const THREE_DEMO_DRIVER_ID = "three.demo";

export type ThreeDemoDriverConfig = {
  width: number;
  height: number;
  debug?: boolean;
};

export const threeDemoAppDefinition = defineGameApp({
  id: "three-demo",
  configSources: [
    {
      id: "three-demo.defaults",
      priority: 0,
      values: {
        renderer: THREE_DEMO_RENDER_SIZE,
        platform: {
          profile: "web"
        }
      }
    }
  ],
  services: [
    { id: "platform" },
    {
      id: "drivers",
      config: {
        ...THREE_DEMO_RENDER_SIZE,
        debug: true
      }
    },
    { id: "data" },
    {
      id: "assets",
      dependencies: ["data", "drivers"]
    },
    {
      id: "renderer",
      dependencies: ["drivers", "assets"]
    }
  ]
});
