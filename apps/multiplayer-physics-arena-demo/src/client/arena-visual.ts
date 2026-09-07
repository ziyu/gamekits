import type { ThreeRendererNative } from "@gamekits/driver-three";
import type {
  PhysicsBodyState,
  PhysicsPredictionIslandMemberDefinition,
  PhysicsPredictionIslandMemberState,
  PhysicsPredictionIslandStateSnapshot,
  PhysicsRotation
} from "@gamekits/physics-core";
import * as THREE from "three";

import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import {
  compileArenaItemCatalog,
  type ArenaCompiledItemDefinition
} from "../items/item-definition";
import { arenaItemPhysicsMemberId, createArenaItemPhysicsMember } from "../items/item-physics";
import { arenaMemberRole } from "../shared/arena-definition";
import type { ArenaEffectPresentationEvent } from "./arena-effects";
import type { ArenaFeedbackSnapshot } from "./arena-feedback";
import type {
  ArenaPresentationSnapshot,
  ArenaPresentedActorState,
  ArenaPresentedItemState
} from "./arena-presentation";

export type ArenaVisual = {
  update(
    state: PhysicsPredictionIslandStateSnapshot | undefined,
    localMemberId?: string,
    deltaMs?: number,
    presentation?: ArenaPresentationSnapshot,
    feedback?: ArenaFeedbackSnapshot
  ): void;
  effect(event: ArenaEffectPresentationEvent): void;
  inspect(memberId?: string): void;
  inspectableHazards(stageIndex: number): string[];
  inspectableMembers(stageIndex: number): string[];
  inspection(memberId?: string): ArenaVisualInspection | undefined;
  inspections(memberIds: readonly string[]): ArenaVisualInspection[];
  destroy(): void;
};

export type ArenaVisualInspection = {
  memberId: string;
  rootName: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  visible: boolean;
  animatedPart?:
    | {
        name: string;
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number };
        scale: { x: number; y: number; z: number };
        visible: boolean;
      }
    | undefined;
};

type MemberVisual = {
  root: THREE.Group;
  model: THREE.Group;
  role: ReturnType<typeof arenaMemberRole>;
  glowMaterials: THREE.MeshStandardMaterial[];
  limbs: THREE.Object3D[];
  hazardKind?: string | undefined;
  hazardAxis?: "x" | "y" | "z" | undefined;
  hazardStrength?: number | undefined;
  hazardOrigin?: { x: number; y: number; z?: number | undefined } | undefined;
  animationParts?: HazardAnimationPart[] | undefined;
  localRing?: THREE.Mesh | undefined;
  marker?: THREE.Group | undefined;
  itemPresentationId?: string | undefined;
  initialized: boolean;
};

type ArenaItemVisualRecipe = {
  style: "ball" | "block" | "orb" | "hammer" | "glove" | "baton";
  primary: number;
  accent: number;
  carryPosition: readonly [number, number, number];
  carryRotation: readonly [number, number, number];
  carryScale: number;
};

type HazardAnimationPart = {
  object: THREE.Object3D;
  kind:
    | "conveyor-slat"
    | "conveyor-roller"
    | "platform-rail"
    | "platform-rotor"
    | "wind-fan"
    | "wind-stream"
    | "bounce-deck"
    | "bounce-ring"
    | "piston-housing"
    | "piston-indicator"
    | "crusher-housing"
    | "crusher-indicator"
    | "wall-guide"
    | "wall-indicator"
    | "crumble-tile"
    | "safe-ring"
    | "warning-beacon";
  phase: number;
  basePosition: THREE.Vector3;
  baseScale: THREE.Vector3;
  extent?: number | undefined;
};

type AmbientAnimationPart = {
  object: THREE.Object3D;
  kind:
    | "broadcast-ring"
    | "zone-lamp"
    | "checkpoint-beacon"
    | "finish-lamp"
    | "spectator-pod"
    | "rail-beacon"
    | "sky";
  phase: number;
  basePosition: THREE.Vector3;
  baseScale: THREE.Vector3;
};

type FxParticle = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
};

type ArenaFx = {
  effectId: string;
  root: THREE.Group;
  ageMs: number;
  durationMs: number;
  particles: FxParticle[];
};

const UNIT = 32;
const MAX_VISUAL_EFFECTS = 48;
const CAMERA_IDLE_POSITION = new THREE.Vector3(0, 8.4 * UNIT, 14.5 * UNIT);
const CAMERA_IDLE_TARGET = new THREE.Vector3(0, 0.8 * UNIT, -3.8 * UNIT);
const COLOR = {
  ink: 0x071225,
  midnight: 0x0b1834,
  track: 0x17345b,
  trackTop: 0x24507a,
  cyan: 0x44e6ff,
  acid: 0xc8ff45,
  coral: 0xff5b55,
  sun: 0xffcf4b,
  violet: 0x8b78ff,
  white: 0xf5f7ff
} as const;
const ITEM_DEFINITIONS_BY_ID = new Map(
  compileArenaItemCatalog(ARENA_COMPILED_CONTENT.stages).definitions.map((definition) => [
    definition.id,
    definition
  ])
);
const ITEM_VISUAL_RECIPES_BY_PRESENTATION_ID = new Map<string, ArenaItemVisualRecipe>([
  [
    "presentation.foam-ball",
    itemVisualRecipe("ball", 0x4ddcff, COLOR.white, [0.68, -0.04, -0.46], [0, 0, 0], 0.78)
  ],
  [
    "presentation.energy-block",
    itemVisualRecipe("block", 0xffb444, COLOR.coral, [0.7, -0.02, -0.48], [0.12, 0, -0.2], 0.72)
  ],
  [
    "presentation.blast-orb",
    itemVisualRecipe("orb", 0xff5f78, COLOR.sun, [0.68, 0, -0.48], [0, 0, 0], 0.68)
  ],
  [
    "presentation.foam-hammer",
    itemVisualRecipe("hammer", 0xff795f, COLOR.sun, [0.73, -0.02, -0.44], [-0.18, 0, -0.42], 0.74)
  ],
  [
    "presentation.gravity-orb",
    itemVisualRecipe("orb", 0x8f6bff, COLOR.cyan, [0.68, 0, -0.48], [0, 0, 0], 0.7)
  ],
  [
    "presentation.spring-glove",
    itemVisualRecipe("glove", 0x70f0a7, COLOR.acid, [0.72, -0.02, -0.5], [0.05, 0, -0.18], 0.75)
  ],
  [
    "presentation.stun-baton",
    itemVisualRecipe("baton", 0x805dff, COLOR.cyan, [0.72, 0, -0.45], [-0.16, 0, -0.55], 0.78)
  ]
]);
const COURSE_PRESENTATION_PLACEMENTS = ARENA_COMPILED_CONTENT.stages.flatMap(
  (stage) => stage.courseProjection.presentation.placements
);
const QUALIFIER_COURSE = ARENA_COMPILED_CONTENT.stages[0]!.course;
const QUALIFIER_STATIC_PLACEMENTS =
  ARENA_COMPILED_CONTENT.stages[0]!.courseProjection.presentation.placements;
const HAZARD_SCHEDULES_BY_MEMBER_ID = new Map(
  ARENA_COMPILED_CONTENT.stages.flatMap((stage) =>
    stage.courseProjection.hazardSchedules.map((schedule) => [schedule.memberId, schedule] as const)
  )
);
const QUALIFIER_ROUTE_VOLUMES = ARENA_COMPILED_CONTENT.stages[0]!.course.volumes.filter(
  (volume) => volume.kind === "checkpoint" || volume.kind === "finish"
);
const QUALIFIER_TRACK = (() => {
  const floorPlacements = QUALIFIER_COURSE.staticLayout.filter(({ role }) => role === "floor");
  const startZ = average(
    ARENA_COMPILED_CONTENT.stages[0]!.courseProjection.participantSpawns.map(
      (spawn) => spawn.position.z ?? 0
    )
  );
  const finish = QUALIFIER_ROUTE_VOLUMES.find(({ kind }) => kind === "finish");
  return {
    width: Math.max(...floorPlacements.map(({ size }) => size.width), 22),
    depth:
      Math.max(
        ...floorPlacements.map(({ position, size }) => (position.z ?? 0) + size.depth / 2),
        startZ
      ) -
      Math.min(
        ...floorPlacements.map(({ position, size }) => (position.z ?? 0) - size.depth / 2),
        finish?.position.z ?? -12.4
      ),
    centerZ:
      (Math.max(
        ...floorPlacements.map(({ position, size }) => (position.z ?? 0) + size.depth / 2),
        startZ
      ) +
        Math.min(
          ...floorPlacements.map(({ position, size }) => (position.z ?? 0) - size.depth / 2),
          finish?.position.z ?? -12.4
        )) /
      2,
    startZ,
    finishZ: finish?.position.z ?? -12.4
  };
})();

export function createArenaVisual(
  native: ThreeRendererNative,
  definitions: ReadonlyMap<string, PhysicsPredictionIslandMemberDefinition>
): ArenaVisual {
  const root = new THREE.Group();
  root.name = "knockout-circuit.root";
  const members = new Map<string, MemberVisual>();
  const effects: ArenaFx[] = [];
  const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.5, 5_000);
  const cameraTarget = CAMERA_IDLE_TARGET.clone();
  let localVisual: MemberVisual | undefined;
  let cameraVisual: MemberVisual | undefined;
  let inspectedMemberId: string | undefined;
  let inspectedVisual: MemberVisual | undefined;
  let cameraShake = 0;
  let elapsedMs = 0;

  setupScene(native, root);
  createCourse(root);
  const ambientParts = collectAmbientAnimationParts(root);
  native.scene.add(root, camera);
  camera.position.copy(CAMERA_IDLE_POSITION);
  camera.lookAt(cameraTarget);
  configureRenderer(native.renderer);

  return {
    update(state, localMemberId, deltaMs = 1000 / 60, presentation, feedback) {
      const safeDeltaMs = Math.min(50, Math.max(0, deltaMs));
      elapsedMs += safeDeltaMs;
      localVisual = undefined;
      cameraVisual = undefined;
      inspectedVisual = undefined;
      if (state) {
        const presentedActors = new Map(
          presentation?.actors.map((actor) => [actor.memberId, actor]) ?? []
        );
        const retained = new Set<string>();
        for (const member of state.members) {
          const definition = definitions.get(member.id) ?? resolveItemMemberDefinition(member);
          if (!definition) continue;
          retained.add(member.id);
          const visual = ensureMemberMesh(root, members, definition);
          if (visual.root.parent !== root) root.add(visual.root);
          if (visual.itemPresentationId !== undefined) visual.root.scale.setScalar(1);
          const local = member.id === localMemberId;
          updateMemberVisual(
            visual,
            member.body,
            state.tick,
            safeDeltaMs,
            local,
            presentedActors.get(member.id)
          );
          setLocalPresentation(visual, local);
          updateHazardPresentation(
            visual,
            feedback?.hazards.find((hazard) => hazard.memberId === member.id)?.phase,
            member.body,
            state.tick
          );
          if (local) localVisual = visual;
          if (member.id === feedback?.camera.targetMemberId) cameraVisual = visual;
          if (member.id === inspectedMemberId) inspectedVisual = visual;
        }
        for (const item of presentation?.items ?? []) {
          const definition = ITEM_DEFINITIONS_BY_ID.get(item.definitionId);
          const owner = members.get(item.ownerMemberId);
          if (definition === undefined || owner === undefined) continue;
          const memberId = arenaItemPhysicsMemberId({
            id: item.itemId,
            instanceGeneration: item.instanceGeneration
          });
          const memberDefinition = createArenaItemPhysicsMember({
            definition,
            item: { id: item.itemId, instanceGeneration: item.instanceGeneration },
            position: { x: 0, y: 0, z: 0 }
          });
          retained.add(memberId);
          const visual = ensureMemberMesh(root, members, memberDefinition);
          updateCarriedItemVisual(visual, owner, item, state.tick);
          if (memberId === inspectedMemberId) inspectedVisual = visual;
        }
        for (const [id, visual] of members) {
          if (retained.has(id)) continue;
          visual.root.removeFromParent();
          disposeObject(visual.root);
          members.delete(id);
        }
      }
      updateAmbientPresentation(ambientParts, elapsedMs);
      updateEffects(effects, safeDeltaMs);
      cameraShake = Math.max(0, cameraShake - safeDeltaMs * 0.0018 * UNIT);
      updateCamera(
        camera,
        cameraTarget,
        inspectedVisual ?? cameraVisual ?? localVisual,
        safeDeltaMs,
        elapsedMs,
        cameraShake,
        inspectedVisual !== undefined
      );
      renderScene(native, camera);
    },
    effect(event) {
      const existingIndex = effects.findIndex((effect) => effect.effectId === event.effectId);
      if (existingIndex >= 0) removeEffect(effects, existingIndex);
      if (event.phase === "cancel") return;
      const origin = localVisual?.root.position ?? cameraVisual?.root.position ?? cameraTarget;
      effects.push(createEffect(root, event, origin));
      while (effects.length > MAX_VISUAL_EFFECTS) removeEffect(effects, 0);
      if (event.kind === "item-hit" && event.phase === "confirm") {
        cameraShake = Math.min(0.3 * UNIT, Math.max(cameraShake, 0.22 * UNIT));
      } else if (event.kind === "jump" && event.phase === "confirm") {
        cameraShake = Math.min(0.3 * UNIT, Math.max(cameraShake, 0.07 * UNIT));
      }
    },
    inspect(memberId) {
      inspectedMemberId = memberId;
    },
    inspectableHazards(stageIndex) {
      return (
        ARENA_COMPILED_CONTENT.stages[stageIndex]?.courseProjection.hazardSchedules.map(
          ({ memberId }) => memberId
        ) ?? []
      );
    },
    inspectableMembers(stageIndex) {
      const stage = ARENA_COMPILED_CONTENT.stages[stageIndex];
      return stage === undefined
        ? []
        : [
            ...stage.courseProjection.hazardSchedules.map(({ memberId }) => memberId),
            ...stage.course.props.map(({ id }) => id)
          ];
    },
    inspection(memberId) {
      return visualInspection(memberId === undefined ? inspectedVisual : members.get(memberId));
    },
    inspections(memberIds) {
      return memberIds.flatMap((memberId) => {
        const inspection = visualInspection(members.get(memberId));
        return inspection === undefined ? [] : [inspection];
      });
    },
    destroy() {
      camera.removeFromParent();
      root.removeFromParent();
      disposeObject(root);
      members.clear();
      effects.length = 0;
    }
  };
}

function visualInspection(visual: MemberVisual | undefined): ArenaVisualInspection | undefined {
  if (visual === undefined) return undefined;
  const animatedPart = visual.animationParts?.[0]?.object;
  return {
    memberId: visual.root.name.replace(/^knockout\./, ""),
    rootName: visual.root.name,
    position: vectorSnapshot(visual.root.position),
    rotation: vectorSnapshot(visual.root.rotation),
    scale: vectorSnapshot(visual.root.scale),
    visible: visual.root.visible,
    ...(animatedPart === undefined
      ? {}
      : {
          animatedPart: {
            name: animatedPart.name,
            position: vectorSnapshot(animatedPart.position),
            rotation: vectorSnapshot(animatedPart.rotation),
            scale: vectorSnapshot(animatedPart.scale),
            visible: animatedPart.visible
          }
        })
  };
}

function resolveItemMemberDefinition(
  member: PhysicsPredictionIslandMemberState
): PhysicsPredictionIslandMemberDefinition | undefined {
  const itemId = member.body.userData?.itemId;
  const itemGeneration = member.body.userData?.itemGeneration;
  const definitionId = member.body.userData?.definitionId;
  if (
    typeof itemId !== "string" ||
    typeof itemGeneration !== "number" ||
    !Number.isSafeInteger(itemGeneration) ||
    itemGeneration < 1 ||
    typeof definitionId !== "string"
  ) {
    return undefined;
  }
  const definition = ITEM_DEFINITIONS_BY_ID.get(definitionId);
  if (definition === undefined) return undefined;
  return createArenaItemPhysicsMember({
    definition,
    item: { id: itemId, instanceGeneration: itemGeneration },
    position: member.body.position,
    linearVelocity: member.body.linearVelocity
  });
}

function setupScene(native: ThreeRendererNative, root: THREE.Group): void {
  native.scene.background = new THREE.Color(COLOR.ink);
  native.scene.fog = new THREE.Fog(COLOR.ink, 28 * UNIT, 96 * UNIT);

  const hemisphere = new THREE.HemisphereLight(0xb9ecff, 0x10172c, 2.4);
  const key = new THREE.DirectionalLight(0xfff0dc, 4.5);
  key.position.set(-10 * UNIT, 24 * UNIT, -74 * UNIT);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -18 * UNIT;
  key.shadow.camera.right = 18 * UNIT;
  key.shadow.camera.top = 20 * UNIT;
  key.shadow.camera.bottom = -20 * UNIT;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 260 * UNIT;

  const cyanRim = new THREE.PointLight(COLOR.cyan, 120, 46 * UNIT, 1.5);
  cyanRim.position.set(-11 * UNIT, 6 * UNIT, -48 * UNIT);
  const coralRim = new THREE.PointLight(COLOR.coral, 105, 46 * UNIT, 1.5);
  coralRim.position.set(11 * UNIT, 5 * UNIT, -142 * UNIT);
  const finishRim = new THREE.PointLight(COLOR.acid, 105, 42 * UNIT, 1.5);
  finishRim.position.set(0, 7 * UNIT, QUALIFIER_TRACK.finishZ * UNIT);
  root.add(hemisphere, key, cyanRim, coralRim, finishRim);

  createSkyParticles(root);
  createBroadcastRings(root);
}

function createCourse(root: THREE.Group): void {
  const course = new THREE.Group();
  course.name = "knockout.course";
  root.add(course);

  const voidDeck = createMesh(
    new THREE.BoxGeometry(
      (QUALIFIER_TRACK.width + 14) * UNIT,
      1.2 * UNIT,
      (QUALIFIER_TRACK.depth + 12) * UNIT
    ),
    new THREE.MeshStandardMaterial({
      color: 0x09162d,
      roughness: 0.55,
      metalness: 0.45
    }),
    "knockout.course.void-deck"
  );
  voidDeck.position.set(0, -2.4 * UNIT, QUALIFIER_TRACK.centerZ * UNIT);
  course.add(voidDeck);

  for (const placement of COURSE_PRESENTATION_PLACEMENTS) {
    if (placement.role === "hazard" || placement.role === "prop" || placement.role === "volume") {
      continue;
    }
    const role = placement.role === "finish-deck" ? "finish" : placement.role;
    const material = new THREE.MeshPhysicalMaterial({
      color: role === "finish" ? 0x23607b : role === "ramp" ? 0x304a78 : COLOR.track,
      roughness: 0.38,
      metalness: 0.26,
      clearcoat: 0.35,
      clearcoatRoughness: 0.5
    });
    const mesh = createMesh(
      new THREE.BoxGeometry(
        placement.size.width * UNIT,
        placement.size.height * UNIT,
        placement.size.depth * UNIT
      ),
      material,
      `knockout.${placement.sourceId}`
    );
    applyTransform(mesh, placement.position, placement.rotation);
    course.add(mesh);
  }

  createEdgeLights(course);
  createLaneGraphics(course);
  createStartGrid(course);
  createCourseZoneArchitecture(course);
  createQualifierRouteMarkers(course);
  createFinishPortal(course);
  createSpectatorPods(course);
}

function ensureMemberMesh(
  root: THREE.Group,
  members: Map<string, MemberVisual>,
  definition: PhysicsPredictionIslandMemberDefinition
): MemberVisual {
  const existing = members.get(definition.id);
  if (existing) return existing;

  const role = arenaMemberRole(definition.id);
  const itemDefinitionId = definition.body.userData?.definitionId;
  const itemDefinition =
    typeof itemDefinitionId === "string" ? ITEM_DEFINITIONS_BY_ID.get(itemDefinitionId) : undefined;
  const visual =
    itemDefinition !== undefined
      ? createItemVisual(definition, itemDefinition)
      : role === "player" || role === "bot"
        ? createRunnerVisual(definition.id, role)
        : role === "sweeper"
          ? createSweeperVisual(definition)
          : role === "platform"
            ? createPlatformVisual(definition)
            : role === "hazard"
              ? createHazardVisual(definition)
              : createPropVisual(definition);
  visual.root.name = `knockout.${definition.id}`;
  root.add(visual.root);
  members.set(definition.id, visual);
  return visual;
}

function applyTransform(
  target: THREE.Object3D,
  position: { x: number; y: number; z?: number },
  rotation?: PhysicsRotation,
  alpha = 1
): void {
  const desiredPosition = new THREE.Vector3(
    position.x * UNIT,
    position.y * UNIT,
    (position.z ?? 0) * UNIT
  );
  if (alpha >= 1) target.position.copy(desiredPosition);
  else target.position.lerp(desiredPosition, alpha);

  if (rotation === undefined) return;
  const desiredRotation = new THREE.Quaternion();
  if (typeof rotation === "number") {
    desiredRotation.setFromEuler(new THREE.Euler(0, 0, rotation));
  } else if ("w" in rotation) {
    desiredRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
  } else {
    desiredRotation.setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z ?? 0));
  }
  if (alpha >= 1) target.quaternion.copy(desiredRotation);
  else target.quaternion.slerp(desiredRotation, alpha);
}

function colorForRole(role: ReturnType<typeof arenaMemberRole>, id: string): number {
  if (role === "player") return id.endsWith("0") ? COLOR.coral : COLOR.cyan;
  if (role === "bot") {
    const palette = [COLOR.sun, COLOR.violet, 0x63e6a4, 0xff8ac5, 0xff9851, 0x73a8ff];
    return palette[Number(id.split(".").at(-1) ?? 0) % palette.length] ?? COLOR.sun;
  }
  if (role === "sweeper") return COLOR.coral;
  if (role === "platform") return COLOR.violet;
  return id.includes("ball") ? COLOR.acid : COLOR.white;
}

function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) material.dispose();
}

function configureRenderer(renderer: THREE.WebGLRenderer | undefined): void {
  if (!renderer) return;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
}

function createMesh<TMaterial extends THREE.Material>(
  geometry: THREE.BufferGeometry,
  material: TMaterial,
  name: string
): THREE.Mesh<THREE.BufferGeometry, TMaterial> {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createRunnerVisual(id: string, role: "player" | "bot"): MemberVisual {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.name = `${id}.runner-model`;
  root.add(model);

  const color = colorForRole(role, id);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.3,
    metalness: 0.06,
    emissive: color,
    emissiveIntensity: 0.06
  });
  const body = createMesh(
    new THREE.CapsuleGeometry(0.5 * UNIT, 0.72 * UNIT, 10, 20),
    bodyMaterial,
    `${id}.chassis`
  );
  body.scale.set(1, 1.02, 0.9);
  model.add(body);

  const belly = createMesh(
    new THREE.SphereGeometry(0.39 * UNIT, 20, 12),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).lerp(new THREE.Color(COLOR.white), 0.3),
      roughness: 0.4,
      metalness: 0.02
    }),
    `${id}.belly`
  );
  belly.scale.set(0.95, 0.82, 0.18);
  belly.position.set(0, -0.08 * UNIT, -0.44 * UNIT);
  model.add(belly);

  const visorMaterial = new THREE.MeshStandardMaterial({
    color: 0x07111f,
    roughness: 0.12,
    metalness: 0.82,
    emissive: role === "player" ? COLOR.cyan : 0x4385a4,
    emissiveIntensity: role === "player" ? 0.55 : 0.22
  });
  const visor = createMesh(
    new THREE.SphereGeometry(0.36 * UNIT, 24, 12),
    visorMaterial,
    `${id}.visor`
  );
  visor.scale.set(1.18, 0.54, 0.18);
  visor.position.set(0, 0.3 * UNIT, -0.48 * UNIT);
  model.add(visor);

  const eyeMaterial = new THREE.MeshBasicMaterial({ color: COLOR.white });
  for (const x of [-0.11, 0.11]) {
    const eye = createMesh(
      new THREE.SphereGeometry(0.035 * UNIT, 10, 8),
      eyeMaterial.clone(),
      `${id}.eye`
    );
    eye.position.set(x * UNIT, 0.31 * UNIT, -0.575 * UNIT);
    model.add(eye);
  }

  const limbMaterial = bodyMaterial.clone();
  limbMaterial.color.offsetHSL(0, -0.05, -0.08);
  const limbs: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const arm = createMesh(
      new THREE.CapsuleGeometry(0.12 * UNIT, 0.22 * UNIT, 5, 10),
      limbMaterial.clone(),
      `${id}.arm`
    );
    arm.position.set(side * 0.56 * UNIT, -0.04 * UNIT, 0);
    arm.rotation.z = side * -0.28;
    model.add(arm);
    limbs.push(arm);

    const foot = createMesh(
      new THREE.SphereGeometry(0.19 * UNIT, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0x10182a, roughness: 0.5, metalness: 0.2 }),
      `${id}.foot`
    );
    foot.scale.set(1, 0.72, 1.35);
    foot.position.set(side * 0.26 * UNIT, -0.86 * UNIT, -0.08 * UNIT);
    model.add(foot);
    limbs.push(foot);
  }

  const localRing = createMesh(
    new THREE.TorusGeometry(0.82 * UNIT, 0.045 * UNIT, 8, 40),
    new THREE.MeshBasicMaterial({ color: COLOR.acid, transparent: true, opacity: 0.82 }),
    `${id}.local-ring`
  );
  localRing.rotation.x = Math.PI / 2;
  localRing.position.y = -0.92 * UNIT;
  localRing.visible = false;
  root.add(localRing);

  const marker = createLocalMarker(id);
  marker.visible = false;
  root.add(marker);

  return {
    root,
    model,
    role,
    glowMaterials: [bodyMaterial, visorMaterial],
    limbs,
    localRing,
    marker,
    initialized: false
  };
}

function createLocalMarker(id: string): THREE.Group {
  const marker = new THREE.Group();
  marker.name = `${id}.local-marker`;
  marker.position.y = 1.55 * UNIT;
  const diamond = createMesh(
    new THREE.OctahedronGeometry(0.16 * UNIT, 0),
    new THREE.MeshBasicMaterial({ color: COLOR.acid }),
    `${id}.marker-diamond`
  );
  const halo = createMesh(
    new THREE.TorusGeometry(0.23 * UNIT, 0.025 * UNIT, 6, 24),
    new THREE.MeshBasicMaterial({ color: COLOR.white, transparent: true, opacity: 0.72 }),
    `${id}.marker-halo`
  );
  halo.rotation.x = Math.PI / 2;
  marker.add(diamond, halo);
  return marker;
}

function createSweeperVisual(definition: PhysicsPredictionIslandMemberDefinition): MemberVisual {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  const shape = definition.colliders?.[0]?.shape;
  const width = shape?.type === "box" ? shape.width : 13;
  const height = shape?.type === "box" ? shape.height : 0.55;
  const depth = shape?.type === "box" ? (shape.depth ?? 0.55) : 0.55;
  const material = new THREE.MeshStandardMaterial({
    color: COLOR.coral,
    roughness: 0.24,
    metalness: 0.48,
    emissive: COLOR.coral,
    emissiveIntensity: 0.18
  });
  const bar = createMesh(
    new THREE.BoxGeometry(width * UNIT, height * UNIT, depth * UNIT),
    material,
    `${definition.id}.bar`
  );
  model.add(bar);
  for (let index = -5; index <= 5; index += 1) {
    const stripe = createMesh(
      new THREE.BoxGeometry(0.35 * UNIT, (height + 0.03) * UNIT, (depth + 0.035) * UNIT),
      new THREE.MeshBasicMaterial({ color: index % 2 === 0 ? COLOR.sun : 0x17152c }),
      `${definition.id}.stripe`
    );
    stripe.position.x = index * 1.05 * UNIT;
    stripe.rotation.z = 0.34;
    model.add(stripe);
  }
  const hubAnchor = new THREE.Group();
  hubAnchor.name = `${definition.id}.hub-anchor`;
  root.add(hubAnchor);
  const hub = createMesh(
    new THREE.CylinderGeometry(0.72 * UNIT, 0.86 * UNIT, 1.35 * UNIT, 24),
    new THREE.MeshStandardMaterial({
      color: 0x172040,
      roughness: 0.3,
      metalness: 0.65,
      emissive: COLOR.cyan,
      emissiveIntensity: 0.3
    }),
    `${definition.id}.hub`
  );
  hub.position.y = 0.36 * UNIT;
  hubAnchor.add(hub);
  const animationParts: HazardAnimationPart[] = [];
  for (let index = 0; index < 12; index += 1) {
    const beacon = createMesh(
      new THREE.BoxGeometry(0.22 * UNIT, 0.12 * UNIT, 0.62 * UNIT),
      new THREE.MeshBasicMaterial({ color: index % 2 === 0 ? COLOR.sun : COLOR.coral }),
      `${definition.id}.warning-beacon`
    );
    beacon.position.set((index / 11 - 0.5) * width * 0.9 * UNIT, 0.34 * UNIT, 0);
    model.add(beacon);
    animationParts.push(hazardAnimationPart(beacon, "warning-beacon", index / 12));
  }
  return {
    root,
    model,
    role: "sweeper",
    glowMaterials: [material],
    limbs: [],
    hazardKind: "rotating-sweeper",
    animationParts,
    initialized: false
  };
}

function createPlatformVisual(definition: PhysicsPredictionIslandMemberDefinition): MemberVisual {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  const shape = definition.colliders?.[0]?.shape;
  const width = shape?.type === "box" ? shape.width : 4;
  const height = shape?.type === "box" ? shape.height : 0.55;
  const depth = shape?.type === "box" ? (shape.depth ?? 3.2) : 3.2;
  const material = new THREE.MeshStandardMaterial({
    color: COLOR.violet,
    roughness: 0.3,
    metalness: 0.42,
    emissive: COLOR.violet,
    emissiveIntensity: 0.12
  });
  const animationParts: HazardAnimationPart[] = [];
  const schedule = HAZARD_SCHEDULES_BY_MEMBER_ID.get(definition.id);
  if (schedule !== undefined) {
    const initialPosition = definition.body.position ?? schedule.origin;
    const rail = createMesh(
      new THREE.BoxGeometry(
        (width + (schedule.axis === "x" ? schedule.travel * 2 + 1.2 : 0)) * UNIT,
        0.12 * UNIT,
        (depth + (schedule.axis === "z" ? schedule.travel * 2 + 1.2 : 0)) * UNIT
      ),
      new THREE.MeshStandardMaterial({
        color: 0x101f3c,
        roughness: 0.42,
        metalness: 0.72,
        emissive: COLOR.cyan,
        emissiveIntensity: 0.12
      }),
      `${definition.id}.guide-rail`
    );
    rail.position.set(
      -(initialPosition.x - schedule.origin.x) * UNIT,
      -0.36 * UNIT,
      -((initialPosition.z ?? 0) - (schedule.origin.z ?? 0)) * UNIT
    );
    root.add(rail);
    animationParts.push(hazardAnimationPart(rail, "platform-rail", 0));
  }
  const deck = createMesh(
    new THREE.BoxGeometry(width * UNIT, height * UNIT, depth * UNIT),
    material,
    `${definition.id}.deck`
  );
  model.add(deck);
  for (const x of [-0.34, 0, 0.34]) {
    const strip = createMesh(
      new THREE.BoxGeometry(0.07 * UNIT, 0.025 * UNIT, depth * 0.82 * UNIT),
      new THREE.MeshBasicMaterial({ color: x === 0 ? COLOR.white : COLOR.cyan }),
      `${definition.id}.light-strip`
    );
    strip.position.set(x * width * UNIT, (height / 2 + 0.02) * UNIT, 0);
    model.add(strip);
  }
  for (const side of [-1, 1]) {
    const rotor = createMesh(
      new THREE.CylinderGeometry(0.34 * UNIT, 0.34 * UNIT, depth * 0.82 * UNIT, 16),
      new THREE.MeshStandardMaterial({
        color: 0x16274a,
        roughness: 0.28,
        metalness: 0.7,
        emissive: COLOR.cyan,
        emissiveIntensity: 0.32
      }),
      `${definition.id}.drive-rotor`
    );
    rotor.rotation.x = Math.PI / 2;
    rotor.position.x = side * (width / 2 + 0.16) * UNIT;
    model.add(rotor);
    animationParts.push(hazardAnimationPart(rotor, "platform-rotor", side));
  }
  return {
    root,
    model,
    role: "platform",
    glowMaterials: [material],
    limbs: [],
    hazardKind: "moving-platform",
    hazardAxis: schedule?.axis,
    hazardOrigin: schedule?.origin,
    animationParts,
    initialized: false
  };
}

function createHazardVisual(definition: PhysicsPredictionIslandMemberDefinition): MemberVisual {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  const shape = definition.colliders?.[0]?.shape;
  const width = shape?.type === "box" ? shape.width : 4;
  const height = shape?.type === "box" ? shape.height : 0.4;
  const depth = shape?.type === "box" ? (shape.depth ?? 4) : 4;
  const kind = definition.body.userData?.hazardKind;
  const schedule = HAZARD_SCHEDULES_BY_MEMBER_ID.get(definition.id);
  const color =
    kind === "bounce-pad"
      ? COLOR.acid
      : kind === "wind-zone"
        ? COLOR.cyan
        : kind === "conveyor"
          ? COLOR.sun
          : COLOR.coral;
  const material = new THREE.MeshStandardMaterial({
    color: kind === "wind-zone" ? 0x163c58 : 0x223a5c,
    roughness: 0.3,
    metalness: 0.48,
    emissive: color,
    emissiveIntensity: 0.14,
    transparent: kind === "wind-zone",
    opacity: kind === "wind-zone" ? 0.28 : 1
  });
  const baseHeight = kind === "wind-zone" ? 0.08 : Math.min(height, 0.34);
  if (kind !== "shrinking-zone") {
    const base = createMesh(
      new THREE.BoxGeometry(width * UNIT, baseHeight * UNIT, depth * UNIT),
      material,
      `${definition.id}.deck`
    );
    base.position.y = kind === "wind-zone" ? -height * 0.5 * UNIT : 0;
    model.add(base);
  }

  const animationParts: HazardAnimationPart[] = [];

  if (kind === "conveyor") {
    const conveyorAxis = schedule?.axis === "x" ? "x" : "z";
    const beltLength = conveyorAxis === "x" ? width : depth;
    const beltCrossSize = conveyorAxis === "x" ? depth : width;
    const slatCount = Math.max(9, Math.min(22, Math.floor(beltLength / 0.8)));
    for (let index = 0; index < slatCount; index += 1) {
      const slat = createMesh(
        new THREE.BoxGeometry(
          (conveyorAxis === "x" ? 0.22 : beltCrossSize * 0.9) * UNIT,
          0.035 * UNIT,
          (conveyorAxis === "z" ? 0.22 : beltCrossSize * 0.9) * UNIT
        ),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
        `${definition.id}.conveyor-slat`
      );
      slat.position.set(
        conveyorAxis === "x" ? (index / slatCount - 0.5) * beltLength * UNIT : 0,
        (baseHeight / 2 + 0.03) * UNIT,
        conveyorAxis === "z" ? (index / slatCount - 0.5) * beltLength * UNIT : 0
      );
      model.add(slat);
      const part = hazardAnimationPart(slat, "conveyor-slat", index / slatCount);
      part.extent = beltLength * UNIT;
      animationParts.push(part);
    }
    for (const edge of [-beltLength / 2 + 0.42, beltLength / 2 - 0.42]) {
      const roller = createMesh(
        new THREE.CylinderGeometry(0.28 * UNIT, 0.28 * UNIT, beltCrossSize * 0.92 * UNIT, 18),
        new THREE.MeshStandardMaterial({
          color: 0x13294b,
          roughness: 0.28,
          metalness: 0.68,
          emissive: COLOR.sun,
          emissiveIntensity: 0.2
        }),
        `${definition.id}.conveyor-roller`
      );
      if (conveyorAxis === "x") {
        roller.rotation.x = Math.PI / 2;
        roller.position.x = edge * UNIT;
      } else {
        roller.rotation.z = Math.PI / 2;
        roller.position.z = edge * UNIT;
      }
      model.add(roller);
      animationParts.push(hazardAnimationPart(roller, "conveyor-roller", edge));
    }
  } else if (kind === "bounce-pad") {
    const deck = createMesh(
      new THREE.BoxGeometry(width * 0.88 * UNIT, 0.16 * UNIT, depth * 0.82 * UNIT),
      new THREE.MeshStandardMaterial({
        color: 0x243d48,
        roughness: 0.24,
        metalness: 0.48,
        emissive: COLOR.acid,
        emissiveIntensity: 0.45
      }),
      `${definition.id}.bounce-deck`
    );
    deck.position.y = 0.14 * UNIT;
    model.add(deck);
    animationParts.push(hazardAnimationPart(deck, "bounce-deck", 0));
    for (const scale of [0.34, 0.58, 0.82]) {
      const ring = createMesh(
        new THREE.TorusGeometry(Math.min(width, depth) * scale * 0.5 * UNIT, 0.055 * UNIT, 8, 40),
        new THREE.MeshBasicMaterial({ color: COLOR.acid, transparent: true, opacity: 0.75 }),
        `${definition.id}.bounce-ring`
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.25 * UNIT;
      model.add(ring);
      animationParts.push(hazardAnimationPart(ring, "bounce-ring", scale));
    }
  } else if (kind === "piston") {
    const ram = createMesh(
      new THREE.BoxGeometry(width * UNIT, height * UNIT, depth * UNIT),
      new THREE.MeshStandardMaterial({
        color: 0x384b68,
        roughness: 0.24,
        metalness: 0.78,
        emissive: COLOR.coral,
        emissiveIntensity: 0.12
      }),
      `${definition.id}.piston-ram`
    );
    model.add(ram);
    const housing = createMesh(
      new THREE.BoxGeometry(width * 1.35 * UNIT, height * 1.08 * UNIT, depth * 1.4 * UNIT),
      new THREE.MeshStandardMaterial({
        color: 0x17284a,
        roughness: 0.34,
        metalness: 0.72,
        emissive: COLOR.coral,
        emissiveIntensity: 0.2
      }),
      `${definition.id}.piston-housing`
    );
    housing.position.x = -Math.sign(schedule?.travel || 1) * width * 0.58 * UNIT;
    model.add(housing);
    animationParts.push(hazardAnimationPart(housing, "piston-housing", 0));
    for (let index = 0; index < 4; index += 1) {
      const indicator = createMesh(
        new THREE.BoxGeometry(0.2 * UNIT, 0.34 * UNIT, 0.08 * UNIT),
        new THREE.MeshBasicMaterial({ color: COLOR.coral }),
        `${definition.id}.piston-indicator`
      );
      indicator.position.set(0, (index - 1.5) * 0.5 * UNIT, (depth / 2 + 0.06) * UNIT);
      model.add(indicator);
      animationParts.push(hazardAnimationPart(indicator, "piston-indicator", index / 4));
    }
  } else if (kind === "crusher") {
    const platen = createMesh(
      new THREE.BoxGeometry(width * UNIT, height * UNIT, depth * UNIT),
      new THREE.MeshStandardMaterial({
        color: 0x3d465d,
        roughness: 0.24,
        metalness: 0.8,
        emissive: COLOR.coral,
        emissiveIntensity: 0.18
      }),
      `${definition.id}.crusher-platen`
    );
    model.add(platen);
    const housing = createMesh(
      new THREE.BoxGeometry(width * 1.22 * UNIT, 0.55 * UNIT, depth * 1.22 * UNIT),
      new THREE.MeshStandardMaterial({
        color: 0x152743,
        roughness: 0.32,
        metalness: 0.7,
        emissive: COLOR.coral,
        emissiveIntensity: 0.24
      }),
      `${definition.id}.crusher-housing`
    );
    model.add(housing);
    animationParts.push(hazardAnimationPart(housing, "crusher-housing", 0));
    for (const [index, x] of [-0.35, 0, 0.35].entries()) {
      const indicator = createMesh(
        new THREE.SphereGeometry(0.11 * UNIT, 10, 8),
        new THREE.MeshBasicMaterial({ color: COLOR.coral }),
        `${definition.id}.crusher-indicator`
      );
      indicator.position.set(x * width * UNIT, 0.38 * UNIT, (depth / 2 + 0.07) * UNIT);
      model.add(indicator);
      animationParts.push(hazardAnimationPart(indicator, "crusher-indicator", index / 3));
    }
  } else if (kind === "extending-wall") {
    const wall = createMesh(
      new THREE.BoxGeometry(width * UNIT, height * UNIT, depth * UNIT),
      new THREE.MeshStandardMaterial({
        color: 0x334967,
        roughness: 0.28,
        metalness: 0.7,
        emissive: COLOR.sun,
        emissiveIntensity: 0.16
      }),
      `${definition.id}.wall-panel`
    );
    model.add(wall);
    for (const y of [-0.3, 0, 0.3]) {
      const guide = createMesh(
        new THREE.BoxGeometry(0.12 * UNIT, 0.12 * UNIT, depth * 1.12 * UNIT),
        new THREE.MeshStandardMaterial({
          color: 0x101e36,
          roughness: 0.3,
          metalness: 0.75,
          emissive: COLOR.cyan,
          emissiveIntensity: 0.22
        }),
        `${definition.id}.wall-guide`
      );
      guide.position.y = y * height * UNIT;
      model.add(guide);
      animationParts.push(hazardAnimationPart(guide, "wall-guide", y));
    }
    for (const [index, y] of [-0.32, 0, 0.32].entries()) {
      const indicator = createMesh(
        new THREE.BoxGeometry(0.1 * UNIT, 0.22 * UNIT, 0.08 * UNIT),
        new THREE.MeshBasicMaterial({ color: COLOR.sun }),
        `${definition.id}.wall-indicator`
      );
      indicator.position.set(0, y * height * UNIT, (depth / 2 + 0.05) * UNIT);
      model.add(indicator);
      animationParts.push(hazardAnimationPart(indicator, "wall-indicator", index / 3));
    }
  } else if (kind === "crumble-floor") {
    const columns = Math.max(3, Math.min(7, Math.floor(width / 2)));
    const rows = Math.max(3, Math.min(7, Math.floor(depth / 2)));
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const tile = createMesh(
          new THREE.BoxGeometry(
            (width / columns - 0.08) * UNIT,
            Math.max(0.1, height * 0.72) * UNIT,
            (depth / rows - 0.08) * UNIT
          ),
          new THREE.MeshStandardMaterial({
            color: (row + column) % 2 === 0 ? 0x394765 : 0x263654,
            roughness: 0.5,
            metalness: 0.2,
            emissive: COLOR.coral,
            emissiveIntensity: 0.08
          }),
          `${definition.id}.crumble-tile`
        );
        tile.position.set(
          ((column + 0.5) / columns - 0.5) * width * UNIT,
          0.08 * UNIT,
          ((row + 0.5) / rows - 0.5) * depth * UNIT
        );
        model.add(tile);
        animationParts.push(
          hazardAnimationPart(tile, "crumble-tile", (row * columns + column) / (rows * columns))
        );
      }
    }
  } else if (kind === "shrinking-zone") {
    const radius = Math.min(width, depth) * 0.5;
    for (const scale of [1, 0.82, 0.64]) {
      const ring = createMesh(
        new THREE.TorusGeometry(radius * scale * UNIT, 0.1 * UNIT, 10, 64),
        new THREE.MeshBasicMaterial({ color: COLOR.coral, transparent: true, opacity: 0.72 }),
        `${definition.id}.safe-ring`
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = (-height * 0.5 + 0.12) * UNIT;
      model.add(ring);
      animationParts.push(hazardAnimationPart(ring, "safe-ring", scale));
    }
  } else {
    const laneCount = Math.max(3, Math.min(9, Math.floor(width / 1.8)));
    for (let lane = 0; lane < laneCount; lane += 1) {
      const strip = createMesh(
        new THREE.BoxGeometry(0.12 * UNIT, 0.025 * UNIT, depth * 0.8 * UNIT),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72 }),
        `${definition.id}.strip`
      );
      strip.position.set(
        ((lane - (laneCount - 1) / 2) / laneCount) * width * 0.84 * UNIT,
        (baseHeight / 2 + 0.02 - (kind === "wind-zone" ? height / 2 : 0)) * UNIT,
        0
      );
      model.add(strip);
    }
  }

  if (kind === "wind-zone") {
    for (const side of [-1, 1]) {
      for (let index = 0; index < 3; index += 1) {
        const fan = new THREE.Group();
        fan.name = `${definition.id}.fan`;
        const housing = createMesh(
          new THREE.TorusGeometry(0.48 * UNIT, 0.1 * UNIT, 8, 24),
          new THREE.MeshStandardMaterial({
            color: 0x1b3154,
            roughness: 0.3,
            metalness: 0.62,
            emissive: color,
            emissiveIntensity: 0.22
          }),
          `${definition.id}.fan-housing`
        );
        fan.add(housing);
        for (let bladeIndex = 0; bladeIndex < 4; bladeIndex += 1) {
          const blade = createMesh(
            new THREE.BoxGeometry(0.12 * UNIT, 0.68 * UNIT, 0.06 * UNIT),
            new THREE.MeshStandardMaterial({
              color: bladeIndex % 2 === 0 ? COLOR.cyan : COLOR.white,
              roughness: 0.22,
              metalness: 0.58,
              emissive: COLOR.cyan,
              emissiveIntensity: 0.3
            }),
            `${definition.id}.fan-blade`
          );
          blade.position.y = 0.22 * UNIT;
          blade.rotation.z = (bladeIndex * Math.PI) / 2;
          fan.add(blade);
        }
        const axle = createMesh(
          new THREE.CylinderGeometry(0.13 * UNIT, 0.13 * UNIT, 0.26 * UNIT, 12),
          new THREE.MeshStandardMaterial({ color: 0x0e1d37, roughness: 0.3, metalness: 0.76 }),
          `${definition.id}.fan-axle`
        );
        axle.rotation.x = Math.PI / 2;
        fan.add(axle);
        fan.position.set(
          side * (width / 2 - 0.55) * UNIT,
          (index + 0.7) * (height / 3.4) * UNIT - height * 0.45 * UNIT,
          (index - 1) * depth * 0.25 * UNIT
        );
        if (schedule?.axis === "x") fan.rotation.y = Math.PI / 2;
        else if (schedule?.axis === "y") fan.rotation.x = Math.PI / 2;
        model.add(fan);
        animationParts.push(hazardAnimationPart(fan, "wind-fan", side * (index + 1)));
      }
    }
    for (let index = 0; index < 12; index += 1) {
      const stream = createMesh(
        new THREE.BoxGeometry(0.055 * UNIT, 0.055 * UNIT, depth * 0.38 * UNIT),
        new THREE.MeshBasicMaterial({ color: COLOR.cyan, transparent: true, opacity: 0.5 }),
        `${definition.id}.wind-stream`
      );
      stream.position.set(
        ((index % 4) - 1.5) * width * 0.18 * UNIT,
        (Math.floor(index / 4) - 1) * height * 0.25 * UNIT,
        0
      );
      stream.rotation.y = Math.PI / 2;
      model.add(stream);
      const part = hazardAnimationPart(stream, "wind-stream", index / 12);
      part.extent = width * UNIT;
      animationParts.push(part);
    }
  }
  return {
    root,
    model,
    role: "hazard",
    glowMaterials: [material],
    limbs: [],
    hazardKind: typeof kind === "string" ? kind : undefined,
    hazardAxis: schedule?.axis,
    hazardStrength: schedule?.strength,
    hazardOrigin: schedule?.origin,
    animationParts,
    initialized: false
  };
}

function createPropVisual(definition: PhysicsPredictionIslandMemberDefinition): MemberVisual {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  const shape = definition.colliders?.[0]?.shape;
  const color = colorForRole("prop", definition.id);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: definition.id.includes("ball") ? 0.24 : 0.38,
    metalness: 0.18,
    emissive: color,
    emissiveIntensity: 0.08
  });
  let geometry: THREE.BufferGeometry;
  if (shape?.type === "sphere") {
    geometry = new THREE.SphereGeometry(shape.radius * UNIT, 32, 20);
  } else if (shape?.type === "box") {
    geometry = new THREE.BoxGeometry(
      shape.width * UNIT,
      shape.height * UNIT,
      (shape.depth ?? 1) * UNIT,
      2,
      2,
      2
    );
  } else {
    geometry = new THREE.DodecahedronGeometry(0.7 * UNIT, 1);
  }
  const prop = createMesh(geometry, material, `${definition.id}.body`);
  model.add(prop);

  if (shape?.type === "sphere") {
    for (const rotation of [0, Math.PI / 2]) {
      const ring = createMesh(
        new THREE.TorusGeometry(shape.radius * 1.02 * UNIT, 0.045 * UNIT, 8, 40),
        new THREE.MeshBasicMaterial({ color: COLOR.ink }),
        `${definition.id}.ring`
      );
      ring.rotation.x = rotation;
      model.add(ring);
    }
  } else {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: COLOR.ink, transparent: true, opacity: 0.7 })
    );
    edges.name = `${definition.id}.edges`;
    model.add(edges);
  }
  return {
    root,
    model,
    role: "prop",
    glowMaterials: [material],
    limbs: [],
    initialized: false
  };
}

function createItemVisual(
  member: PhysicsPredictionIslandMemberDefinition,
  definition: ArenaCompiledItemDefinition
): MemberVisual {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.name = `${member.id}.item-model`;
  root.add(model);
  const recipe =
    ITEM_VISUAL_RECIPES_BY_PRESENTATION_ID.get(definition.presentationId) ??
    itemVisualRecipe(
      definition.shape.type === "sphere" ? "ball" : "block",
      COLOR.cyan,
      COLOR.white,
      [0.68, 0, -0.46],
      [0, 0, 0],
      0.75
    );
  const primary = new THREE.MeshStandardMaterial({
    color: recipe.primary,
    roughness: recipe.style === "ball" || recipe.style === "glove" ? 0.34 : 0.24,
    metalness: recipe.style === "orb" || recipe.style === "baton" ? 0.5 : 0.14,
    emissive: recipe.primary,
    emissiveIntensity: recipe.style === "orb" || recipe.style === "baton" ? 0.42 : 0.12
  });
  const accent = new THREE.MeshStandardMaterial({
    color: recipe.accent,
    roughness: 0.28,
    metalness: 0.32,
    emissive: recipe.accent,
    emissiveIntensity: 0.42
  });
  const dark = new THREE.MeshStandardMaterial({
    color: COLOR.ink,
    roughness: 0.4,
    metalness: 0.42
  });

  if (recipe.style === "ball") {
    const radius = definition.shape.type === "sphere" ? definition.shape.radius : 0.48;
    model.add(
      createMesh(new THREE.SphereGeometry(radius * UNIT, 32, 20), primary, `${member.id}.item-body`)
    );
    for (const [index, rotation] of [0, Math.PI / 2].entries()) {
      const stripe = createMesh(
        new THREE.TorusGeometry(radius * 1.01 * UNIT, 0.055 * UNIT, 8, 40),
        index === 0 ? accent : dark,
        `${member.id}.item-stripe`
      );
      stripe.rotation.x = rotation;
      model.add(stripe);
    }
  } else if (recipe.style === "block") {
    const shape =
      definition.shape.type === "box"
        ? definition.shape
        : { width: 0.85, height: 0.7, depth: 0.85 };
    const bodyGeometry = new THREE.BoxGeometry(
      shape.width * UNIT,
      shape.height * UNIT,
      shape.depth * UNIT,
      2,
      2,
      2
    );
    model.add(createMesh(bodyGeometry, primary, `${member.id}.item-body`));
    const core = createMesh(
      new THREE.BoxGeometry(
        shape.width * 0.62 * UNIT,
        shape.height * 0.64 * UNIT,
        (shape.depth + 0.035) * UNIT
      ),
      accent,
      `${member.id}.item-core`
    );
    model.add(core);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(bodyGeometry),
      new THREE.LineBasicMaterial({ color: COLOR.ink })
    );
    edges.name = `${member.id}.item-edges`;
    model.add(edges);
  } else if (recipe.style === "orb") {
    const radius = definition.shape.type === "sphere" ? definition.shape.radius : 0.6;
    const shellMaterial = primary.clone();
    shellMaterial.transparent = true;
    shellMaterial.opacity = 0.88;
    model.add(
      createMesh(
        new THREE.IcosahedronGeometry(radius * UNIT, 3),
        shellMaterial,
        `${member.id}.item-body`
      )
    );
    const core = createMesh(
      new THREE.SphereGeometry(radius * 0.42 * UNIT, 20, 14),
      accent,
      `${member.id}.item-core`
    );
    model.add(core);
    for (let index = 0; index < 3; index += 1) {
      const ring = createMesh(
        new THREE.TorusGeometry(radius * (1.08 + index * 0.08) * UNIT, 0.035 * UNIT, 7, 42),
        index % 2 === 0 ? accent : dark,
        `${member.id}.item-orbit`
      );
      ring.rotation.set(index * 0.68, index * 0.82, index * 0.44);
      model.add(ring);
    }
  } else if (recipe.style === "hammer") {
    const handle = createMesh(
      new THREE.CylinderGeometry(0.1 * UNIT, 0.13 * UNIT, 1.18 * UNIT, 14),
      dark,
      `${member.id}.item-handle`
    );
    handle.position.y = -0.18 * UNIT;
    const head = createMesh(
      new THREE.BoxGeometry(0.86 * UNIT, 0.48 * UNIT, 0.5 * UNIT, 3, 2, 2),
      primary,
      `${member.id}.item-body`
    );
    head.position.y = 0.55 * UNIT;
    const cap = createMesh(
      new THREE.BoxGeometry(0.94 * UNIT, 0.19 * UNIT, 0.56 * UNIT),
      accent,
      `${member.id}.item-cap`
    );
    cap.position.y = 0.59 * UNIT;
    model.add(handle, head, cap);
  } else if (recipe.style === "glove") {
    const cuff = createMesh(
      new THREE.CylinderGeometry(0.28 * UNIT, 0.36 * UNIT, 0.42 * UNIT, 18),
      accent,
      `${member.id}.item-cuff`
    );
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.28 * UNIT;
    const palm = createMesh(
      new THREE.BoxGeometry(0.62 * UNIT, 0.56 * UNIT, 0.62 * UNIT, 3, 3, 3),
      primary,
      `${member.id}.item-body`
    );
    palm.position.z = -0.12 * UNIT;
    model.add(cuff, palm);
    for (let index = 0; index < 4; index += 1) {
      const knuckle = createMesh(
        new THREE.SphereGeometry(0.15 * UNIT, 14, 10),
        primary,
        `${member.id}.item-knuckle`
      );
      knuckle.position.set((index - 1.5) * 0.16 * UNIT, 0.27 * UNIT, -0.27 * UNIT);
      model.add(knuckle);
    }
  } else {
    const shaft = createMesh(
      new THREE.CylinderGeometry(0.12 * UNIT, 0.15 * UNIT, 1.18 * UNIT, 16),
      primary,
      `${member.id}.item-body`
    );
    model.add(shaft);
    for (const y of [-0.48, -0.2, 0.2, 0.48]) {
      const coil = createMesh(
        new THREE.TorusGeometry(0.18 * UNIT, 0.035 * UNIT, 7, 24),
        accent,
        `${member.id}.item-coil`
      );
      coil.rotation.x = Math.PI / 2;
      coil.position.y = y * UNIT;
      model.add(coil);
    }
  }

  return {
    root,
    model,
    role: "prop",
    glowMaterials: [primary, accent],
    limbs: [],
    itemPresentationId: definition.presentationId,
    initialized: false
  };
}

function updateCarriedItemVisual(
  visual: MemberVisual,
  owner: MemberVisual,
  item: ArenaPresentedItemState,
  tick: number
): void {
  const recipe =
    (visual.itemPresentationId === undefined
      ? undefined
      : ITEM_VISUAL_RECIPES_BY_PRESENTATION_ID.get(visual.itemPresentationId)) ??
    itemVisualRecipe("block", COLOR.cyan, COLOR.white, [0.68, 0, -0.46], [0, 0, 0], 0.75);
  if (visual.root.parent !== owner.model) owner.model.add(visual.root);
  const windup = item.state === "windup" ? item.normalizedActionTime : 0;
  const melee = recipe.style === "hammer" || recipe.style === "glove" || recipe.style === "baton";
  visual.root.position.set(
    recipe.carryPosition[0] * UNIT,
    (recipe.carryPosition[1] + Math.sin(tick * 0.08) * 0.012) * UNIT,
    (recipe.carryPosition[2] + windup * (melee ? 0.22 : 0.32)) * UNIT
  );
  visual.root.rotation.set(
    recipe.carryRotation[0] + windup * (melee ? -0.28 : 0.16),
    recipe.carryRotation[1] + windup * (melee ? 0.18 : 0),
    recipe.carryRotation[2] + windup * (melee ? -0.72 : -0.18)
  );
  visual.root.scale.setScalar(recipe.carryScale * (1 + windup * 0.04));
  if (recipe.style === "orb") visual.model.rotation.y = tick * 0.045;
  visual.initialized = true;
}

function itemVisualRecipe(
  style: ArenaItemVisualRecipe["style"],
  primary: number,
  accent: number,
  carryPosition: ArenaItemVisualRecipe["carryPosition"],
  carryRotation: ArenaItemVisualRecipe["carryRotation"],
  carryScale: number
): ArenaItemVisualRecipe {
  return { style, primary, accent, carryPosition, carryRotation, carryScale };
}

function updateMemberVisual(
  visual: MemberVisual,
  body: PhysicsBodyState,
  tick: number,
  deltaMs: number,
  local: boolean,
  presented?: ArenaPresentedActorState
): void {
  const alpha = visual.initialized ? 1 - Math.exp(-deltaMs / (local ? 38 : 72)) : 1;
  const actor = visual.role === "player" || visual.role === "bot";
  // Rapier yaw belongs to the collision capsule. Runner facing is presentation state derived from
  // horizontal velocity; applying both rotations would make every contact yaw the model twice.
  applyTransform(visual.root, body.position, actor ? undefined : body.rotation, alpha);
  visual.initialized = true;
  if (!actor) return;

  const velocity = body.linearVelocity;
  const horizontalSpeed = presented?.horizontalSpeed ?? Math.hypot(velocity.x, velocity.z ?? 0);
  const stride = Math.min(1, presented?.normalizedSpeed ?? horizontalSpeed / 6.4);
  const targetYaw =
    presented === undefined
      ? horizontalSpeed > 0.12
        ? Math.atan2(-velocity.x, -(velocity.z ?? 0))
        : visual.root.rotation.y
      : presented.facingYaw + Math.PI;
  if (horizontalSpeed > 0.12 || presented !== undefined) {
    visual.root.rotation.y = lerpAngle(visual.root.rotation.y, targetYaw, alpha * 0.7);
  }
  const step = tick * 0.42;
  const baseState = presented?.baseState ?? (horizontalSpeed > 0.18 ? "run" : "idle");
  const running = baseState === "run";
  visual.model.position.y = THREE.MathUtils.lerp(
    visual.model.position.y,
    running ? Math.abs(Math.sin(step)) * stride * 0.055 * UNIT : 0,
    alpha
  );
  const baseTilt =
    baseState === "dive"
      ? 1.08
      : baseState === "fall"
        ? -0.12
        : baseState === "jump"
          ? 0.1
          : running
            ? Math.min(0.18, stride * 0.14)
            : 0;
  visual.model.rotation.x = THREE.MathUtils.lerp(visual.model.rotation.x, baseTilt, alpha);
  for (const [index, limb] of visual.limbs.entries()) {
    const side = index % 2 === 0 ? 1 : -1;
    const isArm = index % 2 === 0;
    const actionRaised =
      isArm &&
      (presented?.carrying === true ||
        presented?.actionClip?.includes("windup") === true ||
        presented?.actionClip?.includes("item-action") === true);
    const limbTarget = actionRaised
      ? -1.05
      : running
        ? Math.sin(step + (side * Math.PI) / 2) * stride * 0.42
        : 0;
    limb.rotation.x = THREE.MathUtils.lerp(limb.rotation.x, limbTarget, alpha);
  }
  const reaction = presented?.reactionClip?.includes("impact") === true;
  const stagger = baseState === "stagger";
  const eliminated = baseState === "eliminated";
  const targetRoll = eliminated
    ? Math.PI / 2
    : reaction || stagger
      ? Math.sin(tick * 0.9) * (reaction ? 0.28 : 0.16)
      : 0;
  visual.model.rotation.z = THREE.MathUtils.lerp(visual.model.rotation.z, targetRoll, alpha);
  const targetScaleY = eliminated ? 0.72 : baseState === "recovery" ? 0.86 : 1;
  visual.model.scale.y = THREE.MathUtils.lerp(visual.model.scale.y, targetScaleY, alpha);
  if (visual.localRing) visual.localRing.rotation.z = tick * 0.035;
  if (visual.marker) {
    visual.marker.position.y = (1.55 + Math.sin(tick * 0.08) * 0.08) * UNIT;
    visual.marker.rotation.y += deltaMs * 0.0024;
  }
}

function setLocalPresentation(visual: MemberVisual, local: boolean): void {
  if (visual.localRing) visual.localRing.visible = local;
  if (visual.marker) visual.marker.visible = local;
  for (const material of visual.glowMaterials) {
    material.emissiveIntensity = local ? 0.52 : visual.role === "bot" ? 0.05 : 0.14;
  }
}

function updateHazardPresentation(
  visual: MemberVisual,
  phase: ArenaFeedbackSnapshot["hazards"][number]["phase"] | undefined,
  body: PhysicsBodyState,
  tick: number
): void {
  if (visual.role !== "sweeper" && visual.role !== "platform" && visual.role !== "hazard") {
    return;
  }
  const resolvedPhase = phase ?? "active";
  const pulse = 0.5 + Math.sin(tick * 0.22) * 0.5;
  const intensity =
    resolvedPhase === "warning"
      ? 0.45 + pulse * 0.55
      : resolvedPhase === "active"
        ? 1.2
        : resolvedPhase === "recovery"
          ? 0.2
          : 0.08;
  for (const material of visual.glowMaterials) material.emissiveIntensity = intensity;
  const activity = resolvedPhase === "active" ? 1 : resolvedPhase === "warning" ? 0.38 : 0.12;
  const direction = Math.sign(visual.hazardStrength ?? 1) || 1;
  for (const part of visual.animationParts ?? []) {
    part.object.position.copy(part.basePosition);
    part.object.scale.copy(part.baseScale);
    if (part.kind === "conveyor-slat") {
      const extent = part.extent ?? UNIT;
      const progress = positiveWrap(part.phase + tick * 0.012 * direction, 1) - 0.5;
      if (visual.hazardAxis === "x") part.object.position.x = progress * extent;
      else part.object.position.z = progress * extent;
    } else if (part.kind === "conveyor-roller") {
      if (visual.hazardAxis === "x") part.object.rotation.z = tick * 0.09 * direction;
      else part.object.rotation.x = tick * 0.09 * direction;
    } else if (part.kind === "platform-rail") {
      const origin = visual.hazardOrigin;
      if (origin !== undefined) {
        part.object.position.x -= (body.position.x - origin.x) * UNIT;
        part.object.position.y -= (body.position.y - origin.y) * UNIT;
        part.object.position.z -= ((body.position.z ?? 0) - (origin.z ?? 0)) * UNIT;
      }
    } else if (part.kind === "platform-rotor") {
      part.object.rotation.y = tick * 0.08 * (part.phase < 0 ? -1 : 1);
    } else if (part.kind === "wind-fan") {
      part.object.rotation.z = tick * 0.16 * activity * direction + part.phase;
    } else if (part.kind === "wind-stream") {
      const extent = part.extent ?? UNIT;
      const progress = positiveWrap(part.phase + tick * 0.022 * direction, 1) - 0.5;
      if (visual.hazardAxis === "z") part.object.position.z = progress * extent;
      else part.object.position.x = progress * extent;
      part.object.scale.x = 0.35 + activity * 0.9;
    } else if (part.kind === "bounce-deck") {
      const bounce = Math.max(0, Math.sin((tick + part.phase * 30) * 0.16)) * activity;
      part.object.position.y += bounce * 0.22 * UNIT;
      part.object.scale.y = 1 - bounce * 0.28;
    } else if (part.kind === "bounce-ring") {
      const expansion = positiveWrap(tick * 0.025 + part.phase, 1);
      part.object.scale.setScalar(0.65 + expansion * 0.7);
      if (part.object instanceof THREE.Mesh && part.object.material instanceof THREE.Material) {
        part.object.material.opacity = (1 - expansion) * activity;
      }
    } else if (part.kind === "piston-housing") {
      const origin = visual.hazardOrigin;
      if (origin !== undefined) {
        part.object.position.x -= (body.position.x - origin.x) * UNIT;
        part.object.position.y -= (body.position.y - origin.y) * UNIT;
        part.object.position.z -= ((body.position.z ?? 0) - (origin.z ?? 0)) * UNIT;
      }
    } else if (part.kind === "crusher-housing") {
      const origin = visual.hazardOrigin;
      if (origin !== undefined) {
        part.object.position.x -= (body.position.x - origin.x) * UNIT;
        part.object.position.y -= (body.position.y - origin.y) * UNIT;
        part.object.position.z -= ((body.position.z ?? 0) - (origin.z ?? 0)) * UNIT;
      }
    } else if (part.kind === "wall-guide") {
      part.object.scale.z = 0.75 + activity * 0.35;
    } else if (
      part.kind === "piston-indicator" ||
      part.kind === "crusher-indicator" ||
      part.kind === "wall-indicator" ||
      part.kind === "warning-beacon"
    ) {
      part.object.visible = positiveWrap(tick * 0.045 + part.phase, 1) < activity;
    } else if (part.kind === "crumble-tile") {
      const collapseProgress = Number(body.userData?.collapseProgress ?? 0);
      const shake = Math.max(0, collapseProgress - 0.22) * (0.25 + activity);
      part.object.rotation.x = Math.sin(tick * 0.33 + part.phase * 19) * shake * 0.16;
      part.object.rotation.z = Math.cos(tick * 0.29 + part.phase * 23) * shake * 0.14;
      part.object.position.y -= Math.max(0, collapseProgress - 0.58 - part.phase * 0.18) * UNIT;
    } else if (part.kind === "safe-ring") {
      const safeScale = Number(body.userData?.safeScale ?? 1);
      part.object.scale.setScalar(Math.max(0.18, safeScale));
      part.object.rotation.z = tick * 0.008 * (part.phase > 0.8 ? 1 : -1);
    }
  }
}

function hazardAnimationPart(
  object: THREE.Object3D,
  kind: HazardAnimationPart["kind"],
  phase: number
): HazardAnimationPart {
  return {
    object,
    kind,
    phase,
    basePosition: object.position.clone(),
    baseScale: object.scale.clone()
  };
}

function positiveWrap(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function updateCamera(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  local: MemberVisual | undefined,
  deltaMs: number,
  elapsedMs: number,
  shake: number,
  inspect = false
): void {
  const desiredPosition = CAMERA_IDLE_POSITION.clone();
  const desiredTarget = CAMERA_IDLE_TARGET.clone();
  if (local && inspect) {
    desiredPosition.set(
      local.root.position.x + 8.5 * UNIT,
      local.root.position.y + 7.4 * UNIT,
      local.root.position.z + 9.5 * UNIT
    );
    desiredTarget.set(
      local.root.position.x,
      local.root.position.y + 0.35 * UNIT,
      local.root.position.z
    );
  } else if (local) {
    desiredPosition.set(
      local.root.position.x,
      local.root.position.y + 5.2 * UNIT,
      local.root.position.z + 8.8 * UNIT
    );
    desiredTarget.set(
      local.root.position.x,
      local.root.position.y + 0.55 * UNIT,
      local.root.position.z - 4.8 * UNIT
    );
  }
  const alpha = 1 - Math.exp(-deltaMs / 190);
  camera.position.lerp(desiredPosition, camera.position.lengthSq() === 0 ? 1 : alpha);
  target.lerp(desiredTarget, alpha * 1.3);
  if (shake > 0) {
    camera.position.x += Math.sin(elapsedMs * 0.052) * shake;
    camera.position.y += Math.cos(elapsedMs * 0.041) * shake * 0.5;
  }
  camera.lookAt(target);
}

function renderScene(native: ThreeRendererNative, camera: THREE.PerspectiveCamera): void {
  const canvas = native.renderer?.domElement;
  const width = canvas?.clientWidth || canvas?.width || 1280;
  const height = canvas?.clientHeight || canvas?.height || 720;
  const nextAspect = width / Math.max(1, height);
  if (Math.abs(camera.aspect - nextAspect) > 0.001) {
    camera.aspect = nextAspect;
    camera.updateProjectionMatrix();
  }
  if (native.renderer) native.renderer.render(native.scene, camera);
  else native.render();
}

function createEffect(
  parent: THREE.Group,
  event: ArenaEffectPresentationEvent,
  origin: THREE.Vector3
): ArenaFx {
  const root = new THREE.Group();
  root.name = `knockout.fx.${event.kind}.${event.phase}`;
  root.position.copy(origin);
  const particles: FxParticle[] = [];
  const confirmed = event.phase === "confirm" || event.phase === "replace";
  const color = event.kind === "jump" ? COLOR.cyan : confirmed ? COLOR.sun : COLOR.coral;
  const ring = createMesh(
    new THREE.TorusGeometry((event.kind === "jump" ? 0.62 : 0.38) * UNIT, 0.045 * UNIT, 8, 36),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: confirmed ? 0.92 : 0.62 }),
    `${root.name}.ring`
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = event.kind === "jump" ? -0.72 * UNIT : 0;
  root.add(ring);

  const particleCount = event.kind === "jump" ? 8 : confirmed ? 16 : 9;
  for (let index = 0; index < particleCount; index += 1) {
    const angle = (index / particleCount) * Math.PI * 2;
    const particle = createMesh(
      new THREE.OctahedronGeometry((confirmed ? 0.055 : 0.035) * UNIT, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
      `${root.name}.particle`
    );
    root.add(particle);
    particles.push({
      mesh: particle,
      velocity: new THREE.Vector3(
        Math.cos(angle) * (confirmed ? 2.9 : 1.8) * UNIT,
        (event.kind === "jump" ? 2.4 : 1.2 + (index % 3) * 0.45) * UNIT,
        Math.sin(angle) * (confirmed ? 2.9 : 1.8) * UNIT
      )
    });
  }
  parent.add(root);
  return {
    effectId: event.effectId,
    root,
    ageMs: 0,
    durationMs: event.kind === "jump" ? 620 : 480,
    particles
  };
}

function updateEffects(effects: ArenaFx[], deltaMs: number): void {
  const deltaSeconds = deltaMs / 1000;
  for (let index = effects.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];
    if (!effect) continue;
    effect.ageMs += deltaMs;
    const progress = Math.min(1, effect.ageMs / effect.durationMs);
    effect.root.scale.setScalar(1 + progress * 1.4);
    for (const particle of effect.particles) {
      particle.mesh.position.addScaledVector(particle.velocity, deltaSeconds);
      particle.velocity.y -= 6.5 * UNIT * deltaSeconds;
      particle.mesh.rotation.x += deltaSeconds * 5;
      particle.mesh.rotation.y += deltaSeconds * 7;
    }
    effect.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if ("opacity" in material) material.opacity = (1 - progress) ** 1.5;
      }
    });
    if (progress < 1) continue;
    removeEffect(effects, index);
  }
}

function removeEffect(effects: ArenaFx[], index: number): void {
  const effect = effects[index];
  if (!effect) return;
  effect.root.removeFromParent();
  disposeObject(effect.root);
  effects.splice(index, 1);
}

function createEdgeLights(course: THREE.Group): void {
  const material = new THREE.MeshBasicMaterial({ color: COLOR.cyan });
  const halfWidth = QUALIFIER_TRACK.width / 2 - 0.3;
  for (const x of [-halfWidth, halfWidth]) {
    const edge = createMesh(
      new THREE.BoxGeometry(0.08 * UNIT, 0.025 * UNIT, QUALIFIER_TRACK.depth * UNIT),
      material.clone(),
      "knockout.course.edge-light"
    );
    edge.position.set(x * UNIT, 0.055 * UNIT, QUALIFIER_TRACK.centerZ * UNIT);
    course.add(edge);
  }
  for (const z of [QUALIFIER_TRACK.finishZ, QUALIFIER_TRACK.startZ + 4]) {
    const edge = createMesh(
      new THREE.BoxGeometry(QUALIFIER_TRACK.width * UNIT, 0.025 * UNIT, 0.08 * UNIT),
      new THREE.MeshBasicMaterial({
        color: z === QUALIFIER_TRACK.finishZ ? COLOR.coral : COLOR.acid
      }),
      "knockout.course.end-light"
    );
    edge.position.set(0, 0.055 * UNIT, z * UNIT);
    course.add(edge);
  }
}

function createLaneGraphics(course: THREE.Group): void {
  for (const x of [-5.2, 0, 5.2]) {
    const lane = createMesh(
      new THREE.BoxGeometry(0.035 * UNIT, 0.018 * UNIT, (QUALIFIER_TRACK.depth - 5) * UNIT),
      new THREE.MeshBasicMaterial({ color: 0x6d9bbd, transparent: true, opacity: 0.22 }),
      "knockout.course.lane"
    );
    lane.position.set(x * UNIT, 0.065 * UNIT, QUALIFIER_TRACK.centerZ * UNIT);
    course.add(lane);
  }
  for (let z = QUALIFIER_TRACK.startZ - 8; z > QUALIFIER_TRACK.finishZ + 4; z -= 12) {
    for (const x of [-2.4, 2.4]) {
      for (const side of [-1, 1]) {
        const slash = createMesh(
          new THREE.BoxGeometry(0.18 * UNIT, 0.022 * UNIT, 1.25 * UNIT),
          new THREE.MeshBasicMaterial({ color: COLOR.white, transparent: true, opacity: 0.45 }),
          "knockout.course.chevron"
        );
        slash.position.set((x + side * 0.38) * UNIT, 0.075 * UNIT, z * UNIT);
        slash.rotation.y = side * 0.52;
        course.add(slash);
      }
    }
  }
}

function createStartGrid(course: THREE.Group): void {
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const tile = createMesh(
        new THREE.BoxGeometry(1.1 * UNIT, 0.025 * UNIT, 0.72 * UNIT),
        new THREE.MeshBasicMaterial({
          color: (row + column) % 2 === 0 ? COLOR.white : COLOR.ink,
          transparent: true,
          opacity: 0.68
        }),
        "knockout.course.start-tile"
      );
      tile.position.set(
        (column - 3.5) * 1.1 * UNIT,
        0.08 * UNIT,
        (QUALIFIER_TRACK.startZ - 1.2 + row * 0.72) * UNIT
      );
      course.add(tile);
    }
  }
}

function createCourseZoneArchitecture(course: THREE.Group): void {
  const zones = [
    { z: -12, color: COLOR.cyan },
    { z: -46, color: COLOR.coral },
    { z: -80, color: COLOR.sun },
    { z: -111, color: COLOR.acid },
    { z: -132, color: COLOR.violet },
    { z: -155, color: COLOR.cyan },
    { z: -181, color: COLOR.coral },
    { z: -199, color: COLOR.acid }
  ] as const;
  for (const [index, zone] of zones.entries()) {
    const arch = new THREE.Group();
    arch.name = `knockout.course.zone.${index + 1}`;
    arch.position.z = zone.z * UNIT;
    for (const side of [-1, 1]) {
      const tower = createMesh(
        new THREE.BoxGeometry(0.45 * UNIT, 5.2 * UNIT, 0.7 * UNIT),
        new THREE.MeshStandardMaterial({
          color: 0x162b4c,
          roughness: 0.32,
          metalness: 0.56,
          emissive: zone.color,
          emissiveIntensity: 0.2
        }),
        `${arch.name}.tower`
      );
      tower.position.set(side * 12.7 * UNIT, 2.6 * UNIT, 0);
      arch.add(tower);
    }
    const beam = createMesh(
      new THREE.BoxGeometry(25.8 * UNIT, 0.34 * UNIT, 0.48 * UNIT),
      new THREE.MeshStandardMaterial({
        color: 0x1b3154,
        roughness: 0.28,
        metalness: 0.62,
        emissive: zone.color,
        emissiveIntensity: 0.26
      }),
      `${arch.name}.beam`
    );
    beam.position.y = 5.15 * UNIT;
    arch.add(beam);
    for (let lampIndex = 0; lampIndex < 11; lampIndex += 1) {
      const lamp = createMesh(
        new THREE.BoxGeometry(0.5 * UNIT, 0.08 * UNIT, 0.12 * UNIT),
        new THREE.MeshBasicMaterial({ color: zone.color }),
        `${arch.name}.lamp`
      );
      lamp.position.set((lampIndex - 5) * 2.1 * UNIT, 4.93 * UNIT, 0);
      arch.add(lamp);
    }
    course.add(arch);
  }

  for (const placement of QUALIFIER_STATIC_PLACEMENTS.filter(({ role }) => role === "wall")) {
    const beacon = createMesh(
      new THREE.BoxGeometry(0.12 * UNIT, 0.12 * UNIT, (placement.size.depth - 1) * UNIT),
      new THREE.MeshBasicMaterial({ color: COLOR.cyan, transparent: true, opacity: 0.48 }),
      "knockout.course.rail-beacon"
    );
    beacon.position.set(
      placement.position.x * UNIT,
      (placement.position.y + placement.size.height / 2 + 0.08) * UNIT,
      (placement.position.z ?? 0) * UNIT
    );
    course.add(beacon);
  }
}

function createQualifierRouteMarkers(course: THREE.Group): void {
  const checkpoints = QUALIFIER_ROUTE_VOLUMES.filter(({ kind }) => kind === "checkpoint").sort(
    (left, right) => (left.routeOrder ?? 0) - (right.routeOrder ?? 0)
  );
  for (const [index, checkpoint] of checkpoints.entries()) {
    const checkpointNumber = index + 1;
    const accent = checkpointNumber % 2 === 0 ? COLOR.acid : COLOR.cyan;
    const z = (checkpoint.position.z ?? 0) * UNIT;
    const halfWidth = Math.min(9.45, checkpoint.size.width / 2 - 0.5);
    const gate = new THREE.Group();
    gate.name = `knockout.course.checkpoint.${checkpointNumber}`;
    gate.position.z = z;

    const laneBand = createMesh(
      new THREE.BoxGeometry(
        Math.min(19.2, checkpoint.size.width) * UNIT,
        0.035 * UNIT,
        0.62 * UNIT
      ),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.58 }),
      `${gate.name}.lane-band`
    );
    laneBand.position.y = 0.09 * UNIT;
    gate.add(laneBand);

    for (const side of [-1, 1]) {
      const pylon = createMesh(
        new THREE.BoxGeometry(0.28 * UNIT, 2.7 * UNIT, 0.38 * UNIT),
        new THREE.MeshStandardMaterial({
          color: 0x183559,
          roughness: 0.25,
          metalness: 0.55,
          emissive: accent,
          emissiveIntensity: 0.3
        }),
        `${gate.name}.pylon`
      );
      pylon.position.set(side * halfWidth * UNIT, 1.42 * UNIT, 0);
      pylon.rotation.z = side * -0.1;
      gate.add(pylon);

      const beacon = createMesh(
        new THREE.OctahedronGeometry(0.23 * UNIT, 0),
        new THREE.MeshBasicMaterial({ color: accent }),
        `${gate.name}.beacon`
      );
      beacon.position.set(side * (halfWidth - 0.12) * UNIT, 3.05 * UNIT, 0);
      beacon.rotation.y = Math.PI / 4;
      gate.add(beacon);
    }

    const header = createMesh(
      new THREE.BoxGeometry(3.35 * UNIT, 0.18 * UNIT, 0.25 * UNIT),
      new THREE.MeshBasicMaterial({ color: accent }),
      `${gate.name}.header`
    );
    header.position.y = 3.12 * UNIT;
    gate.add(header);

    for (let markerIndex = 0; markerIndex < checkpointNumber; markerIndex += 1) {
      const sequenceMarker = createMesh(
        new THREE.BoxGeometry(0.42 * UNIT, 0.42 * UNIT, 0.12 * UNIT),
        new THREE.MeshBasicMaterial({ color: COLOR.white }),
        `${gate.name}.sequence-marker`
      );
      sequenceMarker.position.set(
        (markerIndex - (checkpointNumber - 1) / 2) * 0.62 * UNIT,
        3.12 * UNIT,
        -0.2 * UNIT
      );
      sequenceMarker.rotation.z = Math.PI / 4;
      gate.add(sequenceMarker);
    }
    course.add(gate);
  }
}

function createFinishPortal(course: THREE.Group): void {
  const finish = QUALIFIER_ROUTE_VOLUMES.find(({ kind }) => kind === "finish");
  const finishZ = ((finish?.position.z ?? -12.4) + (finish?.size.depth ?? 1.2) / 2) * UNIT;
  const material = new THREE.MeshStandardMaterial({
    color: 0x21355b,
    roughness: 0.26,
    metalness: 0.66,
    emissive: COLOR.coral,
    emissiveIntensity: 0.42
  });
  for (const x of [-4.45, 4.45]) {
    const column = createMesh(
      new THREE.BoxGeometry(0.55 * UNIT, 5.5 * UNIT, 0.65 * UNIT),
      material.clone(),
      "knockout.course.finish-column"
    );
    column.position.set(x * UNIT, 3.35 * UNIT, finishZ);
    course.add(column);
  }
  const header = createMesh(
    new THREE.BoxGeometry(9.45 * UNIT, 0.72 * UNIT, 0.75 * UNIT),
    material,
    "knockout.course.finish-header"
  );
  header.position.set(0, 6.05 * UNIT, finishZ);
  course.add(header);
  const finishLine = createMesh(
    new THREE.BoxGeometry(8 * UNIT, 0.04 * UNIT, 0.8 * UNIT),
    new THREE.MeshBasicMaterial({ color: COLOR.white }),
    "knockout.course.finish-line"
  );
  finishLine.position.set(0, 0.44 * UNIT, finishZ);
  course.add(finishLine);
  for (let index = 0; index < 10; index += 1) {
    const finishTile = createMesh(
      new THREE.BoxGeometry(0.8 * UNIT, 0.045 * UNIT, 0.4 * UNIT),
      new THREE.MeshBasicMaterial({ color: index % 2 === 0 ? COLOR.ink : COLOR.coral }),
      "knockout.course.finish-tile"
    );
    finishTile.position.set((index - 4.5) * 0.8 * UNIT, 0.46 * UNIT, finishZ - 0.2 * UNIT);
    course.add(finishTile);
  }
  for (let index = 0; index < 9; index += 1) {
    const lamp = createMesh(
      new THREE.SphereGeometry(0.09 * UNIT, 10, 8),
      new THREE.MeshBasicMaterial({ color: index % 2 === 0 ? COLOR.cyan : COLOR.coral }),
      "knockout.course.finish-lamp"
    );
    lamp.position.set((index - 4) * UNIT, 6.05 * UNIT, finishZ - 0.38 * UNIT);
    course.add(lamp);
  }
}

function createSpectatorPods(course: THREE.Group): void {
  for (const side of [-1, 1]) {
    for (let index = 0; index < 18; index += 1) {
      const pod = new THREE.Group();
      pod.name = "knockout.course.spectator-pod";
      pod.position.set(
        side * (15 + (index % 2) * 1.4) * UNIT,
        (2.1 + index * 0.38) * UNIT,
        (6 - index * 12) * UNIT
      );
      const base = createMesh(
        new THREE.CylinderGeometry(0.8 * UNIT, 1.05 * UNIT, 0.38 * UNIT, 16),
        new THREE.MeshStandardMaterial({ color: 0x16274a, roughness: 0.35, metalness: 0.48 }),
        "knockout.course.pod-base"
      );
      const light = createMesh(
        new THREE.CylinderGeometry(0.5 * UNIT, 0.5 * UNIT, 0.08 * UNIT, 16),
        new THREE.MeshBasicMaterial({ color: index % 2 === 0 ? COLOR.cyan : COLOR.coral }),
        "knockout.course.pod-light"
      );
      light.position.y = 0.22 * UNIT;
      pod.add(base, light);
      course.add(pod);
    }
  }
}

function createSkyParticles(root: THREE.Group): void {
  const count = 360;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const angle = pseudoRandom(index * 3) * Math.PI * 2;
    const radius = (22 + pseudoRandom(index * 3 + 1) * 52) * UNIT;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = (4 + pseudoRandom(index * 3 + 2) * 24) * UNIT;
    positions[index * 3 + 2] = -105 * UNIT + Math.sin(angle) * radius * 1.9;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xa8dfff,
      size: 0.075 * UNIT,
      transparent: true,
      opacity: 0.62,
      sizeAttenuation: true
    })
  );
  points.name = "knockout.sky-particles";
  root.add(points);
}

function createBroadcastRings(root: THREE.Group): void {
  for (const [index, color] of [COLOR.cyan, COLOR.coral, COLOR.violet, COLOR.acid].entries()) {
    const ring = createMesh(
      new THREE.TorusGeometry((9 + index * 2.8) * UNIT, 0.045 * UNIT, 6, 72),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16 - index * 0.03 }),
      "knockout.broadcast-ring"
    );
    ring.position.set(
      (index % 2 === 0 ? -1 : 1) * (8 + index * 2) * UNIT,
      (9 + index * 2.2) * UNIT,
      (-42 - index * 48) * UNIT
    );
    ring.rotation.z = index * 0.4;
    root.add(ring);
  }
}

function collectAmbientAnimationParts(root: THREE.Object3D): AmbientAnimationPart[] {
  const parts: AmbientAnimationPart[] = [];
  root.traverse((object) => {
    const kind = ambientAnimationKind(object.name);
    if (kind === undefined) return;
    parts.push({
      object,
      kind,
      phase: pseudoRandom(parts.length + 71),
      basePosition: object.position.clone(),
      baseScale: object.scale.clone()
    });
  });
  return parts;
}

function ambientAnimationKind(name: string): AmbientAnimationPart["kind"] | undefined {
  if (name === "knockout.broadcast-ring") return "broadcast-ring";
  if (name.includes("knockout.course.zone.") && name.endsWith(".lamp")) return "zone-lamp";
  if (name.includes("knockout.course.checkpoint.") && name.endsWith(".beacon")) {
    return "checkpoint-beacon";
  }
  if (name === "knockout.course.finish-lamp") return "finish-lamp";
  if (name === "knockout.course.spectator-pod") return "spectator-pod";
  if (name === "knockout.course.rail-beacon") return "rail-beacon";
  if (name === "knockout.sky-particles") return "sky";
  return undefined;
}

function updateAmbientPresentation(
  parts: readonly AmbientAnimationPart[],
  elapsedMs: number
): void {
  const seconds = elapsedMs / 1000;
  for (const part of parts) {
    part.object.position.copy(part.basePosition);
    part.object.scale.copy(part.baseScale);
    if (part.kind === "broadcast-ring") {
      part.object.rotation.z = seconds * (0.035 + part.phase * 0.025);
      part.object.rotation.y = Math.sin(seconds * 0.16 + part.phase * Math.PI * 2) * 0.08;
    } else if (part.kind === "zone-lamp") {
      const signal = 0.72 + Math.max(0, Math.sin(seconds * 5.5 - part.phase * 8)) * 0.5;
      part.object.scale.multiplyScalar(signal);
    } else if (part.kind === "checkpoint-beacon") {
      part.object.rotation.y = seconds * 1.6 + part.phase * Math.PI * 2;
      part.object.position.y += Math.sin(seconds * 2.4 + part.phase * 7) * 0.08 * UNIT;
    } else if (part.kind === "finish-lamp") {
      const signal = 0.65 + Math.max(0, Math.sin(seconds * 8 - part.phase * 13)) * 0.55;
      part.object.scale.multiplyScalar(signal);
    } else if (part.kind === "spectator-pod") {
      part.object.position.y += Math.sin(seconds * 0.72 + part.phase * Math.PI * 2) * 0.18 * UNIT;
      part.object.rotation.y = Math.sin(seconds * 0.22 + part.phase * 5) * 0.15;
    } else if (part.kind === "rail-beacon") {
      const material = part.object instanceof THREE.Mesh ? part.object.material : undefined;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = 0.25 + positiveWrap(seconds * 0.42 + part.phase, 1) * 0.55;
      }
    } else if (part.kind === "sky") {
      part.object.rotation.y = seconds * 0.004;
      part.object.position.y = part.basePosition.y + Math.sin(seconds * 0.11) * 0.6 * UNIT;
    }
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      disposeMesh(child);
      return;
    }
    if (child instanceof THREE.LineSegments || child instanceof THREE.Points) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    }
  });
}

function lerpAngle(current: number, target: number, alpha: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * Math.min(1, alpha);
}

function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 91.371 + 17.73) * 43_758.5453;
  return value - Math.floor(value);
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function vectorSnapshot(value: { x: number; y: number; z: number }) {
  return { x: value.x, y: value.y, z: value.z };
}
