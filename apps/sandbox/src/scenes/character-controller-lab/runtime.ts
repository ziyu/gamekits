import {
  characterMotorStateSignature,
  createCharacterControlIntentBuffer,
  createCharacterMotorState,
  type CharacterControlIntent,
  type CharacterMotorDiagnostics,
  type CharacterMotorState,
  type CharacterMotorTraceEntry
} from "@gamekits/character-controller";
import type {
  PhysicsBackendAdapter,
  PhysicsBodyState,
  PhysicsContactEvent,
  PhysicsScene,
  PhysicsSceneSnapshot,
  PhysicsVector
} from "@gamekits/physics-core";
import type { Rapier3dPhysicsNative } from "@gamekits/physics-rapier3d";
import {
  characterControllerLabSpawnPoint,
  characterControllerLabStationSpawn,
  createCharacterControllerLabCourse,
  updateCharacterControllerLabPlatform,
  type CharacterControllerLabCourseObject,
  type CharacterControllerLabStationId
} from "./course";
import {
  CHARACTER_CONTROLLER_LAB_BODY_ID,
  CHARACTER_CONTROLLER_LAB_COLLIDER_ID,
  neutralCharacterControllerLabIntent,
  stepCharacterControllerLabMotor
} from "./motor";

const FIXED_DELTA_MS = 1000 / 60;
const MAX_SUB_STEPS = 5;
const MAX_TRACE_ENTRIES = 18;

export type CharacterControllerLabSnapshot = {
  running: boolean;
  paused: boolean;
  tick: number;
  elapsedMs: number;
  scene: PhysicsSceneSnapshot;
  body: PhysicsBodyState;
  motor: CharacterMotorState;
  diagnostics?: CharacterMotorDiagnostics | undefined;
  trace: CharacterMotorTraceEntry[];
  contacts: PhysicsContactEvent[];
  course: Array<
    CharacterControllerLabCourseObject & {
      position: PhysicsVector;
      rotation: PhysicsBodyState["rotation"];
    }
  >;
  queuedStaggerMs: number;
  stateSignature: string;
};

export type CharacterControllerLabController = {
  setIntent(intent: Readonly<CharacterControlIntent>): void;
  advance(deltaMs: number): CharacterControllerLabSnapshot;
  singleStep(): CharacterControllerLabSnapshot;
  queueStagger(durationMs?: number): CharacterControllerLabSnapshot;
  applyExternalImpulse(): CharacterControllerLabSnapshot;
  moveToStation(stationId: CharacterControllerLabStationId): CharacterControllerLabSnapshot;
  reset(): CharacterControllerLabSnapshot;
  setPaused(paused: boolean): CharacterControllerLabSnapshot;
  snapshot(): CharacterControllerLabSnapshot;
  dispose(): void;
};

export function createCharacterControllerLab(
  backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>
): CharacterControllerLabController {
  let scene = createScene(backend);
  let course = createCharacterControllerLabCourse(scene);
  let motor = createCharacterMotorState();
  const intentBuffer = createCharacterControlIntentBuffer(neutralCharacterControllerLabIntent(0));
  let diagnostics: CharacterMotorDiagnostics | undefined;
  let trace: CharacterMotorTraceEntry[] = [];
  let contacts: PhysicsContactEvent[] = [];
  let tick = 0;
  let elapsedMs = 0;
  let accumulatorMs = 0;
  let paused = false;
  let disposed = false;
  let queuedStaggerMs = 0;
  let terminalSnapshot: CharacterControllerLabSnapshot | undefined;

  createRunner(scene);
  scene.step(0);

  const capture = (): CharacterControllerLabSnapshot => {
    if (disposed && terminalSnapshot !== undefined) {
      return structuredClone(terminalSnapshot);
    }
    const body = requireBody(scene, CHARACTER_CONTROLLER_LAB_BODY_ID);
    return {
      running: !disposed,
      paused,
      tick,
      elapsedMs,
      scene: scene.snapshot(),
      body,
      motor: structuredClone(motor),
      diagnostics: diagnostics === undefined ? undefined : structuredClone(diagnostics),
      trace: structuredClone(trace),
      contacts: structuredClone(contacts),
      course: course.map((object) => {
        const state = requireBody(scene, object.bodyId);
        return {
          ...object,
          shape: structuredClone(object.shape),
          position: { ...state.position },
          rotation: structuredClone(state.rotation)
        };
      }),
      queuedStaggerMs,
      stateSignature: characterMotorStateSignature(motor)
    };
  };

  const fixedStep = (): void => {
    tick += 1;
    elapsedMs += FIXED_DELTA_MS;
    updateCharacterControllerLabPlatform(scene, elapsedMs);
    const intent = intentBuffer.consume(tick);
    const result = stepCharacterControllerLabMotor({
      scene,
      state: motor,
      intent,
      tick,
      deltaMs: FIXED_DELTA_MS,
      ...(queuedStaggerMs <= 0 ? {} : { staggerDurationMs: queuedStaggerMs })
    });
    queuedStaggerMs = 0;
    motor = result.state;
    diagnostics = result.diagnostics;
    trace = retainMeaningfulTrace(trace, result.trace);
    contacts = scene.step(FIXED_DELTA_MS, { tick, elapsed: elapsedMs }).contacts;
    const runner = requireBody(scene, CHARACTER_CONTROLLER_LAB_BODY_ID);
    if (
      runner.position.y < -7 ||
      Math.abs(runner.position.x) > 24 ||
      Math.abs(runner.position.z ?? 0) > 24
    ) {
      resetRunner(scene);
      motor = createCharacterMotorState();
      trace = [];
    }
  };

  return {
    setIntent(nextIntent) {
      intentBuffer.update(nextIntent);
    },
    advance(deltaMs) {
      if (disposed || paused) return capture();
      accumulatorMs += Math.max(0, Math.min(deltaMs, FIXED_DELTA_MS * MAX_SUB_STEPS));
      let steps = 0;
      while (accumulatorMs >= FIXED_DELTA_MS && steps < MAX_SUB_STEPS) {
        accumulatorMs -= FIXED_DELTA_MS;
        fixedStep();
        steps += 1;
      }
      return capture();
    },
    singleStep() {
      if (!disposed) fixedStep();
      return capture();
    },
    queueStagger(durationMs = 620) {
      queuedStaggerMs = Math.max(queuedStaggerMs, durationMs);
      return capture();
    },
    applyExternalImpulse() {
      const result = scene.applyBodyCommand?.({
        type: "linear-impulse",
        bodyId: CHARACTER_CONTROLLER_LAB_BODY_ID,
        impulse: { x: -4.8, y: 2.4, z: 1.6 },
        wake: "wake"
      });
      if (result?.status !== "applied") {
        throw new Error(
          `Character Controller Lab impulse failed: ${result?.status ?? "unsupported"}`
        );
      }
      queuedStaggerMs = Math.max(queuedStaggerMs, 520);
      return capture();
    },
    moveToStation(stationId) {
      if (disposed) return capture();
      resetRunner(scene, characterControllerLabStationSpawn(stationId));
      scene.step(0);
      motor = createCharacterMotorState();
      intentBuffer.reset(neutralCharacterControllerLabIntent(intentBuffer.snapshot().sequence));
      diagnostics = undefined;
      trace = [];
      contacts = [];
      accumulatorMs = 0;
      queuedStaggerMs = 0;
      return capture();
    },
    reset() {
      scene.dispose();
      scene = createScene(backend);
      course = createCharacterControllerLabCourse(scene);
      createRunner(scene);
      scene.step(0);
      motor = createCharacterMotorState();
      intentBuffer.reset(neutralCharacterControllerLabIntent(intentBuffer.snapshot().sequence));
      diagnostics = undefined;
      trace = [];
      contacts = [];
      tick = 0;
      elapsedMs = 0;
      accumulatorMs = 0;
      queuedStaggerMs = 0;
      return capture();
    },
    setPaused(nextPaused) {
      paused = nextPaused;
      return capture();
    },
    snapshot: capture,
    dispose() {
      if (disposed) return;
      terminalSnapshot = {
        ...capture(),
        running: false,
        trace: [],
        contacts: [],
        queuedStaggerMs: 0
      };
      disposed = true;
      scene.dispose();
      trace = [];
      contacts = [];
    }
  };
}

function createScene(backend: PhysicsBackendAdapter<Rapier3dPhysicsNative>): PhysicsScene {
  return backend.createScene({
    id: "sandbox.character-controller-lab.scene",
    dimension: "3d",
    gravity: { x: 0, y: -9.81, z: 0 },
    fixedDeltaMs: FIXED_DELTA_MS,
    materialDefinitions: [
      { id: "character-controller-lab.course", friction: 0.92, restitution: 0 },
      { id: "character-controller-lab.runner", friction: 0.2, restitution: 0, density: 1 }
    ]
  });
}

function createRunner(scene: PhysicsScene): void {
  scene.createBody({
    id: CHARACTER_CONTROLLER_LAB_BODY_ID,
    kind: "dynamic",
    position: characterControllerLabSpawnPoint(),
    damping: { linear: 1.55, angular: 7.5 },
    lockedAxes: ["rotation-x", "rotation-z"],
    continuousCollisionDetection: true
  });
  scene.createCollider({
    id: CHARACTER_CONTROLLER_LAB_COLLIDER_ID,
    bodyId: CHARACTER_CONTROLLER_LAB_BODY_ID,
    shape: { type: "capsule", radius: 0.38, height: 0.88 },
    material: "character-controller-lab.runner"
  });
}

function resetRunner(
  scene: PhysicsScene,
  position: PhysicsVector = characterControllerLabSpawnPoint()
): void {
  scene.updateBody(CHARACTER_CONTROLLER_LAB_BODY_ID, {
    position,
    linearVelocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 }
  });
}

function requireBody(scene: PhysicsScene, bodyId: string): PhysicsBodyState {
  const body = scene.getBodyState(bodyId);
  if (!body) throw new Error(`Character Controller Lab body unavailable: ${bodyId}`);
  return body;
}

function retainMeaningfulTrace(
  retained: CharacterMotorTraceEntry[],
  incoming: readonly CharacterMotorTraceEntry[]
): CharacterMotorTraceEntry[] {
  const next = [...retained];
  for (const entry of incoming) {
    if (entry.code === "grounded" || entry.code === "facing-updated") continue;
    const previous = next.at(-1);
    if (previous?.code === entry.code && previous.sequence === entry.sequence) continue;
    next.push(structuredClone(entry));
  }
  return next.slice(-MAX_TRACE_ENTRIES);
}
