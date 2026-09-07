import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLockstepWorkspaceState } from "./release-workspace-state.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const coreManifest = JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8"));
const version = process.env.GAMEKITS_RELEASE_VERSION ?? coreManifest.version;
assertLockstepWorkspaceState({ releaseVersion: version, root });
const distTag = process.env.GAMEKITS_NPM_TAG ?? inferDistTag(version);
const tagName = process.env.GAMEKITS_GIT_TAG ?? `v${version}`;
const releaseName = process.env.GAMEKITS_GITHUB_RELEASE_NAME ?? `GameKits ${version}`;
const repository = process.env.GITHUB_REPOSITORY ?? process.env.GAMEKITS_GITHUB_REPOSITORY;
const targetSha = process.env.GITHUB_SHA ?? git(["rev-parse", "HEAD"]);
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const dryRun = process.env.GAMEKITS_GITHUB_RELEASE_DRY_RUN === "1";
const prerelease = version.includes("-") || distTag !== "latest";

if (!repository) {
  throw new Error("Missing GitHub repository. Set GITHUB_REPOSITORY.");
}

if (!token && !dryRun) {
  throw new Error("Missing GitHub token. Set GITHUB_TOKEN.");
}

const packageNames = resolvePackageNames();
const releaseBody = [
  `GameKits ${version} package release.`,
  "",
  `npm dist-tag: \`${distTag}\``,
  "",
  "Published packages:",
  ...packageNames.map((name) => `- \`${name}@${version}\``)
].join("\n");

if (dryRun) {
  console.log(`Would create Git tag ${tagName} at ${targetSha}.`);
  console.log(`Would create GitHub Release "${releaseName}" in ${repository}.`);
  console.log(releaseBody);
  process.exit(0);
}

await ensureTag();
await ensureRelease();

async function ensureTag() {
  const ref = await github(
    "GET",
    `/repos/${repository}/git/ref/tags/${encodeURIComponent(tagName)}`,
    {
      okStatuses: [200, 404]
    }
  );

  if (ref.status === 200) {
    const existingSha = ref.body.object?.sha;
    if (existingSha !== targetSha) {
      throw new Error(
        `Git tag ${tagName} already points to ${existingSha}; refusing to move it to ${targetSha}.`
      );
    }

    console.log(`Git tag ${tagName} already exists.`);
    return;
  }

  await github("POST", `/repos/${repository}/git/refs`, {
    body: {
      ref: `refs/tags/${tagName}`,
      sha: targetSha
    },
    okStatuses: [201]
  });
  console.log(`Created Git tag ${tagName}.`);
}

async function ensureRelease() {
  const release = await github(
    "GET",
    `/repos/${repository}/releases/tags/${encodeURIComponent(tagName)}`,
    {
      okStatuses: [200, 404]
    }
  );

  if (release.status === 200) {
    console.log(`GitHub Release ${tagName} already exists.`);
    return;
  }

  await github("POST", `/repos/${repository}/releases`, {
    body: {
      tag_name: tagName,
      target_commitish: targetSha,
      name: releaseName,
      body: releaseBody,
      draft: false,
      prerelease
    },
    okStatuses: [201]
  });
  console.log(`Created GitHub Release ${tagName}.`);
}

async function github(method, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  const okStatuses = options.okStatuses ?? [200];

  if (!okStatuses.includes(response.status)) {
    throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${text}`);
  }

  return { status: response.status, body };
}

function inferDistTag(packageVersion) {
  const prereleaseName = packageVersion.split("-")[1]?.split(".")[0];
  if (prereleaseName === "alpha" || prereleaseName === "beta" || prereleaseName === "rc") {
    return prereleaseName;
  }

  return "latest";
}

function resolvePackageNames() {
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

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
