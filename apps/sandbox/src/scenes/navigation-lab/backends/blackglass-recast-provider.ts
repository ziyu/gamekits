import { createDataRegistry, type DataPack, type DataRegistry } from "@gamekits/data";
import {
  createNavigationAgentProfileDataType,
  createNavigationLayoutDataType,
  type NavigationLayoutDefinition
} from "@gamekits/navigation-core";
import {
  createNavigationNavMeshDataType,
  NAVIGATION_NAVMESH_SOURCE_TYPE,
  type NavigationNavMeshSource
} from "@gamekits/navigation-navmesh";
import {
  createRecastNavigationBackendFactory,
  prepareRecastNavigationArtifact,
  type NavigationRecastBuildArtifact
} from "@gamekits/navigation-recast";
import { NAVIGATION_LAB_PROFILES } from "../scenario";
import {
  BLACKGLASS_BLAST_DOOR_AREA_ID,
  BLACKGLASS_COOLANT_AREA_ID,
  BLACKGLASS_GANTRY_AREA_ID,
  BLACKGLASS_TRANSIT_RELAY_PORTAL_ID,
  createBlackglassNavigationLayout
} from "./blackglass-layout";
import { compileBlackglassTerrainNavMeshSource } from "./blackglass-terrain-navmesh";
import type { NavigationLabBackendProvider } from "./contract";
import {
  createNavigationLabDebugAreaCosts,
  type NavigationLabBackendDebugView,
  type NavigationLabDebugShape,
  type NavigationLabDebugStateBinding
} from "./debug-view";

export function createBlackglassRecastNavigationLabBackendProvider(
  options: { id?: string; label?: string } = {}
): NavigationLabBackendProvider {
  const id = options.id ?? "recast";
  const sourceId = `navigation-lab.navmesh.blackglass-basin.${id}`;
  const layoutId = `navigation-lab.layout.blackglass-basin.${id}`;
  const source = compileBlackglassTerrainNavMeshSource(sourceId);
  const layout = createBlackglassNavigationLayout(layoutId, id, {
    type: NAVIGATION_NAVMESH_SOURCE_TYPE,
    id: sourceId
  });
  const debugView: NavigationLabBackendDebugView = {
    backendId: id,
    summary: "Recast bake prepares when this backend is selected",
    areaCosts: createNavigationLabDebugAreaCosts(layout),
    shapes: []
  };
  let artifact: NavigationRecastBuildArtifact | undefined;
  let preparation: Promise<void> | undefined;

  return {
    id,
    label: options.label ?? "Recast NavMesh",
    technology: "Recast polygon NavMesh",
    description:
      "A mature Recast bake generated from the same terrain collision surface. It supports projection, point paths, shared polygon route fields, area cost/blocking, and portal flags; live geometry rebuilds remain an explicit unsupported capability.",
    layoutRef: { type: "navigation.layout", id: layoutId },
    obstacleBindings: {
      bridge: { kind: "area", id: BLACKGLASS_BLAST_DOOR_AREA_ID },
      ridgeTrail: { kind: "area", id: BLACKGLASS_GANTRY_AREA_ID },
      marsh: { kind: "area", id: BLACKGLASS_COOLANT_AREA_ID },
      waystone: { kind: "portal", id: BLACKGLASS_TRANSIT_RELAY_PORTAL_ID }
    },
    debugView,
    prepare() {
      if (preparation === undefined) {
        preparation = prepareRecastNavigationArtifact(source, layout).then((prepared) => {
          artifact = prepared;
          updateDebugView(debugView, prepared, layout);
        });
      }
      return preparation;
    },
    createDataRegistry() {
      return createRecastDataRegistry(id, source, layout);
    },
    createBackendFactories() {
      return [
        createRecastNavigationBackendFactory({
          id,
          ...(artifact === undefined ? {} : { artifact }),
          queryHalfExtents: { x: 2, y: 2, z: 3 }
        })
      ];
    }
  };
}

export const BLACKGLASS_RECAST_NAVIGATION_LAB_BACKEND =
  createBlackglassRecastNavigationLabBackendProvider();

function updateDebugView(
  debugView: NavigationLabBackendDebugView,
  artifact: NavigationRecastBuildArtifact,
  layout: NavigationLayoutDefinition
): void {
  const shapes: NavigationLabDebugShape[] = [];
  for (let index = 0; index < artifact.debugMesh.indices.length; index += 3) {
    const a = artifact.debugMesh.vertices[artifact.debugMesh.indices[index] ?? -1];
    const b = artifact.debugMesh.vertices[artifact.debugMesh.indices[index + 1] ?? -1];
    const c = artifact.debugMesh.vertices[artifact.debugMesh.indices[index + 2] ?? -1];
    const area = artifact.debugMesh.triangleAreas[index / 3];
    if (a !== undefined && b !== undefined && c !== undefined) {
      shapes.push({
        kind: "polygon",
        points: [a, b, c],
        ...(area === undefined ? {} : { area }),
        ...recastDebugStateBinding(area)
      });
    }
  }
  for (const portal of layout.portals ?? []) {
    shapes.push({
      kind: "polyline",
      points: [portal.from.point, portal.to.point],
      lineWidth: 0.06,
      dashed: true,
      stateBinding: "waystone"
    });
  }
  debugView.summary = `${artifact.polygonCount} generated polygons · ${artifact.debugMesh.indices.length / 3} debug triangles · ${artifact.data.byteLength} byte bake`;
  debugView.shapes = shapes;
}

function recastDebugStateBinding(area: string | undefined): {
  stateBinding?: NavigationLabDebugStateBinding;
} {
  if (area === BLACKGLASS_BLAST_DOOR_AREA_ID) {
    return { stateBinding: "bridge" };
  }
  if (area === BLACKGLASS_GANTRY_AREA_ID) {
    return { stateBinding: "ridgeTrail" };
  }
  if (area === BLACKGLASS_COOLANT_AREA_ID) {
    return { stateBinding: "marsh" };
  }
  return {};
}

function createRecastDataRegistry(
  backendId: string,
  source: NavigationNavMeshSource,
  layout: NavigationLayoutDefinition
): DataRegistry {
  const registry = createDataRegistry();
  registry.registerType(createNavigationAgentProfileDataType());
  registry.registerType(createNavigationLayoutDataType());
  registry.registerType(createNavigationNavMeshDataType());
  const pack: DataPack = {
    id: `sandbox.navigation-lab.blackglass-basin.${backendId}`,
    version: "1.0.0",
    entries: [
      { type: NAVIGATION_NAVMESH_SOURCE_TYPE, id: source.id, data: source },
      { type: "navigation.layout", id: layout.id, data: layout },
      ...NAVIGATION_LAB_PROFILES.map((profile) => ({
        type: "navigation.agent-profile",
        id: profile.id,
        data: profile
      }))
    ]
  };
  const validation = registry.registerPack(pack);
  const errors = validation.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Blackglass Recast ${backendId} data is invalid: ${JSON.stringify(errors)}`);
  }
  return registry;
}
