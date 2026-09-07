import type { DataDiagnostic, DataDocument, DataTypeDefinition } from "@gamekits/data";
import type {
  NavigationNavMeshBuildProfile,
  NavigationNavMeshSource
} from "../contracts/navigation-navmesh-source";

export const NAVIGATION_NAVMESH_SOURCE_TYPE = "navigation.navmesh-source";

export function createNavigationNavMeshDataType(): DataTypeDefinition<NavigationNavMeshSource> {
  return {
    type: NAVIGATION_NAVMESH_SOURCE_TYPE,
    getTags: (source) => source.tags ?? [],
    validate(document) {
      const diagnostics: DataDiagnostic[] = [];
      const source = document.data;

      if (!nonEmptyString(source.id)) {
        diagnostics.push(
          diagnostic(
            "navigation.navmesh_missing_id",
            "Navigation NavMesh source requires an id",
            document,
            "id"
          )
        );
      }
      if (!Array.isArray(source.vertices) || source.vertices.length < 3) {
        diagnostics.push(
          diagnostic(
            "navigation.navmesh_missing_vertices",
            "Navigation NavMesh source requires at least three vertices",
            document,
            "vertices"
          )
        );
      }
      for (const [index, vertex] of (source.vertices ?? []).entries()) {
        if (!validPoint(vertex)) {
          diagnostics.push(
            diagnostic(
              "navigation.navmesh_invalid_vertex",
              "Navigation NavMesh vertices must use finite coordinates",
              document,
              `vertices[${index}]`
            )
          );
        }
      }
      if (!Array.isArray(source.triangles) || source.triangles.length === 0) {
        diagnostics.push(
          diagnostic(
            "navigation.navmesh_missing_triangles",
            "Navigation NavMesh source requires at least one triangle",
            document,
            "triangles"
          )
        );
      }
      const triangleKeys = new Set<string>();
      for (const [index, triangle] of (source.triangles ?? []).entries()) {
        const indices = [triangle.a, triangle.b, triangle.c];
        const indicesValid = indices.every(
          (vertexIndex) =>
            Number.isSafeInteger(vertexIndex) &&
            vertexIndex >= 0 &&
            vertexIndex < (source.vertices?.length ?? 0)
        );
        if (!indicesValid) {
          diagnostics.push(
            diagnostic(
              "navigation.navmesh_triangle_out_of_bounds",
              "Navigation NavMesh triangle indices must reference source vertices",
              document,
              `triangles[${index}]`
            )
          );
        }
        if (new Set(indices).size !== 3) {
          diagnostics.push(
            diagnostic(
              "navigation.navmesh_degenerate_triangle",
              "Navigation NavMesh triangles must reference three distinct vertices",
              document,
              `triangles[${index}]`
            )
          );
        } else if (
          indicesValid &&
          triangleAreaSquared(
            source.vertices[triangle.a]!,
            source.vertices[triangle.b]!,
            source.vertices[triangle.c]!
          ) <= 1e-12
        ) {
          diagnostics.push(
            diagnostic(
              "navigation.navmesh_degenerate_triangle",
              "Navigation NavMesh triangles must have a non-zero geometric area",
              document,
              `triangles[${index}]`
            )
          );
        }
        const triangleKey = [...indices].sort((left, right) => left - right).join(":");
        if (triangleKeys.has(triangleKey)) {
          diagnostics.push(
            diagnostic(
              "navigation.navmesh_duplicate_triangle",
              "Navigation NavMesh source cannot contain duplicate triangles",
              document,
              `triangles[${index}]`
            )
          );
        }
        triangleKeys.add(triangleKey);
        if (triangle.area !== undefined && !nonEmptyString(triangle.area)) {
          diagnostics.push(
            diagnostic(
              "navigation.navmesh_invalid_triangle_area",
              "Navigation NavMesh triangle area ids must be non-empty",
              document,
              `triangles[${index}].area`
            )
          );
        }
      }
      validateBuildProfile(diagnostics, source.build, document);
      return diagnostics;
    }
  };
}

function validateBuildProfile(
  diagnostics: DataDiagnostic[],
  build: NavigationNavMeshBuildProfile | undefined,
  document: DataDocument
): void {
  if (build === undefined) {
    diagnostics.push(
      diagnostic(
        "navigation.navmesh_missing_build_profile",
        "Navigation NavMesh source requires a build profile",
        document,
        "build"
      )
    );
    return;
  }
  const positiveFields: Array<keyof NavigationNavMeshBuildProfile> = [
    "cellSize",
    "cellHeight",
    "walkableHeight"
  ];
  for (const field of positiveFields) {
    const value = build?.[field];
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      diagnostics.push(
        diagnostic(
          "navigation.navmesh_invalid_build_profile",
          `Navigation NavMesh build.${field} must be positive and finite`,
          document,
          `build.${field}`
        )
      );
    }
  }
  const nonNegativeFields: Array<keyof NavigationNavMeshBuildProfile> = [
    "walkableRadius",
    "walkableClimb",
    "minRegionArea",
    "mergeRegionArea",
    "maxSimplificationError",
    "maxEdgeLength",
    "detailSampleDistance",
    "detailSampleMaxError"
  ];
  for (const field of nonNegativeFields) {
    const value = build[field];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      diagnostics.push(
        diagnostic(
          "navigation.navmesh_invalid_build_profile",
          `Navigation NavMesh build.${field} must be non-negative and finite`,
          document,
          `build.${field}`
        )
      );
    }
  }
  if (
    build.maxVerticesPerPolygon !== undefined &&
    (!Number.isSafeInteger(build.maxVerticesPerPolygon) || build.maxVerticesPerPolygon < 3)
  ) {
    diagnostics.push(
      diagnostic(
        "navigation.navmesh_invalid_build_profile",
        "Navigation NavMesh build.maxVerticesPerPolygon must be an integer of at least 3",
        document,
        "build.maxVerticesPerPolygon"
      )
    );
  }
  if (
    !Number.isFinite(build?.walkableSlopeAngle) ||
    build.walkableSlopeAngle < 0 ||
    build.walkableSlopeAngle >= 90
  ) {
    diagnostics.push(
      diagnostic(
        "navigation.navmesh_invalid_build_profile",
        "Navigation NavMesh build.walkableSlopeAngle must be at least 0 and below 90 degrees",
        document,
        "build.walkableSlopeAngle"
      )
    );
  }
}

function triangleAreaSquared(
  a: NavigationNavMeshSource["vertices"][number],
  b: NavigationNavMeshSource["vertices"][number],
  c: NavigationNavMeshSource["vertices"][number]
): number {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: (b.z ?? 0) - (a.z ?? 0) };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: (c.z ?? 0) - (a.z ?? 0) };
  const cross = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x
  };
  return cross.x * cross.x + cross.y * cross.y + cross.z * cross.z;
}

function diagnostic(
  code: string,
  message: string,
  document: DataDocument,
  path: string
): DataDiagnostic {
  return {
    code,
    message,
    severity: "error",
    key: { type: document.type, id: document.id },
    path,
    ...(document.sourcePackId === undefined ? {} : { sourcePackId: document.sourcePackId })
  };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validPoint(point: NavigationNavMeshSource["vertices"][number]): boolean {
  return (
    Number.isFinite(point?.x) &&
    Number.isFinite(point?.y) &&
    (point?.z === undefined || Number.isFinite(point.z))
  );
}
