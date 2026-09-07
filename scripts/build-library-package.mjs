import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const packageRoot = process.cwd();
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const shouldBundleDts = manifest.gamekitsBuild?.bundleDts !== false;
const copyEntries = manifest.gamekitsBuild?.copy ?? [];
const entryPoints = manifest.gamekitsBuild?.entries ?? ["src/index.ts"];

function removeBuildInfo(path) {
  try {
    const stat = statSync(path);
    if (!stat.isDirectory()) {
      if (path.endsWith(".tsbuildinfo")) {
        rmSync(path, { force: true });
      }
      return;
    }

    for (const entry of readdirSync(path)) {
      removeBuildInfo(join(path, entry));
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function copyConfiguredFiles() {
  for (const entry of copyEntries) {
    if (!entry?.from || !entry?.to) {
      throw new Error("gamekitsBuild.copy entries must include from and to.");
    }

    const target = join(packageRoot, entry.to);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(packageRoot, entry.from), target, { recursive: true });
  }
}

const externalDependencies = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
  ...Object.keys(manifest.optionalDependencies ?? {})
]);

rmSync(join(packageRoot, "dist"), { recursive: true, force: true });
removeBuildInfo(packageRoot);

execFileSync(
  "tsc",
  [
    "-p",
    "tsconfig.json",
    ...(shouldBundleDts ? ["--noEmit"] : ["--emitDeclarationOnly"]),
    "--ignoreDeprecations",
    "5.0"
  ],
  {
    cwd: packageRoot,
    stdio: "inherit"
  }
);

removeBuildInfo(packageRoot);

execFileSync(
  "tsdown",
  [
    ...entryPoints,
    "--format",
    "esm",
    "--target",
    "es2022",
    "--platform",
    "neutral",
    "--out-dir",
    "dist",
    ...(shouldBundleDts ? ["--dts", "--clean"] : ["--no-dts", "--no-clean"]),
    ...[...externalDependencies].flatMap((dependency) => ["--deps.never-bundle", dependency])
  ],
  {
    cwd: packageRoot,
    stdio: "inherit"
  }
);

removeBuildInfo(packageRoot);
copyConfiguredFiles();
