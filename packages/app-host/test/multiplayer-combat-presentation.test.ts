import {
  reconcileCombatKinematicProjectileRecords,
  sampleCombatKinematicProjectileRecord,
  type CombatKinematicProjectileRecord
} from "@gamekits/combat";
import { describe, expect, it } from "vitest";
import { createStandardCombatKinematicProjectilePresentationTransition } from "../src";

describe("standard Multiplayer and Combat projectile presentation", () => {
  it("compares owner and authority lifecycles by shot age", () => {
    const predicted = record("predicted", 0, {
      finish: { tick: 6, reason: "impact", position: { x: 30, y: 0 } }
    });
    const authoritative = record("authority", 4, {
      finish: { tick: 10, reason: "impact", position: { x: 30, y: 0 } }
    });

    expect(
      reconcileCombatKinematicProjectileRecords(predicted, authoritative, {
        timeline: "shot-relative"
      })
    ).toMatchObject({
      status: "confirmed",
      timeline: "shot-relative",
      fireTickError: 4,
      finishTickError: 0,
      reasonMatches: true
    });
    expect(reconcileCombatKinematicProjectileRecords(predicted, authoritative)).toMatchObject({
      status: "corrected",
      timeline: "absolute",
      fireTickError: 4
    });
  });

  it("adopts matching authority facts without changing predicted lifecycle age or speed", () => {
    const transition = createStandardCombatKinematicProjectilePresentationTransition({
      reconciliation: { timeline: "shot-relative" }
    });
    const predicted = record("predicted", 0);
    const authoritative = record("authority", 4);

    const atConfirm = transition.sample({
      predicted,
      authoritative,
      authorityTick: 10,
      elapsedMs: 100
    });
    const nextFrame = transition.sample({
      predicted,
      authoritative,
      authorityTick: 12,
      elapsedMs: 230
    });
    const laterFrame = transition.sample({
      predicted,
      authoritative,
      authorityTick: 16,
      elapsedMs: 360
    });
    const observerAtAuthorityTick = sampleCombatKinematicProjectileRecord(authoritative, 16);

    expect(atConfirm?.position.x).toBeCloseTo(50, 6);
    expect(nextFrame?.position.x).toBeCloseTo(60, 6);
    expect(laterFrame?.position.x).toBeCloseTo(80, 6);
    expect(observerAtAuthorityTick.position.x).toBeCloseTo(60, 6);
    expect(transition.diagnostics()).toMatchObject({
      reconciled: 1,
      confirmedTrajectories: 1,
      correctedTrajectories: 0,
      smoothedCorrections: 0,
      completedCorrections: 0,
      activeCorrections: 0,
      lastFireTickOffset: 4
    });
  });

  it("keeps absolute timeline adoption available when explicitly requested", () => {
    const transition = createStandardCombatKinematicProjectilePresentationTransition({
      reconciliation: { timeline: "absolute" }
    });
    const predicted = record("predicted", 0);
    const authoritative = record("authority", 4);

    const atConfirm = transition.sample({
      predicted,
      authoritative,
      authorityTick: 10,
      elapsedMs: 100
    });
    const afterCorrection = transition.sample({
      predicted,
      authoritative,
      authorityTick: 16,
      elapsedMs: 400
    });

    expect(atConfirm?.position.x).toBeCloseTo(50, 6);
    expect(afterCorrection?.position.x).toBeCloseTo(60, 6);
    expect(transition.diagnostics()).toMatchObject({
      correctedTrajectories: 1,
      smoothedCorrections: 1,
      completedCorrections: 1,
      activeCorrections: 0,
      lastFireTickOffset: 4
    });
  });

  it("smooths only residual spatial divergence after time alignment", () => {
    const transition = createStandardCombatKinematicProjectilePresentationTransition({
      reconciliation: { timeline: "shot-relative" }
    });
    const predicted = record("predicted", 0);
    const authoritative = record("authority", 4, {
      firePosition: { x: 2, y: 0 }
    });

    const atConfirm = transition.sample({
      predicted,
      authoritative,
      authorityTick: 10,
      elapsedMs: 100
    });
    const afterCorrection = transition.sample({
      predicted,
      authoritative,
      authorityTick: 12,
      elapsedMs: 200
    });

    expect(atConfirm?.position.x).toBeCloseTo(50, 6);
    expect(afterCorrection?.position.x).toBeCloseTo(62, 6);
    expect(transition.diagnostics()).toMatchObject({
      correctedTrajectories: 1,
      smoothedCorrections: 1,
      completedCorrections: 1,
      activeCorrections: 0,
      lastFireTickOffset: 4
    });
  });

  it("keeps a provisional local finish until authority publishes its finish", () => {
    const transition = createStandardCombatKinematicProjectilePresentationTransition();
    const predicted = record("predicted", 0, {
      finish: { tick: 3, reason: "impact", position: { x: 15, y: 0 } }
    });
    const authoritative = record("authority", 2);

    expect(
      transition.sample({
        predicted,
        authoritative,
        authorityTick: 5,
        elapsedMs: 100
      })
    ).toMatchObject({ active: false, position: { x: 15, y: 0 } });
    expect(transition.diagnostics()).toMatchObject({ heldPredictedFinishes: 1 });
  });
});

function record(
  projectileId: string,
  fireTick: number,
  overrides: Partial<CombatKinematicProjectileRecord> = {}
): CombatKinematicProjectileRecord {
  return {
    projectileId,
    correlationId: "shot-1",
    generation: "round-1",
    definitionId: "projectile.test",
    definitionVersion: "v1",
    fireTick,
    fixedDeltaMs: 50,
    firePosition: { x: 0, y: 0 },
    fireVelocity: { x: 100, y: 0 },
    expiresTick: fireTick + 20,
    ...overrides
  };
}
