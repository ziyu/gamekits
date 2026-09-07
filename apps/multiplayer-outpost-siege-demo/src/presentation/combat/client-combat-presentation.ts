import { defineGameModule } from "@gamekits/core";
import type { GameInstallContext } from "@gamekits/game-runtime";

import type { OutpostReplicatedCombatCue, OutpostReplicatedCombatState } from "../../domain";
import { cloneCombatCue } from "../../gameplay/combat-cue-stream";

export type OutpostClientCombatPresentationCue = Omit<OutpostReplicatedCombatCue, "sequence"> & {
  sequence: number;
  authoritySequence: number;
};

export type OutpostClientCombatPresentationSnapshot = {
  cueWatermark: number;
  authorityCueWatermark: number;
  retainedCues: number;
  consumedCues: number;
  droppedCues: number;
  authorityResets: number;
};

export type OutpostClientCombatPresentation = {
  update(input: {
    active: boolean;
    cueWatermark: number;
    cues: readonly OutpostReplicatedCombatCue[];
  }): void;
  cuesAfter(sequence: number): OutpostClientCombatPresentationCue[];
  snapshot(): OutpostClientCombatPresentationSnapshot;
  reset(): void;
};

export type CreateOutpostClientCombatPresentationOptions = {
  cueHistoryLimit?: number | undefined;
};

const DEFAULT_CLIENT_COMBAT_CUE_HISTORY_LIMIT = 64;

export function createOutpostClientCombatPresentation(
  options: CreateOutpostClientCombatPresentationOptions = {}
): OutpostClientCombatPresentation {
  const cueHistoryLimit = options.cueHistoryLimit ?? DEFAULT_CLIENT_COMBAT_CUE_HISTORY_LIMIT;
  if (!Number.isSafeInteger(cueHistoryLimit) || cueHistoryLimit <= 0) {
    throw new Error("Outpost client combat cue history limit must be a positive safe integer.");
  }
  const cues: OutpostClientCombatPresentationCue[] = [];
  let initialized = false;
  let cueWatermark = 0;
  let authorityCueWatermark = 0;
  let consumedCues = 0;
  let droppedCues = 0;
  let authorityResets = 0;

  return {
    update(input) {
      if (!input.active) {
        initialized = false;
        authorityCueWatermark = input.cueWatermark;
        return;
      }
      if (!initialized) {
        initialized = true;
        authorityCueWatermark = input.cueWatermark;
        return;
      }
      if (input.cueWatermark < authorityCueWatermark) {
        authorityResets += 1;
        authorityCueWatermark = input.cueWatermark;
        return;
      }
      if (input.cueWatermark === authorityCueWatermark) {
        return;
      }

      let cursor = authorityCueWatermark;
      const pending = input.cues
        .filter((cue) => cue.sequence > authorityCueWatermark)
        .sort((left, right) => left.sequence - right.sequence);
      for (const authorityCue of pending) {
        if (authorityCue.sequence > input.cueWatermark) {
          break;
        }
        if (authorityCue.sequence <= cursor) {
          continue;
        }
        if (authorityCue.sequence > cursor + 1) {
          droppedCues += authorityCue.sequence - cursor - 1;
        }
        cursor = authorityCue.sequence;
        cueWatermark += 1;
        const cue = cloneCombatCue(authorityCue);
        cues.push({
          ...cue,
          sequence: cueWatermark,
          authoritySequence: authorityCue.sequence
        });
        consumedCues += 1;
      }
      if (input.cueWatermark > cursor) {
        droppedCues += input.cueWatermark - cursor;
      }
      authorityCueWatermark = input.cueWatermark;
      if (cues.length > cueHistoryLimit) {
        cues.splice(0, cues.length - cueHistoryLimit);
      }
    },
    cuesAfter(sequence) {
      return cues
        .filter((cue) => cue.sequence > sequence)
        .map((cue) => ({
          ...cue,
          ...(cue.position === undefined ? {} : { position: { ...cue.position } }),
          ...(cue.normal === undefined ? {} : { normal: { ...cue.normal } }),
          ...(cue.direction === undefined ? {} : { direction: { ...cue.direction } })
        }));
    },
    snapshot() {
      return {
        cueWatermark,
        authorityCueWatermark,
        retainedCues: cues.length,
        consumedCues,
        droppedCues,
        authorityResets
      };
    },
    reset() {
      initialized = false;
      cueWatermark = 0;
      authorityCueWatermark = 0;
      consumedCues = 0;
      droppedCues = 0;
      authorityResets = 0;
      cues.length = 0;
    }
  };
}

export function createOutpostClientCombatPresentationModule(options: {
  presentation: OutpostClientCombatPresentation;
  readCombat():
    | {
        active: boolean;
        combat: Pick<OutpostReplicatedCombatState, "cueWatermark" | "cues">;
      }
    | undefined;
}) {
  return defineGameModule<GameInstallContext>({
    id: "outpost.client.combat-presentation",
    install(ctx) {
      ctx.systems.register({
        id: "outpost.client.combat-presentation.update",
        update() {
          const frame = options.readCombat();
          options.presentation.update({
            active: frame?.active ?? false,
            cueWatermark: frame?.combat.cueWatermark ?? 0,
            cues: frame?.combat.cues ?? []
          });
        }
      });
      return () => options.presentation.reset();
    }
  });
}
