import { createDataRegistry, type DataPack } from "@gamekits/data";
import { describe, expect, it } from "vitest";
import {
  createNavigationNavMeshDataType,
  NAVIGATION_NAVMESH_SOURCE_TYPE,
  type NavigationNavMeshSource
} from "../src";

describe("navigation NavMesh source", () => {
  it("registers serializable triangle geometry", () => {
    const registry = createDataRegistry();
    registry.registerType(createNavigationNavMeshDataType());
    const source = createFlatSource();
    const pack: DataPack = {
      id: "navigation-navmesh.test",
      version: "1.0.0",
      entries: [{ type: NAVIGATION_NAVMESH_SOURCE_TYPE, id: source.id, data: source }]
    };

    const result = registry.registerPack(pack);

    expect(result.diagnostics).toEqual([]);
    expect(
      registry.getValue<NavigationNavMeshSource>(NAVIGATION_NAVMESH_SOURCE_TYPE, source.id)
        .triangles
    ).toHaveLength(2);
  });

  it("rejects out-of-bounds and degenerate triangles", () => {
    const registry = createDataRegistry();
    registry.registerType(createNavigationNavMeshDataType());
    const source = createFlatSource();
    source.triangles = [
      { a: 0, b: 0, c: 1 },
      { a: 0, b: 1, c: 99 }
    ];

    const result = registry.validatePack({
      id: "navigation-navmesh.invalid",
      version: "1.0.0",
      entries: [{ type: NAVIGATION_NAVMESH_SOURCE_TYPE, id: source.id, data: source }]
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "navigation.navmesh_degenerate_triangle",
        "navigation.navmesh_triangle_out_of_bounds"
      ])
    );
  });
});

function createFlatSource(): NavigationNavMeshSource {
  return {
    id: "flat",
    vertices: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 }
    ],
    triangles: [
      { a: 0, b: 1, c: 2 },
      { a: 0, b: 2, c: 3 }
    ],
    build: {
      cellSize: 0.2,
      cellHeight: 0.1,
      walkableRadius: 0.2,
      walkableHeight: 1.8,
      walkableClimb: 0.3,
      walkableSlopeAngle: 45
    }
  };
}
