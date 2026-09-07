import type { DataRef } from "@gamekits/data";
import type { NavigationLayoutDefinition } from "@gamekits/navigation-core";
import { BLACKGLASS_BASIN_TERRAIN } from "../scenarios/blackglass-basin-terrain";

export const BLACKGLASS_BLAST_DOOR_AREA_ID = "blast-door";
export const BLACKGLASS_GANTRY_AREA_ID = "gantry";
export const BLACKGLASS_COOLANT_AREA_ID = "swamp";
export const BLACKGLASS_TRANSIT_RELAY_PORTAL_ID = "portal.blackglass.transit-relay";

export function createBlackglassNavigationLayout(
  id: string,
  backendId: string,
  source: DataRef
): NavigationLayoutDefinition {
  return {
    id,
    backend: backendId,
    source,
    areas: [
      { id: "ground", cost: 1 },
      { id: "road", cost: 0.95 },
      { id: "ridge", cost: 1 },
      { id: BLACKGLASS_BLAST_DOOR_AREA_ID, cost: 0.95 },
      { id: BLACKGLASS_GANTRY_AREA_ID, cost: 1 },
      { id: BLACKGLASS_COOLANT_AREA_ID, cost: 1.65 }
    ],
    portals: [
      {
        id: BLACKGLASS_TRANSIT_RELAY_PORTAL_ID,
        from: { point: { ...BLACKGLASS_BASIN_TERRAIN.relay.from }, area: "ground" },
        to: { point: { ...BLACKGLASS_BASIN_TERRAIN.relay.to }, area: "ground" },
        cost: 3.5,
        bidirectional: true,
        enabled: false
      }
    ],
    tags: ["navigation-lab", "blackglass-basin", backendId, "terrain-derived"]
  };
}
