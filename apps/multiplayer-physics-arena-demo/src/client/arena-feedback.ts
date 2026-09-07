import type { GameAudio, GameAudioSnapshot } from "@gamekits/audio-core";
import type { PhysicsPredictionIslandStateSnapshot } from "@gamekits/physics-core";

import { sampleArenaStageHazards, type ArenaHazardPhase } from "../shared/arena-stage-course";
import type { ArenaSnapshot } from "../shared/protocol";
import { ARENA_AUDIO_IDS } from "./arena-audio-content";
import type { ArenaEffectPresentationEvent } from "./arena-effects";
import type { ArenaPresentationSnapshot } from "./arena-presentation";

export type ArenaFeedbackSnapshot = {
  camera: {
    mode: "playing" | "spectator" | "broadcast";
    targetMemberId?: string | undefined;
  };
  hazards: Array<{
    memberId: string;
    kind: ReturnType<typeof sampleArenaStageHazards>[number]["kind"];
    phase: ArenaHazardPhase;
    nextTransitionTick: number;
  }>;
  audio: GameAudioSnapshot;
};

export type ArenaFeedbackDiagnostics = {
  hazardTransitions: number;
  cameraSwitches: number;
  effectSounds: number;
  trackedEmitters: number;
  disposed: boolean;
};

export type ArenaFeedbackRuntime = {
  unlock(): Promise<boolean>;
  sync(input: {
    snapshot: ArenaSnapshot | undefined;
    predictedState: PhysicsPredictionIslandStateSnapshot | undefined;
    presentation: ArenaPresentationSnapshot;
    localMemberId?: string | undefined;
    deltaMs: number;
  }): void;
  effect(event: ArenaEffectPresentationEvent): void;
  cycleSpectatorTarget(direction: -1 | 1): void;
  snapshot(): ArenaFeedbackSnapshot;
  diagnostics(): ArenaFeedbackDiagnostics;
  dispose(): void;
};

const LISTENER_ID = "knockout.camera";
const AUDIO_OWNER_ID = "knockout.match";

export function createArenaFeedbackRuntime(audio: GameAudio): ArenaFeedbackRuntime {
  let latestSnapshot: ArenaSnapshot | undefined;
  let latestState: PhysicsPredictionIslandStateSnapshot | undefined;
  let feedback: ArenaFeedbackSnapshot = {
    camera: { mode: "broadcast" },
    hazards: [],
    audio: audio.snapshot()
  };
  let elapsedMs = 0;
  let matchPhaseSignature = "";
  let cameraSignature = "";
  let preferredCameraMemberId: string | undefined;
  const hazardSignatures = new Map<string, string>();
  const emitterIds = new Set<string>();
  let hazardTransitions = 0;
  let cameraSwitches = 0;
  let effectSounds = 0;
  let disposed = false;

  return {
    unlock: () => audio.unlock(),
    sync({ snapshot, predictedState, presentation, localMemberId, deltaMs }) {
      if (disposed) return;
      latestSnapshot = snapshot;
      latestState = predictedState;
      elapsedMs += Math.min(50, Math.max(0, deltaMs));
      const camera = resolveCamera(snapshot, localMemberId, preferredCameraMemberId);
      const nextCameraSignature = `${camera.mode}:${camera.targetMemberId ?? "none"}`;
      if (cameraSignature !== nextCameraSignature) {
        cameraSignature = nextCameraSignature;
        cameraSwitches += 1;
      }
      const hazards =
        snapshot === undefined
          ? []
          : sampleArenaStageHazards({
              stageIndex: snapshot.match.stageIndex,
              tick: predictedState?.tick ?? snapshot.frame.tick,
              stageStartedAtTick:
                snapshot.match.stageStartedAtTick === undefined
                  ? (predictedState?.tick ?? snapshot.frame.tick)
                  : snapshot.match.physicsStageStartedAtTick
            }).map(({ memberId, kind, phase, nextTransitionTick }) => ({
              memberId,
              kind,
              phase,
              nextTransitionTick
            }));
      syncMusic(snapshot);
      syncSpatialAudio(
        predictedState,
        presentation,
        camera.targetMemberId,
        new Set(hazards.map((hazard) => hazard.memberId))
      );
      syncHazardAudio(snapshot, hazards);
      audio.update(deltaMs, elapsedMs);
      feedback = { camera, hazards, audio: audio.snapshot() };
    },
    effect(event) {
      if (disposed || event.phase === "cancel") return;
      const position = effectPosition(event, latestSnapshot, latestState);
      const eventId =
        event.kind === "jump"
          ? ARENA_AUDIO_IDS.jump
          : event.kind === "item-action"
            ? ARENA_AUDIO_IDS.item
            : ARENA_AUDIO_IDS.impact;
      const result = audio.sfx.play(eventId, {
        ownerId: AUDIO_OWNER_ID,
        dedupeKey: event.effectId,
        ...(position === undefined ? {} : { transform: { position } })
      });
      if (result.status === "playing" || result.status === "scheduled") effectSounds += 1;
    },
    cycleSpectatorTarget(direction) {
      if (disposed || latestSnapshot === undefined) return;
      const candidates = activeCameraCandidates(latestSnapshot);
      if (candidates.length === 0) {
        preferredCameraMemberId = undefined;
        return;
      }
      const currentIndex = candidates.findIndex(
        ({ actorMemberId }) => actorMemberId === feedback.camera.targetMemberId
      );
      const nextIndex =
        currentIndex < 0 ? 0 : (currentIndex + direction + candidates.length) % candidates.length;
      preferredCameraMemberId = candidates[nextIndex]?.actorMemberId;
    },
    snapshot() {
      return {
        camera: { ...feedback.camera },
        hazards: feedback.hazards.map((hazard) => ({ ...hazard })),
        audio: structuredClone(feedback.audio)
      };
    },
    diagnostics() {
      return {
        hazardTransitions,
        cameraSwitches,
        effectSounds,
        trackedEmitters: emitterIds.size,
        disposed
      };
    },
    dispose() {
      if (disposed) return;
      audio.music.stop({ fadeMs: 160 });
      audio.sfx.stopOwner(AUDIO_OWNER_ID, { fadeMs: 80 });
      for (const emitterId of emitterIds)
        audio.spatial.removeEmitter(emitterId, { stopPlayback: true });
      audio.spatial.removeListener(LISTENER_ID);
      emitterIds.clear();
      hazardSignatures.clear();
      disposed = true;
    }
  };

  function syncMusic(snapshot: ArenaSnapshot | undefined): void {
    const signature = `${snapshot?.match.matchId ?? "offline"}:${snapshot?.phase ?? "lobby"}`;
    if (signature === matchPhaseSignature) return;
    matchPhaseSignature = signature;
    const track =
      snapshot?.phase === "running"
        ? ARENA_AUDIO_IDS.musicRunning
        : snapshot?.phase === "results"
          ? ARENA_AUDIO_IDS.musicResults
          : ARENA_AUDIO_IDS.musicLobby;
    const current = audio.music.getState().trackId;
    if (current === undefined) audio.music.play(track, { fadeInMs: 320 });
    else if (current !== track)
      audio.music.transitionTo(track, { type: "crossfade", durationMs: 480 });
    audio.sfx.play(ARENA_AUDIO_IDS.stage, {
      ownerId: AUDIO_OWNER_ID,
      dedupeKey: `phase:${signature}`
    });
  }

  function syncHazardAudio(
    snapshot: ArenaSnapshot | undefined,
    hazards: ArenaFeedbackSnapshot["hazards"]
  ): void {
    const retained = new Set<string>();
    const listenerPosition = latestState?.members.find(
      (member) => member.id === feedback.camera.targetMemberId
    )?.body.position;
    const pending: Array<{
      hazard: ArenaFeedbackSnapshot["hazards"][number];
      signature: string;
      position: { x: number; y: number; z?: number | undefined } | undefined;
      distance: number;
    }> = [];
    for (const hazard of hazards) {
      retained.add(hazard.memberId);
      const signature = `${snapshot?.match.stageInstanceId}:${hazard.phase}:${hazard.nextTransitionTick}`;
      if (hazardSignatures.get(hazard.memberId) === signature) continue;
      hazardSignatures.set(hazard.memberId, signature);
      hazardTransitions += 1;
      if (hazard.phase !== "warning" && hazard.phase !== "active") continue;
      const position = latestState?.members.find((member) => member.id === hazard.memberId)?.body
        .position;
      pending.push({
        hazard,
        signature,
        position,
        distance:
          position === undefined || listenerPosition === undefined
            ? Number.POSITIVE_INFINITY
            : Math.hypot(
                position.x - listenerPosition.x,
                position.y - listenerPosition.y,
                (position.z ?? 0) - (listenerPosition.z ?? 0)
              )
      });
    }
    pending.sort(
      (left, right) =>
        Number(left.hazard.phase === "active") - Number(right.hazard.phase === "active") ||
        left.distance - right.distance ||
        left.hazard.memberId.localeCompare(right.hazard.memberId)
    );
    for (const { hazard, signature, position } of pending.slice(0, 8)) {
      audio.sfx.play(
        hazard.phase === "warning" ? ARENA_AUDIO_IDS.hazardWarning : ARENA_AUDIO_IDS.hazardActive,
        {
          ownerId: AUDIO_OWNER_ID,
          ...(position === undefined ? {} : { transform: { position } }),
          dedupeKey: `hazard:${hazard.memberId}:${signature}`
        }
      );
    }
    for (const memberId of hazardSignatures.keys()) {
      if (!retained.has(memberId)) hazardSignatures.delete(memberId);
    }
  }

  function syncSpatialAudio(
    state: PhysicsPredictionIslandStateSnapshot | undefined,
    presentation: ArenaPresentationSnapshot,
    cameraTargetMemberId: string | undefined,
    hazardIds: ReadonlySet<string>
  ): void {
    const actorIds = new Set(presentation.actors.map((actor) => actor.memberId));
    const nextEmitterIds = new Set<string>();
    const emitters = (state?.members ?? [])
      .filter((member) => actorIds.has(member.id) || hazardIds.has(member.id))
      .map((member) => {
        nextEmitterIds.add(member.id);
        return {
          id: member.id,
          transform: { position: { ...member.body.position } },
          velocity: { ...member.body.linearVelocity },
          active: true
        };
      });
    audio.spatial.setEmitters(emitters);
    for (const emitterId of emitterIds) {
      if (!nextEmitterIds.has(emitterId))
        audio.spatial.removeEmitter(emitterId, { stopPlayback: true });
    }
    emitterIds.clear();
    for (const emitterId of nextEmitterIds) emitterIds.add(emitterId);
    const listenerBody = state?.members.find((member) => member.id === cameraTargetMemberId)?.body;
    audio.spatial.setListener({
      id: LISTENER_ID,
      transform: { position: listenerBody?.position ?? { x: 0, y: 6, z: 8 } },
      weight: 1
    });
  }
}

function resolveCamera(
  snapshot: ArenaSnapshot | undefined,
  localMemberId: string | undefined,
  preferredMemberId: string | undefined
): ArenaFeedbackSnapshot["camera"] {
  if (localMemberId !== undefined) {
    const localParticipant = snapshot?.participants.find(
      (participant) => participant.actorMemberId === localMemberId
    );
    if (
      snapshot === undefined ||
      localParticipant?.status === "active" ||
      (snapshot.phase === "countdown" && localParticipant?.status === "lobby")
    ) {
      return { mode: "playing", targetMemberId: localMemberId };
    }
  }
  const candidates = snapshot === undefined ? [] : activeCameraCandidates(snapshot);
  const winner = snapshot?.participants.find((participant) => participant.id === snapshot.winnerId);
  const preferred = candidates.find(({ actorMemberId }) => actorMemberId === preferredMemberId);
  const targetMemberId =
    winner?.actorMemberId ?? preferred?.actorMemberId ?? candidates[0]?.actorMemberId;
  return {
    mode: snapshot?.phase === "results" ? "broadcast" : "spectator",
    ...(targetMemberId === undefined ? {} : { targetMemberId })
  };
}

function activeCameraCandidates(snapshot: ArenaSnapshot): ArenaSnapshot["participants"] {
  return [...snapshot.participants]
    .filter(
      (participant) => participant.status === "active" && participant.actorMemberId !== undefined
    )
    .sort((left, right) => left.slot - right.slot || left.id.localeCompare(right.id));
}

function effectPosition(
  event: ArenaEffectPresentationEvent,
  snapshot: ArenaSnapshot | undefined,
  state: PhysicsPredictionIslandStateSnapshot | undefined
): { x: number; y: number; z?: number | undefined } | undefined {
  const participantId = event.kind === "item-hit" ? event.effectId.split(":").at(-1) : undefined;
  const explicitMemberId =
    event.kind === "jump"
      ? event.effectId.slice("jump:".length, event.effectId.lastIndexOf(":"))
      : snapshot?.participants.find((participant) => participant.id === participantId)
          ?.actorMemberId;
  const member = state?.members.find((candidate) => candidate.id === explicitMemberId);
  return member === undefined ? undefined : { ...member.body.position };
}
