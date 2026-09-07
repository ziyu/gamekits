import { worldToScreen } from "@gamekits/camera-core";
import { createSandboxCameraController } from "../camera";
import {
  SANDBOX_RENDER_SIZE,
  type SandboxEntitySnapshot,
  type SandboxSnapshot
} from "../sandbox-game";
import { resolveSandboxSceneClickTarget } from "../scene-hit-test";
import type { SandboxTestHarness } from "./sandbox-harness";

export type BootChainResult = {
  snapshot: SandboxSnapshot;
};

export type IdleAutomationResult = {
  before: SandboxSnapshot;
  after: SandboxSnapshot;
};

export type ConfirmChainResult = {
  before: SandboxSnapshot;
  after: SandboxSnapshot;
};

export type ThreatChainResult = {
  before: SandboxSnapshot;
  after: SandboxSnapshot;
};

export type SelectionChainResult = {
  clickPoint: { x: number; y: number };
  target: ReturnType<typeof resolveSandboxSceneClickTarget>;
  blankTarget: ReturnType<typeof resolveSandboxSceneClickTarget>;
};

export async function runBootChain(harness: SandboxTestHarness): Promise<BootChainResult> {
  await harness.bootRenderer();
  harness.start();
  harness.tickMany(2);
  return { snapshot: harness.snapshot() };
}

export function runIdleAutomationChain(
  harness: SandboxTestHarness,
  ticks = 32,
  delta = 100
): IdleAutomationResult {
  harness.start();
  const before = harness.snapshot();
  harness.tickMany(ticks, delta);
  return { before, after: harness.snapshot() };
}

export function runConfirmChain(harness: SandboxTestHarness): ConfirmChainResult {
  harness.start();
  const before = harness.snapshot({ selectedActorId: "gas.actor.sandbox.worker.0" });
  harness.emitConfirm();
  harness.tickMany(60);
  return { before, after: harness.snapshot({ selectedActorId: "gas.actor.sandbox.worker.0" }) };
}

export function runThreatChain(harness: SandboxTestHarness): ThreatChainResult {
  harness.start();
  const before = harness.snapshot();
  harness.tickMany(150);
  return { before, after: harness.snapshot() };
}

export function runSelectionChain(
  snapshot: SandboxSnapshot,
  entity: SandboxEntitySnapshot
): SelectionChainResult {
  const camera = createSandboxCameraController(SANDBOX_RENDER_SIZE);
  const clickPoint = worldToScreen(camera.getState(), {
    x: (entity.x / 100) * SANDBOX_RENDER_SIZE.width,
    y: (entity.y / 100) * SANDBOX_RENDER_SIZE.height
  });

  return {
    clickPoint,
    target: resolveSandboxSceneClickTarget(snapshot, clickPoint, camera.getState()),
    blankTarget: resolveSandboxSceneClickTarget(snapshot, { x: 1, y: 1 }, camera.getState())
  };
}
