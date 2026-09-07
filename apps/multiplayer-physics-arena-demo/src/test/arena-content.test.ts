import type { DataPack } from "@gamekits/data";
import { describe, expect, it } from "vitest";
import { createArenaDataTypes } from "../content/data-types";
import { ARENA_DEFAULT_MATCH_RULE_ID, arenaContentPack } from "../content/pack";
import { compileArenaContent, createArenaDataRegistry } from "../content/registry";
import {
  ARENA_COURSE_TYPE,
  ARENA_ITEM_TYPE,
  ARENA_MATCH_RULE_TYPE,
  ARENA_STAGE_TYPE
} from "../content/types";
import {
  arenaActorId,
  arenaAttackExecutionId,
  arenaGenerationKey,
  arenaHitTicketId,
  arenaItemInstanceId,
  arenaKnockoutCreditId,
  arenaParticipantId,
  arenaPickupClaimId,
  createArenaGeneration
} from "../shared/arena-identity";

describe("Knockout Arena content and identity", () => {
  it("compiles the baseline three-stage match through app-local DataTypes", () => {
    const registry = createArenaDataRegistry();
    const content = compileArenaContent(registry);

    expect(createArenaDataTypes()).toHaveLength(9);
    expect(registry.snapshot()).toMatchObject({ packs: [arenaContentPack.id] });
    expect(content.matchRule.id).toBe(ARENA_DEFAULT_MATCH_RULE_ID);
    expect(content.stages.map((stage) => stage.definition.kind)).toEqual([
      "qualifier",
      "brawl",
      "final"
    ]);
    expect(content.stages.map((stage) => stage.definition.qualificationCount)).toEqual([6, 3, 1]);
    expect(content.motorProfiles.map(({ id }) => id)).toEqual(["motor.standard"]);
    expect(content.botProfiles.map(({ id }) => id)).toEqual([
      "bot.profile.brawler",
      "bot.profile.opportunist",
      "bot.profile.sprinter"
    ]);
    expect(content.stages[1]?.items).toHaveLength(7);
    expect(
      content.stages[1]?.spawnSet.points.filter((point) => point.kind === "item")
    ).toHaveLength(12);
    expect(content.stages.every((stage) => stage.bots.length === 3)).toBe(true);
    expect(content.stages[0]?.bots.map(({ role }) => role)).toEqual([
      "sprinter",
      "brawler",
      "opportunist"
    ]);
  });

  it("projects one deterministic course definition into aligned Physics, Navigation and Presentation facts", () => {
    const authority = compileArenaContent(createArenaDataRegistry());
    const client = compileArenaContent(createArenaDataRegistry());

    expect(client.definitionVersion).toBe(authority.definitionVersion);
    expect(client.physicsEnvironment).toEqual(authority.physicsEnvironment);
    expect(client.stages.map(({ courseProjection }) => courseProjection.layoutSignature)).toEqual(
      authority.stages.map(({ courseProjection }) => courseProjection.layoutSignature)
    );
    expect(client.stages.map(({ courseProjection }) => courseProjection.scheduleSignature)).toEqual(
      authority.stages.map(({ courseProjection }) => courseProjection.scheduleSignature)
    );

    for (const stage of authority.stages) {
      const projection = stage.courseProjection;
      const physicsSourceIds = new Set(
        (projection.physicsEnvironment.bodies ?? []).map((body) => body.userData?.sourceId)
      );
      const presentationSourceIds = new Set(
        projection.presentation.placements.map((placement) => placement.sourceId)
      );
      const navigationSourceIds = new Set(
        projection.navigation.source.triangles.flatMap((triangle) =>
          (triangle.tags ?? [])
            .filter((tag) => tag.startsWith("source:"))
            .map((tag) => tag.slice("source:".length))
        )
      );
      for (const placement of stage.course.staticLayout) {
        expect(physicsSourceIds.has(placement.id)).toBe(true);
        expect(presentationSourceIds.has(placement.id)).toBe(true);
        if (placement.navigationArea !== undefined) {
          expect(navigationSourceIds.has(placement.id)).toBe(true);
        }
      }
      expect(projection.validationProbes.length).toBeGreaterThan(0);
      expect(projection.navigation.source.version).toBe(stage.course.definitionVersion);
      expect(projection.memberDefinitions.map(({ id }) => id)).toEqual(
        projection.memberDefinitions.map(({ id }) => id).sort()
      );
    }
  });

  it("changes the gameplay signature when an authored placement changes", () => {
    const changedPack = structuredClone(arenaContentPack);
    const courseEntry = changedPack.entries.find(
      (entry) => entry.type === ARENA_COURSE_TYPE && entry.id === "course.circuit-forge"
    );
    if (courseEntry === undefined) throw new Error("Missing circuit course fixture");
    const course = courseEntry.data as {
      definitionVersion: string;
      staticLayout: Array<{ position: { x: number } }>;
    };
    course.definitionVersion = "course.circuit-forge.v2";
    course.staticLayout[0]!.position.x += 0.5;

    const baseline = compileArenaContent(createArenaDataRegistry());
    const changed = compileArenaContent(createArenaDataRegistry({ packs: [changedPack] }));
    expect(changed.definitionVersion).not.toBe(baseline.definitionVersion);
    expect(changed.stages[0]?.courseProjection.layoutSignature).not.toBe(
      baseline.stages[0]?.courseProjection.layoutSignature
    );
  });

  it("reports duplicate documents and dangling references deterministically", () => {
    const registry = createArenaDataRegistry({ packs: [] });
    const duplicate: DataPack = {
      id: "invalid.duplicate",
      version: "1",
      entries: [itemEntry("item.same"), itemEntry("item.same")]
    };
    const missingReference: DataPack = {
      id: "invalid.reference",
      version: "1",
      entries: [
        {
          type: ARENA_STAGE_TYPE,
          id: "stage.invalid",
          data: {
            id: "stage.invalid",
            kind: "qualifier",
            course: { type: ARENA_COURSE_TYPE, id: "course.missing" },
            qualificationCount: 1,
            durationTicks: 60,
            itemPool: [],
            botArchetypes: []
          }
        }
      ]
    };

    expect(registry.validatePack(duplicate).diagnostics.map(({ code }) => code)).toContain(
      "data.duplicate_document"
    );
    const referenceDiagnostics = registry.validatePack(missingReference).diagnostics;
    expect(referenceDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "data.missing_reference",
          key: { type: ARENA_STAGE_TYPE, id: "stage.invalid" },
          path: "course"
        })
      ])
    );
  });

  it("rejects invalid stage topology after DataRegistry validation", () => {
    const invalid = structuredClone(arenaContentPack);
    const match = invalid.entries.find(
      (entry) => entry.type === ARENA_MATCH_RULE_TYPE && entry.id === ARENA_DEFAULT_MATCH_RULE_ID
    );
    if (match === undefined) throw new Error("Missing match fixture");
    match.data = {
      ...(match.data as { id: string; participantCount: number; stages: unknown[] }),
      stages: (match.data as { stages: unknown[] }).stages.slice(0, 2)
    };
    const registry = createArenaDataRegistry({ packs: [invalid] });
    expect(() => compileArenaContent(registry)).toThrow(/arena\.content_stage_count/);
  });

  it("builds stable generation-scoped runtime identities", () => {
    const generation = createArenaGeneration({ match: 2, stage: 1, membershipRevision: 4 });
    const participant = arenaParticipantId("session-alpha", 3);
    const actor = arenaActorId(participant, generation);
    const item = arenaItemInstanceId("item.foam-ball", "spawn.center", generation, 2);
    const claim = arenaPickupClaimId(actor, item, 120, 7);
    const execution = arenaAttackExecutionId(actor, item, 124, 9);

    expect(arenaGenerationKey(generation)).toBe("m2.s1.r4");
    expect(actor).toContain("actor.participant.session-alpha.3.m2.s1.r4");
    expect(claim).toContain(".t120.q7");
    expect(arenaHitTicketId(execution, actor)).toContain("hit.execution.");
    expect(arenaKnockoutCreditId(actor, 180)).toContain(".t180");
    expect(() => createArenaGeneration({ match: 0, stage: 1, membershipRevision: 1 })).toThrow(
      /positive integer/
    );
    expect(() => arenaParticipantId("invalid:session", 0)).toThrow(/stable non-empty segment/);
  });
});

function itemEntry(id: string) {
  return {
    type: ARENA_ITEM_TYPE,
    id,
    data: {
      id,
      kind: "throwable" as const,
      physics: {
        shape: { type: "sphere" as const, radius: 0.5 },
        mass: 1,
        friction: 0.5,
        restitution: 0.5,
        continuousCollisionDetection: true,
        maxLinearSpeed: 10,
        lifetimeTicks: 120,
        maxBounces: 2
      },
      carry: {
        socket: "hand.primary",
        speedMultiplier: 1,
        jumpMultiplier: 1,
        dropPolicy: "drop" as const
      },
      action: {
        mode: "throw-contact" as const,
        windupTicks: 0,
        maxChargeTicks: 0,
        activeTicks: 120,
        cooldownTicks: 0,
        launchSpeed: 10,
        baseImpulse: 4,
        areaRadius: 0
      },
      effect: {
        impulseMode: "directional" as const,
        instabilityDelta: 0.1,
        staggerMultiplier: 1
      },
      respawn: { mode: "none" as const, ticks: 0 },
      presentationId: "presentation.fixture",
      networkStrategy: "predicted-entity" as const
    }
  };
}
