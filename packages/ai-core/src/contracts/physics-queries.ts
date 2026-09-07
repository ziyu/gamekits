import type { PhysicsQueries } from "@gamekits/physics-core";

export function createAiPhysicsQueries(queries: PhysicsQueries): PhysicsQueries {
  return Object.freeze({
    query: queries.query.bind(queries),
    queryPoint: queries.queryPoint.bind(queries),
    raycast: queries.raycast.bind(queries),
    shapeCast: queries.shapeCast.bind(queries),
    overlapShape: queries.overlapShape.bind(queries),
    checkOverlap: queries.checkOverlap.bind(queries),
    checkCollision: queries.checkCollision.bind(queries),
    queryBounds: queries.queryBounds.bind(queries),
    snapshot: queries.snapshot.bind(queries)
  });
}
