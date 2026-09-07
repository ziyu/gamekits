import type { DataDiagnostic, DataDocument, DataTypeDefinition } from "@gamekits/data";
import type { NavigationGraphDefinition } from "../contracts/graph-definition";

export const NAVIGATION_GRAPH_TYPE = "navigation.graph";

export function createNavigationGraphDataType(): DataTypeDefinition<NavigationGraphDefinition> {
  return {
    type: NAVIGATION_GRAPH_TYPE,
    getTags: (graph) => graph.tags ?? [],
    validate(document) {
      const diagnostics: DataDiagnostic[] = [];
      if (!nonEmptyString(document.data.id)) {
        diagnostics.push(
          diagnostic(
            "navigation.graph_missing_id",
            "Navigation graph requires an id",
            document,
            "id"
          )
        );
      }
      if (!Array.isArray(document.data.nodes) || document.data.nodes.length === 0) {
        diagnostics.push(
          diagnostic(
            "navigation.graph_missing_nodes",
            "Navigation graph requires at least one node",
            document,
            "nodes"
          )
        );
      }
      const nodeIds = new Set<string>();
      for (const [index, node] of (document.data.nodes ?? []).entries()) {
        if (!nonEmptyString(node.id) || nodeIds.has(node.id)) {
          diagnostics.push(
            diagnostic(
              nodeIds.has(node.id)
                ? "navigation.graph_duplicate_node"
                : "navigation.graph_node_missing_id",
              "Navigation graph nodes require unique ids",
              document,
              `nodes[${index}].id`
            )
          );
        }
        nodeIds.add(node.id);
        if (!validPoint(node.point)) {
          diagnostics.push(
            diagnostic(
              "navigation.graph_invalid_node_point",
              "Navigation graph node point must be finite",
              document,
              `nodes[${index}].point`
            )
          );
        }
        validatePositiveOptional(
          diagnostics,
          node.clearance,
          "navigation.graph_invalid_node_clearance",
          "Navigation graph node clearance must be positive and finite",
          document,
          `nodes[${index}].clearance`
        );
        validatePositiveOptional(
          diagnostics,
          node.heightClearance,
          "navigation.graph_invalid_node_height_clearance",
          "Navigation graph node height clearance must be positive and finite",
          document,
          `nodes[${index}].heightClearance`
        );
      }
      const edgeIds = new Set<string>();
      for (const [index, edge] of (document.data.edges ?? []).entries()) {
        if (!nonEmptyString(edge.id) || edgeIds.has(edge.id)) {
          diagnostics.push(
            diagnostic(
              edgeIds.has(edge.id)
                ? "navigation.graph_duplicate_edge"
                : "navigation.graph_edge_missing_id",
              "Navigation graph edges require unique ids",
              document,
              `edges[${index}].id`
            )
          );
        }
        edgeIds.add(edge.id);
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) {
          diagnostics.push(
            diagnostic(
              "navigation.graph_invalid_edge_nodes",
              "Navigation graph edge must connect two different existing nodes",
              document,
              `edges[${index}]`
            )
          );
        }
        validatePositiveOptional(
          diagnostics,
          edge.cost,
          "navigation.graph_invalid_edge_cost",
          "Navigation graph edge cost must be positive and finite",
          document,
          `edges[${index}].cost`
        );
        validatePositiveOptional(
          diagnostics,
          edge.width,
          "navigation.graph_invalid_edge_width",
          "Navigation graph edge width must be positive and finite",
          document,
          `edges[${index}].width`
        );
        validatePositiveOptional(
          diagnostics,
          edge.heightClearance,
          "navigation.graph_invalid_edge_height_clearance",
          "Navigation graph edge height clearance must be positive and finite",
          document,
          `edges[${index}].heightClearance`
        );
        if (edge.slope !== undefined && (!Number.isFinite(edge.slope) || edge.slope < 0)) {
          diagnostics.push(
            diagnostic(
              "navigation.graph_invalid_edge_slope",
              "Navigation graph edge slope must be non-negative and finite",
              document,
              `edges[${index}].slope`
            )
          );
        }
      }
      return diagnostics;
    }
  };
}

function validatePositiveOptional(
  diagnostics: DataDiagnostic[],
  value: number | undefined,
  code: string,
  message: string,
  document: DataDocument,
  path: string
): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    diagnostics.push(diagnostic(code, message, document, path));
  }
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

function validPoint(point: NavigationGraphDefinition["nodes"][number]["point"]): boolean {
  return (
    Number.isFinite(point?.x) &&
    Number.isFinite(point?.y) &&
    (point?.z === undefined || Number.isFinite(point.z))
  );
}
