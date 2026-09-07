import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAssetManager, type AssetDefinition } from "@gamekits/asset";
import type { AnimatorBindingDefinition, AnimatorGraphDefinition } from "@gamekits/animator-core";
import type { DataPack } from "@gamekits/data";
import type { PhysicsLayoutData } from "@gamekits/physics-core";
import { describe, expect, it } from "vitest";
import { outpostAppDefinition } from "../app-definition";
import {
  createOutpostDataRegistry,
  OUTPOST_ARENA,
  OUTPOST_ARENA_DEFINITION_ID,
  OUTPOST_ARENA_PHYSICS_LAYOUT_ID,
  OUTPOST_AUDIO_ASSET_IDS,
  outpostContentPack,
  outpostRuntimeFeedbackAssets,
  outpostRuntimeImageAssets,
  registerOutpostDataTypes
} from "../content";
import {
  OUTPOST_PLAYER_TYPE,
  OUTPOST_ARENA_TYPE,
  OUTPOST_RENDER_OBJECT_TYPE,
  OUTPOST_WAVE_TYPE,
  OUTPOST_WEAPON_TYPE,
  type OutpostArenaDefinition,
  type OutpostPlayerDefinition,
  type OutpostRenderObjectDefinition
} from "../domain";
import {
  loadOutpostInitialAssetGroups,
  loadOutpostLazyAssetGroup,
  outpostProfileDefinition
} from "../profiles";
import {
  createOutpostArenaRenderObjectDefinitions,
  createOutpostDynamicRenderObjectDefinition
} from "../presentation";
import { createDataRegistry } from "@gamekits/data";

const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("Outpost content pipeline", () => {
  it("registers app and framework content through one reference graph", () => {
    const registry = createOutpostDataRegistry();
    const snapshot = registry.snapshot();

    expect(snapshot.packs).toEqual(["outpost-siege.core"]);
    expect(snapshot.types).toEqual(
      expect.arrayContaining([
        "asset.definition",
        "ai.agent",
        "animation.clip",
        "animator.graph",
        "combat.delivery",
        "gas.actor",
        "gas.ability",
        "gas.effect",
        "navigation.layout",
        "physics.body",
        "physics.collider",
        "tca.rule",
        OUTPOST_ARENA_TYPE,
        OUTPOST_RENDER_OBJECT_TYPE,
        OUTPOST_PLAYER_TYPE,
        OUTPOST_WAVE_TYPE
      ])
    );
    expect(snapshot.documents.length).toBeGreaterThan(30);
    expect(
      snapshot.documents
        .filter((document) => document.type !== "asset.definition")
        .some((document) => JSON.stringify(document.data).includes("/assets/"))
    ).toBe(false);
    expect(
      registry.referencesFrom({ type: OUTPOST_PLAYER_TYPE, id: "player.outpost.ranger" })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: { type: OUTPOST_WEAPON_TYPE, id: "weapon.outpost.rifle" },
          path: "weapon"
        }),
        expect.objectContaining({
          to: { type: "physics.body", id: "body.outpost.player" },
          path: "physicsBody"
        })
      ])
    );
    expect(
      registry.referencesFrom({
        type: OUTPOST_RENDER_OBJECT_TYPE,
        id: "render.outpost.overseer"
      })
    ).toContainEqual(
      expect.objectContaining({
        to: { type: "asset.definition", id: "asset.outpost.overseer" },
        path: "assetRefs.texture"
      })
    );
  });

  it("locates missing and duplicate content at source pack paths", () => {
    const registry = createOutpostDataRegistry();
    const missingReferencePack: DataPack = {
      id: "outpost.invalid-reference",
      version: "1.0.0",
      entries: [
        {
          type: OUTPOST_PLAYER_TYPE,
          id: "player.outpost.invalid",
          data: {
            id: "player.outpost.invalid",
            actor: { type: "gas.actor", id: "actor.outpost.player" },
            weapon: { type: OUTPOST_WEAPON_TYPE, id: "weapon.outpost.missing" },
            physicsBody: { type: "physics.body", id: "body.outpost.player" },
            renderObject: {
              type: OUTPOST_RENDER_OBJECT_TYPE,
              id: "render.outpost.player"
            },
            movementProfile: {
              type: "outpost.movement-profile",
              id: "movement.outpost.ranger"
            }
          } satisfies OutpostPlayerDefinition
        }
      ]
    };
    const missing = registry.validatePack(missingReferencePack);

    expect(missing.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "data.missing_reference",
        sourcePackId: "outpost.invalid-reference",
        path: "weapon",
        key: { type: OUTPOST_PLAYER_TYPE, id: "player.outpost.invalid" }
      })
    );

    const emptyRegistry = createDataRegistry();
    registerOutpostDataTypes(emptyRegistry);
    const duplicate = emptyRegistry.validatePack({
      id: "outpost.duplicate",
      version: "1.0.0",
      entries: [outpostContentPack.entries[0]!, outpostContentPack.entries[0]!]
    });
    expect(duplicate.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "data.duplicate_document",
        sourcePackId: "outpost.duplicate",
        path: "entries[1]"
      })
    );
  });

  it("keeps headless visual loading empty and retries lazy boss assets", async () => {
    const registry = createOutpostDataRegistry();
    const attempts = new Map<string, number>();
    const diagnostics: Array<{ type: string; assetId?: string; source?: string }> = [];
    const manager = createAssetManager({
      adapter: {
        id: "outpost.test-assets",
        supports: () => true,
        async load(asset) {
          const attempt = (attempts.get(asset.id) ?? 0) + 1;
          attempts.set(asset.id, attempt);
          if (asset.id === "asset.outpost.overseer" && attempt === 1) {
            throw new Error("temporary boss asset failure");
          }
        }
      },
      onDiagnostic(event) {
        diagnostics.push({
          type: event.type,
          ...(event.assetId === undefined ? {} : { assetId: event.assetId }),
          ...(event.source === undefined ? {} : { source: event.source })
        });
      }
    });
    manager.registerFromDataRegistry(registry);

    const headlessResults = await loadOutpostInitialAssetGroups(
      manager,
      outpostProfileDefinition("headless-server")
    );
    expect(headlessResults).toEqual([]);
    expect(attempts.size).toBe(0);

    const browser = outpostProfileDefinition("browser-web");
    const initialResults = await loadOutpostInitialAssetGroups(manager, browser);
    expect(initialResults.map((result) => result.group)).toEqual(["boot", "match", "combat"]);
    expect(initialResults.every((result) => result.succeeded)).toBe(true);
    expect(attempts.has("asset.outpost.overseer")).toBe(false);

    const bossResult = await loadOutpostLazyAssetGroup(manager, browser, "boss", 2);
    expect(bossResult).toMatchObject({ group: "boss", attempt: 2, succeeded: true });
    expect(attempts.get("asset.outpost.overseer")).toBe(2);
    expect(diagnostics).toContainEqual({
      type: "asset.failed",
      assetId: "asset.outpost.overseer",
      source: "asset.manager"
    });
  });

  it("keeps authoring masters separate from runtime textures", () => {
    const registry = createOutpostDataRegistry();

    for (const manifestAsset of outpostRuntimeImageAssets) {
      expect(manifestAsset.authoringSource).toMatch(/\.(png|webp)$/);
      expect(manifestAsset.runtimeUrl).toMatch(/\.webp$/);

      const definition = registry.get<AssetDefinition>("asset.definition", manifestAsset.id).data;
      expect(definition.source).toEqual({ type: "url", url: manifestAsset.runtimeUrl });
      expect(definition.metadata).toMatchObject({
        authoringSource: manifestAsset.authoringSource,
        runtimeFormat: manifestAsset.runtimeFormat,
        width: manifestAsset.width,
        height: manifestAsset.height
      });

      const authoringFile = readFileSync(join(APP_ROOT, manifestAsset.authoringSource));
      if (manifestAsset.authoringSource.endsWith(".png")) {
        expect(authoringFile.subarray(1, 4).toString("ascii")).toBe("PNG");
      } else {
        expect(authoringFile.subarray(0, 4).toString("ascii")).toBe("RIFF");
        expect(authoringFile.subarray(8, 12).toString("ascii")).toBe("WEBP");
      }

      const runtimeFile = readFileSync(join(APP_ROOT, "public", manifestAsset.runtimeUrl.slice(1)));
      expect(runtimeFile.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(runtimeFile.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(readWebpDimensions(runtimeFile)).toEqual({
        width: manifestAsset.width * (manifestAsset.spriteSheet?.frames.length ?? 1),
        height: manifestAsset.height
      });
    }

    const playerAsset = registry.get<AssetDefinition>(
      "asset.definition",
      "asset.outpost.player"
    ).data;
    expect(playerAsset).toMatchObject({
      type: "spritesheet",
      frame: { width: 128, height: 128 },
      metadata: {
        referenceSource: "assets-src/outpost/combat/player.webp",
        sourceColumns: 6,
        sourceRows: 1,
        runtimeFrameCount: 14
      }
    });
    expect(playerAsset.animations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "outpost.player.idle", frames: [0, 1] }),
        expect.objectContaining({ id: "outpost.player.run", frames: [2, 3] }),
        expect.objectContaining({ id: "outpost.player.dash", frames: [9, 10] }),
        expect.objectContaining({ id: "outpost.player.reload-preparing", frames: [6, 7] }),
        expect.objectContaining({ id: "outpost.player.tactical-active", frames: [13] })
      ])
    );
    expect(
      outpostRuntimeImageAssets.find((asset) => asset.id === "asset.outpost.player")?.spriteSheet
        ?.poseBounds
    ).toEqual({ width: 68, height: 110 });
  });

  it("maps player locomotion and gameplay phases to distinct authored clips", () => {
    const registry = createOutpostDataRegistry();
    const graph = registry.getValue<AnimatorGraphDefinition>(
      "animator.graph",
      "animator.outpost.player.graph"
    );
    const binding = registry.getValue<AnimatorBindingDefinition>(
      "animator.binding",
      "animator.outpost.binding.player"
    );

    expect(graph.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "speed", type: "number" }),
        expect.objectContaining({ id: "dashing", type: "boolean" }),
        expect.objectContaining({ id: "dead", type: "boolean" })
      ])
    );
    expect(graph.layers[0]?.states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "idle", clip: "idle" }),
        expect.objectContaining({ id: "run", clip: "run" }),
        expect.objectContaining({ id: "dash", clip: "dash" })
      ])
    );
    expect(binding.phaseMappings).toEqual(
      expect.arrayContaining([
        {
          abilityId: "ability.outpost.rifle_fire",
          phase: "active",
          layer: "base",
          clip: "rifle-active"
        },
        {
          abilityId: "ability.outpost.rifle_reload",
          phase: "preparing",
          layer: "base",
          clip: "reload-preparing"
        },
        {
          abilityId: "ability.outpost.rifle_reload",
          phase: "recovering",
          layer: "base",
          clip: "reload-recovering"
        },
        {
          abilityId: "ability.outpost.shock_field",
          phase: "preparing",
          layer: "base",
          clip: "tactical-preparing"
        },
        {
          abilityId: "ability.outpost.shock_field",
          phase: "active",
          layer: "base",
          clip: "tactical-active"
        }
      ])
    );
    expect(binding.phaseMappings?.some((mapping) => mapping.abilityId === undefined)).toBe(false);
  });

  it("ships a licensed compressed music track instead of the generated audio fixture", () => {
    const registry = createOutpostDataRegistry();
    const definition = registry.get<AssetDefinition>(
      "asset.definition",
      OUTPOST_AUDIO_ASSET_IDS.ambience
    ).data;

    expect(definition).toMatchObject({
      type: "audio",
      source: { type: "url", url: "/assets/outpost/audio/magic-space.ogg" },
      group: "match",
      metadata: {
        title: "Magic Space",
        author: "CodeManu",
        license: "CC0-1.0"
      }
    });
    if (definition.source.type !== "url") {
      throw new Error("Outpost music requires a runtime URL source");
    }
    const runtimeFile = readFileSync(join(APP_ROOT, "public", definition.source.url.slice(1)));
    expect(runtimeFile.subarray(0, 4).toString("ascii")).toBe("OggS");
  });

  it("ships licensed compressed variation banks for every combat sound", () => {
    const registry = createOutpostDataRegistry();
    const banks = [
      {
        ids: OUTPOST_AUDIO_ASSET_IDS.rifle,
        runtimePrefix: "/assets/outpost/audio/rifle-",
        pack: "Sci-fi Sounds"
      },
      {
        ids: OUTPOST_AUDIO_ASSET_IDS.enemyTelegraph,
        runtimePrefix: "/assets/outpost/audio/enemy-telegraph-",
        pack: "Sci-fi Sounds"
      },
      {
        ids: OUTPOST_AUDIO_ASSET_IDS.hit,
        runtimePrefix: "/assets/outpost/audio/hit-",
        pack: "Impact Sounds"
      }
    ] as const;

    for (const bank of banks) {
      expect(bank.ids).toHaveLength(5);
      const runtimeUrls = new Set<string>();
      for (const id of bank.ids) {
        const definition = registry.get<AssetDefinition>("asset.definition", id).data;
        expect(definition).toMatchObject({
          type: "audio",
          group: "combat",
          metadata: {
            author: "Kenney",
            pack: bank.pack,
            license: "CC0-1.0"
          }
        });
        if (definition.source.type !== "url") {
          throw new Error(`Outpost combat audio requires a runtime URL source: ${id}`);
        }
        expect(definition.source.url.startsWith(bank.runtimePrefix)).toBe(true);
        runtimeUrls.add(definition.source.url);
        const runtimeFile = readFileSync(join(APP_ROOT, "public", definition.source.url.slice(1)));
        expect(runtimeFile.subarray(0, 4).toString("ascii")).toBe("OggS");
      }
      expect(runtimeUrls.size).toBe(5);
    }
  });

  it("ships authored vector feedback assets through the combat preload group", () => {
    const registry = createOutpostDataRegistry();
    expect(outpostRuntimeFeedbackAssets).toHaveLength(4);

    for (const asset of outpostRuntimeFeedbackAssets) {
      const definition = registry.get<AssetDefinition>("asset.definition", asset.id).data;
      expect(definition).toMatchObject({
        type: "image",
        source: { type: "url", url: asset.runtimeUrl },
        group: "combat",
        preload: true
      });
      const authoring = readFileSync(join(APP_ROOT, asset.authoringSource), "utf8");
      const runtime = readFileSync(join(APP_ROOT, "public", asset.runtimeUrl.slice(1)));
      expect(authoring.startsWith("<svg")).toBe(true);
      expect(runtime.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(runtime.subarray(8, 12).toString("ascii")).toBe("WEBP");
      expect(readWebpDimensions(runtime)).toEqual({ width: asset.width, height: asset.height });
    }
  });

  it("aligns up-authored player and projectile sprites with gameplay facing", () => {
    const registry = createOutpostDataRegistry();
    const player = registry.getValue<OutpostRenderObjectDefinition>(
      OUTPOST_RENDER_OBJECT_TYPE,
      "render.outpost.player"
    );
    const projectile = registry.getValue<OutpostRenderObjectDefinition>(
      OUTPOST_RENDER_OBJECT_TYPE,
      "render.outpost.projectile"
    );

    expect(player.facingOffsetRadians).toBeCloseTo(Math.PI / 2);
    expect(projectile.facingOffsetRadians).toBeCloseTo(Math.PI / 2);
    expect(
      createOutpostDynamicRenderObjectDefinition(
        registry,
        player.id,
        "player-facing-up",
        100,
        100,
        -Math.PI / 2
      ).transform?.rotation?.z
    ).toBeCloseTo(0);
    expect(
      createOutpostDynamicRenderObjectDefinition(
        registry,
        projectile.id,
        "projectile-facing-right",
        100,
        100,
        0
      ).transform?.rotation?.z
    ).toBeCloseTo(Math.PI / 2);
    expect(
      createOutpostDynamicRenderObjectDefinition(
        registry,
        "render.outpost.feedback.crosshair",
        "crosshair-unmodified",
        100,
        100,
        0.25
      ).transform?.rotation?.z
    ).toBeCloseTo(0.25);
  });

  it("derives every static render placement and collider from the same arena object", () => {
    const registry = createOutpostDataRegistry();
    const arenaAsset = outpostRuntimeImageAssets.find(
      (asset) => asset.id === "asset.outpost.arena"
    );
    const layout = registry.getValue<PhysicsLayoutData>(
      "physics.layout",
      OUTPOST_ARENA_PHYSICS_LAYOUT_ID
    );
    const arena = registry.getValue<OutpostArenaDefinition>(
      OUTPOST_ARENA_TYPE,
      OUTPOST_ARENA_DEFINITION_ID
    );
    const renderObjects = createOutpostArenaRenderObjectDefinitions(registry);

    expect(arenaAsset).toMatchObject(OUTPOST_ARENA);
    expect(layout.bounds).toEqual({
      min: { x: 0, y: 0 },
      max: { x: OUTPOST_ARENA.width, y: OUTPOST_ARENA.height }
    });
    expect(layout.bodies).toHaveLength(1);
    expect(layout.bodies[0]?.colliders).toHaveLength(arena.staticObjects.length);
    expect(renderObjects).toHaveLength(arena.staticObjects.length + 1);
    for (const object of arena.staticObjects) {
      const collider = layout.bodies[0]?.colliders?.find((candidate) => candidate.id === object.id);
      const renderObject = renderObjects.find(
        (candidate) => candidate.id === `outpost.preview.arena.${object.id}`
      );
      expect(collider?.collider).toEqual(object.collider);
      expect(collider?.overrides).toMatchObject({
        shape: { type: "box", width: object.size.width, height: object.size.height },
        offset: {
          position: object.position,
          ...(object.rotation === undefined ? {} : { rotation: object.rotation })
        }
      });
      expect(renderObject).toMatchObject({
        transform: {
          position: object.position,
          rotation: { z: object.rotation ?? 0 }
        },
        props: { width: object.size.width, height: object.size.height }
      });
    }
  });

  it("declares a shared service graph for all runtime profiles", () => {
    expect(outpostAppDefinition.services.map((service) => service.id)).toEqual([
      "platform",
      "drivers",
      "data",
      "renderer",
      "assets",
      "audio",
      "input",
      "multiplayer",
      "ui",
      "game",
      "save",
      "devtools"
    ]);
    expect(
      outpostAppDefinition.services.find((service) => service.id === "assets")?.dependencies
    ).toEqual(["data", "drivers", "renderer"]);
    expect(
      outpostAppDefinition.services.find((service) => service.id === "audio")?.dependencies
    ).toEqual(["assets", "drivers"]);
  });
});

function readWebpDimensions(file: Buffer): { width: number; height: number } {
  for (let offset = 12; offset + 8 <= file.length; ) {
    const chunkType = file.subarray(offset, offset + 4).toString("ascii");
    const chunkSize = file.readUInt32LE(offset + 4);
    const chunkOffset = offset + 8;

    if (chunkType === "VP8X") {
      return {
        width: file.readUIntLE(chunkOffset + 4, 3) + 1,
        height: file.readUIntLE(chunkOffset + 7, 3) + 1
      };
    }

    if (chunkType === "VP8L") {
      const first = file[chunkOffset + 1]!;
      const second = file[chunkOffset + 2]!;
      const third = file[chunkOffset + 3]!;
      const fourth = file[chunkOffset + 4]!;
      return {
        width: 1 + first + ((second & 0x3f) << 8),
        height: 1 + (second >> 6) + (third << 2) + ((fourth & 0x0f) << 10)
      };
    }

    if (chunkType === "VP8 ") {
      return {
        width: file.readUInt16LE(chunkOffset + 6) & 0x3fff,
        height: file.readUInt16LE(chunkOffset + 8) & 0x3fff
      };
    }

    offset = chunkOffset + chunkSize + (chunkSize % 2);
  }

  throw new Error("WebP dimensions are missing");
}
