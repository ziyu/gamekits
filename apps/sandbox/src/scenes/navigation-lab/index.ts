import { createUiRuntime } from "@gamekits/ui-core";
import { createNavigationLabAppSession, type NavigationLabAppSession } from "./app-session";
import type { NavigationLabBackendProvider } from "./backends";
import {
  listNavigationLabScenarioPresentations,
  listNavigationLabScenarioProviders,
  requireNavigationLabScenarioBackend,
  requireNavigationLabScenarioProvider,
  type NavigationLabScenarioProvider
} from "./scenarios";
import {
  bindNavigationLabUi,
  mountNavigationLabDevTools,
  renderNavigationLabUi,
  setNavigationLabBackendBusy,
  updateNavigationLabUi
} from "./ui";
import "./styles.css";

export async function mount(root: HTMLElement): Promise<void> {
  const uiRuntime = createUiRuntime();
  const initial = resolveInitialSelection();
  await initial.backend.prepare?.();
  const ui = renderNavigationLabUi(root, uiRuntime, listNavigationLabScenarioPresentations());
  let session = await createNavigationLabAppSession({
    uiRuntime,
    scenario: initial.scenario.definition,
    backend: initial.backend
  });
  let switchingSession = false;

  const mountSessionDevTools = (): void => {
    if (session.devtools) {
      mountNavigationLabDevTools(ui, session.devtools);
    }
  };

  const selectSession = async (
    nextScenario: NavigationLabScenarioProvider,
    nextBackend: NavigationLabBackendProvider
  ): Promise<void> => {
    if (
      switchingSession ||
      (nextScenario.definition.id === session.scenario.id && nextBackend.id === session.backend.id)
    ) {
      return;
    }
    switchingSession = true;
    setNavigationLabBackendBusy(
      ui,
      true,
      `Loading ${nextScenario.definition.title} · ${nextBackend.label}…`
    );
    try {
      await nextBackend.prepare?.();
    } catch (error) {
      switchingSession = false;
      setNavigationLabBackendBusy(ui, false);
      throw error;
    }
    const previous = session;
    await previous.dispose();
    let switchError: unknown;
    try {
      session = await createNavigationLabAppSession({
        uiRuntime,
        scenario: nextScenario.definition,
        backend: nextBackend
      });
      updateSelectionUrl(session);
    } catch (error) {
      session = await createNavigationLabAppSession({
        uiRuntime,
        scenario: previous.scenario,
        backend: previous.backend
      });
      switchError = error;
    } finally {
      switchingSession = false;
    }
    mountSessionDevTools();
    setNavigationLabBackendBusy(ui, false);
    updateNavigationLabUi(ui, session.scene.snapshot());
    if (switchError) {
      throw switchError;
    }
  };

  bindNavigationLabUi(ui, {
    scene: () => session.scene,
    async selectScenario(scenarioId) {
      const scenario = requireNavigationLabScenarioProvider(scenarioId);
      const backend =
        scenario.backends.find((candidate) => candidate.id === session.backend.id) ??
        scenario.backends[0];
      if (!backend) {
        throw new Error(`Navigation Lab scenario has no backend: ${scenarioId}`);
      }
      await selectSession(scenario, backend);
    },
    async selectBackend(backendId) {
      const scenario = requireNavigationLabScenarioProvider(session.scenario.id);
      const backend = requireNavigationLabScenarioBackend(scenario.definition.id, backendId);
      await selectSession(scenario, backend);
    }
  });
  mountSessionDevTools();

  let frameHandle = 0;
  let lastTime: number | undefined;
  let lastUiUpdate = 0;
  const frame = (now: number): void => {
    const delta = lastTime === undefined ? 0 : Math.max(0, Math.min(now - lastTime, 64));
    lastTime = now;
    if (!switchingSession) {
      session.tick(delta, now);
      if (now - lastUiUpdate >= 1000 / 30) {
        lastUiUpdate = now;
        updateNavigationLabUi(ui, session.scene.snapshot());
      }
    }
    frameHandle = requestAnimationFrame(frame);
  };

  updateNavigationLabUi(ui, session.scene.snapshot());
  frameHandle = requestAnimationFrame(frame);
  window.addEventListener(
    "beforeunload",
    () => {
      cancelAnimationFrame(frameHandle);
      void session.dispose();
    },
    { once: true }
  );
}

function resolveInitialSelection(): {
  scenario: NavigationLabScenarioProvider;
  backend: NavigationLabBackendProvider;
} {
  const parameters = new URLSearchParams(window.location.search);
  const scenarios = listNavigationLabScenarioProviders();
  const scenario =
    scenarios.find((candidate) => candidate.definition.id === parameters.get("navScenario")) ??
    scenarios[0]!;
  const backend =
    scenario.backends.find((candidate) => candidate.id === parameters.get("backend")) ??
    scenario.backends[0]!;
  return { scenario, backend };
}

function updateSelectionUrl(session: NavigationLabAppSession): void {
  const url = new URL(window.location.href);
  url.searchParams.set("navScenario", session.scenario.id);
  url.searchParams.set("backend", session.backend.id);
  window.history.replaceState(window.history.state, "", url);
}
