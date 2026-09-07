import type { RenderObjectDefinition } from "@gamekits/renderer-core";
import type { SandboxRenderNodeAnimation, SandboxSceneRole } from "../components";
import { SANDBOX_ENTITY_TEXTURE_ID, SANDBOX_RING_TEXTURE_ID } from "./constants";
import type {
  SandboxBuildingDefinition,
  SandboxRenderRigDefinition,
  SandboxRouteDefinition
} from "./types";

export function createCampRenderRig(
  id: string,
  renderObjectId: string,
  nodeAnimations: SandboxRenderNodeAnimation[]
): SandboxRenderRigDefinition {
  return {
    id,
    renderObjectId,
    nodeAnimations,
    tags: ["sandbox", "tiny-camp", "animated"]
  };
}

export function createBuildingDefinition(
  id: string,
  label: string,
  zone: SandboxBuildingDefinition["zone"],
  priority: number,
  supportedTasks: SandboxBuildingDefinition["supportedTasks"]
): SandboxBuildingDefinition {
  return {
    id,
    label,
    zone,
    priority,
    initialHealth: zone === "wilds" ? 100 : 92,
    baseHeat: zone === "forest" || zone === "quarry" || zone === "food" ? 6 : 8,
    throughput: zone === "forest" ? 1.15 : zone === "camp" ? 1.25 : 0.9,
    supportedTasks,
    tags: ["sandbox", "building", zone]
  };
}

export function createRouteDefinition(
  id: string,
  fromObjectId: string,
  toObjectId: string,
  capacity: number
): SandboxRouteDefinition {
  return {
    id,
    fromObjectId,
    toObjectId,
    capacity,
    visual: fromObjectId.includes("monster") ? "threat" : "resource",
    tags: ["sandbox", "route"]
  };
}

export function createCampRenderObject(
  id: string,
  role: Exclude<SandboxSceneRole, "road">
): RenderObjectDefinition {
  const style = campRoleStyle(role);
  return {
    id,
    type: "container",
    children: [
      {
        id: "shadow",
        type: "sprite",
        transform: { position: { x: 5, y: 8 }, scale: { x: 1, y: 0.32 } },
        alpha: 0.22,
        props: {
          textureId: SANDBOX_ENTITY_TEXTURE_ID,
          width: style.size + 12,
          height: style.size,
          tint: 0x000000,
          depth: -2
        }
      },
      {
        id: "aura",
        type: "sprite",
        alpha: style.auraAlpha,
        props: {
          textureId: SANDBOX_RING_TEXTURE_ID,
          width: style.size + 24,
          height: style.size + 24,
          tint: style.aura,
          depth: -1
        }
      },
      {
        id: "outer",
        type: "sprite",
        props: {
          textureId: SANDBOX_RING_TEXTURE_ID,
          width: style.size + 10,
          height: style.size + 10,
          tint: style.outer,
          depth: 0
        }
      },
      {
        id: "inner",
        type: "sprite",
        props: {
          textureId: SANDBOX_RING_TEXTURE_ID,
          width: Math.max(16, style.size - 6),
          height: Math.max(16, style.size - 6),
          tint: style.inner,
          depth: 1
        }
      },
      {
        id: "body",
        type: "sprite",
        props: {
          textureId: SANDBOX_ENTITY_TEXTURE_ID,
          width: style.bodyWidth,
          height: style.bodyHeight,
          tint: style.body,
          depth: 2
        }
      },
      {
        id: "core",
        type: "sprite",
        props: {
          textureId: SANDBOX_ENTITY_TEXTURE_ID,
          width: style.core,
          height: style.core,
          tint: style.coreTint,
          depth: 3
        }
      },
      {
        id: "charge",
        type: "container",
        transform: { position: { x: 0, y: style.size / 2 + 12 } },
        children: [
          {
            id: "track",
            type: "sprite",
            alpha: 0.3,
            props: {
              textureId: SANDBOX_ENTITY_TEXTURE_ID,
              width: style.size + 12,
              height: 4,
              tint: 0xf3f0e8,
              depth: 4
            }
          },
          {
            id: "fill",
            type: "sprite",
            props: {
              textureId: SANDBOX_ENTITY_TEXTURE_ID,
              width: 2,
              height: 4,
              tint: style.fill,
              depth: 5
            }
          },
          {
            id: "ring",
            type: "sprite",
            alpha: 0.7,
            props: {
              textureId: SANDBOX_RING_TEXTURE_ID,
              width: 11,
              height: 11,
              tint: style.fill,
              depth: 6
            }
          }
        ]
      },
      {
        id: "beacon",
        type: "sprite",
        transform: { position: { x: 0, y: -style.size / 2 - 9 } },
        alpha: 0.78,
        props: {
          textureId: SANDBOX_ENTITY_TEXTURE_ID,
          width: style.beaconWidth,
          height: style.beaconHeight,
          tint: style.fill,
          depth: 7
        }
      },
      {
        id: "cargo",
        type: "sprite",
        transform: { position: { x: style.size / 2 + 8, y: -style.size / 3 } },
        alpha: role === "worker" ? 0.5 : 0,
        props: {
          textureId: SANDBOX_RING_TEXTURE_ID,
          width: 16,
          height: 16,
          tint: 0xd9b35f,
          depth: 8
        }
      },
      {
        id: "task",
        type: "sprite",
        transform: { position: { x: -style.size / 2 - 8, y: style.size / 3 } },
        alpha: role === "worker" ? 0.74 : 0,
        props: {
          textureId: SANDBOX_ENTITY_TEXTURE_ID,
          width: 8,
          height: 8,
          tint: 0x64c2d0,
          depth: 9
        }
      },
      {
        id: "field",
        type: "sprite",
        alpha: role === "monster" ? 0.32 : 0,
        props: {
          textureId: SANDBOX_RING_TEXTURE_ID,
          width: style.size + 46,
          height: style.size + 46,
          tint: 0xdd3627,
          depth: -3
        }
      },
      {
        id: "gear",
        type: "sprite",
        alpha: role === "workshop" ? 0.8 : 0,
        props: {
          textureId: SANDBOX_RING_TEXTURE_ID,
          width: style.size + 4,
          height: style.size + 4,
          tint: 0xd9b35f,
          depth: 4
        }
      }
    ],
    tags: ["sandbox", "tiny-camp", role]
  };
}

export function createRoadRenderObject(): RenderObjectDefinition {
  return {
    id: "render.sandbox.road",
    type: "sprite",
    alpha: 0.65,
    props: {
      textureId: SANDBOX_ENTITY_TEXTURE_ID,
      width: 80,
      height: 4,
      tint: 0x64c2d0,
      depth: -10
    },
    tags: ["sandbox", "tiny-camp", "road"]
  };
}

function campRoleStyle(role: Exclude<SandboxSceneRole, "road">) {
  switch (role) {
    case "campfire":
      return {
        size: 58,
        bodyWidth: 34,
        bodyHeight: 34,
        core: 14,
        aura: 0x64c2d0,
        auraAlpha: 0.28,
        outer: 0xf3f0e8,
        inner: 0xd9b35f,
        body: 0x273a35,
        coreTint: 0xf0bd4f,
        fill: 0xd9b35f,
        beaconWidth: 20,
        beaconHeight: 8
      };
    case "resource-node":
      return {
        size: 44,
        bodyWidth: 18,
        bodyHeight: 38,
        core: 10,
        aura: 0x64c2d0,
        auraAlpha: 0.22,
        outer: 0x64c2d0,
        inner: 0x7fd16b,
        body: 0x2a4b48,
        coreTint: 0xf3f0e8,
        fill: 0x7fd16b,
        beaconWidth: 16,
        beaconHeight: 12
      };
    case "worker":
      return {
        size: 30,
        bodyWidth: 24,
        bodyHeight: 18,
        core: 7,
        aura: 0x7fd16b,
        auraAlpha: 0.2,
        outer: 0x7fd16b,
        inner: 0xf3f0e8,
        body: 0x7fd16b,
        coreTint: 0x10100e,
        fill: 0xd9b35f,
        beaconWidth: 10,
        beaconHeight: 5
      };
    case "storage":
      return {
        size: 38,
        bodyWidth: 28,
        bodyHeight: 22,
        core: 8,
        aura: 0x9d89d8,
        auraAlpha: 0.18,
        outer: 0x9d89d8,
        inner: 0x64c2d0,
        body: 0x332d4a,
        coreTint: 0xf3f0e8,
        fill: 0x9d89d8,
        beaconWidth: 12,
        beaconHeight: 8
      };
    case "workshop":
      return {
        size: 40,
        bodyWidth: 30,
        bodyHeight: 24,
        core: 8,
        aura: 0xd9b35f,
        auraAlpha: 0.18,
        outer: 0xd9b35f,
        inner: 0xf3f0e8,
        body: 0x4a3f27,
        coreTint: 0xf3f0e8,
        fill: 0xd9b35f,
        beaconWidth: 14,
        beaconHeight: 8
      };
    case "tower":
      return {
        size: 42,
        bodyWidth: 22,
        bodyHeight: 40,
        core: 9,
        aura: 0xd9b35f,
        auraAlpha: 0.2,
        outer: 0xd9b35f,
        inner: 0xf3f0e8,
        body: 0x4a3f27,
        coreTint: 0xf3f0e8,
        fill: 0xd9b35f,
        beaconWidth: 14,
        beaconHeight: 10
      };
    case "monster":
      return {
        size: 46,
        bodyWidth: 30,
        bodyHeight: 30,
        core: 11,
        aura: 0xdd3627,
        auraAlpha: 0.26,
        outer: 0xdd3627,
        inner: 0xd9b35f,
        body: 0x4e201d,
        coreTint: 0xf3f0e8,
        fill: 0xdd3627,
        beaconWidth: 18,
        beaconHeight: 8
      };
  }
}
