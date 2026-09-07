import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const internalWorkspaceScope = "@gamekits/";
const publicPackageScope = "@gamekits/";

export function readPublishableWorkspacePackages(root) {
  const packagesDir = join(root, "packages");

  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = join(packagesDir, entry.name, "package.json");
      if (!existsSync(manifestPath)) {
        return undefined;
      }

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.private === true) {
        return undefined;
      }

      return {
        manifest,
        manifestPath,
        name: manifest.name,
        publicName:
          typeof manifest.name === "string" ? publicPackageName(manifest.name) : manifest.name,
        slug: entry.name,
        version: manifest.version
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

export function validateLockstepReleaseState({ changesetConfig, packages, releaseVersion }) {
  const issues = [];
  const packageNames = packages.map((entry) => entry.name);
  const publishableNames = new Set(packageNames);

  if (packages.length === 0) {
    issues.push("No publishable packages were found under packages/.");
  }

  const duplicatePackageNames = duplicates(packageNames.filter((name) => typeof name === "string"));
  if (duplicatePackageNames.length > 0) {
    issues.push(`Duplicate publishable package names: ${duplicatePackageNames.join(", ")}.`);
  }

  for (const entry of packages) {
    const expectedName = `${internalWorkspaceScope}${entry.slug}`;
    if (entry.name !== expectedName) {
      issues.push(
        `${entry.manifestPath} must be named ${expectedName}; found ${String(entry.name)}.`
      );
    }
    if (entry.version !== releaseVersion) {
      issues.push(
        `${entry.name ?? entry.slug} has version ${String(entry.version)}; expected ${releaseVersion}.`
      );
    }
  }

  const fixedGroups = Array.isArray(changesetConfig.fixed)
    ? changesetConfig.fixed.filter(Array.isArray)
    : [];
  if (fixedGroups.length !== 1) {
    issues.push(
      `Changesets must define exactly one lockstep fixed group; found ${fixedGroups.length}.`
    );
  }

  const fixedNames = fixedGroups.flat().filter((name) => typeof name === "string");
  const fixedNameSet = new Set(fixedNames);
  const duplicateFixedNames = duplicates(fixedNames);
  if (duplicateFixedNames.length > 0) {
    issues.push(
      `Duplicate package names in Changesets fixed groups: ${duplicateFixedNames.join(", ")}.`
    );
  }

  const missingFromFixed = packageNames
    .filter((name) => typeof name === "string" && !fixedNameSet.has(name))
    .sort();
  if (missingFromFixed.length > 0) {
    issues.push(
      `Publishable packages missing from the lockstep fixed group: ${missingFromFixed.join(", ")}.`
    );
  }

  const unexpectedFixed = [...fixedNameSet].filter((name) => !publishableNames.has(name)).sort();
  if (unexpectedFixed.length > 0) {
    issues.push(
      `Non-publishable packages in the lockstep fixed group: ${unexpectedFixed.join(", ")}.`
    );
  }

  const ignoredPublishable = (Array.isArray(changesetConfig.ignore) ? changesetConfig.ignore : [])
    .filter((name) => publishableNames.has(name))
    .sort();
  if (ignoredPublishable.length > 0) {
    issues.push(
      `Publishable packages cannot be ignored by Changesets: ${ignoredPublishable.join(", ")}.`
    );
  }

  return issues;
}

export function assertLockstepWorkspaceState({ root, releaseVersion }) {
  const packages = readPublishableWorkspacePackages(root);
  const changesetConfig = JSON.parse(readFileSync(join(root, ".changeset", "config.json"), "utf8"));
  const issues = validateLockstepReleaseState({ changesetConfig, packages, releaseVersion });

  if (issues.length > 0) {
    throw new Error(`Invalid lockstep release state:\n- ${issues.join("\n- ")}`);
  }

  return packages;
}

export function assertPreparedReleaseState({ packageSlugs, releaseDir, releaseVersion }) {
  const issues = [];
  const uniqueSlugs = [...new Set(packageSlugs)].sort();

  if (uniqueSlugs.length !== packageSlugs.length) {
    issues.push("Prepared release package slugs must not contain duplicates.");
  }

  for (const slug of uniqueSlugs) {
    const manifestPath = join(releaseDir, "packages", slug, "package.json");
    const tarballPath = join(releaseDir, "tarballs", `gamekits-${slug}-${releaseVersion}.tgz`);
    if (!existsSync(manifestPath)) {
      issues.push(`Missing prepared manifest for ${slug}: ${manifestPath}.`);
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const expectedName = `${publicPackageScope}${slug}`;
    if (manifest.name !== expectedName) {
      issues.push(`${manifestPath} must be named ${expectedName}; found ${String(manifest.name)}.`);
    }
    if (manifest.version !== releaseVersion) {
      issues.push(
        `${manifest.name ?? slug} prepared version is ${String(manifest.version)}; expected ${releaseVersion}.`
      );
    }

    for (const field of [
      "dependencies",
      "peerDependencies",
      "optionalDependencies",
      "optionalPeerDependencies"
    ]) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (name.startsWith(publicPackageScope) && range !== releaseVersion) {
          issues.push(`${manifest.name} ${field}.${name} is ${range}; expected ${releaseVersion}.`);
        }
      }
    }

    if (!existsSync(tarballPath)) {
      issues.push(`Missing prepared tarball for ${manifest.name ?? slug}: ${tarballPath}.`);
    }
  }

  if (issues.length > 0) {
    throw new Error(`Invalid prepared release state:\n- ${issues.join("\n- ")}`);
  }
}

export function publicPackageName(name) {
  return name.replace(/^@gamekits\//, publicPackageScope);
}

function duplicates(values) {
  const seen = new Set();
  const duplicateValues = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicateValues.add(value);
    }
    seen.add(value);
  }
  return [...duplicateValues].sort();
}
