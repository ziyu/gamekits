import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { assertLockstepWorkspaceState } from "./release-workspace-state.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const coreVersion = JSON.parse(
  readFileSync(join(root, "packages", "core", "package.json"), "utf8")
).version;
assertLockstepWorkspaceState({ releaseVersion: coreVersion, root });
const changesetDir = join(root, ".changeset");
const config = JSON.parse(readFileSync(join(changesetDir, "config.json"), "utf8"));
const ignoredPackages = new Set(config.ignore ?? []);
const prNumber = process.env.AUTO_CHANGESET_PR_NUMBER?.trim();
const title = firstLine(process.env.AUTO_CHANGESET_TITLE ?? git(["log", "-1", "--pretty=%s"]));
const body = process.env.AUTO_CHANGESET_BODY ?? "";
const labels = new Set(
  (process.env.AUTO_CHANGESET_LABELS ?? "")
    .split(",")
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean)
);
const baseRef = process.env.AUTO_CHANGESET_BASE_REF ?? "HEAD^";
const autoFile = join(
  changesetDir,
  `${prNumber ? `auto-pr-${prNumber}` : `auto-${shortHash(title)}`}.md`
);

if (isVersionChange(title)) {
  console.log("Skipping auto changeset for version commit.");
  process.exit(0);
}

const packageBySlug = loadWorkspacePackages();
const changedFiles = git(["diff", "--name-only", baseRef, "HEAD", "--"])
  .split("\n")
  .map((file) => file.trim())
  .filter(Boolean);
const changedChangesets = changedFiles.filter(isChangesetFile);
const manualChangesets = changedChangesets.filter((file) => join(root, file) !== autoFile);

if (manualChangesets.length > 0) {
  console.log(`Manual changeset detected: ${manualChangesets.join(", ")}`);
  removeAutoChangeset();
  process.exit(0);
}

const affectedPackages = resolveAffectedPackages(changedFiles, packageBySlug);
if (affectedPackages.length === 0) {
  console.log("No publishable package changes detected for auto changeset.");
  removeAutoChangeset();
  process.exit(0);
}

mkdirSync(changesetDir, { recursive: true });

const bump = resolveBump();
const summary = resolveSummary();
const content = [
  "---",
  ...affectedPackages.map((name) => `"${name}": ${bump}`),
  "---",
  "",
  summary,
  ""
].join("\n");

if (existsSync(autoFile) && readFileSync(autoFile, "utf8") === content) {
  console.log(`Auto changeset is up to date: ${relativePath(autoFile)}`);
  process.exit(0);
}

writeFileSync(autoFile, content);
console.log(`Wrote auto changeset: ${relativePath(autoFile)}`);

function loadWorkspacePackages() {
  const packagesDir = join(root, "packages");
  const packages = new Map();

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest.name || manifest.private || ignoredPackages.has(manifest.name)) continue;

    packages.set(entry.name, manifest.name);
  }

  return packages;
}

function resolveAffectedPackages(files, packages) {
  const names = new Set();

  for (const file of files) {
    const match = /^packages\/([^/]+)\/(.+)$/.exec(file);
    if (!match) continue;

    const [, slug, packageFile] = match;
    const packageName = packages.get(slug);
    if (!packageName || !isReleaseRelevantPackageFile(file, packageFile)) continue;

    names.add(packageName);
  }

  return [...names].sort();
}

function isReleaseRelevantPackageFile(file, packageFile) {
  if (packageFile.startsWith("src/")) return true;
  if (packageFile === "README.md") return true;
  if (packageFile !== "package.json") return false;

  const changedLines = git(["diff", "-U0", baseRef, "HEAD", "--", file])
    .split("\n")
    .filter((line) => /^[+-]\s*"/.test(line))
    .map((line) => line.slice(1).trim());

  return changedLines.some((line) => !/^"version":\s*"/.test(line));
}

function isChangesetFile(file) {
  return file.startsWith(".changeset/") && file.endsWith(".md") && file !== ".changeset/README.md";
}

function resolveBump() {
  if (hasAnyLabel("changeset:major", "semver-major", "release:major")) return "major";
  if (hasAnyLabel("changeset:minor", "semver-minor", "release:minor")) return "minor";
  if (hasAnyLabel("changeset:patch", "semver-patch", "release:patch")) return "patch";
  if (/^[a-z]+(?:\([^)]+\))?!:/.test(title) || /BREAKING CHANGE:/i.test(body)) return "major";
  if (/^feat(?:\([^)]+\))?:/i.test(title)) return "minor";

  return "patch";
}

function hasAnyLabel(...candidates) {
  return candidates.some((candidate) => labels.has(candidate));
}

function resolveSummary() {
  const cleanTitle = title.replace(/^changeset:\s*/i, "").trim();
  if (cleanTitle) return cleanTitle;
  if (prNumber) return `Update GameKits packages from PR #${prNumber}.`;
  return "Update GameKits packages.";
}

function removeAutoChangeset() {
  if (!existsSync(autoFile)) return;

  unlinkSync(autoFile);
  console.log(`Removed auto changeset: ${relativePath(autoFile)}`);
}

function isVersionChange(value) {
  return /^Version GameKits packages\b/.test(firstLine(value));
}

function shortHash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function firstLine(value) {
  return value.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function relativePath(path) {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}
