import type { DriverRegistry } from "@gamekits/driver-core";
import type { ThreeGameDriver } from "@gamekits/driver-three";

const THREE_PREVIEW_DRIVER_ID = "sandbox.three";

export type SandboxThreePreview = {
  update(deltaMs: number): void;
  destroy(): void;
};

export function createSandboxThreePreview(drivers: DriverRegistry): SandboxThreePreview {
  const driver = drivers.require<ThreeGameDriver>(THREE_PREVIEW_DRIVER_ID);
  const { renderer, camera } = driver.adapters();
  const native = renderer.native();
  const objectId = renderer.createObject({
    id: "sandbox.three.preview",
    type: "group",
    children: [
      {
        id: "floor",
        type: "debug.square",
        transform: {
          position: { x: 0, y: -26, z: -18 },
          rotation: { x: -1.1 },
          scale: { x: 3.2, y: 1.7, z: 1 }
        },
        props: {
          width: 42,
          height: 42,
          color: "#23342f",
          opacity: 0.9
        }
      },
      {
        id: "cube",
        type: "debug.cube",
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0.55, y: 0.65, z: 0.12 },
          scale: { x: 1, y: 1, z: 1 }
        },
        props: {
          width: 34,
          height: 34,
          depth: 34,
          color: "#8cd6a3",
          opacity: 0.96
        }
      },
      {
        id: "signal",
        type: "debug.cube",
        transform: {
          position: { x: 46, y: 18, z: 8 },
          rotation: { x: 0.2, y: 0.3 },
          scale: { x: 0.38, y: 0.38, z: 0.38 }
        },
        props: {
          width: 28,
          height: 28,
          depth: 28,
          color: "#d9b35f"
        }
      },
      {
        id: "key-light",
        type: "light",
        transform: { position: { x: 60, y: 70, z: 120 } },
        props: { kind: "directional", intensity: 1.8, color: "#f1eee7" }
      },
      {
        id: "fill-light",
        type: "light",
        props: { kind: "ambient", intensity: 0.85, color: "#8cd6a3" }
      }
    ]
  });
  let elapsed = 0;

  camera.applyCameraState({
    mode: "free",
    x: 0,
    y: 0,
    zoom: 1,
    rotation: 0,
    viewport: { width: 260, height: 160 },
    minZoom: 0.5,
    maxZoom: 2
  });

  return {
    update(deltaMs) {
      elapsed += deltaMs;
      const phase = elapsed / 1000;
      native.applyNodeState(objectId, "cube", {
        transform: {
          rotation: {
            x: 0.55 + Math.sin(phase * 0.7) * 0.18,
            y: phase * 0.85,
            z: 0.12 + Math.cos(phase * 0.5) * 0.08
          }
        },
        props: {
          opacity: 0.86 + Math.sin(phase * 1.6) * 0.1
        }
      });
      native.applyNodeState(objectId, "signal", {
        transform: {
          position: {
            x: 46,
            y: 18 + Math.sin(phase * 1.8) * 5,
            z: 8
          },
          rotation: {
            x: phase,
            y: phase * 0.6,
            z: phase * 1.2
          }
        }
      });
    },
    destroy() {
      renderer.destroyObject(objectId);
    }
  };
}
