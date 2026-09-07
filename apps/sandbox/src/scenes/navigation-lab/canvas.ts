import type { NavigationPathRoute, NavigationPoint } from "@gamekits/navigation-core";
import type {
  NavigationLabBackendDebugView,
  NavigationLabDebugLayerId,
  NavigationLabDebugShape
} from "./backends";
import { NAVIGATION_LAB_PROFILES, NAVIGATION_LAB_SCENARIO, NAVIGATION_LAB_UNITS } from "./scenario";
import { drawBlackglassBasinWorld } from "./scenarios/blackglass-basin-canvas";
import type { NavigationLabSnapshot } from "./types";

type DrawOptions = {
  showNavigationOverlay: boolean;
  backendDebugView?: NavigationLabBackendDebugView | undefined;
  backendDebugLayers?: readonly NavigationLabDebugLayerId[] | undefined;
};

type ScreenPoint = { x: number; y: number };

type AreaCostLegendEntry = {
  area: string;
  cost: number;
};

let activeBounds: NavigationLabSnapshot["scenario"]["bounds"] = NAVIGATION_LAB_SCENARIO.bounds;

const TREES = [
  [-8.5, -3.6, 1.1],
  [-7.6, -4.2, 0.9],
  [-6.7, -3.7, 1.2],
  [-5.8, -4.4, 0.8],
  [-4.9, -3.7, 1],
  [4.8, -3.8, 1],
  [5.7, -4.3, 0.85],
  [6.6, -3.6, 1.1],
  [7.5, -4.2, 0.9],
  [8.4, -3.4, 1.15],
  [-8.6, 3.8, 0.8],
  [8.5, 3.7, 0.9]
] as const;

const ROCKS = [
  [-5.7, -2.6, 1],
  [-4.1, -3.9, 0.8],
  [-1.8, -3.5, 1.1],
  [0.2, -4.1, 0.8],
  [2.2, -3.7, 1.05],
  [4.2, -3.4, 0.8],
  [5.7, -2.4, 1]
] as const;

export function drawNavigationLab(
  canvas: HTMLCanvasElement,
  snapshot: NavigationLabSnapshot,
  options: DrawOptions
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(680, Math.round(rect.width * ratio));
  const height = Math.max(430, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const cssWidth = width / ratio;
  const cssHeight = height / ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  activeBounds = snapshot.scenario.bounds;

  if (snapshot.scenario.id === "blackglass-basin") {
    drawBlackglassBasinWorld(context, cssWidth, cssHeight, snapshot, {
      point: (point) => toScreen(cssWidth, cssHeight, point),
      width: (value) => worldWidth(cssWidth, value),
      height: (value) => worldHeight(cssHeight, value)
    });
  } else {
    drawGround(context, cssWidth, cssHeight);
    drawTrails(context, cssWidth, cssHeight, snapshot);
    drawRiver(context, cssWidth, cssHeight);
    drawMarsh(context, cssWidth, cssHeight, snapshot);
    drawCliffs(context, cssWidth, cssHeight);
    drawTerrainProps(context, cssWidth, cssHeight);
    drawSecondaryCrossings(context, cssWidth, cssHeight, snapshot);
    drawBridge(context, cssWidth, cssHeight, snapshot);
    drawWaystones(context, cssWidth, cssHeight, snapshot);
    drawSettlements(context, cssWidth, cssHeight);
    drawWorldLabels(context, cssWidth, cssHeight, snapshot);
  }
  drawBackendData(
    context,
    cssWidth,
    cssHeight,
    snapshot,
    options.backendDebugView,
    options.backendDebugLayers ?? []
  );
  drawRoute(context, cssWidth, cssHeight, snapshot);
  drawField(context, cssWidth, cssHeight, snapshot, options.showNavigationOverlay);
  drawProjection(context, cssWidth, cssHeight, snapshot, options.showNavigationOverlay);
  drawAgents(context, cssWidth, cssHeight, snapshot);
  drawMissionMarkers(context, cssWidth, cssHeight, snapshot);
  drawGameHud(context, cssWidth, cssHeight, snapshot, options.showNavigationOverlay);
}

function drawBackendData(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot,
  view: NavigationLabBackendDebugView | undefined,
  layers: readonly NavigationLabDebugLayerId[]
): void {
  if (!view || view.backendId !== snapshot.backend.id || layers.length === 0) {
    return;
  }
  const enabledLayers = new Set(layers);

  if (enabledLayers.has("areas")) {
    const legendEntries = collectAreaCostLegendEntries(view, snapshot);
    for (const shape of view.shapes) {
      if (!shape.area || shape.stateBinding === "waystone") {
        continue;
      }
      const cost = effectiveDebugAreaCost(shape, view, snapshot);
      drawDebugShape(context, width, height, shape, {
        stroke: areaCostColor(cost, 0.9),
        fill:
          shape.kind === "polygon"
            ? areaCostColor(cost, 0.3)
            : shape.kind === "point"
              ? areaCostColor(cost, 0.82)
              : undefined,
        lineWidth: shape.kind === "polyline" ? 5 : 0.75
      });
    }
    drawAreaCostLegend(context, width, snapshot, legendEntries);
  }

  if (enabledLayers.has("topology")) {
    for (const shape of view.shapes) {
      drawDebugShape(context, width, height, shape, {
        stroke:
          shape.stateBinding === "waystone"
            ? "rgba(137, 222, 210, .65)"
            : "rgba(250, 235, 185, .48)",
        fill: shape.kind === "point" ? "rgba(255, 238, 174, .82)" : undefined,
        lineWidth: shape.kind === "polyline" ? 1.6 : 0.65,
        dash: shape.kind === "polyline" && shape.dashed ? [5, 5] : undefined
      });
    }
  }

  if (enabledLayers.has("constraints")) {
    for (const shape of view.shapes) {
      const blocked = isDebugShapeBlocked(shape, snapshot);
      const compatible = !blocked && isDebugShapeCompatible(shape, snapshot.profileId);
      const portal = shape.stateBinding === "waystone";
      drawDebugShape(context, width, height, shape, {
        stroke: blocked
          ? "rgba(255, 104, 82, .96)"
          : compatible
            ? portal
              ? "rgba(116, 245, 220, .96)"
              : "rgba(185, 235, 129, .5)"
            : "rgba(255, 176, 89, .92)",
        fill:
          shape.kind === "polygon"
            ? blocked
              ? "rgba(190, 43, 34, .38)"
              : compatible
                ? "rgba(144, 207, 104, .08)"
                : "rgba(214, 119, 48, .34)"
            : shape.kind === "point"
              ? compatible
                ? "rgba(185, 235, 129, .72)"
                : "rgba(255, 176, 89, .88)"
              : undefined,
        lineWidth: portal ? 2.2 : blocked || !compatible ? 1.5 : 0.6,
        dash: portal ? [6, 5] : undefined
      });
    }
  }
  context.setLineDash([]);
}

function drawDebugShape(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  shape: NavigationLabDebugShape,
  style: {
    stroke?: string | undefined;
    fill?: string | undefined;
    lineWidth: number;
    dash?: number[] | undefined;
  }
): void {
  context.setLineDash(style.dash ?? []);
  context.lineWidth = style.lineWidth;
  context.lineJoin = "round";
  context.lineCap = "round";
  if (style.stroke) {
    context.strokeStyle = style.stroke;
  }
  if (style.fill) {
    context.fillStyle = style.fill;
  }

  context.beginPath();
  if (shape.kind === "point") {
    const point = toScreen(width, height, shape.point);
    context.arc(point.x, point.y, Math.max(3, worldWidth(width, shape.radius)), 0, Math.PI * 2);
  } else {
    const first = shape.points[0];
    if (!first) {
      return;
    }
    const start = toScreen(width, height, first);
    context.moveTo(start.x, start.y);
    for (let index = 1; index < shape.points.length; index += 1) {
      const point = shape.points[index]!;
      const screen = toScreen(width, height, point);
      context.lineTo(screen.x, screen.y);
    }
    if (shape.kind === "polygon") {
      context.closePath();
    }
  }
  if (style.fill) {
    context.fill();
  }
  if (style.stroke) {
    context.stroke();
  }
}

function isDebugShapeCompatible(
  shape: NavigationLabDebugShape,
  profileId: NavigationLabSnapshot["profileId"]
): boolean {
  const profile = NAVIGATION_LAB_PROFILES.find((candidate) => candidate.id === profileId)!;
  return !(
    (shape.area !== undefined &&
      !(profile.allowedAreas as readonly string[]).includes(shape.area)) ||
    (shape.clearance !== undefined && shape.clearance < profile.radius) ||
    (shape.width !== undefined && shape.width < profile.radius * 2) ||
    (shape.heightClearance !== undefined && shape.heightClearance < profile.height) ||
    (shape.slope !== undefined && shape.slope > profile.maxSlope)
  );
}

function isDebugShapeBlocked(
  shape: NavigationLabDebugShape,
  snapshot: NavigationLabSnapshot
): boolean {
  switch (shape.stateBinding) {
    case "bridge":
      return snapshot.gateBlocked;
    case "ridgeTrail":
      return snapshot.ridgeBlocked;
    case "marsh":
      return snapshot.swampMode === "blocked";
    case "waystone":
      return !snapshot.portalEnabled;
    default:
      return false;
  }
}

function collectAreaCostLegendEntries(
  view: NavigationLabBackendDebugView,
  snapshot: NavigationLabSnapshot
): AreaCostLegendEntry[] {
  const entries = new Map<string, AreaCostLegendEntry>();
  for (const shape of view.shapes) {
    if (shape.area !== undefined && !entries.has(shape.area)) {
      entries.set(shape.area, {
        area: shape.area,
        cost: effectiveDebugAreaCost(shape, view, snapshot)
      });
    }
  }
  return [...entries.values()].sort(
    (left, right) => right.cost - left.cost || left.area.localeCompare(right.area)
  );
}

function effectiveDebugAreaCost(
  shape: NavigationLabDebugShape,
  view: NavigationLabBackendDebugView,
  snapshot: NavigationLabSnapshot
): number {
  if (shape.area === undefined) {
    return 1;
  }
  const profile = NAVIGATION_LAB_PROFILES.find((candidate) => candidate.id === snapshot.profileId)!;
  const overrides = profile.costOverrides as Readonly<Record<string, number>>;
  const configuredCost = overrides[shape.area] ?? view.areaCosts[shape.area] ?? 1;
  const dynamicMultiplier =
    shape.stateBinding === "marsh" && snapshot.swampMode === "costly" ? 3.5 : 1;
  return configuredCost * dynamicMultiplier;
}

function areaCostColor(cost: number, alpha: number): string {
  const normalized = clamp((cost - 0.75) / 2.75, 0, 1);
  const hue = 135 - normalized * 125;
  return `hsla(${hue.toFixed(1)}, 76%, 57%, ${alpha})`;
}

function drawAreaCostLegend(
  context: CanvasRenderingContext2D,
  width: number,
  snapshot: NavigationLabSnapshot,
  entries: readonly AreaCostLegendEntry[]
): void {
  if (entries.length === 0) {
    return;
  }
  const panelWidth = 196;
  const lineHeight = 17;
  const panelHeight = 30 + entries.length * lineHeight;
  const x = width - panelWidth - 16;
  const y = 58;
  context.save();
  context.fillStyle = "rgba(20, 28, 24, .9)";
  context.fillRect(x, y, panelWidth, panelHeight);
  context.strokeStyle = "rgba(239, 225, 185, .28)";
  context.strokeRect(x + 0.5, y + 0.5, panelWidth - 1, panelHeight - 1);
  context.fillStyle = "#e9dfbf";
  context.font = '700 9px "SFMono-Regular", monospace';
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(
    `AREA COST · ${NAVIGATION_LAB_UNITS[snapshot.profileId].shortLabel.toUpperCase()}`,
    x + 12,
    y + 16
  );
  for (const [index, entry] of entries.entries()) {
    const lineY = y + 34 + index * lineHeight;
    context.fillStyle = areaCostColor(entry.cost, 0.95);
    context.fillRect(x + 12, lineY - 5, 9, 9);
    context.fillStyle = "#c9c1a8";
    context.font = '600 9px "SFMono-Regular", monospace';
    context.textAlign = "left";
    context.fillText(entry.area.toUpperCase(), x + 28, lineY);
    context.fillStyle = "#f5ecd0";
    context.textAlign = "right";
    context.fillText(`×${entry.cost.toFixed(2)}`, x + panelWidth - 12, lineY);
  }
  context.restore();
}

export function navigationLabCanvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  bounds: NavigationLabSnapshot["scenario"]["bounds"] = NAVIGATION_LAB_SCENARIO.bounds
): NavigationPoint {
  const rect = canvas.getBoundingClientRect();
  const xRatio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  const yRatio = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  return {
    x: bounds.minX + xRatio * (bounds.maxX - bounds.minX),
    y: bounds.minY + yRatio * (bounds.maxY - bounds.minY)
  };
}

function drawGround(context: CanvasRenderingContext2D, width: number, height: number): void {
  const ground = context.createLinearGradient(0, 0, 0, height);
  ground.addColorStop(0, "#68734b");
  ground.addColorStop(0.55, "#596746");
  ground.addColorStop(1, "#485b42");
  context.fillStyle = ground;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = 0.16;
  for (let index = 0; index < 180; index += 1) {
    const x = hash(index * 17 + 3) * width;
    const y = hash(index * 29 + 11) * height;
    const radius = 0.7 + hash(index * 7) * 1.8;
    context.fillStyle = index % 3 === 0 ? "#d6c78a" : "#263e32";
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  const vignette = context.createRadialGradient(
    width * 0.5,
    height * 0.46,
    height * 0.16,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.72
  );
  vignette.addColorStop(0, "rgba(255, 245, 202, .03)");
  vignette.addColorStop(1, "rgba(20, 28, 22, .42)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);
}

function drawTrails(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot
): void {
  drawWorldStroke(
    context,
    width,
    height,
    [
      { x: -9.2, y: 0.2 },
      { x: -6, y: 0 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: 6, y: 0 },
      { x: 9.2, y: -0.1 }
    ],
    "rgba(57, 43, 31, .32)",
    34
  );
  drawWorldStroke(
    context,
    width,
    height,
    [
      { x: -9.2, y: 0.2 },
      { x: -6, y: 0 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: 6, y: 0 },
      { x: 9.2, y: -0.1 }
    ],
    "#a18d67",
    24
  );
  drawWorldStroke(
    context,
    width,
    height,
    [
      { x: -6, y: 0 },
      { x: -4.7, y: -2.2 },
      { x: -3, y: -3 },
      { x: 0, y: -3.45 },
      { x: 3, y: -3 },
      { x: 4.8, y: -2.1 },
      { x: 6, y: 0 }
    ],
    snapshot.ridgeBlocked ? "rgba(89, 48, 38, .62)" : "#9b8760",
    snapshot.ridgeBlocked ? 8 : 6,
    snapshot.ridgeBlocked ? [8, 8] : []
  );
  drawWorldStroke(
    context,
    width,
    height,
    [
      { x: -6, y: 0 },
      { x: -4.6, y: 2.1 },
      { x: -3, y: 3 },
      { x: 0, y: 3.5 },
      { x: 3, y: 3 },
      { x: 4.7, y: 2 },
      { x: 6, y: 0 }
    ],
    snapshot.swampMode === "blocked" ? "rgba(86, 42, 31, .45)" : "rgba(132, 116, 73, .66)",
    13,
    snapshot.swampMode === "blocked" ? [7, 9] : []
  );
}

function drawRiver(context: CanvasRenderingContext2D, width: number, height: number): void {
  const leftBank = [
    { x: -1.4, y: -5.2 },
    { x: -1.1, y: -3.5 },
    { x: -1.25, y: -1.7 },
    { x: -0.95, y: 0 },
    { x: -1.35, y: 1.9 },
    { x: -1.1, y: 3.5 },
    { x: -1.55, y: 5.2 }
  ];
  const rightBank = [
    { x: 1.05, y: 5.2 },
    { x: 1.35, y: 3.3 },
    { x: 1.05, y: 1.8 },
    { x: 1.25, y: 0 },
    { x: 1.1, y: -1.7 },
    { x: 1.45, y: -3.6 },
    { x: 1.2, y: -5.2 }
  ];
  context.beginPath();
  const first = toScreen(width, height, leftBank[0]!);
  context.moveTo(first.x, first.y);
  for (const point of leftBank.slice(1)) {
    const screen = toScreen(width, height, point);
    context.lineTo(screen.x, screen.y);
  }
  for (const point of rightBank) {
    const screen = toScreen(width, height, point);
    context.lineTo(screen.x, screen.y);
  }
  context.closePath();
  const water = context.createLinearGradient(width * 0.43, 0, width * 0.57, 0);
  water.addColorStop(0, "#315b61");
  water.addColorStop(0.5, "#4d7b7c");
  water.addColorStop(1, "#294f58");
  context.fillStyle = water;
  context.fill();

  context.strokeStyle = "rgba(204, 229, 210, .18)";
  context.lineWidth = 1.4;
  for (let index = 0; index < 12; index += 1) {
    const y = 20 + (index / 12) * height;
    const drift = Math.sin(index * 1.7) * 12;
    context.beginPath();
    context.moveTo(width * 0.465 + drift, y);
    context.bezierCurveTo(width * 0.49, y - 5, width * 0.51, y + 5, width * 0.535 + drift * 0.3, y);
    context.stroke();
  }
}

function drawMarsh(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot
): void {
  const color =
    snapshot.swampMode === "blocked"
      ? "rgba(77, 91, 55, .76)"
      : snapshot.swampMode === "costly"
        ? "rgba(100, 91, 51, .64)"
        : "rgba(78, 111, 67, .48)";
  context.fillStyle = color;
  const top = toScreen(width, height, { x: -9.2, y: 1.7 });
  context.fillRect(0, top.y, width, height - top.y);

  const pools = [
    [-6.3, 3.3, 1.4, 0.55],
    [-3.6, 4.2, 1.1, 0.4],
    [0, 3.8, 1.55, 0.58],
    [3.8, 4, 1.2, 0.42],
    [6.5, 3.1, 1.4, 0.5]
  ] as const;
  for (const [x, y, rx, ry] of pools) {
    const point = toScreen(width, height, { x, y });
    context.fillStyle =
      snapshot.swampMode === "blocked" ? "rgba(41, 70, 66, .82)" : "rgba(52, 87, 74, .7)";
    context.beginPath();
    context.ellipse(
      point.x,
      point.y,
      worldWidth(width, rx),
      worldHeight(height, ry),
      -0.12,
      0,
      Math.PI * 2
    );
    context.fill();
  }
  context.strokeStyle = "rgba(211, 192, 112, .45)";
  context.lineWidth = 1.2;
  for (let index = 0; index < 30; index += 1) {
    const x = -8.5 + hash(index * 13) * 17;
    const y = 2.1 + hash(index * 31) * 2.8;
    const point = toScreen(width, height, { x, y });
    context.beginPath();
    context.moveTo(point.x, point.y + 5);
    context.lineTo(point.x - 2, point.y - 5);
    context.moveTo(point.x, point.y + 5);
    context.lineTo(point.x + 3, point.y - 4);
    context.stroke();
  }
}

function drawCliffs(context: CanvasRenderingContext2D, width: number, height: number): void {
  const cliff = [
    { x: -9.2, y: -2.25 },
    { x: -7.2, y: -2.05 },
    { x: -5.4, y: -2.7 },
    { x: -3.2, y: -3.7 },
    { x: 0, y: -4.2 },
    { x: 3.4, y: -3.65 },
    { x: 5.4, y: -2.65 },
    { x: 7.3, y: -2.05 },
    { x: 9.2, y: -2.3 }
  ];
  const first = toScreen(width, height, cliff[0]!);
  context.beginPath();
  context.moveTo(first.x, 0);
  context.lineTo(first.x, first.y);
  for (const point of cliff.slice(1)) {
    const screen = toScreen(width, height, point);
    context.lineTo(screen.x, screen.y);
  }
  context.lineTo(width, 0);
  context.closePath();
  const ridge = context.createLinearGradient(0, 0, 0, height * 0.35);
  ridge.addColorStop(0, "#444b39");
  ridge.addColorStop(1, "#6f6a4e");
  context.fillStyle = ridge;
  context.fill();
  context.strokeStyle = "rgba(39, 35, 27, .62)";
  context.lineWidth = 4;
  context.stroke();
}

function drawTerrainProps(context: CanvasRenderingContext2D, width: number, height: number): void {
  for (const [x, y, scale] of TREES) {
    drawTree(context, toScreen(width, height, { x, y }), scale);
  }
  for (const [x, y, scale] of ROCKS) {
    drawRock(context, toScreen(width, height, { x, y }), scale);
  }
}

function drawSecondaryCrossings(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot
): void {
  const ropeWest = toScreen(width, height, { x: -1.35, y: -3.3 });
  const ropeEast = toScreen(width, height, { x: 1.35, y: -3.3 });
  context.strokeStyle = snapshot.ridgeBlocked ? "#6b493c" : "#aa8b5a";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(ropeWest.x, ropeWest.y - 7);
  context.quadraticCurveTo(
    (ropeWest.x + ropeEast.x) / 2,
    ropeWest.y + 1,
    ropeEast.x,
    ropeEast.y - 7
  );
  context.moveTo(ropeWest.x, ropeWest.y + 7);
  context.quadraticCurveTo(
    (ropeWest.x + ropeEast.x) / 2,
    ropeWest.y + 15,
    ropeEast.x,
    ropeEast.y + 7
  );
  context.stroke();
  for (let x = ropeWest.x + 5; x < ropeEast.x; x += 9) {
    const broken = snapshot.ridgeBlocked && x > (ropeWest.x + ropeEast.x) / 2 - 9;
    if (broken) {
      continue;
    }
    context.strokeStyle = "#796143";
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(x, ropeWest.y - 4);
    context.lineTo(x, ropeWest.y + 8);
    context.stroke();
  }
  if (snapshot.ridgeBlocked) {
    drawRock(context, { x: ropeWest.x - 8, y: ropeWest.y }, 1.15);
    drawRock(context, { x: ropeWest.x + 5, y: ropeWest.y + 3 }, 0.8);
  }

  for (let index = -3; index <= 3; index += 1) {
    const point = toScreen(width, height, { x: index * 0.42, y: 3.35 + (index % 2) * 0.1 });
    context.fillStyle = snapshot.swampMode === "blocked" ? "rgba(78, 87, 72, .44)" : "#88836c";
    context.beginPath();
    context.ellipse(point.x, point.y, 9, 5, -0.18, 0, Math.PI * 2);
    context.fill();
  }
}

function drawTree(context: CanvasRenderingContext2D, point: ScreenPoint, scale: number): void {
  context.fillStyle = "rgba(17, 25, 20, .28)";
  context.beginPath();
  context.ellipse(point.x + 5 * scale, point.y + 7 * scale, 13 * scale, 7 * scale, 0.3, 0, 7);
  context.fill();
  context.fillStyle = "#253d2d";
  context.beginPath();
  context.arc(point.x, point.y, 10 * scale, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#3d5a39";
  context.beginPath();
  context.arc(point.x - 3 * scale, point.y - 3 * scale, 6.5 * scale, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#759057";
  context.beginPath();
  context.arc(point.x - 5 * scale, point.y - 6 * scale, 2.2 * scale, 0, Math.PI * 2);
  context.fill();
}

function drawRock(context: CanvasRenderingContext2D, point: ScreenPoint, scale: number): void {
  context.fillStyle = "rgba(26, 27, 23, .32)";
  context.beginPath();
  context.ellipse(point.x + 4, point.y + 5, 10 * scale, 5 * scale, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#77715d";
  context.beginPath();
  context.moveTo(point.x - 8 * scale, point.y + 4 * scale);
  context.lineTo(point.x - 4 * scale, point.y - 7 * scale);
  context.lineTo(point.x + 6 * scale, point.y - 5 * scale);
  context.lineTo(point.x + 9 * scale, point.y + 5 * scale);
  context.closePath();
  context.fill();
}

function drawBridge(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot
): void {
  const west = toScreen(width, height, { x: -1.55, y: 0 });
  const east = toScreen(width, height, { x: 1.55, y: 0 });
  const bridgeHeight = 30;
  context.fillStyle = "rgba(24, 26, 22, .44)";
  context.fillRect(west.x - 4, west.y - bridgeHeight / 2 + 6, east.x - west.x + 8, bridgeHeight);
  context.fillStyle = snapshot.gateBlocked ? "#655148" : "#8d7957";
  context.fillRect(west.x, west.y - bridgeHeight / 2, east.x - west.x, bridgeHeight);
  context.strokeStyle = "#4b4031";
  context.lineWidth = 2;
  for (let x = west.x + 7; x < east.x; x += 12) {
    context.beginPath();
    context.moveTo(x, west.y - bridgeHeight / 2);
    context.lineTo(x, west.y + bridgeHeight / 2);
    context.stroke();
  }
  context.strokeRect(west.x, west.y - bridgeHeight / 2, east.x - west.x, bridgeHeight);
  if (snapshot.gateBlocked) {
    context.strokeStyle = "#d36a4a";
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo((west.x + east.x) / 2 - 13, west.y - 13);
    context.lineTo((west.x + east.x) / 2 + 13, west.y + 13);
    context.moveTo((west.x + east.x) / 2 + 13, west.y - 13);
    context.lineTo((west.x + east.x) / 2 - 13, west.y + 13);
    context.stroke();
  }
}

function drawWaystones(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot
): void {
  const west = toScreen(width, height, { x: -6, y: 0 });
  const east = toScreen(width, height, { x: 6, y: 0 });
  drawWaystone(context, west, snapshot.portalEnabled);
  drawWaystone(context, east, snapshot.portalEnabled);
  if (!snapshot.portalEnabled) {
    return;
  }
  context.setLineDash([5, 8]);
  context.strokeStyle = "rgba(121, 224, 211, .72)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(west.x, west.y - 18);
  context.bezierCurveTo(
    west.x + 120,
    west.y - 118,
    east.x - 120,
    east.y - 118,
    east.x,
    east.y - 18
  );
  context.stroke();
  context.setLineDash([]);
}

function drawWaystone(
  context: CanvasRenderingContext2D,
  point: ScreenPoint,
  active: boolean
): void {
  context.fillStyle = active ? "#79ded3" : "#59645a";
  context.shadowColor = active ? "rgba(89, 238, 219, .9)" : "transparent";
  context.shadowBlur = active ? 15 : 0;
  context.beginPath();
  context.moveTo(point.x - 7, point.y + 8);
  context.lineTo(point.x - 4, point.y - 18);
  context.lineTo(point.x + 5, point.y - 22);
  context.lineTo(point.x + 8, point.y + 8);
  context.closePath();
  context.fill();
  context.shadowBlur = 0;
}

function drawSettlements(context: CanvasRenderingContext2D, width: number, height: number): void {
  const camp = toScreen(width, height, NAVIGATION_LAB_SCENARIO.start);
  context.fillStyle = "rgba(42, 31, 23, .35)";
  context.beginPath();
  context.ellipse(camp.x, camp.y + 9, 30, 15, 0, 0, Math.PI * 2);
  context.fill();
  drawTent(context, camp.x - 15, camp.y - 4, "#b06b45");
  drawTent(context, camp.x + 11, camp.y + 5, "#80664a");
  context.fillStyle = "#f3a54b";
  context.beginPath();
  context.arc(camp.x + 1, camp.y + 8, 4, 0, Math.PI * 2);
  context.fill();

  const fort = toScreen(width, height, NAVIGATION_LAB_SCENARIO.goal);
  context.fillStyle = "#554f42";
  context.fillRect(fort.x - 24, fort.y - 25, 48, 46);
  context.fillStyle = "#77705e";
  context.fillRect(fort.x - 31, fort.y - 34, 15, 55);
  context.fillRect(fort.x + 16, fort.y - 34, 15, 55);
  context.fillStyle = "#272b27";
  context.fillRect(fort.x - 8, fort.y - 8, 16, 29);
  context.fillStyle = "#c6a451";
  context.fillRect(fort.x + 22, fort.y - 45, 2, 17);
  context.fillStyle = "#a94f3b";
  context.beginPath();
  context.moveTo(fort.x + 24, fort.y - 45);
  context.lineTo(fort.x + 39, fort.y - 40);
  context.lineTo(fort.x + 24, fort.y - 34);
  context.closePath();
  context.fill();
}

function drawTent(context: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(x - 10, y + 10);
  context.lineTo(x, y - 9);
  context.lineTo(x + 11, y + 10);
  context.closePath();
  context.fill();
  context.strokeStyle = "rgba(43, 30, 21, .7)";
  context.stroke();
}

function drawRoute(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot
): void {
  const pathRoutes = snapshot.activeRoutes.filter(
    (route): route is NavigationPathRoute => route.kind === "path" && route.points.length >= 2
  );
  if (pathRoutes.length === 0) {
    return;
  }
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const route of pathRoutes) {
    drawWorldStroke(context, width, height, route.points, "rgba(255, 222, 119, .18)", 12);
    drawWorldStroke(context, width, height, route.points, "#f6d26f", 3);
  }
  context.setLineDash([]);
}

function drawField(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot,
  showOverlay: boolean
): void {
  if (!showOverlay || snapshot.activeRoute?.kind !== "field") {
    return;
  }
  for (const vector of snapshot.fieldVectors) {
    if (vector.sample.status !== "valid") {
      continue;
    }
    const start = toScreen(width, height, vector.point);
    const end = {
      x: start.x + vector.sample.direction.x * 22,
      y: start.y + vector.sample.direction.y * 22
    };
    context.strokeStyle = "rgba(235, 244, 179, .82)";
    context.fillStyle = "rgba(235, 244, 179, .82)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    drawArrowHead(context, start, end, 5);
  }
}

function drawProjection(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot,
  showOverlay: boolean
): void {
  if (!showOverlay || !snapshot.probePoint || !snapshot.projection) {
    return;
  }
  const raw = toScreen(width, height, snapshot.probePoint);
  const projected = toScreen(width, height, snapshot.projection.point);
  context.setLineDash([4, 5]);
  context.strokeStyle = "rgba(255, 224, 139, .92)";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(raw.x, raw.y);
  context.lineTo(projected.x, projected.y);
  context.stroke();
  context.setLineDash([]);
  context.strokeStyle = "#ffe08b";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(raw.x, raw.y, 7, 0, Math.PI * 2);
  context.stroke();
}

function drawAgents(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot
): void {
  const markerLimit = 600;
  const stride = Math.max(1, Math.ceil(snapshot.agents.length / markerLimit));
  for (let index = 0; index < snapshot.agents.length; index += stride) {
    const agent = snapshot.agents[index];
    if (agent === undefined) {
      continue;
    }
    const point = toScreen(width, height, agent.position);
    const color =
      agent.progress === "route-stale" || agent.progress === "route-missing"
        ? "#d7654d"
        : agent.progress === "stuck"
          ? "#e8ae4f"
          : "#f1e4b1";
    drawUnit(context, point, snapshot.profileId, color);
  }
}

function drawUnit(
  context: CanvasRenderingContext2D,
  point: ScreenPoint,
  profileId: NavigationLabSnapshot["profileId"],
  color: string
): void {
  context.fillStyle = "rgba(18, 24, 20, .32)";
  context.beginPath();
  context.ellipse(point.x + 2, point.y + 7, 9, 4, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = color;
  if (profileId === "profile.hauler") {
    context.fillRect(point.x - 8, point.y - 5, 16, 11);
    context.fillStyle = "#3f372d";
    context.beginPath();
    context.arc(point.x - 6, point.y + 7, 3, 0, Math.PI * 2);
    context.arc(point.x + 6, point.y + 7, 3, 0, Math.PI * 2);
    context.fill();
  } else if (profileId === "profile.heavy") {
    context.beginPath();
    context.arc(point.x, point.y, 7, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#625d4d";
    context.lineWidth = 3;
    context.stroke();
  } else {
    context.beginPath();
    context.moveTo(point.x, point.y - 9);
    context.lineTo(point.x - 6, point.y + 7);
    context.lineTo(point.x + 6, point.y + 7);
    context.closePath();
    context.fill();
  }
}

function drawMissionMarkers(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot
): void {
  drawMarker(
    context,
    toScreen(width, height, snapshot.start),
    snapshot.scenario.startMarker,
    "#e6b95f"
  );
  drawMarker(
    context,
    toScreen(width, height, snapshot.goal),
    snapshot.scenario.goalMarker,
    "#c8da78"
  );
}

function drawMarker(
  context: CanvasRenderingContext2D,
  point: ScreenPoint,
  label: string,
  color: string
): void {
  context.fillStyle = color;
  context.beginPath();
  context.arc(point.x, point.y, 5, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(21, 28, 23, .72)";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "rgba(20, 27, 22, .78)";
  context.fillRect(point.x - 27, point.y + 12, 54, 16);
  context.fillStyle = "#f5edd4";
  context.font = '700 8px "Avenir Next Condensed", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, point.x, point.y + 20);
}

function drawWorldLabels(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot
): void {
  drawLabel(context, toScreen(width, height, { x: -7.9, y: -1.15 }), "EMBER CAMP");
  drawLabel(context, toScreen(width, height, { x: 7.8, y: -1.3 }), "NORTHWATCH");
  drawLabel(context, toScreen(width, height, { x: -0.1, y: -2.15 }), "HUNTER TRAIL");
  drawLabel(context, toScreen(width, height, { x: -0.05, y: 4.65 }), "REED MARSH");
  drawLabel(
    context,
    toScreen(width, height, { x: 0.05, y: 0.8 }),
    snapshot.gateBlocked ? "STONE BRIDGE · CLOSED" : "STONE BRIDGE"
  );
}

function drawLabel(context: CanvasRenderingContext2D, point: ScreenPoint, label: string): void {
  context.fillStyle = "rgba(246, 239, 213, .7)";
  context.font = '700 9px "Avenir Next Condensed", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, point.x, point.y);
}

function drawGameHud(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot,
  showOverlay: boolean
): void {
  context.fillStyle = "rgba(26, 33, 27, .82)";
  context.fillRect(16, 16, 224, 58);
  context.strokeStyle = "rgba(239, 225, 185, .24)";
  context.strokeRect(16.5, 16.5, 223, 57);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#f2e8c9";
  context.font = '700 12px "Avenir Next Condensed", sans-serif';
  context.fillText(NAVIGATION_LAB_UNITS[snapshot.profileId].label.toUpperCase(), 29, 38);
  context.fillStyle = "#c6b890";
  context.font = '600 9px "SFMono-Regular", monospace';
  context.fillText(
    snapshot.activeRoute
      ? `${snapshot.agents.length > 1 ? "PARTY RALLY" : "ACTIVE ROUTE"} · ${snapshot.agents.length} unit${snapshot.agents.length === 1 ? "" : "s"}`
      : "AWAITING ORDERS",
    29,
    57
  );
  if (showOverlay) {
    context.fillStyle = "rgba(23, 37, 33, .84)";
    context.fillRect(width - 184, 16, 168, 34);
    context.fillStyle = "#a9d9c9";
    context.font = '700 9px "SFMono-Regular", monospace';
    context.textAlign = "center";
    context.fillText(
      `${snapshot.backend.id.toUpperCase()} · REV ${snapshot.navigation.revision}`,
      width - 100,
      37
    );
  }
  if (snapshot.lockdown) {
    context.fillStyle = "rgba(128, 43, 34, .92)";
    context.fillRect(width - 155, height - 48, 139, 32);
    context.fillStyle = "#fff2df";
    context.font = '800 10px "Avenir Next Condensed", sans-serif';
    context.textAlign = "center";
    context.fillText(snapshot.scenario.controls.lockdown.hudLabel, width - 85, height - 28);
  }
}

function drawWorldStroke(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  points: readonly NavigationPoint[],
  color: string,
  lineWidth: number,
  dash: number[] = []
): void {
  const first = points[0];
  if (!first) {
    return;
  }
  const start = toScreen(width, height, first);
  context.setLineDash(dash);
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(start.x, start.y);
  for (const point of points.slice(1)) {
    const screen = toScreen(width, height, point);
    context.lineTo(screen.x, screen.y);
  }
  context.stroke();
  context.setLineDash([]);
}

function drawArrowHead(
  context: CanvasRenderingContext2D,
  start: ScreenPoint,
  end: ScreenPoint,
  size: number
): void {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - Math.cos(angle - 0.55) * size, end.y - Math.sin(angle - 0.55) * size);
  context.lineTo(end.x - Math.cos(angle + 0.55) * size, end.y - Math.sin(angle + 0.55) * size);
  context.closePath();
  context.fill();
}

function toScreen(width: number, height: number, point: NavigationPoint): ScreenPoint {
  return {
    x: ((point.x - activeBounds.minX) / (activeBounds.maxX - activeBounds.minX)) * width,
    y: ((point.y - activeBounds.minY) / (activeBounds.maxY - activeBounds.minY)) * height
  };
}

function worldWidth(width: number, value: number): number {
  return (value / (activeBounds.maxX - activeBounds.minX)) * width;
}

function worldHeight(height: number, value: number): number {
  return (value / (activeBounds.maxY - activeBounds.minY)) * height;
}

function hash(value: number): number {
  const raw = Math.sin(value * 91.3458) * 47_158.5453;
  return raw - Math.floor(raw);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
