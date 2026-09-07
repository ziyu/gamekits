import type { DataDiagnostic, DataDocument, DataTypeDefinition } from "@gamekits/data";
import { isNavigationPoint } from "../contracts/geometry";
import type { NavigationLayoutDefinition } from "../contracts/layout";
import type { NavigationAgentProfileDefinition } from "../contracts/profile";

export const NAVIGATION_AGENT_PROFILE_TYPE = "navigation.agent-profile";
export const NAVIGATION_LAYOUT_TYPE = "navigation.layout";

export type NavigationDataTypeDefinition =
  | DataTypeDefinition<NavigationAgentProfileDefinition>
  | DataTypeDefinition<NavigationLayoutDefinition>;

export function createNavigationDataTypes(): NavigationDataTypeDefinition[] {
  return [createNavigationAgentProfileDataType(), createNavigationLayoutDataType()];
}

export function createNavigationAgentProfileDataType(): DataTypeDefinition<NavigationAgentProfileDefinition> {
  return {
    type: NAVIGATION_AGENT_PROFILE_TYPE,
    getTags: (profile) => profile.tags ?? [],
    validate(document) {
      const diagnostics = validateId(document, "navigation.profile_missing_id");
      if (!positiveFinite(document.data.radius)) {
        diagnostics.push(
          diagnostic(
            "navigation.profile_invalid_radius",
            "Navigation agent profile radius must be positive and finite",
            document,
            "radius"
          )
        );
      }
      if (document.data.height !== undefined && !positiveFinite(document.data.height)) {
        diagnostics.push(
          diagnostic(
            "navigation.profile_invalid_height",
            "Navigation agent profile height must be positive and finite",
            document,
            "height"
          )
        );
      }
      if (document.data.maxSlope !== undefined && !nonNegativeFinite(document.data.maxSlope)) {
        diagnostics.push(
          diagnostic(
            "navigation.profile_invalid_slope",
            "Navigation agent profile maxSlope must be non-negative and finite",
            document,
            "maxSlope"
          )
        );
      }
      if (hasDuplicates(document.data.allowedAreas ?? [])) {
        diagnostics.push(
          diagnostic(
            "navigation.profile_duplicate_area",
            "Navigation agent profile allowedAreas must be unique",
            document,
            "allowedAreas"
          )
        );
      }
      for (const [area, cost] of Object.entries(document.data.costOverrides ?? {})) {
        if (!area || !positiveFinite(cost)) {
          diagnostics.push(
            diagnostic(
              "navigation.profile_invalid_cost_override",
              "Navigation agent profile cost override must use a non-empty area and positive cost",
              document,
              `costOverrides.${area}`
            )
          );
        }
      }
      return diagnostics;
    }
  };
}

export function createNavigationLayoutDataType(): DataTypeDefinition<NavigationLayoutDefinition> {
  return {
    type: NAVIGATION_LAYOUT_TYPE,
    getTags: (layout) => layout.tags ?? [],
    validate(document) {
      const diagnostics = validateId(document, "navigation.layout_missing_id");
      if (!nonEmptyString(document.data.backend)) {
        diagnostics.push(
          diagnostic(
            "navigation.layout_missing_backend",
            "Navigation layout requires a backend id",
            document,
            "backend"
          )
        );
      }
      if (
        !document.data.source ||
        !nonEmptyString(document.data.source.type) ||
        !nonEmptyString(document.data.source.id)
      ) {
        diagnostics.push(
          diagnostic(
            "navigation.layout_invalid_source",
            "Navigation layout requires a typed source reference",
            document,
            "source"
          )
        );
      }

      const areaIds = new Set<string>();
      for (const [index, area] of (document.data.areas ?? []).entries()) {
        if (!nonEmptyString(area.id) || areaIds.has(area.id)) {
          diagnostics.push(
            diagnostic(
              areaIds.has(area.id)
                ? "navigation.layout_duplicate_area"
                : "navigation.layout_area_missing_id",
              "Navigation layout areas require unique ids",
              document,
              `areas[${index}].id`
            )
          );
        }
        areaIds.add(area.id);
        if (area.cost !== undefined && !positiveFinite(area.cost)) {
          diagnostics.push(
            diagnostic(
              "navigation.layout_invalid_area_cost",
              "Navigation layout area cost must be positive and finite",
              document,
              `areas[${index}].cost`
            )
          );
        }
      }

      const portalIds = new Set<string>();
      for (const [index, portal] of (document.data.portals ?? []).entries()) {
        if (!nonEmptyString(portal.id) || portalIds.has(portal.id)) {
          diagnostics.push(
            diagnostic(
              portalIds.has(portal.id)
                ? "navigation.layout_duplicate_portal"
                : "navigation.layout_portal_missing_id",
              "Navigation layout portals require unique ids",
              document,
              `portals[${index}].id`
            )
          );
        }
        portalIds.add(portal.id);
        for (const [side, endpoint] of [
          ["from", portal.from],
          ["to", portal.to]
        ] as const) {
          if (!endpoint || !isNavigationPoint(endpoint.point)) {
            diagnostics.push(
              diagnostic(
                "navigation.layout_invalid_portal_endpoint",
                "Navigation portal endpoints must use finite points",
                document,
                `portals[${index}].${side}`
              )
            );
          }
          if (endpoint?.area !== undefined && !areaIds.has(endpoint.area)) {
            diagnostics.push(
              diagnostic(
                "navigation.layout_portal_unknown_area",
                "Navigation portal endpoint areas must exist in the layout",
                document,
                `portals[${index}].${side}.area`
              )
            );
          }
        }
        if (portal.cost !== undefined && !positiveFinite(portal.cost)) {
          diagnostics.push(
            diagnostic(
              "navigation.layout_invalid_portal_cost",
              "Navigation layout portal cost must be positive and finite",
              document,
              `portals[${index}].cost`
            )
          );
        }
      }
      return diagnostics;
    },
    references(document) {
      if (!document.data.source?.type || !document.data.source.id) {
        return [];
      }
      return [{ type: document.data.source.type, id: document.data.source.id, path: "source" }];
    }
  };
}

function validateId<T extends { id: string }>(
  document: DataDocument<T>,
  code: string
): DataDiagnostic[] {
  return nonEmptyString(document.data.id)
    ? []
    : [diagnostic(code, "Navigation definition requires an id", document, "id")];
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

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}
