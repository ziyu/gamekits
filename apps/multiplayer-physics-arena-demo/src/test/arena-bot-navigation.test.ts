import type {
  NavigationPathRequest,
  NavigationQueries,
  NavigationRequestResult,
  NavigationRouteSample
} from "@gamekits/navigation-core";
import { describe, expect, it } from "vitest";

import { createArenaBotDecisionRuntime } from "../ai/decision";
import {
  ARENA_BOT_NAVIGATION_PROFILE_ID,
  prepareArenaBotNavigationRuntime
} from "../ai/navigation";
import type { ArenaBotPerceptionFrame, ArenaBotPerceptionSource } from "../ai/perception";
import { ARENA_COMPILED_CONTENT } from "../content/default-content";

const FIXED_STEP_MS = 1000 / 60;

describe("Knockout Arena bot navigation", () => {
  it("bakes every course, follows a real Recast field and clears routes on stage change", async () => {
    const navigation = await prepareArenaBotNavigationRuntime(ARENA_COMPILED_CONTENT);
    try {
      const stage = ARENA_COMPILED_CONTENT.stages[0]!;
      const start = toNavigationPoint(stage.courseProjection.participantSpawns[0]!.position);
      const checkpoint = stage.course.volumes
        .filter(({ kind }) => kind === "checkpoint")
        .sort((left, right) => (left.routeOrder ?? 0) - (right.routeOrder ?? 0))[0]!;
      const requestId = navigation.queries.requestPath({
        requesterId: "ai.bot.0",
        profileId: ARENA_BOT_NAVIGATION_PROFILE_ID,
        start,
        goal: toNavigationPoint(checkpoint.position),
        goalKey: checkpoint.id,
        routeKind: "field"
      });

      navigation.update(FIXED_STEP_MS, FIXED_STEP_MS);
      const result = navigation.queries.poll(requestId);
      expect(result).toMatchObject({ status: "complete", route: { kind: "field" } });
      if (result.status !== "complete") throw new Error("Expected a complete Recast route");
      const sample = navigation.queries.sampleRoute(result.route.routeId, start);
      expect(sample).toMatchObject({
        status: "valid",
        direction: { x: expect.any(Number), y: expect.any(Number) }
      });
      if (sample.status !== "valid") throw new Error("Expected a valid Recast route sample");
      expect(sample.direction.y).toBeLessThan(0);
      expect(navigation.snapshot()).toMatchObject({
        activeStageIndex: 0,
        artifacts: 3,
        retainedRoutes: 1,
        disposed: false
      });
      expect(navigation.snapshot().artifactBytes).toBeGreaterThan(0);
      expect(navigation.snapshot().polygonCount).toBeGreaterThan(0);

      navigation.activateStage(1);
      expect(navigation.snapshot()).toMatchObject({
        activeStageIndex: 1,
        stageChanges: 1,
        pendingRequests: 0,
        retainedRoutes: 0
      });
    } finally {
      navigation.dispose();
    }
    expect(navigation.snapshot()).toMatchObject({
      pendingRequests: 0,
      retainedRoutes: 0,
      disposed: true
    });
  });

  it("replans stale routes and releases task-owned routes when an agent is removed", () => {
    const navigation = fakeNavigation();
    const fixture = decisionFixture(navigation.queries);
    advanceUntilPhase(fixture, "following", 80);
    expect(navigation.requests()).toBe(1);

    navigation.staleNextSample();
    advance(fixture, 30);

    expect(navigation.requests()).toBeGreaterThanOrEqual(2);
    fixture.runtime.unbind("bot.0", "stage-change");
    expect(navigation.releases()).toBeGreaterThan(0);
    expect(fixture.runtime.snapshot()).toMatchObject({ agents: 0, activeTasks: 0 });
  });

  it("uses deterministic backoff and reports stuck instead of teleporting", () => {
    const navigation = fakeNavigation();
    const fixture = decisionFixture(navigation.queries);

    advance(fixture, 320);

    expect(navigation.requests()).toBeGreaterThanOrEqual(3);
    expect(fixture.runtime.traces()).toContainEqual(
      expect.objectContaining({
        label: "ai.task_failed",
        payload: expect.objectContaining({ reason: "stuck" })
      })
    );
    expect(fixture.frame.actors[0]!.position).toEqual({ x: 0, y: 1, z: 0 });
  });
});

function decisionFixture(navigation: NavigationQueries) {
  const frame: ArenaBotPerceptionFrame = {
    tick: 0,
    elapsedMs: 0,
    stageId: "stage.circuit-forge",
    stageKind: "qualifier",
    actors: [
      {
        participantId: "bot.0",
        memberId: "bot.0",
        position: { x: 0, y: 1, z: 0 },
        linearVelocity: { x: 0, y: 0, z: 0 },
        status: "active",
        instability: 0
      }
    ],
    items: [],
    hazards: [],
    impacts: [],
    objective: {
      id: "checkpoint.1",
      position: { x: 0, y: 1, z: -12 },
      routeOrder: 1,
      checkpointCount: 0,
      qualificationCount: 6,
      activeParticipants: 8,
      completedParticipants: 0,
      stageProgress: 0
    }
  };
  const archetype = ARENA_COMPILED_CONTENT.stages[0]!.bots.find(({ id }) => id === "bot.sprinter")!;
  const profile = ARENA_COMPILED_CONTENT.botProfiles.find(({ id }) => id === archetype.profile.id)!;
  const source: ArenaBotPerceptionSource = { frame: () => frame, profileFor: () => profile };
  const runtime = createArenaBotDecisionRuntime({
    content: ARENA_COMPILED_CONTENT,
    perception: source,
    navigation
  });
  runtime.bind({ memberId: "bot.0", participantId: "bot.0", archetypeId: archetype.id });
  return { runtime, frame, elapsedMs: 0 };
}

function advance(fixture: ReturnType<typeof decisionFixture>, ticks: number): void {
  for (let index = 0; index < ticks; index += 1) {
    fixture.elapsedMs += FIXED_STEP_MS;
    fixture.frame.tick += 1;
    fixture.frame.elapsedMs = fixture.elapsedMs;
    fixture.runtime.update(FIXED_STEP_MS, fixture.elapsedMs);
    fixture.runtime.inputFor("bot.0", fixture.frame.tick);
  }
}

function advanceUntilPhase(
  fixture: ReturnType<typeof decisionFixture>,
  phase: string,
  maxTicks: number
): void {
  for (let index = 0; index < maxTicks; index += 1) {
    advance(fixture, 1);
    if (fixture.runtime.agent("bot.0")?.task?.state.phase === phase) return;
  }
  throw new Error(`Arena bot did not enter navigation phase: ${phase}`);
}

function fakeNavigation(): {
  queries: NavigationQueries;
  requests(): number;
  releases(): number;
  staleNextSample(): void;
} {
  const routes = new Set<string>();
  let requestCount = 0;
  let releaseCount = 0;
  let stale = false;
  const queries: NavigationQueries = {
    projectPoint(point) {
      return { point: { ...point }, distance: 0, revision: 0 };
    },
    requestPath(_request: NavigationPathRequest) {
      requestCount += 1;
      return `request.${requestCount}`;
    },
    poll(requestId): NavigationRequestResult {
      const routeId = `${requestId}.route`;
      routes.add(routeId);
      return {
        status: "complete",
        requestId,
        requesterId: "ai.bot.0",
        cache: "miss",
        route: {
          kind: "field",
          routeId,
          goal: { x: 0, y: -12 },
          goalKey: "checkpoint.1",
          cost: 12,
          revision: 0,
          startProjection: { point: { x: 0, y: 0 }, distance: 0, revision: 0 },
          goalProjection: { point: { x: 0, y: -12 }, distance: 0, revision: 0 }
        }
      };
    },
    cancel() {},
    sampleRoute(routeId): NavigationRouteSample {
      if (!routes.has(routeId)) return { status: "missing", routeId, revision: 0 };
      if (stale) {
        stale = false;
        return { status: "stale", routeId, routeRevision: 0, revision: 1 };
      }
      return {
        status: "valid",
        routeId,
        revision: 0,
        point: { x: 0, y: 0 },
        nextPoint: { x: 0, y: -1 },
        direction: { x: 0, y: -1 },
        distanceToRoute: 0,
        remainingDistance: 12
      };
    },
    releaseRoute(routeId) {
      if (routes.delete(routeId)) releaseCount += 1;
    },
    revision: () => 0,
    snapshot: () => ({
      id: "fake",
      revision: 0,
      disposed: false,
      profiles: [ARENA_BOT_NAVIGATION_PROFILE_ID],
      pendingRequests: 0,
      queuedRequests: 0,
      submittedRequests: 0,
      retainedResults: requestCount,
      retainedRoutes: routes.size,
      cacheEntries: 0,
      negativeCacheEntries: 0,
      traceEntries: 0,
      backend: {
        id: "fake",
        revision: 0,
        capabilities: {
          deferredRequests: false,
          routeFields: true,
          radius: true,
          height: true,
          maxSlope: true,
          dynamicObstacles: []
        },
        disposed: false,
        details: {}
      }
    })
  };
  return {
    queries,
    requests: () => requestCount,
    releases: () => releaseCount,
    staleNextSample() {
      stale = true;
    }
  };
}

function toNavigationPoint(point: { x: number; y: number; z?: number | undefined }) {
  return { x: point.x, y: point.z ?? 0, z: point.y };
}
