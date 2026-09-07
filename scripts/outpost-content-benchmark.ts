import { performance } from "node:perf_hooks";
import { statSync } from "node:fs";
import { join } from "node:path";
import {
  createOutpostDataRegistry,
  createOutpostIdentityRegistry,
  outpostRuntimeImageAssets
} from "../apps/multiplayer-outpost-siege-demo/src";
import {
  checkOutpostContentBudgets,
  outpostContentBudgetCount,
  type OutpostContentBenchmarkResult
} from "./outpost-content-benchmark-budget";

const CONTENT_BOOT_ITERATIONS = 500;
const IDENTITY_COUNT = 25_000;

function main(): void {
  for (let index = 0; index < 20; index += 1) {
    createOutpostDataRegistry();
  }

  const contentStartedAt = performance.now();
  let contentSnapshot = createOutpostDataRegistry().snapshot();
  for (let index = 1; index < CONTENT_BOOT_ITERATIONS; index += 1) {
    contentSnapshot = createOutpostDataRegistry().snapshot();
  }
  const contentDurationMs = performance.now() - contentStartedAt;

  const identities = createOutpostIdentityRegistry();
  const identityStartedAt = performance.now();
  for (let index = 0; index < IDENTITY_COUNT; index += 1) {
    identities.register({
      gameplayObjectId: `object:${index}`,
      entityId: index,
      actorId: `actor:${index}`,
      physicsBodyId: `body:${index}`,
      physicsColliderIds: [`collider:${index}`],
      network: { entityId: `network:${index}`, generation: index % 4 },
      renderObjectId: `render:${index}`
    });
  }
  const identityRegistrationMs = performance.now() - identityStartedAt;

  let checksum = 0;
  const lookupStartedAt = performance.now();
  for (let index = 0; index < IDENTITY_COUNT; index += 1) {
    checksum += identities.byEntityId(index)?.entityId === index ? 1 : 0;
    checksum += identities.byActorId(`actor:${index}`)?.entityId === index ? 1 : 0;
    checksum +=
      identities.byNetworkIdentity({ entityId: `network:${index}`, generation: index % 4 })
        ?.entityId === index
        ? 1
        : 0;
  }
  const lookupMs = performance.now() - lookupStartedAt;
  const runtimeImageSizes = outpostRuntimeImageAssets.map(
    (asset) =>
      statSync(
        join(process.cwd(), "apps/multiplayer-outpost-siege-demo/public", asset.runtimeUrl.slice(1))
      ).size
  );

  const result: OutpostContentBenchmarkResult = {
    millisecondsPerContentBoot: round(contentDurationMs / CONTENT_BOOT_ITERATIONS),
    microsecondsPerIdentityRegistration: round((identityRegistrationMs * 1_000) / IDENTITY_COUNT),
    microsecondsPerIdentityLookup: round((lookupMs * 1_000) / (IDENTITY_COUNT * 3)),
    retainedDocuments: contentSnapshot.documents.length,
    retainedReferences: contentSnapshot.references.length,
    retainedIdentities: identities.snapshot().length,
    runtimeImageBytes: runtimeImageSizes.reduce((total, size) => total + size, 0),
    largestRuntimeImageBytes: Math.max(...runtimeImageSizes)
  };
  const checkEnabled = process.argv.includes("--check");
  const failures = checkEnabled ? checkOutpostContentBudgets(result) : [];

  console.log(
    JSON.stringify(
      {
        benchmark: "outpost-content-and-identity",
        packages: ["@gamekits/data", "@gamekits/asset", "multiplayer-outpost-siege-demo"],
        profile: {
          contentBootIterations: CONTENT_BOOT_ITERATIONS,
          identityCount: IDENTITY_COUNT,
          checksum
        },
        result,
        ...(checkEnabled
          ? {
              budgetCheck: {
                budgets: outpostContentBudgetCount(),
                passed: failures.length === 0,
                failures
              }
            }
          : {})
      },
      null,
      2
    )
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

main();
