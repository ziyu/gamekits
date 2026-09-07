import { createMemoryRenderer } from "@gamekits/test-utils";
import { createMemoryPhysicsBackend } from "@gamekits/physics-core";
import { initRapier2dPhysicsBackend } from "@gamekits/physics-rapier2d";
import { describe, expect, it } from "vitest";

import { createOutpostDataRegistry } from "../content";
import {
  createOutpostClientCombatPresentation,
  createOutpostCombatFeedbackState,
  disposeOutpostCombatFeedback,
  resolveOutpostProjectilePresentationPosition,
  startOutpostAnticipatedTracer,
  syncOutpostCombatFeedback,
  type OutpostProjectilePredictionFrame
} from "../presentation";

describe("Outpost client combat feedback", () => {
  it("renders bounded tracer, hit confirm, impact, and incoming damage direction", () => {
    const renderer = createMemoryRenderer("outpost.combat-feedback.test");
    const targetStates = new Map<string, Record<string, unknown>>();
    const options = {
      dataRegistry: createOutpostDataRegistry(),
      renderer,
      listenerObjectId: "player.ranger-1",
      applyRenderTargetState(native: unknown, state: unknown) {
        targetStates.set((native as { id: string }).id, state as Record<string, unknown>);
      }
    };
    const presentation = createOutpostClientCombatPresentation();
    const feedback = createOutpostCombatFeedbackState();
    presentation.update({ active: true, cueWatermark: 0, cues: [] });
    presentation.update({
      active: true,
      cueWatermark: 3,
      cues: [
        {
          sequence: 1,
          kind: "projectile-spawned",
          at: 10,
          sourceObjectId: "enemy.raider-1",
          position: { x: 700, y: 500 },
          direction: { x: -1, y: 0 }
        },
        {
          sequence: 2,
          kind: "shield-hit",
          at: 12,
          sourceObjectId: "player.ranger-1",
          targetObjectId: "enemy.raider-1",
          position: { x: 760, y: 500 },
          direction: { x: -1, y: 0 },
          amount: 12
        },
        {
          sequence: 3,
          kind: "health-hit",
          at: 14,
          sourceObjectId: "enemy.raider-1",
          targetObjectId: "player.ranger-1",
          position: { x: 800, y: 500 },
          direction: { x: 1, y: 0 },
          amount: 8
        }
      ]
    });

    syncOutpostCombatFeedback(options, feedback, {
      presentation,
      playerFrame: {
        elapsed: 16,
        active: true,
        health: 92,
        fireHeld: false,
        fireSequence: 0,
        aim: { x: 920, y: 500 }
      },
      elapsed: 16,
      localAnticipations: new Set()
    });

    const objectIds = renderer.objects().map((object) => object.id);
    expect(objectIds).toEqual(
      expect.arrayContaining([
        "outpost.player-feedback.player.ranger-1.crosshair",
        "outpost.combat-cue.2.impact",
        "outpost.combat-cue.3.impact",
        "outpost.player-feedback.damage-direction.3"
      ])
    );
    expect(objectIds).toContain("outpost.combat-cue.1.tracer");
    expect(targetStates.get("outpost.player-feedback.player.ranger-1.crosshair")).toMatchObject({
      visible: true,
      transform: { position: { x: 920, y: 500 } },
      props: { tint: 0x63fff2 }
    });
    expect(feedback.effects.size).toBe(4);

    syncOutpostCombatFeedback(options, feedback, {
      presentation,
      playerFrame: {
        elapsed: 500,
        active: true,
        health: 92,
        fireHeld: false,
        fireSequence: 0,
        aim: { x: 930, y: 510 }
      },
      elapsed: 500,
      localAnticipations: new Set()
    });
    expect(feedback.effects.size).toBe(0);
    expect(renderer.objects().map((object) => object.id)).toEqual([
      "outpost.player-feedback.player.ranger-1.crosshair"
    ]);

    disposeOutpostCombatFeedback(options, feedback);
    expect(renderer.objects()).toHaveLength(0);
  });

  it("stops the locally predicted projectile at the shared arena blocker", async () => {
    const renderer = createMemoryRenderer("outpost.projectile-prediction.test");
    const predictionFrame = {
      generation: "prediction-test",
      authorityElapsedMs: 0,
      actors: [],
      records: []
    };
    const options = {
      dataRegistry: createOutpostDataRegistry(),
      renderer,
      listenerObjectId: "player.ranger-1",
      physicsBackend: await initRapier2dPhysicsBackend({
        id: "outpost.projectile-prediction.test"
      }),
      readProjectilePredictionFrame() {
        return predictionFrame;
      }
    };
    const feedback = createOutpostCombatFeedbackState(options);
    const presentation = createOutpostClientCombatPresentation();
    const correlationId = "player.ranger-1.rifle.1";
    presentation.update({ active: true, cueWatermark: 0, cues: [] });
    syncOutpostCombatFeedback(options, feedback, {
      presentation,
      elapsed: 0,
      localAnticipations: new Set()
    });
    startOutpostAnticipatedTracer(options, feedback, {
      correlationId,
      position: { x: 315, y: 200 },
      aim: { x: 315, y: 0 },
      elapsed: 0
    });
    expect(renderer.objects().map((object) => object.id)).toContain(
      projectileObjectId("prediction-test", correlationId)
    );
    expect(renderer.objects().map((object) => object.id)).toContain(
      `outpost.player-feedback.tracer.${correlationId}`
    );
    syncOutpostCombatFeedback(options, feedback, {
      presentation,
      elapsed: 200,
      localAnticipations: new Set([correlationId])
    });

    const stopped = resolveOutpostProjectilePresentationPosition(feedback, {
      projectileId: `${correlationId}.projectile`,
      authorityPosition: { x: 315, y: 0 },
      elapsed: 200
    });
    expect(stopped.x).toBeCloseTo(315, 3);
    expect(stopped.y).toBeGreaterThan(145);
    expect(stopped.y).toBeLessThan(155);
    expect(renderer.objects().map((object) => object.id)).not.toContain(
      projectileObjectId("prediction-test", correlationId)
    );

    disposeOutpostCombatFeedback(options, feedback);
    expect(renderer.objects()).toHaveLength(0);
  });

  it("keeps the owner monotonic and shares one authority projectile identity with observers", () => {
    const renderer = createMemoryRenderer("outpost.projectile-authority-handoff.test");
    const observerRenderer = createMemoryRenderer("outpost.projectile-authority-observer.test");
    const targetStates = new Map<string, Record<string, unknown>>();
    const observerTargetStates = new Map<string, Record<string, unknown>>();
    const correlationId = "player.ranger-1.rifle.1";
    const authorityProjectileId = "authority.rifle.1.projectile";
    const predictionFrame: OutpostProjectilePredictionFrame = {
      generation: "authority-handoff-test",
      authorityElapsedMs: 0,
      actors: [],
      records: []
    };
    const options = {
      dataRegistry: createOutpostDataRegistry(),
      renderer,
      listenerObjectId: "player.ranger-1",
      physicsBackend: createMemoryPhysicsBackend(),
      readProjectilePredictionFrame() {
        return predictionFrame;
      },
      applyRenderTargetState(native: unknown, state: unknown) {
        targetStates.set((native as { id: string }).id, state as Record<string, unknown>);
      }
    };
    const observerOptions = {
      ...options,
      renderer: observerRenderer,
      listenerObjectId: "player.ranger-2",
      applyRenderTargetState(native: unknown, state: unknown) {
        observerTargetStates.set((native as { id: string }).id, state as Record<string, unknown>);
      }
    };
    const feedback = createOutpostCombatFeedbackState(options);
    const observerFeedback = createOutpostCombatFeedbackState(observerOptions);
    syncOutpostCombatFeedback(options, feedback, {
      elapsed: 0,
      localAnticipations: new Set()
    });
    syncOutpostCombatFeedback(observerOptions, observerFeedback, {
      elapsed: 0,
      localAnticipations: new Set()
    });
    startOutpostAnticipatedTracer(options, feedback, {
      correlationId,
      position: { x: 800, y: 500 },
      aim: { x: 1_200, y: 500 },
      elapsed: 0
    });
    syncOutpostCombatFeedback(options, feedback, {
      elapsed: 100,
      localAnticipations: new Set([correlationId])
    });
    syncOutpostCombatFeedback(observerOptions, observerFeedback, {
      elapsed: 100,
      localAnticipations: new Set()
    });
    const visualObjectId = projectileObjectId(predictionFrame.generation, correlationId);
    const beforeAuthority = (
      targetStates.get(visualObjectId)?.transform as
        | { position?: { x?: number; y?: number } }
        | undefined
    )?.position;
    expect(beforeAuthority?.x).toBeGreaterThan(900);
    expect(
      renderer.objects().find((object) => object.id === visualObjectId)?.transform?.rotation?.z
    ).toBeCloseTo(Math.PI / 2);

    predictionFrame.authorityElapsedMs = 50;
    predictionFrame.records = [
      {
        projectileId: authorityProjectileId,
        correlationId,
        generation: predictionFrame.generation,
        definitionId: "combat.outpost.projectile.rifle",
        definitionVersion: "outpost.rifle-projectile.v1",
        fireTick: 4,
        fixedDeltaMs: 1000 / 60,
        firePosition: { x: 834, y: 500 },
        fireVelocity: { x: 760, y: 0 },
        expiresTick: 76
      }
    ];
    syncOutpostCombatFeedback(options, feedback, {
      elapsed: 100,
      localAnticipations: new Set([correlationId])
    });
    syncOutpostCombatFeedback(observerOptions, observerFeedback, {
      elapsed: 100,
      localAnticipations: new Set()
    });

    const afterAuthority = (
      targetStates.get(visualObjectId)?.transform as
        | { position?: { x?: number; y?: number } }
        | undefined
    )?.position;
    expect(afterAuthority?.x).toBeGreaterThanOrEqual(beforeAuthority?.x ?? 0);
    expect(renderer.objects().map((object) => object.id)).toContain(visualObjectId);
    expect(renderer.objects().filter((object) => object.id === visualObjectId)).toHaveLength(1);
    expect(
      observerRenderer.objects().filter((object) => object.id === visualObjectId)
    ).toHaveLength(1);
    expect(
      (targetStates.get(visualObjectId)?.transform as { rotation?: { z?: number } } | undefined)
        ?.rotation?.z
    ).toBeCloseTo(Math.PI / 2);
    expect(
      (
        observerTargetStates.get(visualObjectId)?.transform as
          | { rotation?: { z?: number } }
          | undefined
      )?.rotation?.z
    ).toBeCloseTo(Math.PI / 2);
    expect(
      renderer.objects().find((object) => object.id === visualObjectId)?.props
    ).not.toMatchObject({ tint: 0xfff1a8 });
    expect(renderer.objects().find((object) => object.id === visualObjectId)?.props).toEqual(
      observerRenderer.objects().find((object) => object.id === visualObjectId)?.props
    );
    expect(feedback.projectilePrediction?.diagnostics()).toMatchObject({
      preventedTimelineRewinds: 1,
      acceptedAuthorityTimelines: 1,
      correctedTrajectories: 0,
      lastAuthorityFireTickOffset: 4
    });

    syncOutpostCombatFeedback(options, feedback, {
      elapsed: 400,
      localAnticipations: new Set([correlationId])
    });
    syncOutpostCombatFeedback(observerOptions, observerFeedback, {
      elapsed: 400,
      localAnticipations: new Set()
    });
    const nextPosition = (
      targetStates.get(visualObjectId)?.transform as
        | { position?: { x?: number; y?: number } }
        | undefined
    )?.position;
    expect(nextPosition?.x).toBeGreaterThan(afterAuthority?.x ?? 0);
    const observerPosition = (
      observerTargetStates.get(visualObjectId)?.transform as
        | { position?: { x?: number; y?: number } }
        | undefined
    )?.position;
    expect((nextPosition?.x ?? 0) - (afterAuthority?.x ?? 0)).toBeCloseTo(760 * 0.3, 3);
    expect(observerPosition?.x).toBeGreaterThan(834);
    expect(nextPosition?.x).toBeGreaterThan(observerPosition?.x ?? 0);
    expect(nextPosition?.y).toBeCloseTo(observerPosition?.y ?? 0, 6);

    disposeOutpostCombatFeedback(options, feedback);
    disposeOutpostCombatFeedback(observerOptions, observerFeedback);
    expect(renderer.objects()).toHaveLength(0);
    expect(observerRenderer.objects()).toHaveLength(0);
  });

  it("smooths a real trajectory correction on the existing owner render object", () => {
    const renderer = createMemoryRenderer("outpost.projectile-real-correction.test");
    const targetStates = new Map<string, Record<string, unknown>>();
    const correlationId = "player.ranger-1.rifle.2";
    const authorityProjectileId = "authority.rifle.2.projectile";
    const predictionFrame: OutpostProjectilePredictionFrame = {
      generation: "real-correction-test",
      authorityElapsedMs: 0,
      actors: [],
      records: []
    };
    const options = {
      dataRegistry: createOutpostDataRegistry(),
      renderer,
      listenerObjectId: "player.ranger-1",
      physicsBackend: createMemoryPhysicsBackend(),
      readProjectilePredictionFrame() {
        return predictionFrame;
      },
      applyRenderTargetState(native: unknown, state: unknown) {
        targetStates.set((native as { id: string }).id, state as Record<string, unknown>);
      }
    };
    const feedback = createOutpostCombatFeedbackState(options);
    syncOutpostCombatFeedback(options, feedback, {
      elapsed: 0,
      localAnticipations: new Set()
    });
    startOutpostAnticipatedTracer(options, feedback, {
      correlationId,
      position: { x: 800, y: 500 },
      aim: { x: 1_200, y: 500 },
      elapsed: 0
    });
    predictionFrame.authorityElapsedMs = 32;
    predictionFrame.records = [
      {
        projectileId: authorityProjectileId,
        correlationId,
        generation: predictionFrame.generation,
        definitionId: "combat.outpost.projectile.rifle",
        definitionVersion: "outpost.rifle-projectile.v1",
        fireTick: 2,
        fixedDeltaMs: 1000 / 60,
        firePosition: { x: 834, y: 580 },
        fireVelocity: { x: 760, y: 0 },
        expiresTick: 74
      }
    ];
    syncOutpostCombatFeedback(options, feedback, {
      elapsed: 32,
      localAnticipations: new Set([correlationId])
    });

    const visualObjectId = projectileObjectId(predictionFrame.generation, correlationId);
    expect(feedback.projectilePrediction?.diagnostics()).toMatchObject({
      acceptedAuthorityTimelines: 0,
      correctedTrajectories: 1,
      activeCorrections: 1
    });
    expect(renderer.objects().map((object) => object.id)).toContain(visualObjectId);
    expect(renderer.objects().filter((object) => object.id === visualObjectId)).toHaveLength(1);
    const correctionStartY = (
      targetStates.get(visualObjectId)?.transform as { position?: { y?: number } } | undefined
    )?.position?.y;
    expect(correctionStartY).toBeCloseTo(500, 3);

    syncOutpostCombatFeedback(options, feedback, {
      elapsed: 132,
      localAnticipations: new Set([correlationId])
    });
    const correctingY = (
      targetStates.get(visualObjectId)?.transform as { position?: { y?: number } } | undefined
    )?.position?.y;
    expect(correctingY).toBeGreaterThan(correctionStartY ?? 0);
    expect(correctingY).toBeLessThanOrEqual(580);

    disposeOutpostCombatFeedback(options, feedback);
    expect(renderer.objects()).toHaveLength(0);
  });

  it("stops the correlated projectile on a terminal cue before the finish record arrives", () => {
    const renderer = createMemoryRenderer("outpost.projectile-terminal-cue.test");
    const predictionFrame: OutpostProjectilePredictionFrame = {
      generation: "terminal-cue-test",
      authorityElapsedMs: 0,
      actors: [],
      records: []
    };
    const options = {
      dataRegistry: createOutpostDataRegistry(),
      renderer,
      listenerObjectId: "player.ranger-1",
      physicsBackend: createMemoryPhysicsBackend(),
      readProjectilePredictionFrame() {
        return predictionFrame;
      }
    };
    const feedback = createOutpostCombatFeedbackState(options);
    const presentation = createOutpostClientCombatPresentation();
    const correlationId = "player.ranger-1.rifle.1";
    presentation.update({ active: true, cueWatermark: 0, cues: [] });
    syncOutpostCombatFeedback(options, feedback, {
      presentation,
      elapsed: 0,
      localAnticipations: new Set()
    });
    startOutpostAnticipatedTracer(options, feedback, {
      correlationId,
      position: { x: 315, y: 200 },
      aim: { x: 600, y: 200 },
      elapsed: 0
    });
    predictionFrame.authorityElapsedMs = 16;
    predictionFrame.records = [
      {
        projectileId: "authority.rifle.1.projectile",
        correlationId,
        generation: predictionFrame.generation,
        definitionId: "combat.outpost.projectile.rifle",
        definitionVersion: "outpost.rifle-projectile.v1",
        fireTick: 0,
        fixedDeltaMs: 1000 / 60,
        firePosition: { x: 349, y: 200 },
        fireVelocity: { x: 760, y: 0 },
        expiresTick: 72
      }
    ];
    presentation.update({
      active: true,
      cueWatermark: 1,
      cues: [
        {
          sequence: 1,
          kind: "health-hit",
          at: 16,
          sourceObjectId: "player.ranger-1",
          targetObjectId: "enemy.raider-1",
          projectileId: "authority.rifle.1.projectile",
          correlationId,
          position: { x: 370, y: 200 },
          direction: { x: 1, y: 0 },
          amount: 12
        }
      ]
    });

    syncOutpostCombatFeedback(options, feedback, {
      presentation,
      elapsed: 16,
      localAnticipations: new Set([correlationId])
    });

    const objectIds = renderer.objects().map((object) => object.id);
    expect(objectIds).not.toContain(projectileObjectId(predictionFrame.generation, correlationId));
    expect(objectIds).toContain("outpost.combat-cue.1.impact");
    expect(feedback.terminalProjectileCorrelations.has(correlationId)).toBe(true);

    disposeOutpostCombatFeedback(options, feedback);
    expect(renderer.objects()).toHaveLength(0);
  });

  it("reconstructs a recent finished remote projectile once on the delayed authority timeline", () => {
    const renderer = createMemoryRenderer("outpost.projectile-record-only.test");
    const frame = {
      generation: "record-only-test",
      authorityElapsedMs: 100,
      actors: [],
      records: [
        {
          projectileId: "remote.execution.1.projectile",
          correlationId: "remote.rifle.1",
          generation: "record-only-test",
          definitionId: "combat.outpost.projectile.rifle",
          definitionVersion: "outpost.rifle-projectile.v1",
          fireTick: 0,
          fixedDeltaMs: 1000 / 60,
          firePosition: { x: 700, y: 500 },
          fireVelocity: { x: 760, y: 0 },
          expiresTick: 72,
          finish: {
            tick: 3,
            reason: "impact",
            position: { x: 738, y: 500 },
            normal: { x: -1, y: 0 }
          }
        }
      ]
    };
    const options = {
      dataRegistry: createOutpostDataRegistry(),
      renderer,
      physicsBackend: createMemoryPhysicsBackend(),
      readProjectilePredictionFrame() {
        return frame;
      }
    };
    const feedback = createOutpostCombatFeedbackState(options);

    syncOutpostCombatFeedback(options, feedback, {
      elapsed: 0,
      localAnticipations: new Set()
    });
    const objectId = projectileObjectId("record-only-test", "remote.rifle.1");
    expect(renderer.objects().map((object) => object.id)).toContain(objectId);

    syncOutpostCombatFeedback(options, feedback, {
      elapsed: 70,
      localAnticipations: new Set()
    });
    expect(renderer.objects().map((object) => object.id)).not.toContain(objectId);

    disposeOutpostCombatFeedback(options, feedback);
    expect(renderer.objects()).toHaveLength(0);
  });
});

function projectileObjectId(generation: string, correlationId: string): string {
  return `outpost.combat-projectile.${generation}.${correlationId}`;
}
