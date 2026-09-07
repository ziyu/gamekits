import type {
  NavigationPathRequest,
  NavigationQueries,
  NavigationRequestId,
  NavigationRequestResult
} from "@gamekits/navigation-core";
import { createAiNavigationQueries } from "./navigation-queries";

export type AiNavigationAccess = {
  beginUpdate(): void;
  endUpdate(): void;
  forAgent(agentId: string): NavigationQueries;
  release(agentId: string): void;
  rejectedRequests(): number;
  clear(): void;
};

export function createAiNavigationAccess(options: {
  id: string;
  queries: NavigationQueries;
  maxRequestsPerUpdate: number;
  onRejected(agentId: string, request: NavigationPathRequest): void;
}): AiNavigationAccess {
  const queries = createAiNavigationQueries(options.queries);
  const facades = new Map<string, NavigationQueries>();
  const rejectionPrefix = `ai-budget/${encodeURIComponent(options.id)}/`;
  let updating = false;
  let requestsThisUpdate = 0;
  let rejectedTotal = 0;
  let rejectionSequence = 0;

  return {
    beginUpdate() {
      updating = true;
      requestsThisUpdate = 0;
    },
    endUpdate() {
      updating = false;
    },
    forAgent(agentId) {
      const existing = facades.get(agentId);
      if (existing !== undefined) {
        return existing;
      }
      const facade = Object.freeze({
        projectPoint: queries.projectPoint,
        requestPath(request: NavigationPathRequest): NavigationRequestId {
          if (!updating || requestsThisUpdate < options.maxRequestsPerUpdate) {
            if (updating) {
              requestsThisUpdate += 1;
            }
            return queries.requestPath(request);
          }
          rejectedTotal += 1;
          rejectionSequence += 1;
          options.onRejected(agentId, request);
          return `${rejectionPrefix}${rejectionSequence}/${encodeURIComponent(request.requesterId)}`;
        },
        poll(requestId: NavigationRequestId): NavigationRequestResult {
          const rejection = parseRejectedRequest(requestId);
          if (rejection !== undefined) {
            return {
              status: "rejected",
              requestId,
              requesterId: rejection.requesterId,
              reason: "queue-full",
              revision: queries.revision(),
              message: "AI path request budget exceeded"
            };
          }
          return queries.poll(requestId);
        },
        cancel(requestId: NavigationRequestId) {
          if (parseRejectedRequest(requestId) === undefined) {
            queries.cancel(requestId);
          }
        },
        sampleRoute: queries.sampleRoute,
        releaseRoute: queries.releaseRoute,
        revision: queries.revision,
        snapshot: queries.snapshot
      });
      facades.set(agentId, facade);
      return facade;
    },
    release(agentId) {
      facades.delete(agentId);
    },
    rejectedRequests() {
      return rejectedTotal;
    },
    clear() {
      facades.clear();
      updating = false;
      requestsThisUpdate = 0;
    }
  };

  function parseRejectedRequest(
    requestId: NavigationRequestId
  ): { requesterId: string } | undefined {
    if (!requestId.startsWith(rejectionPrefix)) {
      return undefined;
    }
    const separator = requestId.indexOf("/", rejectionPrefix.length);
    if (separator < 0) {
      return undefined;
    }
    try {
      return { requesterId: decodeURIComponent(requestId.slice(separator + 1)) };
    } catch {
      return { requesterId: "unknown" };
    }
  }
}
