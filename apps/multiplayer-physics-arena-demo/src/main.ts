import "./styles.css";

import { createConfiguredAppHost } from "@gamekits/app-host";
import type { ThreeRendererNative } from "@gamekits/driver-three";
import { initRapier3dPhysicsBackend } from "@gamekits/physics-rapier3d";

import { createArenaGameAudio } from "./client/arena-audio-content";
import { createArenaFeedbackRuntime } from "./client/arena-feedback";
import { createArenaInputController } from "./client/arena-input";
import { createArenaHazardAudit } from "./client/arena-hazard-audit";
import { createArenaWebAudioBackend } from "./client/arena-web-audio-backend";
import { createArenaDefinitionMap } from "./shared/arena-definition";
import { createArenaVisual } from "./client/arena-visual";
import {
  arenaAppDefinition,
  createArenaAppProfile,
  measureArenaViewport,
  type ArenaAppContext
} from "./client/app-profile";
import {
  createArenaClientSession,
  loadArenaServerConfig,
  type ArenaClientSession,
  type ArenaSessionIntent
} from "./client/session";
import { renderArenaUi, updateArenaUi } from "./client/ui";
import { readArenaStageSelection } from "./shared/arena-stage-selection";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app element.");

void boot(root).catch((error) => {
  root.replaceChildren();
  const message = document.createElement("pre");
  message.className = "arena-boot-error";
  message.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
  root.append(message);
});

async function boot(rootElement: HTMLElement): Promise<void> {
  const ui = renderArenaUi(rootElement);
  const context: ArenaAppContext = { ui };
  const configured = createConfiguredAppHost({
    app: arenaAppDefinition,
    profile: createArenaAppProfile(),
    context
  });
  await configured.host.boot();
  await configured.host.start();
  const renderer = requireValue(context.renderer, "Three renderer");
  const native = renderer.native() as ThreeRendererNative;
  const visual = createArenaVisual(native, createArenaDefinitionMap());
  const hazardAudit = createArenaHazardAudit(ui.viewport);
  const audio = createArenaGameAudio(createArenaWebAudioBackend());
  const feedback = createArenaFeedbackRuntime(audio);
  const serverConfig = await loadArenaServerConfig();
  let session: ArenaClientSession | undefined;
  const input = createArenaInputController(ui.viewport, {
    onItemAction: (action) => void session?.itemAction(action),
    onSpectatorCycle: (direction) => feedback.cycleSpectatorTarget(direction)
  });
  let connecting = false;
  let lastFrame: number | undefined;
  let lastUiUpdate = 0;

  ui.setConnection("offline", "AUTHORITY READY · CHOOSE CREATE OR JOIN");

  const connect = async (intent: ArenaSessionIntent): Promise<void> => {
    if (connecting) return;
    connecting = true;
    ui.setBusy(true);
    ui.setConnection("connecting", `${intent.toUpperCase()} · NEGOTIATING ROOM`);
    try {
      await feedback.unlock();
      await session?.dispose();
      session = undefined;
      const physicsBackend = await initRapier3dPhysicsBackend({
        id: `knockout.browser.rapier3d.${Date.now()}`,
        groups: { "arena-item": 0b001, "arena-actor": 0b010, "arena-world": 0b100 }
      });
      session = await createArenaClientSession({
        config: serverConfig,
        sessionId: ui.sessionInput.value,
        displayName: ui.nameInput.value,
        intent,
        stageSelection: readArenaStageSelection(ui.stageSelect.value),
        physicsBackend,
        readInput: input.sample,
        onEffect(event) {
          feedback.effect(event);
          visual.effect(event);
          ui.showEffect(event);
        }
      });
      ui.setConnection("online", `AUTHORITY LINKED · ${session.peerId}`);
      ui.disconnectButton.disabled = false;
      ui.pushLog(`${intent} accepted · ${session.peerId}`);
      ui.viewport.focus();
    } catch (error) {
      ui.setConnection("error", error instanceof Error ? error.message : String(error));
      ui.pushLog("connection rejected");
    } finally {
      connecting = false;
      ui.setBusy(false);
      ui.disconnectButton.disabled = session === undefined;
    }
  };

  ui.createButton.addEventListener("click", () => void connect("create"));
  ui.joinButton.addEventListener("click", () => void connect("join"));
  ui.spectatorPreviousButton.addEventListener("click", () => feedback.cycleSpectatorTarget(-1));
  ui.spectatorNextButton.addEventListener("click", () => feedback.cycleSpectatorTarget(1));
  ui.disconnectButton.addEventListener("click", () => {
    const active = session;
    session = undefined;
    void active?.dispose();
    ui.setConnection("offline", "AUTHORITY DISCONNECTED");
    ui.disconnectButton.disabled = true;
    ui.pushLog("left room");
  });

  const resizeObserver = new ResizeObserver(() => {
    const size = measureArenaViewport(ui.viewport);
    renderer.resize(size.width, size.height);
  });
  resizeObserver.observe(ui.viewport);

  let frameHandle = 0;
  const frame = (now: number): void => {
    const delta = Math.min(50, lastFrame === undefined ? 1000 / 60 : now - lastFrame);
    lastFrame = now;
    configured.host.tick(delta, now);
    session?.tick(delta);
    const snapshot = session?.snapshot();
    const predictedState = session?.predictedState();
    const simulationState = predictedState ?? snapshot?.frame;
    const stateSource =
      predictedState !== undefined
        ? "predicted"
        : snapshot !== undefined
          ? "authority-fallback"
          : "unavailable";
    const presentation = session?.presentation() ?? { generation: 0, actors: [], items: [] };
    feedback.sync({
      snapshot,
      predictedState: simulationState,
      presentation,
      localMemberId: session?.localMemberId(),
      deltaMs: delta
    });
    const feedbackSnapshot = feedback.snapshot();
    visual.update(simulationState, session?.localMemberId(), delta, presentation, feedbackSnapshot);
    const auditMemberIds =
      snapshot === undefined ? [] : visual.inspectableMembers(snapshot.match.stageIndex);
    hazardAudit?.update({
      snapshot,
      predictedState: simulationState,
      stateSource,
      hazards: feedbackSnapshot.hazards,
      list: visual.inspectableMembers,
      select: visual.inspect,
      visuals: visual.inspections(auditMemberIds)
    });
    if (now - lastUiUpdate >= 100) {
      updateArenaUi(
        ui,
        snapshot,
        session?.localMemberId(),
        {
          ...(session?.telemetry() ?? { status: "offline" }),
          feedback: feedback.diagnostics(),
          audio: {
            unlock: feedbackSnapshot.audio.unlock,
            active: feedbackSnapshot.audio.activePlaybackInstances,
            native: feedbackSnapshot.audio.nativePlaybackCount,
            emitters: feedbackSnapshot.audio.spatial.emitters.length
          }
        },
        {
          camera: feedbackSnapshot.camera,
          inputDevice: input.device(),
          localPeerId: session?.peerId
        }
      );
      lastUiUpdate = now;
    }
    frameHandle = requestAnimationFrame(frame);
  };
  frameHandle = requestAnimationFrame(frame);

  window.addEventListener(
    "beforeunload",
    () => {
      cancelAnimationFrame(frameHandle);
      resizeObserver.disconnect();
      input.dispose();
      visual.destroy();
      hazardAudit?.destroy();
      feedback.dispose();
      audio.dispose();
      void session?.dispose();
      void configured.host.dispose();
    },
    { once: true }
  );
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}.`);
  return value;
}
