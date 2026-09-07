import type {
  DataDiagnostic,
  DataDocument,
  DataReferenceTarget,
  DataTypeDefinition
} from "@gamekits/data";
import type {
  PhysicsBodyData,
  PhysicsColliderData,
  PhysicsLayoutData,
  PhysicsMaterialDefinition,
  PhysicsSceneData,
  PhysicsShapeDefinition
} from "../runtime/types";

export type PhysicsDataTypeDefinition =
  | DataTypeDefinition<PhysicsMaterialDefinition>
  | DataTypeDefinition<PhysicsBodyData>
  | DataTypeDefinition<PhysicsColliderData>
  | DataTypeDefinition<PhysicsLayoutData>
  | DataTypeDefinition<PhysicsSceneData>;

export function createPhysicsMaterialDataType(): DataTypeDefinition<PhysicsMaterialDefinition> {
  return {
    type: "physics.material",
    validate(document: DataDocument<PhysicsMaterialDefinition>) {
      const diagnostics: DataDiagnostic[] = [];
      if (!document.data.id) {
        diagnostics.push(diagnostic("physics.material_missing_id", document, "data.id"));
      }
      if (document.data.density !== undefined && document.data.density < 0) {
        diagnostics.push(diagnostic("physics.material_invalid_density", document, "data.density"));
      }

      return diagnostics;
    }
  };
}

export function createPhysicsBodyDataType(): DataTypeDefinition<PhysicsBodyData> {
  return {
    type: "physics.body",
    validate(document: DataDocument<PhysicsBodyData>) {
      const diagnostics: DataDiagnostic[] = [];
      if (!["static", "dynamic", "kinematic"].includes(document.data.kind)) {
        diagnostics.push(diagnostic("physics.body_invalid_kind", document, "data.kind"));
      }

      return diagnostics;
    },
    references(document: DataDocument<PhysicsBodyData>) {
      return (document.data.colliders ?? []).map((reference, index: number) => ({
        type: reference.type,
        id: reference.id,
        path: `data.colliders[${index}]`
      }));
    }
  };
}

export function createPhysicsColliderDataType(): DataTypeDefinition<PhysicsColliderData> {
  return {
    type: "physics.collider",
    validate(document: DataDocument<PhysicsColliderData>) {
      const diagnostics: DataDiagnostic[] = [];
      diagnostics.push(...validateShape(document.data.shape, document));
      return diagnostics;
    },
    references(document: DataDocument<PhysicsColliderData>) {
      const references: DataReferenceTarget[] = [];
      if (document.data.material) {
        references.push({
          type: "physics.material",
          id: document.data.material,
          path: "data.material"
        });
      }

      return references;
    }
  };
}

export function createPhysicsSceneDataType(): DataTypeDefinition<PhysicsSceneData> {
  return {
    type: "physics.scene",
    references(document: DataDocument<PhysicsSceneData>) {
      return (document.data.materials ?? []).map((reference, index: number) => ({
        type: reference.type,
        id: reference.id,
        path: `data.materials[${index}]`
      }));
    }
  };
}

export function createPhysicsLayoutDataType(): DataTypeDefinition<PhysicsLayoutData> {
  return {
    type: "physics.layout",
    validate(document: DataDocument<PhysicsLayoutData>) {
      const diagnostics: DataDiagnostic[] = [];
      const bodyIds = new Set<string>();
      if (!document.data.id) {
        diagnostics.push(diagnostic("physics.layout_missing_id", document, "data.id"));
      }
      if (document.data.bounds && !validBounds(document.data.bounds)) {
        diagnostics.push(diagnostic("physics.layout_invalid_bounds", document, "data.bounds"));
      }
      const bodies = Array.isArray(document.data.bodies) ? document.data.bodies : [];
      if (!Array.isArray(document.data.bodies)) {
        diagnostics.push(diagnostic("physics.layout_invalid_bodies", document, "data.bodies"));
      }
      for (const [bodyIndex, body] of bodies.entries()) {
        if (!body.id || bodyIds.has(body.id)) {
          diagnostics.push(
            diagnostic(
              body.id ? "physics.layout_duplicate_body_id" : "physics.layout_body_missing_id",
              document,
              `data.bodies[${bodyIndex}].id`
            )
          );
        }
        bodyIds.add(body.id);
        if (!body.body?.type || !body.body.id) {
          diagnostics.push(
            diagnostic(
              "physics.layout_body_missing_definition",
              document,
              `data.bodies[${bodyIndex}].body`
            )
          );
        }
        if (body.position && !validVector(body.position)) {
          diagnostics.push(
            diagnostic(
              "physics.layout_invalid_body_position",
              document,
              `data.bodies[${bodyIndex}].position`
            )
          );
        }
        const colliderIds = new Set<string>();
        for (const [colliderIndex, collider] of (body.colliders ?? []).entries()) {
          if (!collider.id || colliderIds.has(collider.id)) {
            diagnostics.push(
              diagnostic(
                collider.id
                  ? "physics.layout_duplicate_collider_id"
                  : "physics.layout_collider_missing_id",
                document,
                `data.bodies[${bodyIndex}].colliders[${colliderIndex}].id`
              )
            );
          }
          colliderIds.add(collider.id);
          if (!collider.collider?.type || !collider.collider.id) {
            diagnostics.push(
              diagnostic(
                "physics.layout_collider_missing_definition",
                document,
                `data.bodies[${bodyIndex}].colliders[${colliderIndex}].collider`
              )
            );
          }
          if (collider.overrides?.shape) {
            diagnostics.push(
              ...validateShape(
                collider.overrides.shape,
                document,
                `data.bodies[${bodyIndex}].colliders[${colliderIndex}].overrides.shape`
              )
            );
          }
        }
      }
      return diagnostics;
    },
    references(document: DataDocument<PhysicsLayoutData>) {
      const references: DataReferenceTarget[] = [];
      if (document.data.scene) {
        references.push({
          type: document.data.scene.type,
          id: document.data.scene.id,
          path: "data.scene"
        });
      }
      for (const [bodyIndex, body] of (Array.isArray(document.data.bodies)
        ? document.data.bodies
        : []
      ).entries()) {
        if (body.body?.type && body.body.id) {
          references.push({
            type: body.body.type,
            id: body.body.id,
            path: `data.bodies[${bodyIndex}].body`
          });
        }
        for (const [colliderIndex, collider] of (body.colliders ?? []).entries()) {
          if (collider.collider?.type && collider.collider.id) {
            references.push({
              type: collider.collider.type,
              id: collider.collider.id,
              path: `data.bodies[${bodyIndex}].colliders[${colliderIndex}].collider`
            });
          }
        }
      }
      return references;
    }
  };
}

export function createPhysicsDataTypes(): PhysicsDataTypeDefinition[] {
  return [
    createPhysicsMaterialDataType(),
    createPhysicsBodyDataType(),
    createPhysicsColliderDataType(),
    createPhysicsSceneDataType(),
    createPhysicsLayoutDataType()
  ];
}

function validateShape(
  shape: PhysicsShapeDefinition | undefined,
  document: DataDocument<unknown>,
  path = "data.shape"
): DataDiagnostic[] {
  if (!shape) {
    return [diagnostic("physics.collider_missing_shape", document, path)];
  }

  switch (shape.type) {
    case "circle":
    case "sphere":
      return shape.radius > 0
        ? []
        : [diagnostic("physics.shape_invalid_radius", document, `${path}.radius`)];
    case "box":
      return shape.width > 0 && shape.height > 0
        ? []
        : [diagnostic("physics.shape_invalid_box", document, path)];
    case "capsule":
      return shape.radius > 0 && shape.height > 0
        ? []
        : [diagnostic("physics.shape_invalid_capsule", document, path)];
    case "polygon":
    case "polyline":
      return shape.points.length >= 2
        ? []
        : [diagnostic("physics.shape_invalid_points", document, `${path}.points`)];
    case "mesh":
      return shape.assetId
        ? []
        : [diagnostic("physics.shape_missing_mesh_asset", document, `${path}.assetId`)];
    case "custom":
      return shape.backend
        ? []
        : [diagnostic("physics.shape_missing_backend", document, `${path}.backend`)];
  }
}

function validBounds(bounds: {
  min: { x: number; y: number; z?: number };
  max: { x: number; y: number; z?: number };
}) {
  if (
    !validVector(bounds.min) ||
    !validVector(bounds.max) ||
    bounds.max.x <= bounds.min.x ||
    bounds.max.y <= bounds.min.y
  ) {
    return false;
  }

  if (bounds.min.z === undefined || bounds.max.z === undefined) {
    return bounds.min.z === undefined && bounds.max.z === undefined;
  }
  return bounds.max.z > bounds.min.z;
}

function validVector(vector: { x: number; y: number; z?: number }) {
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    (vector.z === undefined || Number.isFinite(vector.z))
  );
}

function diagnostic(code: string, document: DataDocument<unknown>, path: string): DataDiagnostic {
  return {
    code,
    message: code,
    severity: "error",
    key: { type: document.type, id: document.id },
    path,
    ...(document.sourcePackId === undefined ? {} : { sourcePackId: document.sourcePackId })
  };
}
