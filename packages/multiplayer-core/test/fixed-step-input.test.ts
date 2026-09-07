import { describe, expect, it } from "vitest";
import {
  createMultiplayerFixedStepInputBundle,
  createMultiplayerFixedStepInputInbox,
  readMultiplayerFixedStepInputBundle
} from "../src";

describe("fixed-step input delivery", () => {
  it("deduplicates redundant bundles and consumes contiguous input", () => {
    const inbox = createMultiplayerFixedStepInputInbox<{ move: number }>({
      maxBufferedFramesPerSource: 8
    });
    const first = createMultiplayerFixedStepInputBundle([
      { sequence: 1, payload: { move: 1 } },
      { sequence: 2, payload: { move: 2 } }
    ]);
    const second = createMultiplayerFixedStepInputBundle([
      { sequence: 1, payload: { move: 1 } },
      { sequence: 2, payload: { move: 2 } },
      { sequence: 3, payload: { move: 3 } }
    ]);

    expect(
      inbox.ingest({
        sourceId: "peer-1",
        generation: "round-1",
        bundle: first,
        decode: readMove
      })
    ).toEqual({ status: "accepted", accepted: 2, duplicates: 0, stale: 0, rejected: 0 });
    expect(
      inbox.ingest({
        sourceId: "peer-1",
        generation: "round-1",
        bundle: second,
        decode: readMove
      })
    ).toEqual({ status: "accepted", accepted: 1, duplicates: 2, stale: 0, rejected: 0 });

    expect(inbox.consume({ sourceId: "peer-1", generation: "round-1" })).toMatchObject({
      status: "input",
      acknowledgedSequence: 1,
      frame: { sequence: 1, payload: { move: 1 } }
    });
    expect(inbox.consume({ sourceId: "peer-1", generation: "round-1" })).toMatchObject({
      status: "input",
      acknowledgedSequence: 2
    });
    expect(inbox.consume({ sourceId: "peer-1", generation: "round-1" })).toMatchObject({
      status: "input",
      acknowledgedSequence: 3
    });
    expect(inbox.diagnostics()).toMatchObject({
      sources: 1,
      queuedFrames: 0,
      acceptedFrames: 3,
      duplicateFrames: 2,
      consumedFrames: 3
    });
  });

  it("fills an observed sequence gap only after the configured wait budget", () => {
    const inbox = createMultiplayerFixedStepInputInbox<{ move: number }>({
      maxGapTicks: 1,
      gapPolicy: "neutral",
      neutralInput: () => ({ move: 0 })
    });
    inbox.ingest({
      sourceId: "peer-1",
      generation: 1,
      bundle: createMultiplayerFixedStepInputBundle([{ sequence: 2, payload: { move: 2 } }]),
      decode: readMove
    });

    expect(inbox.consume({ sourceId: "peer-1", generation: 1 })).toEqual({
      status: "gap",
      acknowledgedSequence: 0
    });
    expect(inbox.consume({ sourceId: "peer-1", generation: 1 })).toMatchObject({
      status: "gap-filled",
      acknowledgedSequence: 1,
      frame: { sequence: 1, payload: { move: 0 } }
    });
    expect(inbox.consume({ sourceId: "peer-1", generation: 1 })).toMatchObject({
      status: "input",
      acknowledgedSequence: 2,
      frame: { sequence: 2, payload: { move: 2 } }
    });
    expect(inbox.diagnostics()).toMatchObject({ gaps: 2, gapFills: 1 });
  });

  it("rejects invalid bundle envelopes and releases retained source state", () => {
    expect(readMultiplayerFixedStepInputBundle({ protocol: "wrong", frames: [] })).toBeUndefined();
    expect(
      readMultiplayerFixedStepInputBundle({
        protocol: "gamekits.fixed-step-input.v1",
        frames: [
          { sequence: 1, payload: {} },
          { sequence: 1, payload: {} }
        ]
      })
    ).toBeUndefined();

    const inbox = createMultiplayerFixedStepInputInbox<{ move: number }>();
    inbox.ingest({
      sourceId: "peer-1",
      generation: "round-1",
      bundle: createMultiplayerFixedStepInputBundle([{ sequence: 1, payload: { move: 1 } }]),
      decode: readMove
    });
    inbox.release("peer-1");
    expect(inbox.diagnostics()).toMatchObject({ sources: 0, queuedFrames: 0 });
    inbox.dispose();
    expect(inbox.diagnostics()).toMatchObject({ disposed: true });
  });
});

function readMove(value: unknown): { move: number } | undefined {
  return value !== null &&
    typeof value === "object" &&
    typeof (value as { move?: unknown }).move === "number"
    ? { move: (value as { move: number }).move }
    : undefined;
}
