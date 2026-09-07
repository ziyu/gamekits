import { defineGameApp } from "@gamekits/app-host";

export const PHYSICS_3D_LAB_DRIVER_ID = "physics-3d-lab.three";

export const PHYSICS_3D_LAB_RENDER_SIZE = {
  width: 1080,
  height: 720
} as const;

export type Physics3dLabDriverConfig = {
  width: number;
  height: number;
  debug?: boolean;
};

export const physics3dLabAppDefinition = defineGameApp({
  id: "physics-3d-lab",
  configSources: [
    {
      id: "physics-3d-lab.defaults",
      priority: 0,
      values: {
        renderer: PHYSICS_3D_LAB_RENDER_SIZE,
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
        ...PHYSICS_3D_LAB_RENDER_SIZE,
        debug: true
      }
    },
    {
      id: "renderer",
      dependencies: ["drivers"]
    }
  ]
});
