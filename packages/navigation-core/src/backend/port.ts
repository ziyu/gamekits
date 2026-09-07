import type { DataRegistry } from "@gamekits/data";
import type { NavigationPoint, NavigationProjection } from "../contracts/geometry";
import type { NavigationLayoutDefinition } from "../contracts/layout";
import type {
  NavigationObstacleTarget,
  NavigationObstacleUpdate,
  NavigationObstacleUpdateResult
} from "../contracts/obstacle";
import type { NavigationAgentProfileDefinition } from "../contracts/profile";
import type {
  NavigationPathFailureReason,
  NavigationPathTraversal,
  NavigationRequestId,
  NavigationRouteTraversal,
  NavigationRouteKind
} from "../contracts/routes";

export type NavigationBackendRequestId = string;

export type NavigationBackendPathRequest = {
  requestId: NavigationRequestId;
  profile: NavigationAgentProfileDefinition;
  start: NavigationPoint;
  goal: NavigationPoint;
  goalKey?: string | undefined;
  routeKind: NavigationRouteKind;
  maxCost?: number | undefined;
};

export type NavigationBackendRoute =
  | {
      kind: "path";
      points: NavigationPoint[];
      traversals?: NavigationPathTraversal[] | undefined;
    }
  | { kind: "field"; routeKey: string };

export type NavigationBackendPathResult =
  | {
      status: "complete";
      revision: number;
      route: NavigationBackendRoute;
      cost: number;
      startProjection: NavigationProjection;
      goalProjection: NavigationProjection;
      dependencies?: NavigationObstacleTarget[] | undefined;
    }
  | {
      status: "failed";
      revision: number;
      reason: Exclude<
        NavigationPathFailureReason,
        "profile-missing" | "backend-error" | "stale-result"
      >;
      message?: string | undefined;
      dependencies?: NavigationObstacleTarget[] | undefined;
    };

export type NavigationBackendPathStatus =
  | { status: "pending"; revision: number }
  | { status: "missing"; revision: number }
  | NavigationBackendPathResult;

export type NavigationBackendRouteSample =
  | {
      status: "valid";
      revision: number;
      point: NavigationPoint;
      nextPoint: NavigationPoint;
      direction: NavigationPoint;
      distanceToRoute: number;
      remainingDistance: number;
      traversal?: NavigationRouteTraversal | undefined;
    }
  | { status: "stale"; routeRevision: number; revision: number }
  | { status: "missing"; revision: number };

export type NavigationBackendCapabilities = {
  deferredRequests: boolean;
  routeFields: boolean;
  radius: boolean;
  height: boolean;
  maxSlope: boolean;
  dynamicObstacles: Array<NavigationObstacleTarget["kind"]>;
};

export type NavigationBackendSnapshot = {
  id: string;
  revision: number;
  disposed: boolean;
  capabilities: NavigationBackendCapabilities;
  details?: Record<string, unknown> | undefined;
};

export type NavigationBackendAdapter = {
  readonly id: string;
  readonly capabilities: NavigationBackendCapabilities;
  revision(): number;
  projectPoint(
    point: NavigationPoint,
    profile: NavigationAgentProfileDefinition
  ): NavigationProjection | undefined;
  submitPath(request: NavigationBackendPathRequest): void;
  pollPath(requestId: NavigationBackendRequestId): NavigationBackendPathStatus;
  cancelPath(requestId: NavigationBackendRequestId): void;
  releasePath(requestId: NavigationBackendRequestId): void;
  update?(deltaMs: number, elapsedMs: number): void;
  sampleRoute?(
    routeKey: string,
    point: NavigationPoint,
    profile: NavigationAgentProfileDefinition
  ): NavigationBackendRouteSample;
  retainRoute?(routeKey: string): void;
  releaseRoute?(routeKey: string): void;
  updateObstacle?(update: NavigationObstacleUpdate): NavigationObstacleUpdateResult;
  snapshot(): NavigationBackendSnapshot;
  dispose(): void;
};

export type NavigationBackendFactoryContext = {
  layout: NavigationLayoutDefinition;
  dataRegistry: DataRegistry;
};

export type NavigationBackendFactory = {
  readonly id: string;
  create(context: NavigationBackendFactoryContext): NavigationBackendAdapter;
};
