import type { NavigationQueries } from "@gamekits/navigation-core";

export function createAiNavigationQueries(queries: NavigationQueries): NavigationQueries {
  return Object.freeze({
    projectPoint: queries.projectPoint.bind(queries),
    requestPath: queries.requestPath.bind(queries),
    poll: queries.poll.bind(queries),
    cancel: queries.cancel.bind(queries),
    sampleRoute: queries.sampleRoute.bind(queries),
    releaseRoute: queries.releaseRoute.bind(queries),
    revision: queries.revision.bind(queries),
    snapshot: queries.snapshot.bind(queries)
  });
}
