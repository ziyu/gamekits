import type {
  PhysicsBodyDefinition,
  PhysicsColliderDefinition,
  PhysicsRotation,
  PhysicsScene,
  PhysicsVector
} from "@gamekits/physics-core";

export type CharacterControllerLabCourseObjectRole =
  | "floor"
  | "slope"
  | "step"
  | "ledge"
  | "platform"
  | "bumper"
  | "ceiling"
  | "wall"
  | "beam"
  | "crate"
  | "hazard";

export type CharacterControllerLabCourseObject = {
  id: string;
  bodyId: string;
  colliderId: string;
  role: CharacterControllerLabCourseObjectRole;
  label: string;
  showLabel?: boolean | undefined;
  shape: Extract<PhysicsColliderDefinition["shape"], { type: "box" | "sphere" }>;
};

export type CharacterControllerLabStationId =
  | "acceleration"
  | "slope-step"
  | "coyote-gap"
  | "platform"
  | "impact";

const material = "character-controller-lab.course";

export function createCharacterControllerLabCourse(
  scene: PhysicsScene
): CharacterControllerLabCourseObject[] {
  return [
    box(scene, {
      id: "proving-ground",
      role: "floor",
      label: "Free Run Plaza",
      position: { x: 0, y: -0.35, z: 0 },
      size: { x: 34, y: 0.7, z: 34 }
    }),
    box(scene, {
      id: "north-curb",
      role: "wall",
      label: "North Boundary",
      position: { x: 0, y: 0.35, z: -17 },
      size: { x: 34, y: 0.7, z: 0.45 }
    }),
    box(scene, {
      id: "south-curb",
      role: "wall",
      label: "South Boundary",
      position: { x: 0, y: 0.35, z: 17 },
      size: { x: 34, y: 0.7, z: 0.45 }
    }),
    box(scene, {
      id: "west-curb",
      role: "wall",
      label: "West Boundary",
      position: { x: -17, y: 0.35, z: 0 },
      size: { x: 0.45, y: 0.7, z: 34 }
    }),
    box(scene, {
      id: "east-curb",
      role: "wall",
      label: "East Boundary",
      position: { x: 17, y: 0.35, z: 0 },
      size: { x: 0.45, y: 0.7, z: 34 }
    }),

    box(scene, {
      id: "walkable-slope",
      role: "slope",
      label: "Walkable Ramp · 20°",
      showLabel: true,
      position: { x: -11.2, y: 0.78, z: -2.6 },
      rotation: { x: 0, y: 0, z: -0.35 },
      size: { x: 5.4, y: 0.55, z: 4.2 }
    }),
    box(scene, {
      id: "steep-slope",
      role: "hazard",
      label: "Rejected Ramp · 56°",
      showLabel: true,
      position: { x: -11.4, y: 1.75, z: 4.1 },
      rotation: { x: 0, y: 0, z: 0.98 },
      size: { x: 4.8, y: 0.55, z: 3.7 }
    }),

    box(scene, {
      id: "step-low",
      role: "step",
      label: "0.22m Step",
      position: { x: -4.3, y: 0.11, z: -7.1 },
      size: { x: 4.2, y: 0.22, z: 1.15 }
    }),
    box(scene, {
      id: "step-medium",
      role: "step",
      label: "0.30m Step",
      position: { x: -4.3, y: 0.26, z: -8.28 },
      size: { x: 4.2, y: 0.52, z: 1.15 }
    }),
    box(scene, {
      id: "step-limit",
      role: "step",
      label: "0.40m Step",
      position: { x: -4.3, y: 0.46, z: -9.46 },
      size: { x: 4.2, y: 0.92, z: 1.15 }
    }),
    box(scene, {
      id: "step-deck",
      role: "ledge",
      label: "Bounded Step Stair",
      showLabel: true,
      position: { x: -4.3, y: 0.46, z: -11.2 },
      size: { x: 4.2, y: 0.92, z: 2.35 }
    }),

    box(scene, {
      id: "coyote-launch",
      role: "ledge",
      label: "Coyote Launch",
      showLabel: true,
      position: { x: 4.7, y: 1.2, z: -10.2 },
      size: { x: 4.2, y: 2.4, z: 4.5 }
    }),
    box(scene, {
      id: "coyote-landing",
      role: "ledge",
      label: "Recovery Landing",
      position: { x: 10.25, y: 1.2, z: -10.2 },
      size: { x: 4.6, y: 2.4, z: 4.5 }
    }),
    box(scene, {
      id: "buffer-ceiling",
      role: "ceiling",
      label: "Low Clearance Buffer",
      showLabel: true,
      position: { x: 10.25, y: 3.48, z: -10.2 },
      size: { x: 4.2, y: 0.28, z: 3.8 }
    }),

    box(scene, {
      id: "balance-entry",
      role: "step",
      label: "Beam Entry",
      position: { x: -1.5, y: 0.45, z: 5.4 },
      size: { x: 2.2, y: 0.9, z: 2.2 }
    }),
    box(scene, {
      id: "balance-beam",
      role: "beam",
      label: "Balance Beam",
      showLabel: true,
      position: { x: 1.75, y: 0.95, z: 5.4 },
      size: { x: 5.7, y: 0.3, z: 0.65 }
    }),
    box(scene, {
      id: "balance-exit",
      role: "step",
      label: "Beam Exit",
      position: { x: 5.2, y: 0.45, z: 5.4 },
      size: { x: 2.2, y: 0.9, z: 2.2 }
    }),

    box(scene, {
      id: "moving-platform",
      role: "platform",
      label: "Traverse Platform",
      showLabel: true,
      kind: "kinematic",
      position: { x: 10.2, y: 1.15, z: 1.2 },
      size: { x: 3, y: 0.36, z: 3 }
    }),
    box(scene, {
      id: "elevator-platform",
      role: "platform",
      label: "Lift Platform",
      kind: "kinematic",
      position: { x: 14, y: 0.5, z: 5.2 },
      size: { x: 2.8, y: 0.36, z: 2.8 }
    }),
    box(scene, {
      id: "rotating-sweeper",
      role: "hazard",
      label: "Rotating Sweeper",
      showLabel: true,
      kind: "kinematic",
      position: { x: 9.7, y: 0.62, z: 10.4 },
      size: { x: 7.2, y: 0.34, z: 0.45 }
    }),

    box(scene, {
      id: "tunnel-floor",
      role: "floor",
      label: "Dive Tunnel",
      position: { x: -9.3, y: 0.14, z: 10.4 },
      size: { x: 6.6, y: 0.28, z: 4.2 }
    }),
    box(scene, {
      id: "tunnel-ceiling",
      role: "ceiling",
      label: "Jump Buffer Tunnel",
      showLabel: true,
      position: { x: -9.3, y: 2.25, z: 10.4 },
      size: { x: 6.6, y: 0.3, z: 4.2 }
    }),
    box(scene, {
      id: "tunnel-back-wall",
      role: "wall",
      label: "Tunnel Wall",
      position: { x: -12.45, y: 1.15, z: 10.4 },
      size: { x: 0.3, y: 2.3, z: 4.2 }
    }),

    sphere(scene, {
      id: "push-ball-a",
      role: "bumper",
      label: "Heavy Push Ball",
      showLabel: true,
      kind: "dynamic",
      position: { x: -2.6, y: 0.78, z: 11.8 },
      radius: 0.78
    }),
    sphere(scene, {
      id: "push-ball-b",
      role: "bumper",
      label: "Light Push Ball",
      kind: "dynamic",
      position: { x: 0, y: 0.58, z: 12.6 },
      radius: 0.58
    }),
    box(scene, {
      id: "push-crate-a",
      role: "crate",
      label: "Dynamic Crate",
      kind: "dynamic",
      position: { x: 3, y: 0.6, z: 11.8 },
      size: { x: 1.2, y: 1.2, z: 1.2 }
    }),
    box(scene, {
      id: "push-crate-b",
      role: "crate",
      label: "Tall Dynamic Crate",
      kind: "dynamic",
      position: { x: 4.7, y: 0.9, z: 12.6 },
      size: { x: 1.1, y: 1.8, z: 1.1 }
    })
  ];
}

export function characterControllerLabSpawnPoint(): PhysicsVector {
  return { x: 0, y: 0.84, z: 0 };
}

export function characterControllerLabStationSpawn(
  stationId: CharacterControllerLabStationId
): PhysicsVector {
  switch (stationId) {
    case "acceleration":
      return characterControllerLabSpawnPoint();
    case "slope-step":
      return { x: -8.3, y: 0.84, z: -3 };
    case "coyote-gap":
      return { x: 3.7, y: 3.24, z: -10.2 };
    case "platform":
      return { x: 7.4, y: 0.84, z: 1.2 };
    case "impact":
      return { x: -4.6, y: 0.84, z: 11.8 };
  }
}

export function updateCharacterControllerLabPlatform(scene: PhysicsScene, elapsedMs: number): void {
  const traversePhase = elapsedMs / 1_650;
  scene.updateBody("character-controller-lab.course.moving-platform", {
    position: {
      x: 10.2 + Math.sin(traversePhase) * 2.7,
      y: 1.15 + Math.sin(traversePhase * 0.55) * 0.18,
      z: 1.2
    }
  });
  const liftPhase = elapsedMs / 1_300;
  scene.updateBody("character-controller-lab.course.elevator-platform", {
    position: { x: 14, y: 0.55 + (Math.sin(liftPhase) * 0.5 + 0.5) * 3.2, z: 5.2 }
  });
  scene.updateBody("character-controller-lab.course.rotating-sweeper", {
    rotation: { x: 0, y: elapsedMs * 0.00115, z: 0 }
  });
}

function box(
  scene: PhysicsScene,
  options: {
    id: string;
    role: CharacterControllerLabCourseObjectRole;
    label: string;
    showLabel?: boolean | undefined;
    kind?: PhysicsBodyDefinition["kind"] | undefined;
    position: PhysicsVector;
    rotation?: PhysicsRotation | undefined;
    size: { x: number; y: number; z: number };
  }
): CharacterControllerLabCourseObject {
  const bodyId = `character-controller-lab.course.${options.id}`;
  const colliderId = `${bodyId}.collider`;
  scene.createBody({
    id: bodyId,
    kind: options.kind ?? "static",
    position: options.position,
    ...(options.rotation === undefined ? {} : { rotation: options.rotation }),
    ...(options.kind === "dynamic"
      ? { damping: { linear: 0.7, angular: 0.5 }, continuousCollisionDetection: true }
      : {})
  });
  const shape = {
    type: "box" as const,
    width: options.size.x,
    height: options.size.y,
    depth: options.size.z
  };
  scene.createCollider({ id: colliderId, bodyId, shape, material });
  return { ...options, bodyId, colliderId, shape };
}

function sphere(
  scene: PhysicsScene,
  options: {
    id: string;
    role: CharacterControllerLabCourseObjectRole;
    label: string;
    showLabel?: boolean | undefined;
    kind: PhysicsBodyDefinition["kind"];
    position: PhysicsVector;
    radius: number;
  }
): CharacterControllerLabCourseObject {
  const bodyId = `character-controller-lab.course.${options.id}`;
  const colliderId = `${bodyId}.collider`;
  scene.createBody({
    id: bodyId,
    kind: options.kind,
    position: options.position,
    damping: { linear: 0.4, angular: 0.25 },
    continuousCollisionDetection: true
  });
  const shape = { type: "sphere" as const, radius: options.radius };
  scene.createCollider({ id: colliderId, bodyId, shape, material });
  return { ...options, bodyId, colliderId, shape };
}
