import type { AiPerceptionFact, AiSharedFactQueries } from "@gamekits/ai-core";
import type { NavigationAgentProfileDefinition } from "@gamekits/navigation-core";
import {
  createGridNavigationBackend,
  type NavigationGridCellDefinition,
  type NavigationGridDefinition
} from "@gamekits/navigation-grid";
import { AI_LAB_OBSTACLE_BLUEPRINTS } from "./ecosystem";

const AI_LAB_GRID_ORIGIN = { x: 4, y: 6 } as const;
const AI_LAB_GRID_CELL_SIZE = 2;
const AI_LAB_GRID_WIDTH = 47;
const AI_LAB_GRID_HEIGHT = 45;

export const AI_LAB_NAVIGATION_PROFILE = {
  id: "ai-lab.small-animal",
  radius: 1.2,
  tags: ["sandbox", "small-animal"]
} as const satisfies NavigationAgentProfileDefinition;

export type AiLabSharedFacts = AiSharedFactQueries & {
  alert(): boolean;
  setAlert(active: boolean, elapsed: number): void;
};

export function createAiLabSharedFacts(): AiLabSharedFacts {
  let alert = createAlertFact(false, 0);
  return {
    facts() {
      return [cloneFact(alert)];
    },
    fact(key, subjectId) {
      if (key !== alert.key || (subjectId !== undefined && subjectId !== alert.subjectId)) {
        return undefined;
      }
      return cloneFact(alert);
    },
    alert() {
      return alert.value === true;
    },
    setAlert(active, elapsed) {
      alert = createAlertFact(active, elapsed);
    }
  };
}

export function createAiLabNavigationBackend() {
  return createGridNavigationBackend({
    id: "sandbox.ai-lab.navigation-grid",
    grid: createAiLabNavigationGrid(),
    maxRouteFields: 48
  });
}

function createAiLabNavigationGrid(): NavigationGridDefinition {
  const cells: NavigationGridCellDefinition[] = [];
  for (let row = 0; row < AI_LAB_GRID_HEIGHT; row += 1) {
    for (let column = 0; column < AI_LAB_GRID_WIDTH; column += 1) {
      const x = AI_LAB_GRID_ORIGIN.x + column * AI_LAB_GRID_CELL_SIZE;
      const y = AI_LAB_GRID_ORIGIN.y + row * AI_LAB_GRID_CELL_SIZE;
      const obstacleIds = AI_LAB_OBSTACLE_BLUEPRINTS.filter((obstacle) =>
        pointInsideObstacleClearance(x, y, obstacle)
      ).map((obstacle) => obstacle.id);
      cells.push({
        column,
        row,
        area: "forest-floor",
        clearance: 3,
        ...(obstacleIds.length === 0 ? {} : { obstacleIds })
      });
    }
  }
  return {
    id: "sandbox.ai-lab.forest-grid",
    width: AI_LAB_GRID_WIDTH,
    height: AI_LAB_GRID_HEIGHT,
    cellSize: AI_LAB_GRID_CELL_SIZE,
    origin: { ...AI_LAB_GRID_ORIGIN },
    connectivity: 8,
    cells,
    dynamicObstacles: AI_LAB_OBSTACLE_BLUEPRINTS.map((obstacle) => ({
      id: obstacle.id,
      blocked: obstacle.enabled,
      tags: ["sandbox", "ai-lab", obstacle.kind]
    })),
    tags: ["sandbox", "ai-lab", "physics-aligned"]
  };
}

function pointInsideObstacleClearance(
  x: number,
  y: number,
  obstacle: (typeof AI_LAB_OBSTACLE_BLUEPRINTS)[number]
): boolean {
  return (
    Math.abs(x - obstacle.x) <= obstacle.width / 2 + AI_LAB_NAVIGATION_PROFILE.radius &&
    Math.abs(y - obstacle.y) <= obstacle.height / 2 + AI_LAB_NAVIGATION_PROFILE.radius
  );
}

function createAlertFact(active: boolean, observedAt: number): AiPerceptionFact {
  return {
    key: "forest.alert",
    subjectId: "forest",
    value: active,
    observedAt,
    confidence: 1,
    metadata: { source: "sandbox.ai-lab.shared-facts" }
  };
}

function cloneFact(fact: AiPerceptionFact): AiPerceptionFact {
  return {
    ...fact,
    ...(fact.position === undefined ? {} : { position: { ...fact.position } }),
    ...(fact.metadata === undefined ? {} : { metadata: { ...fact.metadata } })
  };
}
