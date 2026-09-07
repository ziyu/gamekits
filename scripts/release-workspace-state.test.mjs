import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import {
  assertLockstepWorkspaceState,
  assertPreparedReleaseState,
  readPublishableWorkspacePackages,
  validateLockstepReleaseState
} from "./release-workspace-state.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

test("the repository keeps every public package in one lockstep release group", () => {
  const coreManifest = JSON.parse(
    readFileSync(join(repositoryRoot, "packages", "core", "package.json"), "utf8")
  );
  const packages = assertLockstepWorkspaceState({
    releaseVersion: coreManifest.version,
    root: repositoryRoot
  });

  assert.ok(packages.length > 0);
  assert.equal(new Set(packages.map(({ name }) => name)).size, packages.length);
});

test("reports fixed-group omissions and version drift together", () => {
  const packages = [
    packageEntry("core", "0.1.0-alpha.6"),
    packageEntry("multiplayer-core", "0.1.0-alpha.5")
  ];
  const issues = validateLockstepReleaseState({
    changesetConfig: {
      fixed: [["@gamekits/core"]],
      ignore: []
    },
    packages,
    releaseVersion: "0.1.0-alpha.6"
  });

  assert.deepEqual(issues, [
    "@gamekits/multiplayer-core has version 0.1.0-alpha.5; expected 0.1.0-alpha.6.",
    "Publishable packages missing from the lockstep fixed group: @gamekits/multiplayer-core."
  ]);
});

test("rejects publishable packages that are ignored or outside the package scope", () => {
  const packages = [
    packageEntry("core", "0.1.0-alpha.6"),
    {
      ...packageEntry("audio-core", "0.1.0-alpha.6"),
      name: "audio-core"
    }
  ];
  const issues = validateLockstepReleaseState({
    changesetConfig: {
      fixed: [["@gamekits/core", "audio-core"]],
      ignore: ["@gamekits/core"]
    },
    packages,
    releaseVersion: "0.1.0-alpha.6"
  });

  assert.deepEqual(issues, [
    "packages/audio-core/package.json must be named @gamekits/audio-core; found audio-core.",
    "Publishable packages cannot be ignored by Changesets: @gamekits/core."
  ]);
});

test("reads only public workspace packages", () => {
  const root = temporaryRoot();
  writeWorkspacePackage(root, "core", {
    name: "@gamekits/core",
    private: false,
    version: "0.1.0-alpha.6"
  });
  writeWorkspacePackage(root, "platform-tauri", {
    name: "@gamekits/platform-tauri",
    private: true,
    version: "0.1.0"
  });

  assert.deepEqual(
    readPublishableWorkspacePackages(root).map(({ name, slug, version }) => ({
      name,
      slug,
      version
    })),
    [{ name: "@gamekits/core", slug: "core", version: "0.1.0-alpha.6" }]
  );
});

test("validates prepared package versions, internal dependencies, and tarballs", () => {
  const root = temporaryRoot();
  const packageDir = join(root, "packages", "app-host");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        dependencies: { "@gamekits/core": "0.1.0-alpha.5" },
        name: "@gamekits/app-host",
        version: "0.1.0-alpha.5"
      },
      null,
      2
    )}\n`
  );

  assert.throws(
    () =>
      assertPreparedReleaseState({
        packageSlugs: ["app-host"],
        releaseDir: root,
        releaseVersion: "0.1.0-alpha.6"
      }),
    (error) => {
      assert.match(error.message, /prepared version is 0\.1\.0-alpha\.5/);
      assert.match(error.message, /dependencies\.@gamekits\/core is 0\.1\.0-alpha\.5/);
      assert.match(error.message, /Missing prepared tarball/);
      return true;
    }
  );
});

function packageEntry(slug, version) {
  return {
    manifest: {},
    manifestPath: `packages/${slug}/package.json`,
    name: `@gamekits/${slug}`,
    publicName: `@gamekits/${slug}`,
    slug,
    version
  };
}

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "gamekits-release-state-"));
  temporaryRoots.push(root);
  return root;
}

function writeWorkspacePackage(root, slug, manifest) {
  const packageDir = join(root, "packages", slug);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
