import { defineGameModule, type GameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";
import {
  createNavigationProgressTracker,
  type NavigationHandle,
  type NavigationPathRequest,
  type NavigationPoint,
  type NavigationProgressTracker,
  type NavigationRequestResult,
  type NavigationRoute,
  type NavigationRouteSample
} from "@gamekits/navigation-core";
import {
  NAVIGATION_LAB_PROFILES,
  NAVIGATION_LAB_SCENARIO,
  NAVIGATION_LAB_UNITS,
  type NavigationLabProfileId,
  type NavigationLabScenarioDefinition
} from "./scenario";
import type { NavigationLabBackendProvider } from "./backends";
import type {
  NavigationLabAgentSnapshot,
  NavigationLabBurstSnapshot,
  NavigationLabController,
  NavigationLabPointMode,
  NavigationLabStressSnapshot,
  NavigationLabSwampMode
} from "./types";

type NavigationLabAgentState = NavigationLabAgentSnapshot & {
  loopOrigin?: NavigationPoint | undefined;
};

type NavigationLabStressState = Omit<
  NavigationLabStressSnapshot,
  "averageStepMs" | "p95StepMs" | "withinBudget"
> & {
  planningStartedAt: number;
  totalStepMs: number;
  recentStepMs: number[];
};

type NavigationLabPartyMemberRequest = {
  id: string;
  requestId: string;
  start: NavigationPoint;
  result?: Exclude<NavigationRequestResult, { status: "pending" }> | undefined;
};

type NavigationLabPartyRequest = {
  label: string;
  members: NavigationLabPartyMemberRequest[];
};

type NavigationLabRequestTemplate = Omit<NavigationPathRequest, "id" | "requesterId"> & {
  label: string;
};

export type NavigationLabState = {
  running: boolean;
  tick: number;
  elapsed: number;
  scenario: NavigationLabScenarioDefinition;
  backend: NavigationLabBackendProvider;
  profileId: NavigationLabProfileId;
  start: NavigationPoint;
  goal: NavigationPoint;
  pointMode: NavigationLabPointMode;
  probePoint?: NavigationPoint | undefined;
  currentRequestId?: string | undefined;
  lastResult?: NavigationRequestResult | undefined;
  activeRoute?: NavigationRoute | undefined;
  activeRoutes: NavigationRoute[];
  partyRequest?: NavigationLabPartyRequest | undefined;
  releasedSample?: NavigationRouteSample | undefined;
  agents: NavigationLabAgentState[];
  agentsFrozen: boolean;
  gateBlocked: boolean;
  ridgeBlocked: boolean;
  swampMode: NavigationLabSwampMode;
  portalEnabled: boolean;
  lockdown: boolean;
  lastObstacleResult?: ReturnType<NavigationHandle["updateObstacle"]> | undefined;
  burst?: NavigationLabBurstSnapshot | undefined;
  burstRequestIds: Set<string>;
  stress?: NavigationLabStressState | undefined;
  lastRequest?: NavigationLabRequestTemplate | undefined;
  sequence: number;
  notice: string;
  progress: NavigationProgressTracker;
};

const NAVIGATION_LAB_STRESS_BUDGET_MS = 4;
const NAVIGATION_LAB_STRESS_MAX_AGENTS = 20_000;
const NAVIGATION_LAB_STRESS_SAMPLE_WINDOW = 180;

export function createNavigationLabState(
  navigation: NavigationHandle,
  backend: NavigationLabBackendProvider,
  scenario: NavigationLabScenarioDefinition = NAVIGATION_LAB_SCENARIO
): NavigationLabState {
  return {
    running: false,
    tick: 0,
    elapsed: 0,
    scenario,
    backend,
    profileId: "profile.scout",
    start: { ...scenario.start },
    goal: { ...scenario.goal },
    pointMode: "probe",
    activeRoutes: [],
    agents: [],
    agentsFrozen: false,
    gateBlocked: false,
    ridgeBlocked: false,
    swampMode: "normal",
    portalEnabled: false,
    lockdown: false,
    burstRequestIds: new Set(),
    sequence: 0,
    notice: `Choose a unit, then send it from ${scenario.startLocation} using ${backend.label}.`,
    progress: createNavigationProgressTracker(navigation)
  };
}

export function createNavigationLabSimulationModule(
  state: NavigationLabState,
  navigation: NavigationHandle
): GameModule<GameInstallContext> {
  return defineGameModule<GameInstallContext>({
    id: "sandbox.navigation-lab.simulation",
    install(ctx) {
      state.running = true;
      ctx.systems.register({
        id: "sandbox.navigation-lab.simulation.update",
        update(systemContext) {
          advanceNavigationLabState(state, navigation, systemContext.delta, systemContext.elapsed);
          state.tick = systemContext.tick;
        }
      });
      return () => {
        state.running = false;
        releaseActiveRoute(state, navigation);
        state.progress.clear();
        state.burstRequestIds.clear();
      };
    }
  });
}

export function advanceNavigationLabState(
  state: NavigationLabState,
  navigation: NavigationHandle,
  deltaMs: number,
  elapsedMs: number
): void {
  state.elapsed = elapsedMs;
  settlePartyRequest(state, navigation);
  settleCurrentRequest(state, navigation);
  settleBurstRequests(state, navigation);
  const stressStepStartedAt = state.stress?.status === "running" ? monotonicNow() : undefined;

  for (const agent of state.agents) {
    const route = state.activeRoutes.find((candidate) => candidate.routeId === agent.routeId);
    const progress = state.progress.update({
      agentId: agent.id,
      routeId: agent.routeId,
      position: agent.position,
      elapsedMs,
      arrivalDistance: 0.12,
      progressEpsilon: agent.loopOrigin === undefined ? 0.08 : 0.01,
      stuckAfterMs: agent.loopOrigin === undefined ? 1200 : 60_000
    });
    agent.progress = progress.status;
    if (progress.sample.status !== "valid") {
      agent.direction = { x: 0, y: 0 };
      agent.remainingDistance = 0;
      continue;
    }
    const traversal = progress.sample.traversal;
    if (
      traversal !== undefined &&
      Math.hypot(
        agent.position.x - traversal.entryPoint.x,
        agent.position.y - traversal.entryPoint.y,
        (agent.position.z ?? 0) - (traversal.entryPoint.z ?? 0)
      ) <= 0.12
    ) {
      agent.position = { ...traversal.exitPoint };
      agent.direction = { x: 0, y: 0 };
      agent.remainingDistance = progress.sample.remainingDistance;
      state.progress.remove(agent.id);
      continue;
    }
    const nextOffset = {
      x: progress.sample.nextPoint.x - agent.position.x,
      y: progress.sample.nextPoint.y - agent.position.y
    };
    const distanceToNext = Math.hypot(nextOffset.x, nextOffset.y);
    const movementDirection =
      distanceToNext === 0
        ? progress.sample.direction
        : { x: nextOffset.x / distanceToNext, y: nextOffset.y / distanceToNext };
    agent.direction = { ...movementDirection };
    agent.remainingDistance = progress.sample.remainingDistance;
    if (progress.status === "arrived" && agent.loopOrigin !== undefined) {
      agent.position = { ...agent.loopOrigin };
      agent.direction = { x: 0, y: 0 };
      state.progress.remove(agent.id);
      continue;
    }
    if (state.agentsFrozen || progress.status === "arrived") {
      continue;
    }
    const speed = route?.kind === "field" ? 2.2 : 2.65;
    const step = Math.min(speed * Math.max(0, deltaMs) * 0.001, 0.18, distanceToNext);
    agent.position = {
      x: agent.position.x + movementDirection.x * step,
      y: agent.position.y + movementDirection.y * step
    };
  }

  if (stressStepStartedAt !== undefined && state.stress?.status === "running") {
    recordStressStep(state.stress, monotonicNow() - stressStepStartedAt, state.agents.length);
  }
}

export function createNavigationLabController(options: {
  navigation: NavigationHandle;
  state: NavigationLabState;
}): NavigationLabController {
  const { navigation, state } = options;

  return {
    setProfile(profileId) {
      if (!NAVIGATION_LAB_PROFILES.some((profile) => profile.id === profileId)) {
        return;
      }
      cancelCurrentRequest(state, navigation);
      releaseActiveRoute(state, navigation);
      state.profileId = profileId;
      state.lastResult = undefined;
      state.releasedSample = undefined;
      state.notice = `${profileLabel(profileId)} selected. Choose Send Unit or Rally Party.`;
      refreshProbe(state, navigation);
    },
    setPointMode(mode) {
      state.pointMode = mode;
      state.notice =
        mode === "probe"
          ? "Inspect where the selected unit can stand."
          : `Click the terrain to move the ${mode === "start" ? "camp" : "destination"} marker.`;
    },
    placePoint(point) {
      state.probePoint = { ...point };
      const projection = navigation.projectPoint(point, state.profileId);
      if (projection === undefined) {
        state.notice = `${profileLabel(state.profileId)} cannot stand near that terrain point.`;
        return;
      }
      if (state.pointMode === "start") {
        state.start = { ...projection.point };
        state.pointMode = "probe";
        state.notice = "The departure marker moved to the nearest walkable ground.";
      } else if (state.pointMode === "goal") {
        state.goal = { ...projection.point };
        state.pointMode = "probe";
        state.notice = "The destination marker moved to the nearest walkable ground.";
      } else {
        state.notice = `Nearest walkable point is ${projection.distance.toFixed(2)} m away.`;
      }
    },
    requestPath() {
      return submit(state, navigation, {
        label: "point path",
        profileId: state.profileId,
        start: state.start,
        goal: state.goal,
        goalKey: state.scenario.goalKey,
        routeKind: "path"
      });
    },
    requestField() {
      const request = {
        label: "shared route field",
        profileId: state.profileId,
        start: state.start,
        goal: state.goal,
        goalKey: state.scenario.goalKey,
        routeKind: "field"
      } satisfies NavigationLabRequestTemplate;
      return navigation.snapshot().backend.capabilities.routeFields
        ? submit(state, navigation, request)
        : submitPartyPaths(state, navigation, request);
    },
    repeatLastRequest() {
      if (state.lastRequest === undefined) {
        state.notice = "Run a route query before testing the cache.";
        return undefined;
      }
      if (
        state.lastRequest.routeKind === "field" &&
        !navigation.snapshot().backend.capabilities.routeFields
      ) {
        return submitPartyPaths(state, navigation, {
          ...state.lastRequest,
          label: "repeat / party path probe"
        });
      }
      return submit(state, navigation, { ...state.lastRequest, label: "repeat / cache probe" });
    },
    requestCostCappedPath() {
      return submit(state, navigation, {
        label: "8-cost capped path",
        profileId: state.profileId,
        start: state.start,
        goal: state.goal,
        goalKey: state.scenario.goalKey,
        routeKind: "path",
        maxCost: 8
      });
    },
    cancelProbe() {
      cancelCurrentRequest(state, navigation);
      releaseActiveRoute(state, navigation);
      state.sequence += 1;
      const requestId = navigation.requestPath({
        id: `navigation-lab.cancel.${state.sequence}`,
        requesterId: "navigation-lab.cancel-probe",
        profileId: state.profileId,
        start: state.start,
        goal: state.goal,
        routeKind: "path"
      });
      navigation.cancel(requestId);
      state.currentRequestId = requestId;
      state.notice = "The route order was cancelled before the navigator started it.";
      return requestId;
    },
    runBurst(count = 18) {
      const resolvedCount = Math.max(1, Math.min(36, Math.floor(count)));
      for (const requestId of state.burstRequestIds) {
        navigation.cancel(requestId);
      }
      state.burstRequestIds.clear();
      state.burst = {
        total: resolvedCount,
        pending: resolvedCount,
        completed: 0,
        failed: 0,
        cancelled: 0
      };
      for (let index = 0; index < resolvedCount; index += 1) {
        state.sequence += 1;
        const start =
          state.scenario.fieldAgentStarts[index % state.scenario.fieldAgentStarts.length] ??
          state.scenario.start;
        const requestId = navigation.requestPath({
          id: `navigation-lab.burst.${state.sequence}`,
          requesterId: `navigation-lab.burst-group.${index % 6}`,
          profileId: state.profileId,
          start: { ...start },
          goal: state.goal,
          goalKey: state.scenario.goalKey,
          routeKind: "path"
        });
        state.burstRequestIds.add(requestId);
      }
      state.notice = `${resolvedCount} scouting orders entered the budgeted request queue.`;
    },
    runStress(count = 1000) {
      if (!navigation.snapshot().backend.capabilities.routeFields) {
        state.notice = `${state.backend.label} does not expose shared route fields, so the live unit stress test is unavailable.`;
        return undefined;
      }
      const targetAgents = Math.max(
        1,
        Math.min(NAVIGATION_LAB_STRESS_MAX_AGENTS, Math.floor(count))
      );
      const planningStartedAt = monotonicNow();
      const requestId = submit(state, navigation, {
        label: `${targetAgents}-unit shared field stress`,
        profileId: state.profileId,
        start: state.start,
        goal: state.goal,
        goalKey: state.scenario.goalKey,
        routeKind: "field"
      });
      state.stress = {
        status: "planning",
        targetAgents,
        activeAgents: 0,
        planningMs: 0,
        spawnMs: 0,
        sampledTicks: 0,
        samplesPerTick: 0,
        peakStepMs: 0,
        budgetMs: NAVIGATION_LAB_STRESS_BUDGET_MS,
        planningStartedAt,
        totalStepMs: 0,
        recentStepMs: []
      };
      state.notice = `Preparing one shared field for ${targetAgents.toLocaleString()} continuously moving units.`;
      return requestId;
    },
    stopStress() {
      if (state.stress === undefined) {
        state.notice = "No live unit stress test is active.";
        return;
      }
      cancelCurrentRequest(state, navigation);
      releaseActiveRoute(state, navigation);
      state.notice = `Stopped the ${state.stress.targetAgents.toLocaleString()}-unit stress test; its timing summary remains visible.`;
    },
    releaseRoute() {
      if (state.activeRoutes.length === 0) {
        state.notice = "No retained route is currently active.";
        return;
      }
      const routeId = state.activeRoutes[0]!.routeId;
      const routeCount = state.activeRoutes.length;
      releaseActiveRoute(state, navigation);
      state.releasedSample = navigation.sampleRoute(routeId, state.start);
      state.notice = `Released ${routeCount} route${routeCount === 1 ? "" : "s"}; subsequent sampling of ${routeId} is ${state.releasedSample.status}.`;
    },
    toggleAgentsFrozen() {
      state.agentsFrozen = !state.agentsFrozen;
      state.notice = state.agentsFrozen
        ? "The party is held in place; stuck detection should trigger after 1.2 s."
        : "The party resumed following the current route samples.";
    },
    toggleGate() {
      state.gateBlocked = !state.gateBlocked;
      state.lockdown = false;
      state.lastObstacleResult = navigation.updateObstacle({
        id: `navigation-lab.gate.${state.sequence++}`,
        target: state.backend.obstacleBindings.bridge,
        blocked: state.gateBlocked,
        source: "navigation-lab.ui"
      });
      state.notice = obstacleNotice(
        state.scenario.controls.bridge.label,
        state.gateBlocked ? "blocked" : "open",
        state
      );
    },
    cycleSwamp() {
      state.swampMode = nextSwampMode(state.swampMode);
      state.lockdown = false;
      state.lastObstacleResult = navigation.updateObstacle({
        id: `navigation-lab.swamp.${state.sequence++}`,
        target: state.backend.obstacleBindings.marsh,
        blocked: state.swampMode === "blocked",
        costMultiplier: state.swampMode === "costly" ? 3.5 : 1,
        source: "navigation-lab.ui"
      });
      state.notice = obstacleNotice(
        state.scenario.controls.marsh.label,
        swampLabel(state.swampMode),
        state
      );
    },
    togglePortal() {
      state.portalEnabled = !state.portalEnabled;
      state.lockdown = false;
      state.lastObstacleResult = navigation.updateObstacle({
        id: `navigation-lab.portal.${state.sequence++}`,
        target: state.backend.obstacleBindings.waystone,
        blocked: !state.portalEnabled,
        source: "navigation-lab.ui"
      });
      state.notice = obstacleNotice(
        state.scenario.controls.portal.label,
        state.portalEnabled ? "enabled" : "disabled",
        state
      );
    },
    runLockdown() {
      state.gateBlocked = true;
      state.ridgeBlocked = true;
      state.swampMode = "blocked";
      state.portalEnabled = false;
      state.lockdown = true;
      const updates = [
        state.backend.obstacleBindings.bridge,
        state.backend.obstacleBindings.ridgeTrail,
        state.backend.obstacleBindings.marsh,
        state.backend.obstacleBindings.waystone
      ];
      for (const target of updates) {
        state.lastObstacleResult = navigation.updateObstacle({
          id: `navigation-lab.lockdown.${state.sequence++}`,
          target,
          blocked: true,
          source: "navigation-lab.lockdown"
        });
      }
      return submit(state, navigation, {
        label: "lockdown unreachable probe",
        profileId: state.profileId,
        start: state.start,
        goal: state.goal,
        goalKey: state.scenario.goalKey,
        routeKind: "path"
      });
    },
    probeUnsupportedObstacle() {
      state.lastObstacleResult = navigation.updateObstacle({
        id: `navigation-lab.custom.${state.sequence++}`,
        target: { kind: "custom", id: "weather-front" },
        blocked: true,
        source: "navigation-lab.ui"
      });
      state.notice = `Weather-front capability probe: ${state.lastObstacleResult.status}.`;
    },
    reset() {
      cancelCurrentRequest(state, navigation);
      releaseActiveRoute(state, navigation);
      for (const requestId of state.burstRequestIds) {
        navigation.cancel(requestId);
      }
      state.burstRequestIds.clear();
      state.burst = undefined;
      state.stress = undefined;
      resetObstacleState(state, navigation);
      state.profileId = "profile.scout";
      state.start = { ...state.scenario.start };
      state.goal = { ...state.scenario.goal };
      state.pointMode = "probe";
      state.probePoint = undefined;
      state.lastResult = undefined;
      state.lastRequest = undefined;
      state.releasedSample = undefined;
      state.agentsFrozen = false;
      state.notice = `${state.scenario.title} restored. ${state.backend.label} revision remains monotonic.`;
    },
    snapshot() {
      const projection =
        state.probePoint === undefined
          ? undefined
          : navigation.projectPoint(state.probePoint, state.profileId);
      return {
        running: state.running,
        tick: state.tick,
        elapsed: state.elapsed,
        scenario: state.scenario,
        backend: {
          id: state.backend.id,
          label: state.backend.label,
          technology: state.backend.technology,
          description: state.backend.description
        },
        profileId: state.profileId,
        start: { ...state.start },
        goal: { ...state.goal },
        pointMode: state.pointMode,
        ...(state.probePoint === undefined ? {} : { probePoint: { ...state.probePoint } }),
        ...(projection === undefined ? {} : { projection }),
        ...(state.currentRequestId === undefined
          ? {}
          : { currentRequestId: state.currentRequestId }),
        ...(state.lastResult === undefined ? {} : { lastResult: state.lastResult }),
        ...(state.activeRoute === undefined ? {} : { activeRoute: state.activeRoute }),
        activeRoutes: [...state.activeRoutes],
        ...(state.releasedSample === undefined ? {} : { releasedSample: state.releasedSample }),
        agents: state.agents.map(cloneAgent),
        fieldVectors: createFieldVectors(state, navigation),
        agentsFrozen: state.agentsFrozen,
        gateBlocked: state.gateBlocked,
        ridgeBlocked: state.ridgeBlocked,
        swampMode: state.swampMode,
        portalEnabled: state.portalEnabled,
        lockdown: state.lockdown,
        ...(state.lastObstacleResult === undefined
          ? {}
          : { lastObstacleResult: state.lastObstacleResult }),
        ...(state.burst === undefined ? {} : { burst: { ...state.burst } }),
        ...(state.stress === undefined ? {} : { stress: stressSnapshot(state.stress) }),
        navigation: navigation.snapshot(),
        traces: navigation.traces().slice(-10),
        notice: state.notice
      };
    }
  };
}

function submit(
  state: NavigationLabState,
  navigation: NavigationHandle,
  request: NavigationLabRequestTemplate
): string {
  cancelCurrentRequest(state, navigation);
  releaseActiveRoute(state, navigation);
  state.sequence += 1;
  const requestId = navigation.requestPath({
    ...request,
    id: `navigation-lab.request.${state.sequence}`,
    requesterId: "navigation-lab.operator"
  });
  state.currentRequestId = requestId;
  state.lastRequest = { ...request, start: { ...request.start }, goal: { ...request.goal } };
  state.lastResult = navigation.poll(requestId);
  state.releasedSample = undefined;
  state.notice = `${request.label} accepted as ${requestId}.`;
  return requestId;
}

function settleCurrentRequest(state: NavigationLabState, navigation: NavigationHandle): void {
  if (state.currentRequestId === undefined || state.partyRequest !== undefined) {
    return;
  }
  const result = navigation.poll(state.currentRequestId);
  state.lastResult = result;
  if (result.status === "pending") {
    return;
  }
  state.currentRequestId = undefined;
  if (result.status === "complete") {
    if (state.stress?.status === "planning") {
      const spawnStartedAt = monotonicNow();
      state.activeRoute = result.route;
      state.activeRoutes = [result.route];
      state.agents = createStressAgents(
        result.route,
        state.stress.targetAgents,
        state.scenario,
        state.profileId,
        navigation
      );
      state.progress.clear();
      state.stress.status = "running";
      state.stress.planningMs = spawnStartedAt - state.stress.planningStartedAt;
      state.stress.spawnMs = monotonicNow() - spawnStartedAt;
      state.stress.activeAgents = state.agents.length;
      state.stress.samplesPerTick = state.agents.length;
      state.notice = `${state.agents.length.toLocaleString()} units are sharing one ${state.backend.label} route field; timing excludes the capped canvas marker projection.`;
      return;
    }
    state.activeRoute = result.route;
    state.activeRoutes = [result.route];
    state.agents = createAgents(result.route, state.start, state.scenario);
    state.progress.clear();
    state.notice = `${result.route.kind === "field" ? "Shared field" : "Path"} complete · cost ${result.route.cost.toFixed(2)} · cache ${result.cache}.`;
    return;
  }
  state.agents = [];
  if (state.stress?.status === "planning") {
    state.stress.status = "failed";
    state.stress.planningMs = monotonicNow() - state.stress.planningStartedAt;
    state.stress.activeAgents = 0;
  }
  state.notice = terminalResultNotice(result);
}

function submitPartyPaths(
  state: NavigationLabState,
  navigation: NavigationHandle,
  request: NavigationLabRequestTemplate
): string {
  cancelCurrentRequest(state, navigation);
  releaseActiveRoute(state, navigation);
  state.sequence += 1;
  const groupId = `navigation-lab.party.${state.sequence}`;
  const members = state.scenario.fieldAgentStarts.map((start, index) => {
    const requestId = navigation.requestPath({
      id: `${groupId}.${index + 1}`,
      requesterId: `navigation-lab.party-member.${index + 1}`,
      profileId: request.profileId,
      start: { ...start },
      goal: { ...request.goal },
      goalKey: request.goalKey,
      routeKind: "path",
      maxCost: request.maxCost,
      metadata: request.metadata
    });
    return {
      id: `party-agent-${index + 1}`,
      requestId,
      start: { ...start }
    };
  });
  const firstRequest = members[0];
  state.partyRequest = { label: request.label, members };
  state.currentRequestId = firstRequest?.requestId;
  state.lastRequest = { ...request, start: { ...request.start }, goal: { ...request.goal } };
  state.lastResult =
    firstRequest === undefined ? undefined : navigation.poll(firstRequest.requestId);
  state.releasedSample = undefined;
  state.notice = `${members.length} party paths accepted because ${state.backend.label} does not expose shared route fields.`;
  return groupId;
}

function settlePartyRequest(state: NavigationLabState, navigation: NavigationHandle): void {
  const party = state.partyRequest;
  if (party === undefined) {
    return;
  }
  let representative: NavigationRequestResult | undefined;
  for (const member of party.members) {
    if (member.result !== undefined) {
      representative ??= member.result;
      continue;
    }
    const result = navigation.poll(member.requestId);
    representative ??= result;
    if (result.status !== "pending") {
      member.result = result;
    }
  }
  state.lastResult = representative;
  const pending = party.members.filter((member) => member.result === undefined);
  if (pending.length > 0) {
    state.currentRequestId = pending[0]!.requestId;
    state.notice = `Planning party paths · ${party.members.length - pending.length}/${party.members.length} ready.`;
    return;
  }

  const completed = party.members.flatMap((member) =>
    member.result?.status === "complete" ? [{ member, result: member.result }] : []
  );
  state.partyRequest = undefined;
  state.currentRequestId = undefined;
  state.progress.clear();
  if (completed.length === 0) {
    state.activeRoute = undefined;
    state.activeRoutes = [];
    state.agents = [];
    const firstResult = party.members[0]?.result;
    state.notice =
      firstResult === undefined || firstResult.status === "complete"
        ? "Party rally produced no usable paths."
        : terminalResultNotice(firstResult);
    return;
  }

  state.lastResult = completed[0]!.result;
  state.activeRoutes = completed.map(({ result }) => result.route);
  state.activeRoute = state.activeRoutes[0];
  state.agents = completed.map(({ member, result }) => ({
    id: member.id,
    routeId: result.route.routeId,
    position: { ...member.start },
    direction: { x: 0, y: 0 },
    remainingDistance: result.route.cost,
    progress: "moving"
  }));
  const failed = party.members.length - completed.length;
  state.notice = `Party rally complete · ${completed.length} individual path${completed.length === 1 ? "" : "s"}${failed === 0 ? "" : ` · ${failed} failed`}.`;
}

function settleBurstRequests(state: NavigationLabState, navigation: NavigationHandle): void {
  if (state.burst === undefined || state.burstRequestIds.size === 0) {
    return;
  }
  for (const requestId of state.burstRequestIds) {
    const result = navigation.poll(requestId);
    if (result.status === "pending") {
      continue;
    }
    state.burstRequestIds.delete(requestId);
    if (result.status === "complete") {
      navigation.releaseRoute(result.route.routeId);
      state.burst.completed += 1;
    } else if (result.status === "cancelled") {
      state.burst.cancelled += 1;
    } else {
      state.burst.failed += 1;
    }
  }
  state.burst.pending = state.burstRequestIds.size;
  if (state.burst.pending === 0) {
    state.notice = `Burst drained: ${state.burst.completed} complete, ${state.burst.failed} failed.`;
  }
}

function createAgents(
  route: NavigationRoute,
  start: NavigationPoint,
  scenario: NavigationLabScenarioDefinition
): NavigationLabAgentState[] {
  const starts = route.kind === "field" ? scenario.fieldAgentStarts : [{ ...start }];
  return starts.map((point, index) => ({
    id: route.kind === "field" ? `field-agent-${index + 1}` : "path-agent",
    routeId: route.routeId,
    position: { ...point },
    direction: { x: 0, y: 0 },
    remainingDistance: route.cost,
    progress: "moving"
  }));
}

function createStressAgents(
  route: NavigationRoute,
  count: number,
  scenario: NavigationLabScenarioDefinition,
  profileId: NavigationLabProfileId,
  navigation: NavigationHandle
): NavigationLabAgentState[] {
  const starts =
    scenario.fieldAgentStarts.length > 0 ? scenario.fieldAgentStarts : [scenario.start];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, index) => {
    const seed = starts[index % starts.length] ?? scenario.start;
    const layer = Math.floor(index / starts.length);
    const radius = Math.min(0.6, 0.025 * Math.sqrt(layer + 1));
    const angle = layer * goldenAngle + (index % starts.length);
    const candidate = {
      x: seed.x + Math.cos(angle) * radius,
      y: seed.y + Math.sin(angle) * radius,
      ...(seed.z === undefined ? {} : { z: seed.z })
    };
    const origin = navigation.projectPoint(candidate, profileId)?.point ?? seed;
    return {
      id: `stress-agent-${index + 1}`,
      routeId: route.routeId,
      position: { ...origin },
      direction: { x: 0, y: 0 },
      remainingDistance: route.cost,
      progress: "moving",
      loopOrigin: { ...origin }
    };
  });
}

function createFieldVectors(state: NavigationLabState, navigation: NavigationHandle) {
  if (state.activeRoute?.kind !== "field") {
    return [];
  }
  return state.scenario.fieldSamplePoints.map((point) => ({
    point: { ...point },
    sample: navigation.sampleRoute(state.activeRoute!.routeId, point)
  }));
}

function releaseActiveRoute(state: NavigationLabState, navigation: NavigationHandle): void {
  for (const routeId of new Set(state.activeRoutes.map((route) => route.routeId))) {
    navigation.releaseRoute(routeId);
  }
  state.activeRoute = undefined;
  state.activeRoutes = [];
  state.agents = [];
  state.progress.clear();
  if (state.stress?.status === "planning" || state.stress?.status === "running") {
    state.stress.status = "stopped";
    state.stress.activeAgents = 0;
    state.stress.samplesPerTick = 0;
  }
}

function cancelCurrentRequest(state: NavigationLabState, navigation: NavigationHandle): void {
  if (state.partyRequest !== undefined) {
    for (const member of state.partyRequest.members) {
      if (member.result?.status === "complete") {
        navigation.releaseRoute(member.result.route.routeId);
      } else if (member.result === undefined) {
        navigation.cancel(member.requestId);
      }
    }
    state.partyRequest = undefined;
    state.currentRequestId = undefined;
    return;
  }
  if (state.currentRequestId !== undefined) {
    navigation.cancel(state.currentRequestId);
    state.currentRequestId = undefined;
  }
}

function resetObstacleState(state: NavigationLabState, navigation: NavigationHandle): void {
  const updates = [
    { target: state.backend.obstacleBindings.bridge, blocked: false },
    { target: state.backend.obstacleBindings.ridgeTrail, blocked: false },
    {
      target: state.backend.obstacleBindings.marsh,
      blocked: false,
      costMultiplier: 1
    },
    { target: state.backend.obstacleBindings.waystone, blocked: true }
  ];
  for (const update of updates) {
    state.lastObstacleResult = navigation.updateObstacle({
      id: `navigation-lab.reset.${state.sequence++}`,
      ...update,
      source: "navigation-lab.reset"
    });
  }
  state.gateBlocked = false;
  state.ridgeBlocked = false;
  state.swampMode = "normal";
  state.portalEnabled = false;
  state.lockdown = false;
}

function refreshProbe(state: NavigationLabState, navigation: NavigationHandle): void {
  if (state.probePoint !== undefined) {
    navigation.projectPoint(state.probePoint, state.profileId);
  }
}

function nextSwampMode(mode: NavigationLabSwampMode): NavigationLabSwampMode {
  return mode === "normal" ? "costly" : mode === "costly" ? "blocked" : "normal";
}

function obstacleNotice(label: string, mode: string, state: NavigationLabState): string {
  const result = state.lastObstacleResult;
  return `${label} ${mode} · ${result?.status ?? "unknown"} · revision ${result?.revision ?? "--"} · invalidated ${result?.invalidatedRouteFields ?? 0} field(s).`;
}

function terminalResultNotice(
  result: Exclude<NavigationRequestResult, { status: "pending" | "complete" }>
): string {
  if (result.status === "failed") {
    return `Route failed: ${result.reason}${result.cache === "hit" ? " (negative cache hit)" : ""}.`;
  }
  if (result.status === "cancelled") {
    return "Route request cancelled before publication.";
  }
  if (result.status === "rejected") {
    return `Route rejected: ${result.reason}.`;
  }
  return "Route result is no longer retained.";
}

function profileLabel(profileId: NavigationLabProfileId): string {
  return NAVIGATION_LAB_UNITS[profileId].label;
}

function swampLabel(mode: NavigationLabSwampMode): string {
  return mode === "normal" ? "passable" : mode === "costly" ? "high-cost" : "blocked";
}

function cloneAgent(agent: NavigationLabAgentState): NavigationLabAgentSnapshot {
  return {
    id: agent.id,
    routeId: agent.routeId,
    position: { ...agent.position },
    direction: { ...agent.direction },
    remainingDistance: agent.remainingDistance,
    progress: agent.progress
  };
}

function recordStressStep(
  stress: NavigationLabStressState,
  durationMs: number,
  samples: number
): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return;
  }
  stress.sampledTicks += 1;
  stress.samplesPerTick = samples;
  stress.totalStepMs += durationMs;
  stress.peakStepMs = Math.max(stress.peakStepMs, durationMs);
  stress.recentStepMs.push(durationMs);
  if (stress.recentStepMs.length > NAVIGATION_LAB_STRESS_SAMPLE_WINDOW) {
    stress.recentStepMs.shift();
  }
}

function stressSnapshot(stress: NavigationLabStressState): NavigationLabStressSnapshot {
  const averageStepMs = stress.sampledTicks === 0 ? 0 : stress.totalStepMs / stress.sampledTicks;
  const sorted = [...stress.recentStepMs].sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const p95StepMs = sorted[p95Index] ?? 0;
  const measured = stress.sampledTicks >= 30;
  return {
    status: stress.status,
    targetAgents: stress.targetAgents,
    activeAgents: stress.activeAgents,
    planningMs: roundMilliseconds(stress.planningMs),
    spawnMs: roundMilliseconds(stress.spawnMs),
    sampledTicks: stress.sampledTicks,
    samplesPerTick: stress.samplesPerTick,
    averageStepMs: roundMilliseconds(averageStepMs),
    p95StepMs: roundMilliseconds(p95StepMs),
    peakStepMs: roundMilliseconds(stress.peakStepMs),
    budgetMs: stress.budgetMs,
    ...(measured ? { withinBudget: p95StepMs <= stress.budgetMs } : {})
  };
}

function roundMilliseconds(value: number): number {
  return Number(value.toFixed(3));
}

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}
