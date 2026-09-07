import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workDir = mkdtempSync(join(tmpdir(), "gamekits-core-release-"));
const packDir = join(workDir, "pack");
const consumerDir = join(workDir, "consumer");

function run(command: string, args: string[], cwd = root): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

try {
  mkdirSync(packDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  run("corepack", ["pnpm", "--filter", "@gamekits/core", "pack", "--pack-destination", packDir]);

  const tarballs = run("find", [packDir, "-maxdepth", "1", "-name", "*.tgz"])
    .trim()
    .split("\n")
    .filter(Boolean);

  if (tarballs.length !== 1) {
    throw new Error(`Expected one core tarball, found ${tarballs.length}`);
  }

  const tarball = tarballs[0]!;
  const tarballContents = run("tar", ["-tf", tarball]).trim().split("\n");
  const forbiddenEntries = tarballContents.filter(
    (entry) =>
      [
        "package/src/",
        "package/test/",
        "package/.turbo/",
        "package/apps/",
        "package/node_modules/"
      ].some((prefix) => entry.startsWith(prefix)) || entry.endsWith(".tsbuildinfo")
  );

  if (forbiddenEntries.length > 0) {
    throw new Error(`Unexpected files in tarball:\n${forbiddenEntries.join("\n")}`);
  }

  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify(
      {
        name: "gamekits-core-release-smoke",
        private: true,
        type: "module"
      },
      null,
      2
    )
  );

  run("corepack", ["pnpm", "add", tarball], consumerDir);

  run(
    "node",
    [
      "--input-type=module",
      "-e",
      [
        "import { Clock, Registry, createSeededRng } from '@gamekits/core';",
        "const clock = new Clock();",
        "clock.start();",
        "clock.tick(16);",
        "const registry = new Registry();",
        "registry.register('rng', createSeededRng('release-smoke'));",
        "if (clock.snapshot().ticks !== 1 || !registry.has('rng')) throw new Error('smoke failed');"
      ].join("")
    ],
    consumerDir
  );

  console.log(`Verified @gamekits/core release tarball: ${tarball}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
