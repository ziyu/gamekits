import { describe, expect, it } from "vitest";
import type { PhysicsBodyState, PhysicsQuery } from "@gamekits/physics-core";

import {
  compileCharacterMotorDefinition,
  observeCharacterEnvironment,
  type CharacterMotorDefinition
} from "../src";

const definition = compileCharacterMotorDefinition({
  id: "environment.fixture",
  version: "1",
  capsuleRadius: 0.5,
  capsuleHeight: 1.8,
  maxGroundSpeed: 6,
  groundAcceleration: 20,
  groundBraking: 25,
  maxAirSpeed: 4,
  airAcceleration: 8,
  airBraking: 3,
  maxSlopeRadians: Math.PI / 4,
  stepHeight: 0.4,
  groundProbeDistance: 0.25,
  groundSnapDistance: 0.1,
  ceilingClearance: 0.1,
  coyoteTimeMs: 80,
  jumpBufferMs: 100,
  jumpSpeed: 6,
  jumpHoldDurationMs: 100,
  jumpHoldAcceleration: 5,
  diveSpeed: 8,
  diveVerticalSpeed: 1,
  minimumDiveAirTimeMs: 80,
  diveDurationMs: 300,
  recoveryDurationMs: 200,
  diveCooldownMs: 700,
  diveSteeringScale: 0.4,
  staggerControlScale: 0.1,
  recoveryControlScale: 0.5,
  maxPlatformSpeed: 10,
  platformDepartureVelocityScale: 0.75,
  maxFacingRateRadiansPerSecond: Math.PI * 4
} satisfies CharacterMotorDefinition);

const body: PhysicsBodyState = {
  id: "actor",
  kind: "dynamic",
  position: { x: 0, y: 0.9, z: 0 },
  linearVelocity: { x: 1, y: 0, z: 0 },
  sleeping: false
};

describe("character environment observation", () => {
  it("derives a bounded walkable step from low, high, and landing probes", () => {
    const queries: PhysicsQuery[] = [];
    const observation = observeCharacterEnvironment({
      body,
      definition,
      intent: {
        sequence: 1,
        move: { x: 1, y: 0, z: 0 },
        jumpPressed: false,
        jumpHeld: false,
        divePressed: false
      },
      simulation: {
        query(query) {
          queries.push(query);
          if (query.type === "shape-cast") {
            return [
              {
                colliderId: "floor.collider",
                bodyId: "floor",
                distance: 0.1,
                normal: { x: 0, y: 1, z: 0 }
              }
            ];
          }
          if (query.type !== "raycast") return [];
          if (query.direction.y < 0) {
            return [
              {
                colliderId: "step.collider",
                bodyId: "step",
                point: { x: 0.7, y: 0.3, z: 0 },
                distance: 0.3,
                normal: { x: 0, y: 1, z: 0 }
              }
            ];
          }
          if (query.origin.y < 0.3) {
            return [
              {
                colliderId: "step.collider",
                bodyId: "step",
                point: { x: 0.5, y: 0.14, z: 0 },
                distance: 0.5,
                normal: { x: -1, y: 0, z: 0 }
              }
            ];
          }
          return [];
        }
      },
      ignoreColliderIds: ["actor.collider"]
    });

    expect(observation).toMatchObject({
      ground: { bodyId: "floor", normal: { x: 0, y: 1, z: 0 } },
      step: {
        height: 0.3,
        landingNormal: { x: 0, y: 1, z: 0 },
        clearance: true
      },
      queryCount: 5,
      rejectedQueryCount: 0
    });
    expect(queries).toHaveLength(5);
    expect(queries.slice(1).map((query) => query.type)).toEqual([
      "raycast",
      "raycast",
      "raycast",
      "check"
    ]);
  });

  it("reports an overhead blocker only while an actor is rising with held jump", () => {
    const observation = observeCharacterEnvironment({
      body: { ...body, linearVelocity: { x: 0, y: 3, z: 0 } },
      definition,
      intent: {
        sequence: 2,
        move: { x: 0, y: 0, z: 0 },
        jumpPressed: false,
        jumpHeld: true,
        divePressed: false
      },
      simulation: {
        query(query) {
          return query.type === "raycast"
            ? [
                {
                  colliderId: "ceiling.collider",
                  distance: 0.05,
                  normal: { x: 0, y: -1, z: 0 }
                }
              ]
            : [];
        }
      }
    });

    expect(observation).toEqual({
      queryCount: 2,
      rejectedQueryCount: 0,
      ceilingBlocked: true
    });
  });
});
