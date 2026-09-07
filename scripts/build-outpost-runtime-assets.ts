import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  OutpostRuntimeImageAsset,
  OutpostRuntimeSpriteSheetFrame
} from "../apps/multiplayer-outpost-siege-demo/src/content/runtime-image-assets";
import { outpostRuntimeFeedbackAssets } from "../apps/multiplayer-outpost-siege-demo/src/content/runtime-feedback-assets";
import { outpostRuntimeImageAssets } from "../apps/multiplayer-outpost-siege-demo/src/content/runtime-image-assets";

const APP_ROOT = join(process.cwd(), "apps/multiplayer-outpost-siege-demo");

for (const asset of outpostRuntimeImageAssets) {
  const sourcePath = join(APP_ROOT, asset.authoringSource);
  const outputPath = join(APP_ROOT, "public", asset.runtimeUrl.slice(1));
  mkdirSync(dirname(outputPath), { recursive: true });
  if (asset.spriteSheet === undefined) {
    buildImageAsset(asset, sourcePath, outputPath);
  } else {
    buildSpriteSheetAsset(asset, sourcePath, outputPath);
  }
}

for (const asset of outpostRuntimeFeedbackAssets) {
  const sourcePath = join(APP_ROOT, asset.authoringSource);
  const outputPath = join(APP_ROOT, "public", asset.runtimeUrl.slice(1));
  mkdirSync(dirname(outputPath), { recursive: true });
  const raster = spawnSync(
    "rsvg-convert",
    ["-w", String(asset.width), "-h", String(asset.height), sourcePath],
    { maxBuffer: 4 * 1024 * 1024 }
  );
  if (raster.error) {
    throw new Error(
      `Unable to rasterize ${asset.id}. Install librsvg so rsvg-convert is available.`,
      { cause: raster.error }
    );
  }
  if (raster.status !== 0) {
    throw new Error(`Unable to rasterize ${asset.id}: ${raster.stderr.toString().trim()}`);
  }
  const result = spawnSync(
    "magick",
    ["png:-", "-strip", "-define", "webp:lossless=true", outputPath],
    { input: raster.stdout, encoding: "utf8" }
  );
  if (result.error) {
    throw new Error(`Unable to encode ${asset.id}. Install ImageMagick so magick is available.`, {
      cause: result.error
    });
  }
  if (result.status !== 0) {
    throw new Error(`Unable to encode ${asset.id}: ${result.stderr.trim()}`);
  }
}

console.log(
  `Built ${outpostRuntimeImageAssets.length + outpostRuntimeFeedbackAssets.length} Outpost runtime WebP assets.`
);

function buildImageAsset(
  asset: OutpostRuntimeImageAsset,
  sourcePath: string,
  outputPath: string
): void {
  const padding = asset.padding ?? 0;
  const contentWidth = asset.width - padding * 2;
  const contentHeight = asset.height - padding * 2;
  const geometry = `${contentWidth}x${contentHeight}${asset.fit === "cover" ? "^" : ""}`;
  runMagick(
    asset.id,
    [
      sourcePath,
      ...(asset.fit === "contain" ? ["-trim", "+repage"] : []),
      "-resize",
      geometry,
      "-gravity",
      "center",
      "-background",
      "none",
      "-extent",
      `${asset.width}x${asset.height}`,
      "-strip",
      "-define",
      "webp:method=6",
      "-quality",
      asset.fit === "cover" ? "80" : "90",
      outputPath
    ],
    "build image"
  );
}

function buildSpriteSheetAsset(
  asset: OutpostRuntimeImageAsset,
  sourcePath: string,
  outputPath: string
): void {
  const spriteSheet = asset.spriteSheet;
  if (spriteSheet === undefined) {
    throw new Error(`Unable to build ${asset.id}: missing sprite sheet metadata`);
  }
  const sourceFrameCount = spriteSheet.sourceColumns * spriteSheet.sourceRows;
  const temporaryRoot = mkdtempSync(join(tmpdir(), "gamekits-outpost-sprites-"));
  try {
    runMagick(
      asset.id,
      [
        sourcePath,
        "-crop",
        `${spriteSheet.sourceColumns}x${spriteSheet.sourceRows}@`,
        "+repage",
        join(temporaryRoot, "source-%d.png")
      ],
      "split authoring poses"
    );
    const framePaths = spriteSheet.frames.map((frame, index) => {
      if (
        !Number.isSafeInteger(frame.sourceFrame) ||
        frame.sourceFrame < 0 ||
        frame.sourceFrame >= sourceFrameCount
      ) {
        throw new Error(
          `Unable to build ${asset.id}: source frame ${frame.sourceFrame} is outside 0-${sourceFrameCount - 1}`
        );
      }
      const framePath = join(temporaryRoot, `frame-${index}.png`);
      buildSpriteFrame(
        asset,
        frame,
        join(temporaryRoot, `source-${frame.sourceFrame}.png`),
        framePath
      );
      return framePath;
    });
    runMagick(
      asset.id,
      [
        ...framePaths,
        "+append",
        "-strip",
        "-define",
        "webp:lossless=true",
        "-define",
        "webp:method=6",
        outputPath
      ],
      "assemble sprite sheet"
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function buildSpriteFrame(
  asset: OutpostRuntimeImageAsset,
  frame: OutpostRuntimeSpriteSheetFrame,
  sourcePath: string,
  outputPath: string
): void {
  const padding = asset.padding ?? 0;
  const contentWidth = asset.width - padding * 2;
  const contentHeight = asset.height - padding * 2;
  const poseBounds = asset.spriteSheet?.poseBounds;
  runMagick(
    asset.id,
    [
      sourcePath,
      "-trim",
      "+repage",
      ...(frame.flipX === true ? ["-flop"] : []),
      "-resize",
      poseBounds === undefined
        ? `${contentWidth}x${contentHeight}`
        : `${poseBounds.width}x${poseBounds.height}!`,
      ...(frame.rotateDegrees === undefined
        ? []
        : ["-background", "none", "-rotate", String(frame.rotateDegrees)]),
      "-gravity",
      "center",
      "-background",
      "none",
      "-extent",
      `${asset.width}x${asset.height}`,
      ...(frame.offsetX === undefined && frame.offsetY === undefined
        ? []
        : ["-roll", `${signedOffset(frame.offsetX)}${signedOffset(frame.offsetY)}`]),
      outputPath
    ],
    "build sprite frame"
  );
}

function signedOffset(value: number | undefined): string {
  const resolved = value ?? 0;
  return resolved >= 0 ? `+${resolved}` : String(resolved);
}

function runMagick(assetId: string, args: string[], action: string): void {
  const result = spawnSync("magick", args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(
      `Unable to ${action} for ${assetId}. Install ImageMagick so magick is available.`,
      { cause: result.error }
    );
  }
  if (result.status !== 0) {
    throw new Error(`Unable to ${action} for ${assetId}: ${result.stderr.trim()}`);
  }
}
