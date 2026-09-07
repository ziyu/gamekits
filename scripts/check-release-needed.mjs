import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inferDistTag,
  parseAdditionalDistTags,
  resolveRequiredDistTags,
  validateDistTagPolicy
} from "./release-dist-tags.mjs";
import { assertLockstepWorkspaceState } from "./release-workspace-state.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sentinelManifest = JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8"));
const version = process.env.GAMEKITS_RELEASE_VERSION ?? sentinelManifest.version;
const registry = process.env.GAMEKITS_NPM_REGISTRY ?? "https://registry.npmjs.org";
const distTag = process.env.GAMEKITS_NPM_TAG ?? inferDistTag(version);
const additionalDistTags = parseAdditionalDistTags(process.env.GAMEKITS_NPM_ADDITIONAL_TAGS);
validateDistTagPolicy({ additionalDistTags, distTag, version });
assertLockstepWorkspaceState({ releaseVersion: version, root });
const packageNames = resolvePackageNames();

const missingPackages = [];
const staleDistTags = [];
for (const packageName of packageNames) {
  const metadata = await fetchPackageMetadata(packageName);
  if (!metadata?.versions?.[version]) {
    missingPackages.push(packageName);
    continue;
  }

  const requiredDistTags = resolveRequiredDistTags({
    additionalDistTags,
    distTag,
    version
  });
  const staleTags = requiredDistTags.filter((tag) => metadata["dist-tags"]?.[tag] !== version);
  if (staleTags.length > 0) {
    staleDistTags.push(`${packageName}:${staleTags.join("+")}`);
  }
}

const shouldPublish = missingPackages.length > 0 || staleDistTags.length > 0;

writeOutput("should-publish", String(shouldPublish));
writeOutput("release-version", version);
writeOutput("missing-packages", missingPackages.join(","));
writeOutput("stale-dist-tags", staleDistTags.join(","));

if (shouldPublish) {
  if (missingPackages.length > 0) {
    console.log(
      `${missingPackages.map((name) => `${name}@${version}`).join(", ")} not published yet.`
    );
  }
  if (staleDistTags.length > 0) {
    console.log(`${staleDistTags.join(", ")} dist-tag(s) are stale for ${version}.`);
  }
  console.log("Release should run.");
} else {
  console.log(
    `All ${packageNames.length} @gamekits package(s) are already published and tagged at ${version}.`
  );
}

async function fetchPackageMetadata(name) {
  const response = await fetch(registryPackageUrl(name), {
    headers: {
      Accept: "application/json"
    }
  });

  if (response.status === 200) {
    return response.json();
  }

  if (response.status === 404) {
    return undefined;
  }

  const body = await response.text();
  throw new Error(`Unable to check ${name} in npm registry: HTTP ${response.status} ${body}`);
}

function registryPackageUrl(name) {
  const base = registry.endsWith("/") ? registry : `${registry}/`;
  const encodedName = encodeURIComponent(name);
  return `${base}${encodedName}`;
}

function resolvePackageNames() {
  const sentinelPackage = process.env.GAMEKITS_RELEASE_SENTINEL_PACKAGE;
  if (sentinelPackage) {
    return [sentinelPackage];
  }

  const explicitPackages = process.env.GAMEKITS_PUBLISH_PACKAGES;
  if (explicitPackages) {
    return explicitPackages
      .split(",")
      .map((slug) => slug.trim())
      .filter(Boolean)
      .map((slug) => `@gamekits/${slug}`);
  }

  const packagesDir = join(root, "packages");
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name, "package.json"))
    .filter((manifestPath) => existsSync(manifestPath))
    .map((manifestPath) => JSON.parse(readFileSync(manifestPath, "utf8")))
    .filter((manifest) => manifest.private !== true)
    .map((manifest) => manifest.name)
    .filter((name) => typeof name === "string" && name.startsWith("@gamekits/"))
    .map(publicPackageName)
    .sort();
}

function publicPackageName(name) {
  return name.replace(/^@gamekits\//, "@gamekits/");
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.log(`${name}=${value}`);
    return;
  }

  appendFileSync(outputPath, `${name}=${value}\n`);
}
