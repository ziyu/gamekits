import "@gamekits/devtools-ui/styles.css";
import "./styles.css";
import { createConfiguredAppHost } from "@gamekits/app-host";
import type { InputActionEvent } from "@gamekits/input-core";
import { observeElementViewport } from "@gamekits/platform-web";
import { createUiRuntime } from "@gamekits/ui-core";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { outpostAppDefinition } from "./app-definition";
import {
  applyOutpostInputAction,
  applyOutpostGamepadAimTarget,
  outpostPlayerActionForInputAction,
  OUTPOST_ACTION,
  OUTPOST_VIEWPORT,
  setOutpostPointerViewportPosition
} from "./gameplay";
import { createOutpostBrowserProfile, type OutpostBrowserContext } from "./profiles";
import {
  createOutpostBrowserIdentity,
  createOutpostBrowserMultiplayer,
  createOutpostSessionId,
  enterOutpostBrowserSession,
  loadOutpostBrowserServerConfig,
  normalizeOutpostSessionId,
  sendOutpostPlayerAction,
  sendOutpostReady,
  type OutpostBrowserSessionIntent
} from "./realtime";
import { OutpostApp, type OutpostBootPhase, type OutpostConnectionView } from "./ui";

const rootElement = document.querySelector<HTMLElement>("#app");
if (!rootElement) {
  throw new Error("Missing #app element");
}

void boot(rootElement);

async function boot(root: HTMLElement): Promise<void> {
  const reactRoot = createRoot(root);
  const rendererRoot = document.createElement("div");
  rendererRoot.className = "outpost-renderer";
  const uiRuntime = createUiRuntime();
  const sharedSessionId = readSessionIdFromUrl();
  let bootPhase: OutpostBootPhase = "running";
  let bootMessage = "awaiting deployment order";
  let connection: OutpostConnectionView = {
    phase: "lobby",
    ...(sharedSessionId === undefined ? {} : { sessionId: sharedSessionId })
  };
  let context: OutpostBrowserContext | undefined;
  let disposeActive: (() => Promise<void>) | undefined;
  let deploymentPending = false;

  const render = (sync = false) => {
    const element = (
      <OutpostApp
        bootMessage={bootMessage}
        bootPhase={bootPhase}
        connection={connection}
        devtools={context?.devtools}
        onCreateSession={(displayName) => {
          void deploy({ kind: "create", sessionId: createOutpostSessionId(), displayName });
        }}
        onGameFocus={() => {
          if (context) {
            context.inputBlocked = false;
            void context.audio?.unlock();
          }
          uiRuntime.setFocus({ scope: "game", reason: "outpost.viewport" });
        }}
        onJoinSession={(sessionId, displayName) => {
          void deploy({ kind: "join", sessionId, displayName });
        }}
        onReady={(ready) => {
          void updateReady(ready);
        }}
        onResetConnection={() => {
          if (!deploymentPending) {
            connection = { phase: "lobby" };
            render();
          }
        }}
        rendererRoot={rendererRoot}
        uiRuntime={uiRuntime}
      />
    );
    if (sync) {
      flushSync(() => reactRoot.render(element));
    } else {
      reactRoot.render(element);
    }
  };

  render(true);

  async function deploy(intent: OutpostBrowserSessionIntent): Promise<void> {
    if (deploymentPending || disposeActive) {
      return;
    }
    deploymentPending = true;
    connection = { phase: "connecting" };
    render();

    let disposeAttempt: (() => Promise<void>) | undefined;
    try {
      const sessionId = normalizeOutpostSessionId(intent.sessionId);
      const config = await loadOutpostBrowserServerConfig();
      const identity = createOutpostBrowserIdentity(intent.displayName);
      const multiplayerClient = createOutpostBrowserMultiplayer(config, identity);
      const multiplayer = multiplayerClient.runtime;
      const { initRapier2dPhysicsBackend } = await import("@gamekits/physics-rapier2d");
      const physicsBackend = await initRapier2dPhysicsBackend({
        id: `outpost.browser.prediction.${identity.playerId}`
      });
      context = {
        ui: { rendererRoot },
        uiRuntime,
        physicsBackend,
        inputBlocked: true,
        assetDiagnostics: [],
        inputDiagnostics: []
      };
      bootPhase = "booting";
      bootMessage = "arming client presentation runtime";
      await waitForRendererRoot(rendererRoot);

      const configured = createConfiguredAppHost({
        app: outpostAppDefinition,
        profile: createOutpostBrowserProfile(context, {
          multiplayer,
          snapshotSource: multiplayerClient.snapshotSource,
          localPlayerId: identity.playerId
        }),
        context
      });
      const host = configured.host;
      let frameHandle = 0;
      let unsubscribeInput = () => {};
      let stopViewportObserver = () => {};
      let disposed = false;
      disposeAttempt = async () => {
        if (disposed) {
          return;
        }
        disposed = true;
        cancelAnimationFrame(frameHandle);
        stopViewportObserver();
        unsubscribeInput();
        await host.dispose();
      };

      await host.boot();
      const activeContext = context;
      if (
        !activeContext.client ||
        !activeContext.inputRouter ||
        !activeContext.multiplayer ||
        !activeContext.renderer ||
        !activeContext.camera
      ) {
        throw new Error("Outpost Browser profile did not expose the client multiplayer runtime.");
      }
      const client = activeContext.client;
      const inputRouter = activeContext.inputRouter;
      const runtime = activeContext.multiplayer;
      const renderer = activeContext.renderer;
      const camera = activeContext.camera;
      stopViewportObserver = observeElementViewport({
        element: rendererRoot,
        fallback: OUTPOST_VIEWPORT,
        onResize(viewport) {
          renderer.resize(viewport.width, viewport.height);
          camera.setState({ viewport });
        }
      });
      let lastUiSignature = "";
      let lastUiPollAt = Number.NEGATIVE_INFINITY;
      const syncMatchUi = (now: number) => {
        if (now - lastUiPollAt < 100) {
          return;
        }
        lastUiPollAt = now;
        const view = client.view();
        if (!view) {
          return;
        }
        const signature = matchUiSignature(view);
        if (signature === lastUiSignature) {
          return;
        }
        lastUiSignature = signature;
        connection = {
          phase: "connected",
          sessionId,
          localPlayerId: identity.playerId,
          match: view
        };
        render();
      };

      await enterOutpostBrowserSession(runtime, { ...intent, sessionId }, identity);
      await host.start();
      bootPhase = "running";
      bootMessage = "server authority online";
      connection = {
        phase: "connected",
        sessionId,
        localPlayerId: identity.playerId
      };
      render();

      unsubscribeInput = inputRouter.onAction((event) =>
        routeInputAction(activeContext, event, identity.playerId)
      );
      activeContext.inputBlocked = false;
      uiRuntime.setFocus({ scope: "game", reason: "outpost.multiplayer.connected" });

      let lastTime: number | undefined;
      const frame = (now: number) => {
        const delta = lastTime === undefined ? 0 : Math.max(0, Math.min(48, now - lastTime));
        lastTime = now;
        host.tick(delta, now);
        syncMatchUi(now);
        frameHandle = requestAnimationFrame(frame);
      };
      frameHandle = requestAnimationFrame(frame);
      disposeActive = disposeAttempt;
      updateSessionUrl(sessionId);
    } catch (error) {
      await disposeAttempt?.();
      context = undefined;
      bootPhase = "running";
      bootMessage = "deployment failed";
      connection = {
        phase: "failed",
        error: error instanceof Error ? error.message : String(error)
      };
      render();
    } finally {
      deploymentPending = false;
    }
  }

  async function updateReady(ready: boolean): Promise<void> {
    const runtime = context?.multiplayer;
    const authorityPeerId = context?.client?.snapshot().authorityPeerId;
    if (!runtime || !authorityPeerId || connection.phase !== "connected") {
      return;
    }
    connection = { ...connection, readyPending: true };
    render();
    try {
      await sendOutpostReady(runtime, authorityPeerId, ready);
    } catch (error) {
      connection = {
        phase: "failed",
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (connection.phase === "connected") {
        connection = { ...connection, readyPending: false };
      }
      render();
    }
  }

  window.addEventListener(
    "beforeunload",
    () => {
      void disposeActive?.();
    },
    { once: true }
  );

  function routeInputAction(
    activeContext: OutpostBrowserContext,
    event: InputActionEvent,
    localPlayerId: string
  ): void {
    const client = activeContext.client;
    if (!client) {
      return;
    }
    if (
      event.actionId === OUTPOST_ACTION.aim &&
      event.input.x !== undefined &&
      event.input.y !== undefined
    ) {
      setOutpostPointerViewportPosition(client.input, {
        x: event.input.x,
        y: event.input.y
      });
      const world = client.screenToWorld({ x: event.input.x, y: event.input.y });
      applyOutpostInputAction(client.input, {
        ...event,
        input: { ...event.input, x: world.x, y: world.y }
      });
      return;
    }
    applyOutpostInputAction(client.input, event);
    if (event.actionId === OUTPOST_ACTION.dash && event.phase === "pressed") {
      client.requestInputSample();
    }
    const localPlayer = client.view()?.players.find((player) => player.playerId === localPlayerId);
    if (localPlayer) {
      applyOutpostGamepadAimTarget(client.input, localPlayer);
    }
    const playerAction = outpostPlayerActionForInputAction(event);
    const authorityPeerId = client.snapshot().authorityPeerId;
    if (playerAction && authorityPeerId && activeContext.multiplayer) {
      void sendOutpostPlayerAction(
        activeContext.multiplayer,
        authorityPeerId,
        playerAction,
        {
          x: client.input.aimX,
          y: client.input.aimY
        },
        playerAction === "rifle" ? client.input.fireSequence : undefined,
        playerAction === "rifle" ? client.input.fireHeld : undefined,
        playerAction === "dash" ? client.input.dashSequence : undefined
      );
    }
  }
}

function matchUiSignature(match: NonNullable<OutpostConnectionView["match"]>): string {
  const countdown = Math.ceil(match.countdownMsRemaining / 100);
  const elapsed = Math.floor(match.elapsedMs / 100);
  const participants = match.participants
    .map(
      (participant) =>
        `${participant.peerId}:${participant.status}:${participant.ready}:${participant.slot ?? "x"}`
    )
    .join("|");
  const actors = match.combat.actors
    .map(
      (actor) =>
        `${actor.objectId}:${Math.round(actor.health)}:${Math.round(actor.shield)}:${Math.round(
          actor.stamina
        )}:${Math.round(actor.resource)}:${Object.values(actor.cooldowns).join(",")}:${
          actor.weapon?.magazine ?? "x"
        }:${actor.weapon?.reserveAmmo ?? "x"}:${
          actor.weapon?.phase ?? "x"
        }:${actor.weapon?.shotSequence ?? "x"}`
    )
    .join("|");
  return `${match.phase}:${countdown}:${elapsed}:${participants}:${actors}:${match.combat.kills}:${match.combat.rejectedCommands}:${match.combat.cueWatermark}`;
}

function updateSessionUrl(sessionId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("session", sessionId);
  window.history.replaceState(null, "", url);
}

function readSessionIdFromUrl(): string | undefined {
  const value = new URL(window.location.href).searchParams.get("session");
  if (!value) {
    return undefined;
  }
  try {
    return normalizeOutpostSessionId(value);
  } catch {
    return undefined;
  }
}

async function waitForRendererRoot(rendererRoot: HTMLElement): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (rendererRoot.isConnected) {
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  throw new Error("Outpost renderer root was not mounted");
}
