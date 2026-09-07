import { createGameplayDevToolsCorrelation } from "@gamekits/app-host";
import { createDevToolsRuntime } from "@gamekits/devtools";
import { createInputRouter, type NormalizedInputEvent } from "@gamekits/input-core";
import { createMemorySaveStore, createSaveManager } from "@gamekits/save";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ABYSS_ACTION, applyAbyssInputAction, configureAbyssInputRouter } from "./app-input";
import {
  ABYSS_CHAIN_PANEL_ID,
  ABYSS_SOURCE_ID,
  createAbyssDevToolsPanel,
  createAbyssDevToolsTraceBridge
} from "./devtools/abyss-devtools";
import { Loot, createAbyssSaveContributor } from "./game";
import { createAbyssTestHarness } from "./test/abyss-test-utils";
import { renderAbyssDevToolsPanel } from "./ui/devtools/AbyssDevToolsPanel";

describe("Abyss Delve DevTools chain", () => {
  it("explains input to ability to loot to reward to save through DevTools", async () => {
    let now = 0;
    const devtools = createDevToolsRuntime({ clock: () => now++ });
    const gameplayCorrelation = createGameplayDevToolsCorrelation({
      devtools,
      id: "abyss.gameplay-correlation",
      gasTraceLimit: 80,
      tcaTraceLimit: 80
    });
    const harness = createAbyssTestHarness({
      gasTraceStore: gameplayCorrelation.gasTraceStore,
      tcaTraceStore: gameplayCorrelation.tcaTraceStore
    });
    const bridge = createAbyssDevToolsTraceBridge(() => devtools);
    const panel = createAbyssDevToolsPanel();
    devtools.registerPanel(panel);
    devtools.registerDataSource({
      id: ABYSS_SOURCE_ID,
      label: "Abyss Run",
      kind: "custom",
      snapshot: () => harness.abyss.snapshot()
    });

    const router = createInputRouter();
    configureAbyssInputRouter(router);
    const firstEnemy = harness.livingEnemies()[0]!;
    harness.movePlayerNear(firstEnemy);
    harness.weaken(firstEnemy);
    routeInput(harness, router, {
      id: "test.attack",
      device: "mouse",
      button: "primary",
      phase: "pressed",
      scope: "game",
      timestamp: 1,
      source: "test"
    });
    harness.tick(500);
    bridge.sync(harness.abyss.snapshot());

    expect(harness.abyss.runtime.world.query([Loot]).length).toBeGreaterThan(0);
    harness.pickupFirstLoot();

    for (let step = 0; step < 12 && harness.livingEnemies().length > 0; step += 1) {
      harness.attack(harness.livingEnemies()[0]!);
    }
    const reward = harness.abyss.snapshot().rewardChoices[0]!;
    harness.abyss.input.rewardChoiceRequested = reward.id;
    harness.tick(80);

    const saveManager = createSaveManager({
      appId: "abyss-delve",
      gameId: "abyss-delve",
      gameVersion: "0.1.0",
      formatVersion: "1.0.0",
      store: createMemorySaveStore(),
      contributorPolicy: {
        excludeScopes: ["presentation", "debug", "cache", "ui"]
      }
    });
    saveManager.registerContributor(createAbyssSaveContributor(() => harness.abyss));
    const clock = harness.abyss.runtime.clock.snapshot();
    const checkpoint = harness.abyss.captureCheckpoint();
    const save = await saveManager.save("checkpoint", {
      runtime: {
        seed: checkpoint.seed,
        clock: {
          ticks: clock.ticks,
          elapsed: clock.elapsed
        }
      }
    });
    harness.abyss.trace({
      kind: "save",
      label: "checkpoint saved",
      payload: { roomId: checkpoint.currentRoomId, ticks: clock.ticks }
    });
    bridge.sync(harness.abyss.snapshot());

    const traceLabels = devtools.snapshot().traces.map((trace) => trace.label);
    expect(traceLabels).toContain(ABYSS_ACTION.attack);
    expect(traceLabels).toContain("basic attack");
    expect(traceLabels.some((label) => label.includes("defeated"))).toBe(true);
    expect(traceLabels.some((label) => label.includes("dropped"))).toBe(true);
    expect(traceLabels.some((label) => label.includes("picked"))).toBe(true);
    expect(traceLabels.some((label) => label.includes("selected"))).toBe(true);
    expect(traceLabels).toContain("checkpoint saved");
    expect(devtools.snapshot().traces.some((trace) => trace.source === "gamekits.gas")).toBe(true);
    expect(devtools.snapshot().traces.some((trace) => trace.source === "gamekits.tca")).toBe(true);
    expect(save.envelope.payload.sections["abyss.run_checkpoint"]?.data).toMatchObject({
      selectedRewardIds: [reward.id],
      gold: harness.abyss.snapshot().player.gold
    });

    const snapshot = devtools.snapshot({ includeSourceSnapshots: true });
    expect(snapshot.panels.map((entry) => entry.id)).toContain(ABYSS_CHAIN_PANEL_ID);
    expect(snapshot.sourceSnapshots?.find((source) => source.id === ABYSS_SOURCE_ID)).toMatchObject(
      {
        id: ABYSS_SOURCE_ID,
        kind: "custom"
      }
    );

    const html = renderToStaticMarkup(
      createElement(() => renderAbyssDevToolsPanel({ panel, snapshot }))
    );
    expect(html).toContain("Abyss Chain");
    expect(html).toContain("Input");
    expect(html).toContain("Ability");
    expect(html).toContain("Loot");
    expect(html).toContain("Reward");
    expect(html).toContain("Save");
    expect(html).toContain("checkpoint saved");

    await harness.abyss.runtime.dispose();
    gameplayCorrelation.dispose();
    devtools.dispose();
  });
});

function routeInput(
  harness: ReturnType<typeof createAbyssTestHarness>,
  router: ReturnType<typeof createInputRouter>,
  input: NormalizedInputEvent
): void {
  for (const event of router.handle(input)) {
    applyAbyssInputAction(harness.abyss.input, event);
    harness.abyss.trace({
      kind: "input",
      label: event.actionId,
      payload: { phase: event.phase }
    });
  }
}
