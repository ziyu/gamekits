import type { ThreeRendererNative } from "@gamekits/driver-three";
import type { PhysicsPredictionIslandStateSnapshot } from "@gamekits/physics-core";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type { ArenaPresentationSnapshot } from "../client/arena-presentation";
import { createArenaVisual } from "../client/arena-visual";
import { ARENA_COMPILED_CONTENT } from "../content/default-content";
import { compileArenaItemCatalog } from "../items/item-definition";
import { arenaItemPhysicsMemberId, createArenaItemPhysicsMember } from "../items/item-physics";
import { createArenaDefinitionMap } from "../shared/arena-definition";

describe("Knockout Circuit presentation", () => {
  it("renders a third-person runner scene instead of the driver debug camera", () => {
    const render = vi.fn();
    const native = fakeNative(render);
    const visual = createArenaVisual(native, createArenaDefinitionMap());

    visual.update(arenaState(), "player.0", 1000 / 60);

    const circuit = native.scene.getObjectByName("knockout-circuit.root");
    const player = native.scene.getObjectByName("knockout.player.0");
    const localRing = native.scene.getObjectByName("player.0.local-ring");
    expect(circuit).toBeInstanceOf(THREE.Group);
    expect(player).toBeInstanceOf(THREE.Group);
    expect(localRing?.visible).toBe(true);
    expect(native.scene.getObjectByName("knockout.course.checkpoint.1")).toBeInstanceOf(
      THREE.Group
    );
    expect(native.scene.getObjectByName("knockout.course.checkpoint.2")).toBeInstanceOf(
      THREE.Group
    );
    expect(native.scene.getObjectByName("knockout.course.checkpoint.7")).toBeInstanceOf(
      THREE.Group
    );
    expect(native.scene.getObjectByName("knockout.course.zone.8")).toBeInstanceOf(THREE.Group);
    expect(native.scene.getObjectByName("knockout.circuit.floor-start")).toMatchObject({
      geometry: expect.objectContaining({
        parameters: expect.objectContaining({ depth: 160 * 32 })
      })
    });
    expect(native.scene.getObjectByName("knockout.circuit.floor-finish")).toMatchObject({
      geometry: expect.objectContaining({
        parameters: expect.objectContaining({ depth: 54 * 32 })
      })
    });
    expect(native.scene.getObjectByName("knockout.course.track-surface")).toBeUndefined();
    expect(native.scene.getObjectByName("knockout.course.finish-line")).toBeInstanceOf(THREE.Mesh);
    expect(render).toHaveBeenCalledOnce();
    expect(render.mock.calls[0]?.[1]).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(render.mock.calls[0]?.[1]).not.toBe(native.camera);

    visual.destroy();
    expect(native.scene.getObjectByName("knockout-circuit.root")).toBeUndefined();
  });

  it("gives every authored hazard a readable mechanical model and continuous animation", () => {
    const native = fakeNative(vi.fn());
    const visual = createArenaVisual(native, createArenaDefinitionMap());
    const state = arenaHazardState();
    const feedback = {
      camera: { mode: "broadcast" as const },
      hazards: state.members.map(({ id }) => ({
        memberId: id,
        kind: createArenaDefinitionMap().get(id)!.body.userData!.hazardKind as
          | "conveyor"
          | "wind-zone"
          | "bounce-pad"
          | "piston"
          | "moving-platform"
          | "rotating-sweeper",
        phase: "active" as const,
        nextTransitionTick: 240
      })),
      audio: {} as never
    };

    visual.update(state, undefined, 16, undefined, feedback);
    const conveyorSlat = native.scene.getObjectByName("circuit.conveyor-left.conveyor-slat")!;
    const conveyorRoller = native.scene.getObjectByName("circuit.conveyor-left.conveyor-roller")!;
    const windFan = native.scene.getObjectByName("circuit.wind-left.fan")!;
    const windStream = native.scene.getObjectByName("circuit.wind-left.wind-stream")!;
    const bounceDeck = native.scene.getObjectByName("circuit.bounce-left.bounce-deck")!;
    const pistonRam = native.scene.getObjectByName("circuit.piston-left.piston-ram")!;
    const bridgeRail = native.scene.getObjectByName("circuit.moving-bridge-left.guide-rail")!;
    const sweeperBeacon = native.scene.getObjectByName("circuit.sweeper-alpha.warning-beacon")!;
    const baseline = {
      slatZ: conveyorSlat.position.z,
      rollerX: conveyorRoller.rotation.x,
      fanZ: windFan.rotation.z,
      streamX: windStream.position.x,
      bounceY: bounceDeck.position.y
    };

    state.tick += 12;
    visual.update(state, undefined, 200, undefined, feedback);

    expect(conveyorSlat.position.z).not.toBe(baseline.slatZ);
    expect(conveyorRoller.rotation.x).not.toBe(baseline.rollerX);
    expect(windFan.rotation.z).not.toBe(baseline.fanZ);
    expect(windStream.position.x).not.toBe(baseline.streamX);
    expect(bounceDeck.position.y).not.toBe(baseline.bounceY);
    expect(pistonRam).toBeInstanceOf(THREE.Mesh);
    expect(bridgeRail).toBeInstanceOf(THREE.Mesh);
    expect(sweeperBeacon).toBeInstanceOf(THREE.Mesh);
    visual.destroy();
  });

  it("animates final-stage collapse and safe-zone mechanics from replicated body facts", () => {
    const native = fakeNative(vi.fn());
    const visual = createArenaVisual(native, createArenaDefinitionMap());
    const state = arenaHazardState(["crown.collapse-band", "crown.shrinking-zone"]);
    state.members[0]!.body.userData = {
      ...state.members[0]!.body.userData,
      collapseProgress: 0.76
    };
    state.members[1]!.body.userData = {
      ...state.members[1]!.body.userData,
      safeScale: 0.48
    };
    const feedback = {
      camera: { mode: "broadcast" as const },
      hazards: state.members.map(({ id }) => ({
        memberId: id,
        kind: createArenaDefinitionMap().get(id)!.body.userData!.hazardKind as
          | "crumble-floor"
          | "shrinking-zone",
        phase: "active" as const,
        nextTransitionTick: 240
      })),
      audio: {} as never
    };

    visual.update(state, undefined, 16, undefined, feedback);
    const tile = native.scene.getObjectByName("crown.collapse-band.crumble-tile")!;
    const ring = native.scene.getObjectByName("crown.shrinking-zone.safe-ring")!;
    const tileY = tile.position.y;
    state.tick += 18;
    visual.update(state, undefined, 200, undefined, feedback);

    expect(tile.rotation.x).not.toBe(0);
    expect(tile.position.y).toBeLessThanOrEqual(tileY);
    expect(ring.scale.x).toBeCloseTo(0.48);
    visual.destroy();
  });

  it("renders shrinking-zone sensors as ground rings without an opaque collider deck", () => {
    const native = fakeNative(vi.fn());
    const visual = createArenaVisual(native, createArenaDefinitionMap());
    const state = arenaHazardState(["scrap.shrinking-zone"]);

    visual.update(state, undefined, 16);

    expect(native.scene.getObjectByName("scrap.shrinking-zone.deck")).toBeUndefined();
    const ring = native.scene.getObjectByName("scrap.shrinking-zone.safe-ring")!;
    const worldPosition = new THREE.Vector3();
    ring.updateWorldMatrix(true, false);
    ring.getWorldPosition(worldPosition);
    expect(ring).toBeInstanceOf(THREE.Mesh);
    expect(worldPosition.y).toBeCloseTo(0.02 * 32);
    visual.destroy();
  });

  it("orients reusable conveyor mechanics along the authored impulse axis", () => {
    const native = fakeNative(vi.fn());
    const visual = createArenaVisual(native, createArenaDefinitionMap());
    const state = arenaHazardState(["scrap.outer-conveyor"]);
    const feedback = {
      camera: { mode: "broadcast" as const },
      hazards: [
        {
          memberId: "scrap.outer-conveyor",
          kind: "conveyor" as const,
          phase: "active" as const,
          nextTransitionTick: 240
        }
      ],
      audio: {} as never
    };

    visual.update(state, undefined, 16, undefined, feedback);
    const slat = native.scene.getObjectByName("scrap.outer-conveyor.conveyor-slat")!;
    const start = slat.position.clone();
    state.tick += 12;
    visual.update(state, undefined, 200, undefined, feedback);

    expect(slat.position.x).not.toBe(start.x);
    expect(slat.position.z).toBe(start.z);
    visual.destroy();
  });

  it("keeps clearly non-gameplay arena facilities visibly operating", () => {
    const native = fakeNative(vi.fn());
    const visual = createArenaVisual(native, createArenaDefinitionMap());
    const state = arenaState();
    visual.update(state, "player.0", 16);
    const ring = native.scene.getObjectByName("knockout.broadcast-ring")!;
    const pod = native.scene.getObjectByName("knockout.course.spectator-pod")!;
    const checkpoint = native.scene.getObjectByName("knockout.course.checkpoint.1.beacon")!;
    const baseline = {
      ringZ: ring.rotation.z,
      podY: pod.position.y,
      checkpointY: checkpoint.rotation.y
    };

    for (let frame = 0; frame < 20; frame += 1) visual.update(state, "player.0", 50);

    expect(ring.rotation.z).not.toBe(baseline.ringZ);
    expect(pod.position.y).not.toBe(baseline.podY);
    expect(checkpoint.rotation.y).not.toBe(baseline.checkpointY);
    visual.destroy();
  });

  it("exposes every authored hazard instance to the real-browser audit camera", () => {
    const native = fakeNative(vi.fn());
    const visual = createArenaVisual(native, createArenaDefinitionMap());

    expect(visual.inspectableHazards(0)).toHaveLength(14);
    expect(visual.inspectableHazards(1)).toEqual([
      "scrap.outer-conveyor",
      "scrap.fan-tunnel",
      "scrap.launch-pad",
      "scrap.crusher-west",
      "scrap.crusher-east",
      "scrap.wall-west",
      "scrap.wall-east",
      "scrap.shrinking-zone"
    ]);
    expect(visual.inspectableHazards(2)).toEqual([
      "crown.collapse-band",
      "crown.shrinking-zone",
      "crown.sweeper",
      "crown.launch-pad"
    ]);
    expect(visual.inspectableMembers(0)).toHaveLength(19);
    expect(visual.inspectableMembers(1)).toHaveLength(12);
    expect(visual.inspectableMembers(2)).toHaveLength(5);

    const state = arenaHazardState(visual.inspectableHazards(1));
    visual.inspect("scrap.crusher-west");
    visual.update(state, undefined, 16);
    expect(native.scene.getObjectByName("scrap.crusher-west.crusher-platen")).toBeInstanceOf(
      THREE.Mesh
    );
    expect(native.scene.getObjectByName("scrap.wall-west.wall-panel")).toBeInstanceOf(THREE.Mesh);
    visual.destroy();
  });

  it("faces a runner along horizontal velocity instead of adding solver yaw", () => {
    for (const [moveX, moveZ] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0]
    ] as const) {
      const native = fakeNative(vi.fn());
      const visual = createArenaVisual(native, createArenaDefinitionMap());
      const state = arenaState();
      const player = state.members.find((member) => member.id === "player.0")!;
      player.body.linearVelocity = { x: moveX * 4.5, y: 0, z: moveZ * 4.5 };
      player.body.rotation = {
        x: 0,
        y: Math.sin(Math.PI / 4),
        z: 0,
        w: Math.cos(Math.PI / 4)
      };
      for (let frame = 0; frame < 24; frame += 1) {
        state.tick += 1;
        visual.update(state, "player.0", 16);
      }

      const model = native.scene.getObjectByName("player.0.runner-model");
      const worldRotation = model?.getWorldQuaternion(new THREE.Quaternion());
      const facing = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(worldRotation!)
        .setY(0)
        .normalize();
      const movement = new THREE.Vector3(moveX, 0, moveZ);
      expect(facing.dot(movement)).toBeGreaterThan(0.999);
      visual.destroy();
    }
  });

  it("converts semantic character facing into the runner model's negative-Z forward axis", () => {
    for (const [moveX, moveZ] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0]
    ] as const) {
      const native = fakeNative(vi.fn());
      const visual = createArenaVisual(native, createArenaDefinitionMap());
      const state = arenaState();
      const player = state.members.find((member) => member.id === "player.0")!;
      player.body.linearVelocity = { x: moveX * 4.5, y: 0, z: moveZ * 4.5 };
      const presentation = {
        generation: 1,
        sourceGeneration: state.generation,
        items: [],
        actors: [
          {
            memberId: "player.0",
            participantId: "player.0",
            generation: 1,
            tick: state.tick,
            local: true,
            horizontalSpeed: 4.5,
            normalizedSpeed: 4.5 / 7.2,
            verticalVelocity: 0,
            facingYaw: Math.atan2(moveX, moveZ),
            instability: 0,
            grounded: true,
            carrying: false,
            baseState: "run" as const
          }
        ]
      };

      for (let frame = 0; frame < 24; frame += 1) {
        state.tick += 1;
        visual.update(state, "player.0", 16, presentation);
      }

      const model = native.scene.getObjectByName("player.0.runner-model")!;
      const facing = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()))
        .setY(0)
        .normalize();
      expect(facing.dot(new THREE.Vector3(moveX, 0, moveZ))).toBeGreaterThan(0.999);
      visual.destroy();
    }
  });

  it("consumes semantic Animator state instead of rebuilding gameplay mode in Three", () => {
    const native = fakeNative(vi.fn());
    const visual = createArenaVisual(native, createArenaDefinitionMap());
    const state = arenaState();
    const presentation = {
      generation: 1,
      sourceGeneration: state.generation,
      items: [],
      actors: [
        {
          memberId: "player.0",
          participantId: "player.0",
          generation: 1,
          tick: state.tick,
          local: true,
          horizontalSpeed: 0,
          normalizedSpeed: 0,
          verticalVelocity: 0,
          facingYaw: Math.PI / 2,
          instability: 1,
          grounded: true,
          carrying: false,
          baseState: "eliminated" as const
        }
      ]
    };
    for (let frame = 0; frame < 24; frame += 1) {
      visual.update(state, "player.0", 16, presentation);
    }

    const model = native.scene.getObjectByName("player.0.runner-model")!;
    expect(model.rotation.z).toBeGreaterThan(1.4);
    expect(model.scale.y).toBeLessThan(0.8);
    const facing = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()))
      .setY(0)
      .normalize();
    expect(facing.x).toBeGreaterThan(0.99);
    visual.destroy();
  });

  it("reparents the same picked item visual from the world into the primary hand socket", () => {
    const native = fakeNative(vi.fn());
    const visual = createArenaVisual(native, createArenaDefinitionMap());
    const state = arenaState();
    const definition = compileArenaItemCatalog(ARENA_COMPILED_CONTENT.stages).definitions.find(
      ({ id }) => id === "item.gravity-orb"
    )!;
    const item = { id: "item.fixture.gravity", instanceGeneration: 1 };
    const member = createArenaItemPhysicsMember({
      definition,
      item,
      position: { x: 0.5, y: 1.2, z: 2 }
    });
    state.members.push({
      id: member.id,
      body: {
        ...member.body,
        id: member.id,
        kind: "dynamic",
        position: { x: 0.5, y: 1.2, z: 2 },
        linearVelocity: { x: 0, y: 0, z: 0 },
        sleeping: false
      }
    });

    visual.update(state, "player.0", 16, { generation: 1, actors: [], items: [] });
    const memberId = arenaItemPhysicsMemberId(item);
    const worldVisual = native.scene.getObjectByName(`knockout.${memberId}`)!;
    expect(worldVisual.parent?.name).toBe("knockout-circuit.root");

    state.members = state.members.filter(({ id }) => id !== memberId);
    const presentation: ArenaPresentationSnapshot = {
      generation: 1,
      actors: [],
      items: [
        {
          itemId: item.id,
          definitionId: definition.id,
          instanceGeneration: item.instanceGeneration,
          ownerParticipantId: "player.0",
          ownerMemberId: "player.0",
          state: "carried",
          normalizedActionTime: 0
        }
      ]
    };
    visual.update(state, "player.0", 16, presentation);

    expect(native.scene.getObjectByName(`knockout.${memberId}`)).toBe(worldVisual);
    expect(worldVisual.parent?.name).toBe("player.0.runner-model");
    expect(native.scene.getObjectByName(`${memberId}.item-body`)).toBeInstanceOf(THREE.Mesh);
    expect(worldVisual.position.x).toBeGreaterThan(0);
    visual.destroy();
  });

  it("builds a readable authored model for every item definition", () => {
    const native = fakeNative(vi.fn());
    const visual = createArenaVisual(native, createArenaDefinitionMap());
    const state = arenaState();
    const definitions = compileArenaItemCatalog(ARENA_COMPILED_CONTENT.stages).definitions;
    for (const [index, definition] of definitions.entries()) {
      const item = { id: `item.fixture.${index}`, instanceGeneration: 1 };
      const member = createArenaItemPhysicsMember({
        definition,
        item,
        position: { x: index * 1.5, y: 1.2, z: 0 }
      });
      state.members.push({
        id: member.id,
        body: {
          ...member.body,
          id: member.id,
          kind: "dynamic",
          position: { x: index * 1.5, y: 1.2, z: 0 },
          linearVelocity: { x: 0, y: 0, z: 0 },
          sleeping: false
        }
      });
    }

    visual.update(state, undefined, 16, { generation: 1, actors: [], items: [] });

    for (let index = 0; index < definitions.length; index += 1) {
      const memberId = arenaItemPhysicsMemberId({
        id: `item.fixture.${index}`,
        instanceGeneration: 1
      });
      expect(native.scene.getObjectByName(`${memberId}.item-body`)).toBeInstanceOf(THREE.Mesh);
    }
    visual.destroy();
  });

  it("bounds speculative effect presentation and removes expired particles", () => {
    const native = fakeNative(vi.fn());
    const visual = createArenaVisual(native, createArenaDefinitionMap());
    visual.update(arenaState(), "player.0", 16);

    visual.effect({
      effectId: "jump:player.0:7",
      kind: "jump",
      phase: "anticipate",
      tick: 12
    });
    expect(native.scene.getObjectByName("knockout.fx.jump.anticipate")).toBeDefined();

    for (let index = 0; index < 14; index += 1) visual.update(arenaState(), "player.0", 50);
    expect(native.scene.getObjectByName("knockout.fx.jump.anticipate")).toBeUndefined();
    visual.destroy();
  });

  it("retracts cancelled anticipation before it can linger on screen", () => {
    const native = fakeNative(vi.fn());
    const visual = createArenaVisual(native, createArenaDefinitionMap());
    visual.update(arenaState(), "player.0", 16);

    const event = {
      effectId: "item-hit:item.foam-ball:player.0:12",
      kind: "item-hit" as const,
      tick: 12
    };
    visual.effect({ ...event, phase: "anticipate" });
    expect(native.scene.getObjectByName("knockout.fx.item-hit.anticipate")).toBeDefined();
    visual.effect({ ...event, phase: "cancel" });
    expect(native.scene.getObjectByName("knockout.fx.item-hit.anticipate")).toBeUndefined();
    expect(native.scene.getObjectByName("knockout.fx.item-hit.cancel")).toBeUndefined();
    visual.destroy();
  });
});

function fakeNative(render: ReturnType<typeof vi.fn>): ThreeRendererNative {
  const renderer = {
    domElement: { clientWidth: 1280, clientHeight: 720, width: 1280, height: 720 },
    shadowMap: { enabled: false, type: THREE.BasicShadowMap },
    outputColorSpace: THREE.LinearSRGBColorSpace,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    render
  } as unknown as THREE.WebGLRenderer;
  return {
    scene: new THREE.Scene(),
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1),
    renderer,
    render: vi.fn()
  } as unknown as ThreeRendererNative;
}

function arenaState(): PhysicsPredictionIslandStateSnapshot {
  return {
    generation: "round:1",
    tick: 12,
    members: [
      {
        id: "player.0",
        body: {
          id: "player.0",
          kind: "dynamic",
          position: { x: -1.2, y: 1.3, z: 4.1 },
          linearVelocity: { x: 1.5, y: 0, z: -4.5 },
          sleeping: false
        }
      },
      {
        id: "bot.0",
        body: {
          id: "bot.0",
          kind: "dynamic",
          position: { x: 1.2, y: 1.3, z: 3.7 },
          linearVelocity: { x: 0, y: 0, z: -3.5 },
          sleeping: false
        }
      },
      {
        id: "hazard.sweeper",
        body: {
          id: "hazard.sweeper",
          kind: "kinematic",
          position: { x: 0, y: 1, z: -1.5 },
          rotation: { x: 0, y: 0.35, z: 0 },
          linearVelocity: { x: 0, y: 0, z: 0 },
          sleeping: false
        }
      }
    ]
  };
}

function arenaHazardState(
  ids = [
    "circuit.conveyor-left",
    "circuit.wind-left",
    "circuit.bounce-left",
    "circuit.piston-left",
    "circuit.moving-bridge-left",
    "circuit.sweeper-alpha"
  ]
): PhysicsPredictionIslandStateSnapshot {
  const definitions = createArenaDefinitionMap();
  return {
    generation: "round:hazards",
    tick: 18,
    members: ids.map((id) => {
      const definition = definitions.get(id)!;
      return {
        id,
        body: {
          id,
          kind: definition.body.kind,
          position: structuredClone(definition.body.position ?? { x: 0, y: 0, z: 0 }),
          ...(definition.body.rotation === undefined
            ? {}
            : { rotation: structuredClone(definition.body.rotation) }),
          ...(definition.body.userData === undefined
            ? {}
            : { userData: structuredClone(definition.body.userData) }),
          linearVelocity: { x: 0, y: 0, z: 0 },
          sleeping: false
        }
      };
    })
  };
}
