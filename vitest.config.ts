import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"]
    }
  },
  resolve: {
    alias: {
      "@gamekits/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@gamekits/world": new URL("./packages/world/src/index.ts", import.meta.url).pathname,
      "@gamekits/world-koota": new URL("./packages/world-koota/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/event-bus": new URL("./packages/event-bus/src/index.ts", import.meta.url).pathname,
      "@gamekits/game-runtime": new URL("./packages/game-runtime/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/data": new URL("./packages/data/src/index.ts", import.meta.url).pathname,
      "@gamekits/driver-core": new URL("./packages/driver-core/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/driver-phaser": new URL("./packages/driver-phaser/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/driver-three": new URL("./packages/driver-three/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/asset": new URL("./packages/asset/src/index.ts", import.meta.url).pathname,
      "@gamekits/app-host": new URL("./packages/app-host/src/index.ts", import.meta.url).pathname,
      "@gamekits/tca": new URL("./packages/tca/src/index.ts", import.meta.url).pathname,
      "@gamekits/gas": new URL("./packages/gas/src/index.ts", import.meta.url).pathname,
      "@gamekits/combat": new URL("./packages/combat/src/index.ts", import.meta.url).pathname,
      "@gamekits/ai-core/testing": new URL(
        "./packages/ai-core/src/testing/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/ai-core": new URL("./packages/ai-core/src/index.ts", import.meta.url).pathname,
      "@gamekits/animator-core/playback": new URL(
        "./packages/animator-core/src/playback/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/animator-core/testing": new URL(
        "./packages/animator-core/src/testing/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/animator-core": new URL("./packages/animator-core/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/audio-core/backend": new URL(
        "./packages/audio-core/src/backend/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/audio-core/testing": new URL(
        "./packages/audio-core/src/testing/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/audio-core": new URL("./packages/audio-core/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/navigation-core/backend": new URL(
        "./packages/navigation-core/src/backend/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/navigation-core/testing": new URL(
        "./packages/navigation-core/src/testing/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/navigation-core": new URL(
        "./packages/navigation-core/src/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/navigation-graph": new URL(
        "./packages/navigation-graph/src/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/navigation-grid": new URL(
        "./packages/navigation-grid/src/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/navigation-navmesh": new URL(
        "./packages/navigation-navmesh/src/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/navigation-recast": new URL(
        "./packages/navigation-recast/src/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/multiplayer-core": new URL(
        "./packages/multiplayer-core/src/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/multiplayer-memory": new URL(
        "./packages/multiplayer-memory/src/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/multiplayer-colyseus/server": new URL(
        "./packages/multiplayer-colyseus/src/server/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/multiplayer-colyseus": new URL(
        "./packages/multiplayer-colyseus/src/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/ui-core": new URL("./packages/ui-core/src/index.ts", import.meta.url).pathname,
      "@gamekits/react-ui": new URL("./packages/react-ui/src/index.ts", import.meta.url).pathname,
      "@gamekits/save": new URL("./packages/save/src/index.ts", import.meta.url).pathname,
      "@gamekits/save-indexeddb": new URL("./packages/save-indexeddb/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/devtools": new URL("./packages/devtools/src/index.ts", import.meta.url).pathname,
      "@gamekits/devtools-ui": new URL("./packages/devtools-ui/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/camera-core": new URL("./packages/camera-core/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/character-controller": new URL(
        "./packages/character-controller/src/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/physics-core/testing": new URL(
        "./packages/physics-core/src/testing/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/physics-core": new URL("./packages/physics-core/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/physics-rapier2d": new URL(
        "./packages/physics-rapier2d/src/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/physics-rapier3d": new URL(
        "./packages/physics-rapier3d/src/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/input-core": new URL("./packages/input-core/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/input-dom": new URL("./packages/input-dom/src/index.ts", import.meta.url).pathname,
      "@gamekits/platform-core": new URL("./packages/platform-core/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/platform-web": new URL("./packages/platform-web/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/platform-tauri": new URL("./packages/platform-tauri/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/renderer-core": new URL("./packages/renderer-core/src/index.ts", import.meta.url)
        .pathname,
      "@gamekits/renderer-phaser": new URL(
        "./packages/renderer-phaser/src/index.ts",
        import.meta.url
      ).pathname,
      "@gamekits/test-utils": new URL("./packages/test-utils/src/index.ts", import.meta.url)
        .pathname
    }
  }
});
