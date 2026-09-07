import {
  createMultiplayerSpeculativeEffectJournal,
  type MultiplayerSpeculativeEffectJournalDiagnostics
} from "@gamekits/multiplayer-core";
import type { PhysicsPredictionIslandContact } from "@gamekits/physics-core";

import { arenaItemPhysicsMemberId } from "../items/item-physics";
import type {
  ArenaPublicCombatHit,
  ArenaPublicItemAction,
  ArenaSnapshot
} from "../shared/protocol";

type ArenaPredictedEffect =
  | {
      kind: "jump";
      memberId: string;
      inputSequence: number;
    }
  | {
      kind: "item-action";
      commandId: string;
      itemId?: string | undefined;
    }
  | {
      kind: "item-hit";
      itemId: string;
      itemGeneration: number;
      targetParticipantId: string;
    };

type ArenaAuthorityEffect = ArenaPublicItemAction | ArenaPublicCombatHit;

export type ArenaClientEffectDiagnostics = {
  presentation: {
    anticipated: number;
    confirmed: number;
    cancelled: number;
    replaced: number;
  };
  journal: MultiplayerSpeculativeEffectJournalDiagnostics;
};

export type ArenaEffectPresentationEvent = {
  effectId: string;
  kind: ArenaPredictedEffect["kind"];
  phase: "anticipate" | "confirm" | "cancel" | "replace";
  tick: number;
};

export type ArenaClientEffectController = {
  anticipateJump(input: { memberId: string; inputSequence: number; predictionTick: number }): void;
  anticipateItemAction(input: {
    commandId: string;
    tick: number;
    itemId?: string | undefined;
  }): void;
  anticipateItemContacts(
    contacts: readonly PhysicsPredictionIslandContact[],
    snapshot: ArenaSnapshot | undefined,
    peerId: string
  ): void;
  reconcile(snapshot: ArenaSnapshot, peerId: string): void;
  diagnostics(): ArenaClientEffectDiagnostics;
  dispose(): void;
};

/**
 * Keeps predicted presentation reversible and replay-safe. Authority facts remain in snapshots;
 * this controller only deduplicates and settles client-side anticipation.
 */
export function createArenaClientEffectController(
  initialRound = 1,
  onPresentation?: (event: ArenaEffectPresentationEvent) => void
): ArenaClientEffectController {
  const presentation = { anticipated: 0, confirmed: 0, cancelled: 0, replaced: 0 };
  const journal = createMultiplayerSpeculativeEffectJournal<
    ArenaPredictedEffect,
    ArenaAuthorityEffect
  >({
    generation: roundGeneration(initialRound),
    maxPending: 256,
    maxResolved: 512,
    maxAgeTicks: 45,
    hooks: {
      onAnticipate(effect) {
        presentation.anticipated += 1;
        onPresentation?.({
          effectId: effect.effectId,
          kind: effect.value.kind,
          phase: "anticipate",
          tick: effect.tick
        });
      },
      onConfirm(event) {
        presentation.confirmed += 1;
        onPresentation?.({
          effectId: event.effect.effectId,
          kind: event.effect.value.kind,
          phase: "confirm",
          tick: event.tick
        });
      },
      onCancel(event) {
        presentation.cancelled += 1;
        onPresentation?.({
          effectId: event.effect.effectId,
          kind: event.effect.value.kind,
          phase: "cancel",
          tick: event.tick
        });
      },
      onReplace(event) {
        presentation.replaced += 1;
        onPresentation?.({
          effectId: event.effect.effectId,
          kind: event.effect.value.kind,
          phase: "replace",
          tick: event.tick
        });
      }
    }
  });

  return {
    anticipateJump({ memberId, inputSequence, predictionTick }) {
      journal.anticipate({
        effectId: `jump:${memberId}:${inputSequence}`,
        tick: predictionTick,
        value: { kind: "jump", memberId, inputSequence }
      });
    },
    anticipateItemAction({ commandId, tick, itemId }) {
      journal.anticipate({
        effectId: `item-action:${commandId}`,
        tick,
        value: { kind: "item-action", commandId, ...(itemId === undefined ? {} : { itemId }) }
      });
    },
    anticipateItemContacts(contacts, snapshot, peerId) {
      if (snapshot === undefined) return;
      const localParticipant = snapshot.participants.find(
        (participant) => participant.peerId === peerId
      );
      if (localParticipant === undefined) return;
      for (const contact of contacts) {
        if (contact.phase !== "enter") continue;
        for (const [itemBodyId, targetBodyId] of [
          [contact.bodyA, contact.bodyB],
          [contact.bodyB, contact.bodyA]
        ] as const) {
          if (itemBodyId === undefined || targetBodyId === undefined) continue;
          const item = snapshot.items.find(
            (candidate) =>
              candidate.bodyMemberId === itemBodyId ||
              ((candidate.state === "windup" ||
                candidate.state === "released" ||
                candidate.state === "triggered") &&
                arenaItemPhysicsMemberId({
                  id: candidate.id,
                  instanceGeneration:
                    candidate.bodyMemberId === undefined
                      ? candidate.instanceGeneration + 1
                      : candidate.instanceGeneration
                }) === itemBodyId)
          );
          const target = snapshot.participants.find(
            (participant) => participant.actorMemberId === targetBodyId
          );
          if (
            item?.executionId === undefined ||
            target === undefined ||
            ((item.sourceParticipantId ?? item.ownerParticipantId) !== localParticipant.id &&
              target.id !== localParticipant.id)
          ) {
            continue;
          }
          const itemGeneration =
            item.bodyMemberId === undefined ? item.instanceGeneration + 1 : item.instanceGeneration;
          journal.anticipate({
            effectId: `item-hit:${item.executionId}:${target.id}`,
            tick: contact.tick,
            value: {
              kind: "item-hit",
              itemId: item.id,
              itemGeneration,
              targetParticipantId: target.id
            }
          });
        }
      }
    },
    reconcile(snapshot, peerId) {
      const generation = roundGeneration(snapshot.frame.generation);
      if (journal.generation() !== generation) {
        journal.reset(generation);
      }
      const acknowledgedSequence = snapshot.inputAcksByPeerId[peerId] ?? 0;
      for (const effect of journal.pending()) {
        if (effect.value.kind === "jump") {
          if (effect.value.inputSequence <= acknowledgedSequence) {
            journal.resolve({
              effectId: effect.effectId,
              generation,
              tick: snapshot.frame.tick,
              outcome: "confirm"
            });
          }
          continue;
        }
        if (effect.value.kind === "item-action") {
          const predicted = effect.value;
          const action = snapshot.itemActions.find(
            (candidate) => candidate.id === predicted.commandId
          );
          if (action?.status === "confirmed") {
            journal.resolve({
              effectId: effect.effectId,
              generation,
              tick: action.tick,
              outcome: "confirm",
              authority: action
            });
          } else if (action?.status === "rejected") {
            journal.resolve({
              effectId: effect.effectId,
              generation,
              tick: action.tick,
              outcome: "cancel",
              reason: action.code
            });
          }
          continue;
        }
        if (effect.value.kind === "item-hit") {
          const predicted = effect.value;
          const hit = snapshot.combat.hits.find(
            (candidate) =>
              candidate.itemId === predicted.itemId &&
              candidate.itemGeneration === predicted.itemGeneration &&
              candidate.targetParticipantId === predicted.targetParticipantId
          );
          if (hit !== undefined) {
            journal.resolve({
              effectId: effect.effectId,
              generation,
              tick: hit.tick,
              outcome: "confirm",
              authority: hit
            });
          }
          continue;
        }
      }
      journal.expire(snapshot.frame.tick);
    },
    diagnostics() {
      return {
        presentation: { ...presentation },
        journal: journal.diagnostics()
      };
    },
    dispose() {
      journal.dispose();
    }
  };
}

function roundGeneration(generation: string | number): string {
  return typeof generation === "number" ? `m${generation}.s1.r${generation}` : generation;
}
