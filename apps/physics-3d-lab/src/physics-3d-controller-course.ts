import {
  createCharacterMotorState,
  type CharacterMotorDiagnostics,
  type CharacterMotorState
} from "@gamekits/character-controller";
import {
  type PhysicsBackendAdapter,
  type PhysicsBodyState,
  type PhysicsScene,
  type PhysicsVector
} from "@gamekits/physics-core";
import type { Rapier3dPhysicsNative } from "@gamekits/physics-rapier3d";

import {
  PHYSICS_3D_CHARACTER_BODY_ID,
  PHYSICS_3D_CHARACTER_COLLIDER_ID,
  createPhysics3dCharacterIntent,
  stepPhysics3dCharacter
} from "./physics-3d-character-controller";

export type Physics3dControllerCourseCaseId =
  | "flat-braking"
  | "walkable-slope"
  | "bounded-step"
  | "moving-platform"
  | "edge-coyote"
  | "actor-push"
  | "landing";

export type Physics3dControllerCourseCase = {
  id: Physics3dControllerCourseCaseId;
  passed: boolean;
  metrics: Record<string, number | string | boolean>;
};

export type Physics3dControllerCourseReport = {
  backend: string;
  fixedDeltaMs: number;
  cases: Physics3dControllerCourseCase[];
  passed: boolean;
};

const FIXED_DELTA_MS = 1000 / 60;
const CHARACTER_HALF_HEIGHT = 0.75;

export function runPhysics3dControllerCourse(
  backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>
): Physics3dControllerCourseReport {
  const cases = [
    runFlatBrakingCase(backend),
    runWalkableSlopeCase(backend),
    runBoundedStepCase(backend),
    runMovingPlatformCase(backend),
    runEdgeCoyoteCase(backend),
    runActorPushCase(backend),
    runLandingCase(backend)
  ];
  return {
    backend: backend.kind,
    fixedDeltaMs: FIXED_DELTA_MS,
    cases,
    passed: cases.every((entry) => entry.passed)
  };
}

function runFlatBrakingCase(
  backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>
): Physics3dControllerCourseCase {
  const harness = createCourseHarness(backend, { x: -2.5, y: CHARACTER_HALF_HEIGHT, z: 0 });
  createFloor(harness.scene, { width: 14, depth: 4 });
  harness.settle(45);
  const startX = harness.body().position.x;
  harness.advance(90, { moveX: 1 });
  const moved = harness.body();
  const peakSpeed = harness.peakHorizontalSpeed;
  harness.advance(60);
  const stopped = harness.body();
  const grounded = harness.groundedTicks;
  harness.dispose();
  return courseCase(
    "flat-braking",
    moved.position.x - startX > 3 && Math.abs(stopped.linearVelocity.x) < 0.2,
    {
      distance: round(moved.position.x - startX),
      peakHorizontalSpeed: round(peakSpeed),
      stoppedSpeed: round(Math.abs(stopped.linearVelocity.x)),
      groundedTicks: grounded
    }
  );
}

function runWalkableSlopeCase(
  backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>
): Physics3dControllerCourseCase {
  const angle = 0.2;
  const startX = -3;
  const surfaceY = slopeSurfaceY(startX, angle, 0.8, 0.4);
  const harness = createCourseHarness(backend, {
    x: startX,
    y: surfaceY + CHARACTER_HALF_HEIGHT + 0.02,
    z: 0
  });
  const rampBodyId = harness.scene.createBody({
    id: "course.slope",
    kind: "static",
    position: { x: 0, y: 0.8, z: 0 },
    rotation: { x: 0, y: 0, z: angle }
  });
  harness.scene.createCollider({
    id: "course.slope.collider",
    bodyId: rampBodyId,
    shape: { type: "box", width: 8, height: 0.4, depth: 3 },
    material: "course"
  });
  harness.settle(30);
  const before = harness.body();
  harness.advance(82, { moveX: 1 });
  const after = harness.body();
  const slopeRadians = harness.diagnostics?.groundSlopeRadians ?? 0;
  harness.dispose();
  return courseCase(
    "walkable-slope",
    after.position.x - before.position.x > 3 && after.position.y - before.position.y > 0.45,
    {
      horizontalDistance: round(after.position.x - before.position.x),
      heightGain: round(after.position.y - before.position.y),
      observedSlopeRadians: round(slopeRadians),
      groundedTicks: harness.groundedTicks
    }
  );
}

function runBoundedStepCase(
  backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>
): Physics3dControllerCourseCase {
  const harness = createCourseHarness(backend, { x: -1.5, y: CHARACTER_HALF_HEIGHT, z: 0 });
  createFloor(harness.scene, { width: 12, depth: 4 });
  const stepBodyId = harness.scene.createBody({
    id: "course.step",
    kind: "static",
    position: { x: 1.2, y: 0.15, z: 0 }
  });
  harness.scene.createCollider({
    id: "course.step.collider",
    bodyId: stepBodyId,
    shape: { type: "box", width: 1.4, height: 0.3, depth: 3 },
    material: "course"
  });
  harness.settle(35);
  harness.advance(105, { moveX: 1 });
  const after = harness.body();
  const maximumY = harness.maximumY;
  harness.dispose();
  return courseCase("bounded-step", after.position.x > 2.2 && maximumY > 0.95, {
    finalX: round(after.position.x),
    maximumY: round(maximumY),
    groundedTicks: harness.groundedTicks
  });
}

function runMovingPlatformCase(
  backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>
): Physics3dControllerCourseCase {
  const platformTop = 0.2;
  const harness = createCourseHarness(backend, {
    x: 0,
    y: platformTop + CHARACTER_HALF_HEIGHT,
    z: 0
  });
  const platformBodyId = harness.scene.createBody({
    id: "course.platform",
    kind: "kinematic",
    position: { x: 0, y: 0, z: 0 }
  });
  harness.scene.createCollider({
    id: "course.platform.collider",
    bodyId: platformBodyId,
    shape: { type: "box", width: 4, height: 0.4, depth: 3 },
    material: "course"
  });
  harness.settle(30);
  let platformX = 0;
  harness.advance(90, {}, () => {
    platformX += 0.02;
    harness.scene.updateBody(platformBodyId, {
      position: { x: platformX, y: 0, z: 0 }
    });
  });
  const actor = harness.body();
  const inheritedSpeed = harness.state.inheritedPlatformVelocity.x;
  const platform = requireBody(harness.scene, platformBodyId);
  harness.dispose();
  return courseCase(
    "moving-platform",
    actor.position.x > 0.8 && Math.abs(platform.position.x - actor.position.x) < 1,
    {
      actorX: round(actor.position.x),
      platformX: round(platform.position.x),
      inheritedSpeed: round(inheritedSpeed),
      groundBodyId: harness.state.groundBodyId ?? "none"
    }
  );
}

function runEdgeCoyoteCase(
  backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>
): Physics3dControllerCourseCase {
  const harness = createCourseHarness(backend, { x: -0.8, y: CHARACTER_HALF_HEIGHT, z: 0 });
  const ledgeBodyId = harness.scene.createBody({
    id: "course.ledge",
    kind: "static",
    position: { x: 0, y: -0.2, z: 0 }
  });
  harness.scene.createCollider({
    id: "course.ledge.collider",
    bodyId: ledgeBodyId,
    shape: { type: "box", width: 3, height: 0.4, depth: 3 },
    material: "course"
  });
  harness.settle(30);
  let airborneTicks = 0;
  let jumpRequested = false;
  let jumpVelocity = 0;
  for (let tick = 0; tick < 100; tick += 1) {
    if (!harness.state.grounded) airborneTicks += 1;
    const shouldJump = airborneTicks === 3 && !jumpRequested;
    harness.advance(1, { moveX: 1, jumpPressed: shouldJump, jumpHeld: shouldJump });
    if (shouldJump) {
      jumpRequested = true;
      jumpVelocity = harness.body().linearVelocity.y;
    }
    if (jumpRequested && harness.state.lastConsumedJumpSequence > 0) break;
  }
  const consumedSequence = harness.state.lastConsumedJumpSequence;
  harness.dispose();
  return courseCase("edge-coyote", jumpRequested && consumedSequence > 0 && jumpVelocity > 0, {
    airborneTicksBeforeJump: airborneTicks,
    consumedSequence,
    jumpVelocity: round(jumpVelocity),
    coyoteRemainingMs: round(harness.state.coyoteRemainingMs)
  });
}

function runActorPushCase(
  backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>
): Physics3dControllerCourseCase {
  const harness = createCourseHarness(backend, { x: -1.6, y: CHARACTER_HALF_HEIGHT, z: 0 });
  createFloor(harness.scene, { width: 14, depth: 4 });
  const targetBodyId = createActor(harness.scene, "course.push-target", {
    x: 0,
    y: CHARACTER_HALF_HEIGHT,
    z: 0
  });
  harness.settle(35);
  const targetStart = requireBody(harness.scene, targetBodyId).position.x;
  harness.advance(110, { moveX: 1 });
  const pusher = harness.body();
  const target = requireBody(harness.scene, targetBodyId);
  harness.dispose();
  return courseCase(
    "actor-push",
    target.position.x - targetStart > 0.5 && pusher.position.x < target.position.x,
    {
      targetDistance: round(target.position.x - targetStart),
      pusherX: round(pusher.position.x),
      targetX: round(target.position.x)
    }
  );
}

function runLandingCase(
  backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>
): Physics3dControllerCourseCase {
  const harness = createCourseHarness(backend, { x: 0, y: 4.5, z: 0 });
  createFloor(harness.scene, { width: 8, depth: 4 });
  let landingTick = 0;
  let minimumVerticalSpeed = 0;
  for (let tick = 1; tick <= 180; tick += 1) {
    harness.advance(1);
    minimumVerticalSpeed = Math.min(minimumVerticalSpeed, harness.body().linearVelocity.y);
    if (harness.state.grounded) {
      landingTick = tick;
      break;
    }
  }
  const landed = harness.body();
  harness.advance(30);
  const settled = harness.body();
  harness.dispose();
  return courseCase(
    "landing",
    landingTick > 0 && Math.abs(settled.position.y - CHARACTER_HALF_HEIGHT) < 0.08,
    {
      landingTick,
      minimumVerticalSpeed: round(minimumVerticalSpeed),
      landingY: round(landed.position.y),
      settledY: round(settled.position.y),
      grounded: harness.state.grounded
    }
  );
}

type CourseHarness = {
  scene: PhysicsScene;
  state: CharacterMotorState;
  diagnostics?: CharacterMotorDiagnostics | undefined;
  groundedTicks: number;
  peakHorizontalSpeed: number;
  maximumY: number;
  advance(
    ticks: number,
    input?: Partial<CourseInput>,
    beforeStep?: ((tick: number) => void) | undefined
  ): void;
  settle(ticks: number): void;
  body(): PhysicsBodyState;
  dispose(): void;
};

type CourseInput = {
  moveX: number;
  moveZ: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  divePressed: boolean;
};

function createCourseHarness(
  backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>,
  position: PhysicsVector
): CourseHarness {
  const scene = backend.createScene({
    id: "physics-3d-controller-course.scene",
    dimension: "3d",
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedDeltaMs: FIXED_DELTA_MS,
    materialDefinitions: [
      { id: "course", friction: 0.9, restitution: 0 },
      { id: "actor", friction: 0.25, restitution: 0, density: 1 }
    ]
  });
  createActor(scene, PHYSICS_3D_CHARACTER_BODY_ID, position, PHYSICS_3D_CHARACTER_COLLIDER_ID);
  let sequence = 0;
  const harness: CourseHarness = {
    scene,
    state: createCharacterMotorState(),
    diagnostics: undefined,
    groundedTicks: 0,
    peakHorizontalSpeed: 0,
    maximumY: position.y,
    advance(ticks, input = {}, beforeStep) {
      for (let tick = 0; tick < ticks; tick += 1) {
        sequence += 1;
        beforeStep?.(tick);
        const intent = createPhysics3dCharacterIntent({
          sequence,
          moveX: input.moveX ?? 0,
          moveZ: input.moveZ ?? 0,
          jumpPressed: input.jumpPressed === true && tick === 0,
          jumpHeld: input.jumpHeld === true,
          divePressed: input.divePressed === true && tick === 0
        });
        const result = stepPhysics3dCharacter({
          scene,
          state: harness.state,
          intent,
          tick: sequence,
          deltaMs: FIXED_DELTA_MS
        });
        harness.state = result.state;
        harness.diagnostics = result.diagnostics;
        scene.step(FIXED_DELTA_MS, { tick: sequence, elapsed: sequence * FIXED_DELTA_MS });
        const body = harness.body();
        if (harness.state.grounded) harness.groundedTicks += 1;
        harness.peakHorizontalSpeed = Math.max(
          harness.peakHorizontalSpeed,
          Math.hypot(body.linearVelocity.x, body.linearVelocity.z ?? 0)
        );
        harness.maximumY = Math.max(harness.maximumY, body.position.y);
      }
    },
    settle(ticks) {
      harness.advance(ticks);
    },
    body() {
      return requireBody(scene, PHYSICS_3D_CHARACTER_BODY_ID);
    },
    dispose() {
      scene.dispose();
    }
  };
  scene.step(0);
  return harness;
}

function createFloor(scene: PhysicsScene, size: { width: number; depth: number }): void {
  const bodyId = scene.createBody({
    id: "course.floor",
    kind: "static",
    position: { x: 0, y: -0.25, z: 0 }
  });
  scene.createCollider({
    id: "course.floor.collider",
    bodyId,
    shape: { type: "box", width: size.width, height: 0.5, depth: size.depth },
    material: "course"
  });
}

function createActor(
  scene: PhysicsScene,
  bodyId: string,
  position: PhysicsVector,
  colliderId = `${bodyId}.collider`
): string {
  const id = scene.createBody({
    id: bodyId,
    kind: "dynamic",
    position,
    damping: { linear: 1.8, angular: 7 },
    lockedAxes: ["rotation-x", "rotation-z"],
    continuousCollisionDetection: true
  });
  scene.createCollider({
    id: colliderId,
    bodyId: id,
    shape: { type: "capsule", radius: 0.36, height: 0.78 },
    material: "actor"
  });
  return id;
}

function slopeSurfaceY(x: number, angle: number, centerY: number, height: number): number {
  return centerY + Math.tan(angle) * x + height / (2 * Math.cos(angle));
}

function requireBody(scene: PhysicsScene, bodyId: string): PhysicsBodyState {
  const body = scene.getBodyState(bodyId);
  if (body === undefined) throw new Error(`Controller course body unavailable: ${bodyId}`);
  return body;
}

function courseCase(
  id: Physics3dControllerCourseCaseId,
  passed: boolean,
  metrics: Physics3dControllerCourseCase["metrics"]
): Physics3dControllerCourseCase {
  return { id, passed, metrics };
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
