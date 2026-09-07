import type { NavigationPoint } from "@gamekits/navigation-core";
import type { NavigationLabSnapshot } from "../types";
import {
  BLACKGLASS_BASIN_TERRAIN,
  blackglassTerrainCellAt,
  type BlackglassTerrainCell
} from "./blackglass-basin-terrain";

type ScreenPoint = { x: number; y: number };

export type NavigationLabCanvasProjection = {
  point(point: NavigationPoint): ScreenPoint;
  width(value: number): number;
  height(value: number): number;
};

export function drawBlackglassBasinWorld(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: NavigationLabSnapshot,
  projection: NavigationLabCanvasProjection
): void {
  drawBasaltFloor(context, width, height);
  drawWalkableTerrain(context, snapshot, projection);
  drawBlockedStructures(context, projection);
  drawTerrainFeatures(context, snapshot, projection);
  drawTransitRelay(context, snapshot, projection);
  drawWorldLabels(context, projection);
}

function drawBasaltFloor(context: CanvasRenderingContext2D, width: number, height: number): void {
  const floor = context.createLinearGradient(0, 0, width, height);
  floor.addColorStop(0, "#1b242a");
  floor.addColorStop(0.52, "#111a20");
  floor.addColorStop(1, "#0b1217");
  context.fillStyle = floor;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = 0.18;
  for (let index = 0; index < 180; index += 1) {
    const x = noise(index * 13 + 7) * width;
    const y = noise(index * 31 + 3) * height;
    const size = 0.8 + noise(index * 19) * 2.2;
    context.fillStyle = index % 6 === 0 ? "#a95e3c" : "#66747a";
    context.fillRect(x, y, size, size * 0.55);
  }
  context.globalAlpha = 1;
}

function drawWalkableTerrain(
  context: CanvasRenderingContext2D,
  snapshot: NavigationLabSnapshot,
  projection: NavigationLabCanvasProjection
): void {
  const tileWidth = projection.width(BLACKGLASS_BASIN_TERRAIN.tileSize);
  const tileHeight = projection.height(BLACKGLASS_BASIN_TERRAIN.tileSize);

  for (const cell of BLACKGLASS_BASIN_TERRAIN.cells) {
    const center = projection.point(cell.point);
    context.fillStyle = terrainColor(cell, snapshot);
    context.fillRect(
      center.x - tileWidth / 2 - 0.25,
      center.y - tileHeight / 2 - 0.25,
      tileWidth + 0.5,
      tileHeight + 0.5
    );

    context.strokeStyle = terrainSeamColor(cell);
    context.lineWidth = 0.55;
    context.strokeRect(center.x - tileWidth / 2, center.y - tileHeight / 2, tileWidth, tileHeight);

    if ((cell.column * 17 + cell.row * 29) % 11 === 0) {
      context.fillStyle = "rgba(223, 231, 217, .08)";
      context.fillRect(center.x - 1, center.y - 1, 2, 2);
    }
  }
}

function drawBlockedStructures(
  context: CanvasRenderingContext2D,
  projection: NavigationLabCanvasProjection
): void {
  const tileWidth = projection.width(BLACKGLASS_BASIN_TERRAIN.tileSize);
  const tileHeight = projection.height(BLACKGLASS_BASIN_TERRAIN.tileSize);

  for (let row = 0; row < BLACKGLASS_BASIN_TERRAIN.height; row += 1) {
    for (let column = 0; column < BLACKGLASS_BASIN_TERRAIN.width; column += 1) {
      if (blackglassTerrainCellAt(column, row) !== undefined) {
        continue;
      }
      const point = terrainPoint(column, row);
      const center = projection.point(point);
      const centralReactor = Math.abs(point.x) <= 2.1;
      context.fillStyle = centralReactor ? "#17191b" : structureColor(column, row);
      context.fillRect(
        center.x - tileWidth / 2 + 0.7,
        center.y - tileHeight / 2 + 0.7,
        tileWidth - 1.4,
        tileHeight - 1.4
      );
      context.strokeStyle = centralReactor ? "rgba(218, 99, 54, .28)" : "rgba(125, 145, 147, .18)";
      context.lineWidth = centralReactor ? 1.1 : 0.7;
      context.strokeRect(
        center.x - tileWidth / 2 + 1.1,
        center.y - tileHeight / 2 + 1.1,
        tileWidth - 2.2,
        tileHeight - 2.2
      );

      if (!centralReactor && (column * 7 + row * 5) % 9 === 0) {
        context.fillStyle = "rgba(196, 213, 203, .13)";
        context.fillRect(center.x - tileWidth * 0.24, center.y - 1, tileWidth * 0.48, 2);
      }
    }
  }
}

function drawTerrainFeatures(
  context: CanvasRenderingContext2D,
  snapshot: NavigationLabSnapshot,
  projection: NavigationLabCanvasProjection
): void {
  const tileWidth = projection.width(BLACKGLASS_BASIN_TERRAIN.tileSize);
  const tileHeight = projection.height(BLACKGLASS_BASIN_TERRAIN.tileSize);

  for (const cell of BLACKGLASS_BASIN_TERRAIN.cells) {
    const center = projection.point(cell.point);
    if (cell.area === "road") {
      context.fillStyle = "rgba(236, 190, 92, .35)";
      context.fillRect(center.x - tileWidth * 0.28, center.y - 0.7, tileWidth * 0.56, 1.4);
    } else if (cell.area === "blast-door") {
      context.strokeStyle = snapshot.gateBlocked ? "#ef7658" : "#bed587";
      context.lineWidth = snapshot.gateBlocked ? 3 : 1.5;
      context.beginPath();
      context.moveTo(center.x - tileWidth * 0.35, center.y - tileHeight * 0.32);
      context.lineTo(center.x + tileWidth * 0.35, center.y + tileHeight * 0.32);
      context.moveTo(center.x + tileWidth * 0.35, center.y - tileHeight * 0.32);
      context.lineTo(center.x - tileWidth * 0.35, center.y + tileHeight * 0.32);
      context.stroke();
    } else if (cell.area === "ridge" || cell.area === "gantry") {
      context.strokeStyle =
        cell.area === "gantry" && snapshot.ridgeBlocked
          ? "rgba(239, 100, 77, .92)"
          : "rgba(183, 210, 215, .62)";
      context.lineWidth = cell.area === "gantry" ? 2 : 1;
      context.beginPath();
      context.moveTo(center.x - tileWidth * 0.36, center.y - tileHeight * 0.2);
      context.lineTo(center.x + tileWidth * 0.36, center.y - tileHeight * 0.2);
      context.moveTo(center.x - tileWidth * 0.36, center.y + tileHeight * 0.2);
      context.lineTo(center.x + tileWidth * 0.36, center.y + tileHeight * 0.2);
      context.stroke();
    } else if (cell.area === "swamp") {
      const radius = 1.5 + noise(cell.column * 19 + cell.row * 31) * 2.5;
      context.strokeStyle =
        snapshot.swampMode === "blocked" ? "rgba(151, 248, 133, .44)" : "rgba(131, 220, 190, .28)";
      context.lineWidth = 0.8;
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.stroke();
    }
  }
}

function drawTransitRelay(
  context: CanvasRenderingContext2D,
  snapshot: NavigationLabSnapshot,
  projection: NavigationLabCanvasProjection
): void {
  const from = projection.point(BLACKGLASS_BASIN_TERRAIN.relay.from);
  const to = projection.point(BLACKGLASS_BASIN_TERRAIN.relay.to);
  context.setLineDash([6, 7]);
  context.strokeStyle = snapshot.portalEnabled
    ? "rgba(112, 245, 222, .94)"
    : "rgba(93, 126, 132, .36)";
  context.lineWidth = snapshot.portalEnabled ? 3 : 1.4;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.bezierCurveTo(from.x + 100, from.y - 95, to.x - 80, to.y + 90, to.x, to.y);
  context.stroke();
  context.setLineDash([]);
  drawRelayTower(context, from, snapshot.portalEnabled);
  drawRelayTower(context, to, snapshot.portalEnabled);
}

function drawRelayTower(
  context: CanvasRenderingContext2D,
  point: ScreenPoint,
  enabled: boolean
): void {
  context.strokeStyle = enabled ? "#7cf0d7" : "#6d8589";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(point.x, point.y, 10, 0, Math.PI * 2);
  context.arc(point.x, point.y, 4, 0, Math.PI * 2);
  context.stroke();
  if (enabled) {
    context.fillStyle = "rgba(124, 240, 215, .26)";
    context.beginPath();
    context.arc(point.x, point.y, 16, 0, Math.PI * 2);
    context.fill();
  }
}

function drawWorldLabels(
  context: CanvasRenderingContext2D,
  projection: NavigationLabCanvasProjection
): void {
  for (const landmark of BLACKGLASS_BASIN_TERRAIN.landmarks) {
    const point = projection.point(landmark.point);
    context.fillStyle = "rgba(231, 235, 219, .72)";
    context.font = '700 8px "Avenir Next Condensed", sans-serif';
    context.textAlign = landmark.align ?? "center";
    context.textBaseline = "middle";
    context.fillText(landmark.label, point.x, point.y);
  }
}

function terrainColor(cell: BlackglassTerrainCell, snapshot: NavigationLabSnapshot): string {
  switch (cell.area) {
    case "road":
      return "#55544d";
    case "ridge":
      return "#3b494f";
    case "gantry":
      return snapshot.ridgeBlocked ? "#6d302c" : "#485c62";
    case "blast-door":
      return snapshot.gateBlocked ? "#66332d" : "#5f604f";
    case "swamp":
      return snapshot.swampMode === "blocked"
        ? "#315b3f"
        : snapshot.swampMode === "costly"
          ? "#315d57"
          : "#314e53";
    default:
      return "#303b41";
  }
}

function terrainSeamColor(cell: BlackglassTerrainCell): string {
  switch (cell.area) {
    case "road":
    case "blast-door":
      return "rgba(230, 188, 93, .16)";
    case "ridge":
    case "gantry":
      return "rgba(184, 210, 213, .13)";
    case "swamp":
      return "rgba(116, 211, 182, .11)";
    default:
      return "rgba(161, 178, 177, .08)";
  }
}

function structureColor(column: number, row: number): string {
  const value = (column * 13 + row * 17) % 5;
  return value === 0 ? "#222b2f" : value === 1 ? "#20272b" : "#1d2428";
}

function terrainPoint(column: number, row: number): NavigationPoint {
  return {
    x: BLACKGLASS_BASIN_TERRAIN.bounds.minX + (column + 0.5) * BLACKGLASS_BASIN_TERRAIN.tileSize,
    y: BLACKGLASS_BASIN_TERRAIN.bounds.minY + (row + 0.5) * BLACKGLASS_BASIN_TERRAIN.tileSize
  };
}

function noise(value: number): number {
  const raw = Math.sin(value * 73.184) * 31_337.119;
  return raw - Math.floor(raw);
}
