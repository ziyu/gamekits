import { defineComponent } from "@gamekits/world";
import type {
  PhysicsBodyDefinition,
  PhysicsBodyId,
  PhysicsColliderDefinition,
  PhysicsColliderId,
  PhysicsContactEvent,
  PhysicsRotation,
  PhysicsVector
} from "../runtime/types";

export type PhysicsBodyComponentState = {
  definition: PhysicsBodyDefinition;
  bodyId?: PhysicsBodyId;
  enabled: boolean;
  syncFromWorld: boolean;
  syncVelocityFromWorld: boolean;
  syncToWorld: boolean;
};

export type PhysicsColliderComponentState = {
  definition: PhysicsColliderDefinition;
  colliderId?: PhysicsColliderId;
  enabled: boolean;
};

export type PhysicsTransformComponentState = {
  position: PhysicsVector;
  rotation?: PhysicsRotation;
};

export type PhysicsVelocityComponentState = {
  linear: PhysicsVector;
  angular?: PhysicsRotation;
};

export type PhysicsContactsComponentState = {
  contacts: PhysicsContactEvent[];
};

export const PhysicsBodyComponent = defineComponent<PhysicsBodyComponentState>({
  id: "physics.body",
  create(data: Partial<PhysicsBodyComponentState> | undefined) {
    const definition = data?.definition ?? { kind: "dynamic" };
    const isDynamic = definition.kind === "dynamic";

    return {
      definition,
      enabled: data?.enabled ?? true,
      syncFromWorld: data?.syncFromWorld ?? !isDynamic,
      syncVelocityFromWorld: data?.syncVelocityFromWorld ?? true,
      syncToWorld: data?.syncToWorld ?? definition.kind !== "static",
      ...(data?.bodyId === undefined ? {} : { bodyId: data.bodyId })
    };
  }
});

export const PhysicsColliderComponent = defineComponent<PhysicsColliderComponentState>({
  id: "physics.collider",
  create(data: Partial<PhysicsColliderComponentState> | undefined) {
    return {
      definition: data?.definition ?? { shape: { type: "circle", radius: 1 } },
      enabled: data?.enabled ?? true,
      ...(data?.colliderId === undefined ? {} : { colliderId: data.colliderId })
    };
  }
});

export const PhysicsTransformComponent = defineComponent<PhysicsTransformComponentState>({
  id: "physics.transform",
  create(data: Partial<PhysicsTransformComponentState> | undefined) {
    return {
      position: cloneVector(data?.position ?? { x: 0, y: 0 }),
      ...(data?.rotation === undefined ? {} : { rotation: data.rotation })
    };
  }
});

export const PhysicsVelocityComponent = defineComponent<PhysicsVelocityComponentState>({
  id: "physics.velocity",
  create(data: Partial<PhysicsVelocityComponentState> | undefined) {
    return {
      linear: cloneVector(data?.linear ?? { x: 0, y: 0 }),
      ...(data?.angular === undefined ? {} : { angular: data.angular })
    };
  }
});

export const PhysicsContactsComponent = defineComponent<PhysicsContactsComponentState>({
  id: "physics.contacts",
  create(data: Partial<PhysicsContactsComponentState> | undefined) {
    return {
      contacts: [...(data?.contacts ?? [])]
    };
  }
});

function cloneVector(vector: PhysicsVector): PhysicsVector {
  return {
    x: vector.x,
    y: vector.y,
    ...(vector.z === undefined ? {} : { z: vector.z })
  };
}
