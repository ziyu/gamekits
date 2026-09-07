import { createEventBus } from "@gamekits/event-bus";
import { describe, expect, it } from "vitest";
import {
  createMultiplayerAuthorityBindingStore,
  createMultiplayerClientReplication,
  createMultiplayerModule,
  readMultiplayerFixedStepInputBundle,
  type MultiplayerBridgeInstallContext,
  type MultiplayerBridgeSystem,
  type MultiplayerMessageEnvelope,
  type MultiplayerMessageListener,
  type MultiplayerOutgoingMessage,
  type MultiplayerRuntime
} from "../src";

type Snapshot = { tick: number; x: number; ack: number };
type Input = { dx: number };
type State = { x: number };

describe("managed client prediction domains", () => {
  it("sends a bounded redundant bundle and prunes acknowledged encoded frames", async () => {
    const harness = createRuntimeHarness();
    const binding = createBinding("session-1");
    const replication = createMultiplayerClientReplication<Snapshot, Input, State, undefined>({
      runtime: harness.runtime,
      installContext: undefined,
      options: {
        authority: { binding },
        readSnapshot: readSnapshot,
        prediction: {
          inputRateHz: 20,
          maxPredictionLeadInputs: 4,
          inputDelivery: { mode: "redundant-bundle", maxFramesPerBundle: 4 },
          buffer: {
            cloneState: (state) => ({ ...state }),
            applyInput(state, input) {
              state.x += input.dx;
              return state;
            }
          },
          readInput: () => ({ dx: 1 }),
          encodeInput: ({ input, predictionFrame }) => ({
            sequence: predictionFrame.sequence,
            dx: input.dx
          }),
          readAuthoritativeState: ({ snapshot }) => ({ x: snapshot.x }),
          readAcknowledgedSequence: ({ snapshot }) => snapshot.ack
        },
        applyFrame() {}
      }
    });

    harness.emit(snapshotMessage("session-1", 0, 0));
    replication.update({ delta: 0, elapsed: 0, tick: 0 });
    await settle();
    replication.update({ delta: 50, elapsed: 50, tick: 1 });
    await settle();

    expect(readMultiplayerFixedStepInputBundle(harness.sent[0]?.payload)?.frames).toHaveLength(1);
    expect(readMultiplayerFixedStepInputBundle(harness.sent[1]?.payload)?.frames).toEqual([
      expect.objectContaining({ sequence: 1 }),
      expect.objectContaining({ sequence: 2 })
    ]);

    harness.emit(snapshotMessage("session-1", 1, 1));
    replication.update({ delta: 50, elapsed: 100, tick: 2 });
    await settle();
    expect(readMultiplayerFixedStepInputBundle(harness.sent[2]?.payload)?.frames).toEqual([
      expect.objectContaining({ sequence: 2 }),
      expect.objectContaining({ sequence: 3 })
    ]);
    expect(replication.diagnostics()).toMatchObject({
      sentInputBundles: 3,
      redundantInputFrames: 2,
      pendingEncodedInputs: 2
    });
    replication.dispose();
  });

  it("orders domain callbacks and recreates runtimes at the binding boundary", async () => {
    const harness = createRuntimeHarness();
    const binding = createBinding("session-1");
    const systems: MultiplayerBridgeSystem[] = [];
    const events: string[] = [];
    let exposed = false;
    const module = createMultiplayerModule<MultiplayerBridgeInstallContext, Snapshot, Input, State>(
      {
        runtime: harness.runtime,
        clientPredictionDomains: [
          {
            id: "arena",
            create({ binding: active }) {
              events.push(`create:${active.sessionId}`);
              return {
                applyAuthoritative({ snapshot }) {
                  events.push(`authority:${snapshot.tick}`);
                },
                applyInput({ predictionFrame }) {
                  events.push(`input:${predictionFrame.sequence}`);
                },
                applyFrame({ snapshot }) {
                  events.push(`frame:${snapshot.tick}`);
                },
                diagnostics: () => ({ events: events.length }),
                dispose() {
                  events.push(`dispose:${active.sessionId}`);
                }
              };
            }
          }
        ],
        exposeClientPredictionDomains(view) {
          exposed = view !== undefined;
        },
        clientReplication: {
          authority: { binding },
          readSnapshot,
          prediction: {
            inputRateHz: 20,
            buffer: {
              cloneState: (state) => ({ ...state }),
              applyInput(state, input) {
                state.x += input.dx;
                return state;
              }
            },
            readInput: () => ({ dx: 1 }),
            encodeInput: ({ input, predictionFrame }) => ({
              sequence: predictionFrame.sequence,
              dx: input.dx
            }),
            readAuthoritativeState: ({ snapshot }) => ({ x: snapshot.x }),
            readAcknowledgedSequence: ({ snapshot }) => snapshot.ack
          },
          applyFrame() {
            events.push("app-frame");
          }
        }
      }
    );
    const dispose = module.install({
      eventBus: createEventBus(),
      systems: { register: (system) => systems.push(system) }
    });
    expect(exposed).toBe(true);

    harness.emit(snapshotMessage("session-1", 0, 0));
    systems[0]?.update({ delta: 0, elapsed: 0, tick: 0 });
    await settle();
    expect(events).toEqual(["create:session-1", "authority:0", "input:1", "frame:0", "app-frame"]);

    binding.bind({
      sessionId: "session-2",
      mode: "server-authoritative",
      authorityPeerId: "server",
      authorityEndpoint: { kind: "server", id: "server", peerId: "server" }
    });
    harness.emit(snapshotMessage("session-2", 0, 0));
    systems[0]?.update({ delta: 0, elapsed: 0, tick: 0 });
    await settle();
    expect(events).toContain("dispose:session-1");
    expect(events).toContain("create:session-2");

    if (typeof dispose === "function") {
      dispose();
    }
    expect(events.at(-1)).toBe("dispose:session-2");
    expect(exposed).toBe(false);
  });
});

function createBinding(sessionId: string) {
  return createMultiplayerAuthorityBindingStore({
    sessionId,
    mode: "server-authoritative",
    authorityPeerId: "server",
    authorityEndpoint: { kind: "server", id: "server", peerId: "server" }
  });
}

function createRuntimeHarness(): {
  runtime: MultiplayerRuntime;
  sent: MultiplayerOutgoingMessage[];
  emit(message: MultiplayerMessageEnvelope): void;
} {
  const listeners = new Set<MultiplayerMessageListener>();
  const sent: MultiplayerOutgoingMessage[] = [];
  const runtime = {
    id: "test.runtime",
    backendId: "test.backend",
    send(message: MultiplayerOutgoingMessage) {
      sent.push(structuredClone(message));
      return Promise.resolve();
    },
    subscribe(listener: MultiplayerMessageListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  } as MultiplayerRuntime;
  return {
    runtime,
    sent,
    emit(message) {
      for (const listener of listeners) {
        listener(message);
      }
    }
  };
}

function snapshotMessage(sessionId: string, tick: number, ack: number): MultiplayerMessageEnvelope {
  return {
    id: `snapshot-${sessionId}-${tick}-${ack}`,
    sessionId,
    channel: "reliable",
    kind: "game.snapshot",
    sourcePeerId: "server",
    targetPeerIds: ["client"],
    tick,
    timestamp: tick * 50,
    payload: { tick, x: tick, ack }
  };
}

function readSnapshot(payload: unknown): Snapshot | undefined {
  return payload !== null &&
    typeof payload === "object" &&
    typeof (payload as Snapshot).tick === "number" &&
    typeof (payload as Snapshot).x === "number" &&
    typeof (payload as Snapshot).ack === "number"
    ? (payload as Snapshot)
    : undefined;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
