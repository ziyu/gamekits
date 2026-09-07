import type { DataKey, DataRegistry } from "@gamekits/data";
import { expect } from "vitest";
import type { MemoryRendererAdapter } from "@gamekits/test-utils";
import type {
  SandboxEntitySnapshot,
  SandboxSceneRole,
  SandboxSnapshot,
  SandboxTimelineEntry
} from "../sandbox-game";

export function expectTimelineSorted(snapshot: SandboxSnapshot): void {
  expect(snapshot.timeline).toEqual(
    [...snapshot.timeline].sort(
      (left, right) => left.time - right.time || left.id.localeCompare(right.id)
    )
  );
}

export function expectTimelineKinds(
  snapshot: SandboxSnapshot,
  kinds: Array<SandboxTimelineEntry["kind"]>
): void {
  expect(snapshot.timeline.map((entry) => entry.kind)).toEqual(expect.arrayContaining(kinds));
}

export function expectSceneRoles(snapshot: SandboxSnapshot, roles: SandboxSceneRole[]): void {
  expect(snapshot.entities.map((entity) => entity.role)).toEqual(expect.arrayContaining(roles));
}

export function expectEntityWithRole(
  snapshot: SandboxSnapshot,
  role: SandboxSceneRole
): SandboxEntitySnapshot {
  const entity = snapshot.entities.find((candidate) => candidate.role === role);
  expect(entity, `Expected Sandbox entity role ${role}`).toBeDefined();
  return entity!;
}

export function expectEntityWithObjectId(
  snapshot: SandboxSnapshot,
  objectId: string
): SandboxEntitySnapshot {
  const entity = snapshot.entities.find((candidate) => candidate.objectId === objectId);
  expect(entity, `Expected Sandbox scene object ${objectId}`).toBeDefined();
  return entity!;
}

export function expectEveryDataReferenceResolves(registry: DataRegistry): void {
  const references = registry.snapshot().references;
  expect(references.length).toBeGreaterThan(0);

  for (const reference of references) {
    expect(
      registry.has(reference.to.type, reference.to.id),
      `${reference.from.type}:${reference.from.id} -> ${reference.to.type}:${reference.to.id} at ${reference.path}`
    ).toBe(true);
  }
}

export function expectDataReference(
  registry: DataRegistry,
  from: DataKey,
  to: DataKey,
  path?: string
): void {
  expect(registry.referencesFrom(from)).toContainEqual(
    expect.objectContaining({
      from: expect.objectContaining(from),
      to: expect.objectContaining(to),
      ...(path ? { path } : {})
    })
  );
}

export function expectRendererLinked(
  renderer: MemoryRendererAdapter,
  snapshot: SandboxSnapshot,
  expectedCount: number
): void {
  const objects = renderer.objects();
  expect(objects).toHaveLength(expectedCount);
  expect(new Set(objects.map((object) => object.id)).size).toBe(expectedCount);
  expect(snapshot.entities.filter((entity) => entity.renderObjectId !== undefined).length).toBe(
    expectedCount
  );
}

export function expectGasActor(snapshot: SandboxSnapshot, actorId: string) {
  const actor = snapshot.gasActors.find((candidate) => candidate.actor.actorId === actorId);
  expect(actor, `Expected GAS actor ${actorId}`).toBeDefined();
  return actor!;
}
