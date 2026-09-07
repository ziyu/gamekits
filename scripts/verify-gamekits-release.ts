import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLockstepWorkspaceState,
  assertPreparedReleaseState
} from "./release-workspace-state.mjs";

type PackageManifest = {
  name: string;
  version: string;
  private?: boolean;
  type?: string;
  main?: string;
  types?: string;
  exports?: unknown;
  repository?: {
    type: "git";
    url: string;
    directory?: string;
  };
  sideEffects?: boolean | string[];
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  optionalDependencies?: Record<string, string>;
  optionalPeerDependencies?: Record<string, string>;
};

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseRepositoryUrl = "https://github.com/ziyu/gamekits";
const workspaceVersion = (
  JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8")) as PackageManifest
).version;
const releaseVersion = process.env.GAMEKITS_RELEASE_VERSION ?? workspaceVersion;
assertLockstepWorkspaceState({ releaseVersion, root });
const releaseDir =
  process.env.GAMEKITS_RELEASE_DIR ?? mkdtempSync(join(tmpdir(), "gamekits-release-"));
const shouldCleanReleaseDir = process.env.GAMEKITS_RELEASE_DIR === undefined;
const commandEnv = {
  ...process.env,
  npm_config_cache: join(releaseDir, "npm-cache"),
  npm_config_logs_dir: join(releaseDir, "npm-logs")
};

const wave1PackageSlugs = [
  "core",
  "event-bus",
  "world",
  "platform-core",
  "renderer-core",
  "world-koota",
  "game-runtime",
  "data",
  "save",
  "tca",
  "gas",
  "multiplayer-core",
  "multiplayer-memory",
  "multiplayer-colyseus",
  "test-utils"
];

const wave2SupportPackageSlugs = wave1PackageSlugs.filter(
  (slug) => !["world-koota", "test-utils"].includes(slug)
);

const wave2PackageSlugs = [
  "save-indexeddb",
  "input-core",
  "camera-core",
  "physics-core",
  "physics-rapier2d",
  "physics-rapier3d",
  "driver-core",
  "devtools",
  "ui-core",
  "asset",
  "platform-web",
  "input-dom",
  "renderer-phaser",
  "driver-phaser",
  "driver-three",
  "app-host"
];

const wave3SupportPackageSlugs = ["core", "devtools", "ui-core"];

const wave3PackageSlugs = ["react-ui", "devtools-ui"];

const allPackageSlugs = discoverPublishablePackageSlugs();

const releaseWave = process.env.GAMEKITS_RELEASE_WAVE ?? "all";
const installOffline = process.env.GAMEKITS_RELEASE_OFFLINE === "1";

const smokeSource = `
import { Clock } from "@gamekits/core";
import { createEventBus } from "@gamekits/event-bus";
import { defineComponent } from "@gamekits/world";
import { createKootaWorld } from "@gamekits/world-koota";
import { createGame } from "@gamekits/game-runtime";
import { createDataRegistry } from "@gamekits/data";
import { createCoreTcaDefinitions, createTcaRuleDataType, createTcaTraceStore } from "@gamekits/tca";
import { GasActor, createGasDataTypes, createGasTraceStore } from "@gamekits/gas";
import { createPlatformServiceRegistry } from "@gamekits/platform-core";
import { createMultiplayerRuntime } from "@gamekits/multiplayer-core";
import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";
import { createColyseusMultiplayerBackend } from "@gamekits/multiplayer-colyseus";
import { GameKitsColyseusRoom } from "@gamekits/multiplayer-colyseus/server";

const clock = new Clock();
clock.start();
clock.tick(16);

const bus = createEventBus({ now: () => 1 });
const events = [];
bus.onAny((event) => events.push(event));
bus.emit("release.smoke", { ok: true }, "verify");

const Position = defineComponent({ id: "position", create: () => ({ x: 0, y: 0 }) });
const world = createKootaWorld();
const entity = world.spawn();
world.add(entity, Position, { x: 1 });
world.add(entity, GasActor, { id: "actor.release-smoke" });

const game = createGame({ modules: [], world, eventBus: bus, seed: "release-smoke" });
game.start();
game.tick(16);
game.dispose();

const data = createDataRegistry();
data.registerType(createTcaRuleDataType());
for (const type of createGasDataTypes()) {
  data.registerType(type);
}

createCoreTcaDefinitions();
createTcaTraceStore();
createGasTraceStore();
createPlatformServiceRegistry();

const multiplayerBackend = createMemoryMultiplayerBackend();
const colyseusBackend = createColyseusMultiplayerBackend({
  endpoint: "ws://127.0.0.1:1",
  roomName: "release_smoke"
});
if (colyseusBackend.kind !== "colyseus" || typeof GameKitsColyseusRoom !== "function") {
  throw new Error("colyseus multiplayer smoke failed");
}
const multiplayerHost = createMultiplayerRuntime({
  id: "release.host",
  backend: multiplayerBackend,
  clock: () => 1
});
const multiplayerClient = createMultiplayerRuntime({
  id: "release.client",
  backend: multiplayerBackend,
  clock: () => 1
});
const multiplayerMessages = [];
multiplayerClient.subscribe((message) => {
  if (message.kind === "game.command") {
    multiplayerMessages.push(message);
  }
});
await multiplayerHost.createSession({
  id: "release.session",
  localPeer: { id: "host" }
});
await multiplayerClient.joinSession({
  sessionId: "release.session",
  localPeer: { id: "client" }
});
await multiplayerHost.send({
  channel: "reliable",
  kind: "game.command",
  payload: { action: "release-smoke" }
});
await multiplayerHost.dispose();
await multiplayerClient.dispose();

if (clock.snapshot().ticks !== 1) throw new Error("clock smoke failed");
if (world.count() !== 1) throw new Error("world smoke failed");
if (events[0]?.type !== "release.smoke") throw new Error("event smoke failed");
if (multiplayerMessages[0]?.kind !== "game.command") throw new Error("multiplayer smoke failed");
console.log("gamekits wave 1 smoke ok");
`;

const wave2BaseSmokeSource = `
import { Clock } from "@gamekits/core";
import { createEventBus } from "@gamekits/event-bus";
import { defineComponent } from "@gamekits/world";
import { createDataRegistry } from "@gamekits/data";
import { createCoreTcaDefinitions, createTcaRuleDataType, createTcaTraceStore } from "@gamekits/tca";
import { createGasDataTypes, createGasTraceStore } from "@gamekits/gas";
import { createPlatformServiceRegistry } from "@gamekits/platform-core";

const clock = new Clock();
clock.start();
clock.tick(16);

const bus = createEventBus({ now: () => 1 });
const events = [];
bus.onAny((event) => events.push(event));
bus.emit("release.wave2.base", { ok: true }, "verify");

defineComponent({ id: "position", create: () => ({ x: 0, y: 0 }) });

const data = createDataRegistry();
data.registerType(createTcaRuleDataType());
for (const type of createGasDataTypes()) {
  data.registerType(type);
}

createCoreTcaDefinitions();
createTcaTraceStore();
createGasTraceStore();
createPlatformServiceRegistry();

if (clock.snapshot().ticks !== 1) throw new Error("clock smoke failed");
if (events[0]?.type !== "release.wave2.base") throw new Error("event smoke failed");
`;

const testUtilsSmokeSource = `
import { describe, expect, it } from "vitest";
import { createEventBus } from "@gamekits/event-bus";
import { createMemoryRenderer, recordEvents } from "@gamekits/test-utils";

describe("@gamekits/test-utils release smoke", () => {
  it("exports vitest-facing helpers", () => {
    const bus = createEventBus({ now: () => 1 });
    const recorder = recordEvents();
    bus.onAny(recorder.push);
    bus.emit("release.test-utils", {}, "verify");

    expect(recorder.types()).toEqual(["release.test-utils"]);
    expect(createMemoryRenderer().id).toBe("memory-renderer");
  });
});
`;

const wave2SmokeSource = `
import { createWebPlatform } from "@gamekits/platform-web";
import { createDriverRegistry } from "@gamekits/driver-core";
import { createPhaserDriver } from "@gamekits/driver-phaser";
import { createThreeDriver } from "@gamekits/driver-three";
import { createInputRouter } from "@gamekits/input-core";
import { createDomInputAdapter } from "@gamekits/input-dom";
import { createCameraController } from "@gamekits/camera-core";
import {
  checkOverlap,
  createMemoryPhysicsBackend,
  createPhysicsDataTypes,
  queryPoint,
  raycast
} from "@gamekits/physics-core";
import { initRapier2dPhysicsBackend } from "@gamekits/physics-rapier2d";
import { initRapier3dPhysicsBackend } from "@gamekits/physics-rapier3d";
import { createAssetManager } from "@gamekits/asset";
import { createMemorySaveStore } from "@gamekits/save";
import { createIndexedDbSaveStore } from "@gamekits/save-indexeddb";
import { createDevToolsRuntime } from "@gamekits/devtools";
import { createUiRuntime as createWave2UiRuntime } from "@gamekits/ui-core";
import { createHeadlessHost, createStandardAppProfile, defineGameApp } from "@gamekits/app-host";

const platform = createWebPlatform({ appName: "GameKits Wave 2 Smoke" });
const indexedDbStore = createIndexedDbSaveStore({
  databaseName: "release-smoke",
  indexedDB: { open() { throw new Error("Lazy store must not open during construction"); } }
});
await indexedDbStore.dispose();
if ((await platform.services.app.name()) !== "GameKits Wave 2 Smoke") {
  throw new Error("platform smoke failed");
}

const phaserDriver = createPhaserDriver({ id: "phaser-smoke" });
const threeDriver = createThreeDriver({ id: "three-smoke" });
const drivers = createDriverRegistry([phaserDriver, threeDriver]);
if (!drivers.has("phaser-smoke") || drivers.require("phaser-smoke").capabilities().renderer !== true) {
  throw new Error("driver smoke failed");
}
if (!drivers.has("three-smoke") || drivers.require("three-smoke").capabilities().assets !== true) {
  throw new Error("three driver smoke failed");
}

const inputRouter = createInputRouter();
let inputCount = 0;
const domTarget = {
  addEventListener() {
    inputCount += 1;
  },
  removeEventListener() {
    inputCount -= 1;
  }
};
const domInput = createDomInputAdapter({
  target: domTarget,
  onInput(input) {
    inputRouter.handle(input);
  },
  scope: "game",
  clock: () => 1
});
domInput.start();
domInput.stop();
if (inputCount !== 0) throw new Error("dom input smoke failed");

const camera = createCameraController({ viewport: { width: 800, height: 600 } });
camera.pan(10, 20);
if (camera.getState().x <= 400) throw new Error("camera smoke failed");

for (const type of createPhysicsDataTypes()) {
  data.registerType(type);
}

function assertPhysicsHit(label, results, colliderId) {
  if (!results.some((hit) => hit.colliderId === colliderId)) {
    throw new Error(\`\${label} smoke failed\`);
  }
}

const memoryPhysics = createMemoryPhysicsBackend({
  id: "memory-physics-smoke",
  dimension: "3d"
});
const memoryPhysicsScene = memoryPhysics.createScene({
  dimension: "3d",
  gravity: { x: 0, y: 0, z: 0 }
});
const memoryPhysicsBody = memoryPhysicsScene.createBody({
  kind: "static",
  position: { x: 1, y: 0, z: 0 }
});
const memoryPhysicsCollider = memoryPhysicsScene.createCollider({
  bodyId: memoryPhysicsBody,
  shape: { type: "sphere", radius: 0.5 },
  filter: { groups: ["actor"], collidesWith: ["query"] }
});
assertPhysicsHit(
  "memory physics point",
  queryPoint(memoryPhysicsScene, { x: 1, y: 0, z: 0 }),
  memoryPhysicsCollider
);
assertPhysicsHit(
  "memory physics raycast",
  raycast(memoryPhysicsScene, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, {
    maxDistance: 5,
    filter: { groups: ["query"], collidesWith: ["actor"] }
  }),
  memoryPhysicsCollider
);
if (!checkOverlap(memoryPhysicsScene, { type: "sphere", radius: 0.25 }, { x: 1, y: 0, z: 0 })) {
  throw new Error("memory physics overlap smoke failed");
}
memoryPhysicsScene.dispose();

const rapier2dPhysics = await initRapier2dPhysicsBackend({ id: "rapier2d-smoke" });
const rapier2dScene = rapier2dPhysics.createScene({ gravity: { x: 0, y: 0 } });
const rapier2dBody = rapier2dScene.createBody({ kind: "static", position: { x: 1, y: 0 } });
const rapier2dCollider = rapier2dScene.createCollider({
  bodyId: rapier2dBody,
  shape: { type: "circle", radius: 0.5 }
});
rapier2dScene.step(1000 / 60);
assertPhysicsHit("rapier2d point", queryPoint(rapier2dScene, { x: 1, y: 0 }), rapier2dCollider);
assertPhysicsHit(
  "rapier2d raycast",
  raycast(rapier2dScene, { x: 0, y: 0 }, { x: 1, y: 0 }, { maxDistance: 5 }),
  rapier2dCollider
);
if (!checkOverlap(rapier2dScene, { type: "circle", radius: 0.25 }, { x: 1, y: 0 })) {
  throw new Error("rapier2d overlap smoke failed");
}
rapier2dScene.dispose();

const rapier3dPhysics = await initRapier3dPhysicsBackend({ id: "rapier3d-smoke" });
const rapier3dScene = rapier3dPhysics.createScene({ gravity: { x: 0, y: 0, z: 0 } });
const rapier3dBody = rapier3dScene.createBody({
  kind: "static",
  position: { x: 1, y: 0, z: 0 }
});
const rapier3dCollider = rapier3dScene.createCollider({
  bodyId: rapier3dBody,
  shape: { type: "sphere", radius: 0.5 }
});
rapier3dScene.step(1000 / 60);
assertPhysicsHit(
  "rapier3d point",
  queryPoint(rapier3dScene, { x: 1, y: 0, z: 0 }),
  rapier3dCollider
);
assertPhysicsHit(
  "rapier3d raycast",
  raycast(rapier3dScene, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { maxDistance: 5 }),
  rapier3dCollider
);
if (!checkOverlap(rapier3dScene, { type: "sphere", radius: 0.25 }, { x: 1, y: 0, z: 0 })) {
  throw new Error("rapier3d overlap smoke failed");
}
rapier3dScene.dispose();

const assets = createAssetManager({
  adapter: {
    id: "wave2-memory-assets",
    supports() {
      return true;
    },
    async load() {
      return undefined;
    }
  }
});
assets.register({ id: "debug-square", type: "image", source: { uri: "debug-square.png" } });
await assets.load("debug-square");

const saveStore = createMemorySaveStore();
await saveStore.write("slot-1", new Uint8Array([1, 2, 3]), { id: "slot-1", label: "Smoke" });
const saveBytes = await saveStore.read("slot-1");
const saveSlots = await saveStore.list();
if (saveBytes[2] !== 3 || saveSlots[0]?.label !== "Smoke") {
  throw new Error("save smoke failed");
}

const devtools = createDevToolsRuntime();
devtools.pushTrace({ kind: "runtime", label: "wave2.smoke", source: "verify" });
if (devtools.snapshot().traces.length !== 1) throw new Error("devtools smoke failed");

const ui = createWave2UiRuntime();
ui.registerPanel({ id: "panel.smoke", kind: "panel", title: "Smoke" });
ui.open("panel.smoke");
if (ui.openPanels().length !== 1) throw new Error("ui smoke failed");

const app = defineGameApp({ id: "wave2-smoke", services: [] });
const profile = createStandardAppProfile({ id: "wave2-profile" });
const host = createHeadlessHost({ id: "wave2-headless" });
if (app.id !== "wave2-smoke" || profile.id !== "wave2-profile" || host.snapshot().phase !== "registered") {
  throw new Error("app-host smoke failed");
}

console.log("gamekits wave 2 smoke ok");
`;

const wave3SmokeSource = `
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createUiRuntime as createWave3UiRuntime } from "@gamekits/ui-core";
import {
  createGameKitsUiAnimator,
  GameKitsUiShell,
  UiPanelHost,
  UiTip
} from "@gamekits/react-ui";
import { createDevToolsRuntime as createWave3DevToolsRuntime } from "@gamekits/devtools";
import {
  createDevToolsUiBridge,
  DevToolsLauncher,
  DevToolsOverlay
} from "@gamekits/devtools-ui";

{
function assertCssExport(specifier) {
  const resolved = import.meta.resolve(specifier);
  if (!resolved.endsWith("/dist/styles.css")) {
    throw new Error(\`Unexpected CSS export for \${specifier}: \${resolved}\`);
  }
}

assertCssExport("@gamekits/react-ui/styles.css");
assertCssExport("@gamekits/devtools-ui/styles.css");

const ui = createWave3UiRuntime();
ui.registerPanel({ id: "actor", title: "Actor", kind: "panel" });
ui.open("actor", { actorId: "a" });

const shellHtml = renderToStaticMarkup(
  createElement(
    GameKitsUiShell,
    { runtime: ui },
    createElement(UiPanelHost, {
      renderPanel: (panel) => createElement("span", null, String(panel.props))
    })
  )
);

if (!shellHtml.includes('data-ui-panel="actor"') || !shellHtml.includes("Actor")) {
  throw new Error("react-ui shell smoke failed");
}

const tipHtml = renderToStaticMarkup(
  createElement(UiTip, { content: "Runtime focus scope" }, createElement("button", null, "?"))
);
if (!tipHtml.includes('role="tooltip"')) throw new Error("react-ui tip smoke failed");

const animator = createGameKitsUiAnimator({ reducedMotion: true });
if (typeof animator.enter !== "function" || typeof animator.exit !== "function") {
  throw new Error("react-ui animator smoke failed");
}

const devtools = createWave3DevToolsRuntime();
const devtoolsUi = createWave3UiRuntime();
const bridge = createDevToolsUiBridge({ devtools, ui: devtoolsUi });
bridge.openShell();
if (!bridge.snapshot().shell.open) throw new Error("devtools-ui bridge smoke failed");

const launcherHtml = renderToStaticMarkup(
  createElement(DevToolsLauncher, { runtime: devtools, uiRuntime: devtoolsUi, label: "Inspect" })
);
if (!launcherHtml.includes("gamekits-devtools-launcher")) {
  throw new Error("devtools-ui launcher smoke failed");
}

devtools.registerPanel({ id: "app.chain", label: "App Chain" });
const overlayHtml = renderToStaticMarkup(
  createElement(DevToolsOverlay, {
    runtime: devtools,
    uiRuntime: devtoolsUi,
    renderPanel: () => createElement("section", null, "Custom Chain Panel")
  })
);
if (!overlayHtml.includes("Custom Chain Panel")) {
  throw new Error("devtools-ui overlay smoke failed");
}

console.log("gamekits wave 3 smoke ok");
}
`;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function readWorkspacePackageManifest(slug: string): PackageManifest {
  const manifestPath = join(root, "packages", slug, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Unknown GameKits package: ${slug}`);
  }

  return JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
}

function discoverPublishablePackageSlugs(): string[] {
  return readdirSync(join(root, "packages"))
    .filter((slug) => {
      const manifestPath = join(root, "packages", slug, "package.json");
      if (!existsSync(manifestPath)) {
        return false;
      }

      return (JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest).private !== true;
    })
    .sort();
}

function workspaceDependencySlugs(manifest: PackageManifest): string[] {
  return unique(
    [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.optionalPeerDependencies ?? {})
    ]
      .filter((name) => name.startsWith("@gamekits/"))
      .map((name) => name.slice("@gamekits/".length))
  );
}

function resolveWorkspacePackageClosure(packageSlugs: string[]): string[] {
  const resolved: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (slug: string): void => {
    if (visited.has(slug)) {
      return;
    }
    if (visiting.has(slug)) {
      throw new Error(`Circular GameKits package dependency detected at ${slug}`);
    }

    const manifest = readWorkspacePackageManifest(slug);
    if (manifest.private === true) {
      throw new Error(`Cannot include private GameKits package in release verification: ${slug}`);
    }

    visiting.add(slug);
    for (const dependencySlug of workspaceDependencySlugs(manifest)) {
      visit(dependencySlug);
    }
    visiting.delete(slug);
    visited.add(slug);
    resolved.push(slug);
  };

  for (const slug of unique(packageSlugs)) {
    visit(slug);
  }

  return resolved;
}

function resolvePackageSlugs(): string[] {
  const explicitPackages = process.env.GAMEKITS_RELEASE_PACKAGES;
  if (explicitPackages) {
    return resolveWorkspacePackageClosure(
      unique(
        explicitPackages
          .split(",")
          .map((slug) => slug.trim())
          .filter(Boolean)
      )
    );
  }

  if (releaseWave === "2") {
    return resolveWorkspacePackageClosure([...wave2SupportPackageSlugs, ...wave2PackageSlugs]);
  }

  if (releaseWave === "3") {
    return resolveWorkspacePackageClosure([...wave3SupportPackageSlugs, ...wave3PackageSlugs]);
  }

  if (releaseWave === "all") {
    return resolveWorkspacePackageClosure(allPackageSlugs);
  }

  if (releaseWave !== "1") {
    throw new Error(`Unknown GAMEKITS_RELEASE_WAVE: ${releaseWave}`);
  }

  return resolveWorkspacePackageClosure(wave1PackageSlugs);
}

function resolveSmokeSource(): string {
  if (releaseWave === "2") {
    return `${wave2BaseSmokeSource}\n${wave2SmokeSource}`;
  }

  if (releaseWave === "3") {
    return wave3SmokeSource;
  }

  if (releaseWave === "all") {
    return `${wave2BaseSmokeSource}\n${wave2SmokeSource}\n${wave3SmokeSource}`;
  }

  return smokeSource;
}

function shouldRunTestUtilsSmoke(packageSlugs: string[]): boolean {
  if (!packageSlugs.includes("test-utils")) {
    return false;
  }

  return (
    process.env.GAMEKITS_RUN_TEST_UTILS_SMOKE === "1" ||
    releaseWave === "1" ||
    releaseWave === "all"
  );
}

function run(command: string, args: string[], cwd = root): string {
  return execFileSync(command, args, {
    cwd,
    env: commandEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function runInherit(command: string, args: string[], cwd = root): void {
  execFileSync(command, args, {
    cwd,
    env: commandEnv,
    stdio: "inherit"
  });
}

function workspaceName(slug: string): string {
  return `@gamekits/${slug}`;
}

function mapDependencies(dependencies: Record<string, string> | undefined) {
  if (!dependencies) {
    return undefined;
  }

  const mapped = Object.fromEntries(
    Object.entries(dependencies).map(([name, range]) => {
      if (name.startsWith("@gamekits/")) {
        return [name, releaseVersion];
      }

      return [name, range];
    })
  );

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function rewritePackageScope(path: string): void {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      rewritePackageScope(join(path, entry));
    }
    return;
  }

  if (!/\.(js|mjs|cjs|d\.ts|map)$/.test(path)) {
    return;
  }

  const current = readFileSync(path, "utf8");
  const next = current.replaceAll("@gamekits/", "@gamekits/");
  if (next !== current) {
    writeFileSync(path, next);
  }
}

function removeBuildInfo(path: string): void {
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
}

function listFiles(path: string): string[] {
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    return [path];
  }

  return readdirSync(path).flatMap((entry) => listFiles(join(path, entry)));
}

function assertNoLegacyScope(path: string): void {
  const offenders = listFiles(path).filter((file) => {
    if (!/\.(js|mjs|cjs|d\.ts|map|json)$/.test(file)) {
      return false;
    }

    return /@gamekit\//.test(readFileSync(file, "utf8"));
  });

  if (offenders.length > 0) {
    throw new Error(
      `Publish artifacts still reference @gamekit/*:\n${offenders
        .map((file) => relative(root, file))
        .join("\n")}`
    );
  }
}

function assertTarballContents(tarball: string): void {
  const contents = run("tar", ["-tf", tarball]).trim().split("\n");
  const forbiddenEntries = contents.filter(
    (entry) =>
      [
        "package/src/",
        "package/test/",
        "package/apps/",
        "package/.turbo/",
        "package/node_modules/"
      ].some((prefix) => entry.startsWith(prefix)) || entry.endsWith(".tsbuildinfo")
  );

  if (forbiddenEntries.length > 0) {
    throw new Error(`Unexpected files in ${tarball}:\n${forbiddenEntries.join("\n")}`);
  }
}

function assertPublishManifest(manifest: PackageManifest, slug: string): void {
  if (manifest.repository?.url !== releaseRepositoryUrl) {
    throw new Error(
      `${manifest.name} publish manifest repository.url must be ${releaseRepositoryUrl} for npm provenance.`
    );
  }

  if (manifest.repository.directory !== `packages/${slug}`) {
    throw new Error(
      `${manifest.name} publish manifest repository.directory must be packages/${slug}.`
    );
  }
}

function preparePackage(slug: string, packagesDir: string): string {
  const sourceDir = join(root, "packages", slug);
  const manifestPath = join(sourceDir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
  const targetDir = join(packagesDir, slug);
  const sourceDist = join(sourceDir, "dist");
  const targetDist = join(targetDir, "dist");

  if (manifest.version !== releaseVersion) {
    throw new Error(
      `${manifest.name} has workspace version ${manifest.version}; expected lockstep release version ${releaseVersion}.`
    );
  }

  if (!existsSync(sourceDist)) {
    throw new Error(`Missing dist for ${manifest.name}. Run build before release verification.`);
  }

  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDist, targetDist, { recursive: true });
  removeBuildInfo(targetDist);
  rewritePackageScope(targetDist);

  const publishManifest: PackageManifest & {
    files: string[];
    publishConfig: { access: "public" };
  } = {
    name: manifest.name,
    version: releaseVersion,
    type: manifest.type,
    main: manifest.main,
    types: manifest.types,
    exports: manifest.exports,
    repository: {
      type: "git",
      url: releaseRepositoryUrl,
      directory: `packages/${slug}`
    },
    files: ["dist"],
    sideEffects: manifest.sideEffects ?? false,
    publishConfig: { access: "public" },
    dependencies: mapDependencies(manifest.dependencies),
    peerDependencies: mapDependencies(manifest.peerDependencies),
    peerDependenciesMeta: manifest.peerDependenciesMeta,
    optionalDependencies: mapDependencies(manifest.optionalDependencies),
    optionalPeerDependencies: mapDependencies(manifest.optionalPeerDependencies)
  };

  for (const key of [
    "dependencies",
    "peerDependencies",
    "peerDependenciesMeta",
    "optionalDependencies",
    "optionalPeerDependencies"
  ] as const) {
    if (publishManifest[key] === undefined) {
      delete publishManifest[key];
    }
  }

  assertPublishManifest(publishManifest, slug);
  writeJson(join(targetDir, "package.json"), publishManifest);
  assertNoLegacyScope(targetDir);

  return targetDir;
}

try {
  const packageSlugs = resolvePackageSlugs();
  const packagesDir = join(releaseDir, "packages");
  const packDir = join(releaseDir, "tarballs");
  const consumerDir = join(releaseDir, "consumer");
  rmSync(packagesDir, { recursive: true, force: true });
  rmSync(packDir, { recursive: true, force: true });
  rmSync(consumerDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  for (const slug of packageSlugs) {
    runInherit("corepack", ["pnpm", "--filter", workspaceName(slug), "build"]);
  }

  const preparedDirs = packageSlugs.map((slug) => preparePackage(slug, packagesDir));
  const tarballs = preparedDirs.map((preparedDir) => {
    const output = run("npm", ["pack", "--pack-destination", packDir], preparedDir).trim();
    const tarball = join(packDir, output.split("\n").at(-1)!);
    assertTarballContents(tarball);
    return tarball;
  });
  assertPreparedReleaseState({
    packageSlugs,
    releaseDir,
    releaseVersion
  });

  const localTarballDependencies = Object.fromEntries(
    packageSlugs.map((slug, index) => [workspaceName(slug), `file:${tarballs[index]!}`])
  );
  const runTestUtilsSmoke = shouldRunTestUtilsSmoke(packageSlugs);

  writeJson(join(consumerDir, "package.json"), {
    name: `gamekits-wave-${releaseWave}-release-smoke`,
    private: true,
    type: "module",
    dependencies: {
      ...localTarballDependencies,
      ...(releaseWave === "3" || releaseWave === "all"
        ? { react: "^18.3.1", "react-dom": "^18.3.1" }
        : {}),
      ...(runTestUtilsSmoke ? { vitest: "^3.1.3" } : {})
    }
  });
  writeFileSync(
    join(consumerDir, ".pnpmfile.cjs"),
    `const localPackages = ${JSON.stringify(localTarballDependencies, null, 2)};

function rewriteDependencies(dependencies) {
  if (!dependencies) return;
  for (const [name, specifier] of Object.entries(localPackages)) {
    if (dependencies[name]) {
      dependencies[name] = specifier;
    }
  }
}

module.exports = {
  hooks: {
    readPackage(pkg) {
      rewriteDependencies(pkg.dependencies);
      rewriteDependencies(pkg.peerDependencies);
      rewriteDependencies(pkg.optionalDependencies);
      return pkg;
    }
  }
};
`
  );
  writeFileSync(join(consumerDir, "smoke.mjs"), resolveSmokeSource());
  writeFileSync(join(consumerDir, "test-utils-smoke.test.mjs"), testUtilsSmokeSource);

  runInherit(
    "corepack",
    [
      "pnpm",
      "install",
      "--ignore-scripts",
      ...(installOffline ? ["--offline"] : []),
      "--registry",
      "https://registry.npmjs.org/"
    ],
    consumerDir
  );
  runInherit("node", ["smoke.mjs"], consumerDir);
  if (runTestUtilsSmoke) {
    runInherit(
      "corepack",
      ["pnpm", "exec", "vitest", "run", "test-utils-smoke.test.mjs"],
      consumerDir
    );
  }

  console.log(`Verified @gamekits wave ${releaseWave} release artifacts in ${releaseDir}`);
} finally {
  if (shouldCleanReleaseDir) {
    rmSync(releaseDir, { recursive: true, force: true });
  }
}
