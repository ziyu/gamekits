# @gamekits/multiplayer-core

Provider-neutral multiplayer facade, authority helpers and conformance tools for GameKits.

`multiplayer-core` defines the stable GameKits boundary for session summaries, peers, semantic envelopes, authority decisions, replication helpers, peer/player binding and diagnostics. It does not implement a production room server, matchmaking, reconnect engine, presence store or provider-native state sync. Real backends live in packages such as `@gamekits/multiplayer-colyseus`.

## Runtime

```ts
import { createMultiplayerRuntime } from "@gamekits/multiplayer-core";
import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";

const multiplayer = createMultiplayerRuntime({
  id: "arena.client",
  backend: createMemoryMultiplayerBackend(),
  connectContext: {
    localPeer: { id: "client-a", playerId: "player-a", role: "client" }
  }
});

await multiplayer.joinSession({
  sessionId: "arena-session",
  localPeer: { id: "client-a", playerId: "player-a", role: "client" }
});
```

`createSession`, `joinSession`, `leaveSession`, `send`, `subscribe`, `peers`, `session`, `localPeer` and `snapshot` are provider-neutral. `reconnect()` is currently visible but unsupported in the core runtime; it rejects with `MULTIPLAYER_UNSUPPORTED_CAPABILITY` unless a future backend-specific facade explicitly implements reconnect semantics.

## Authority Contract

Connected, joined or peer count only proves presence. Gameplay state is valid only after the app creates an authority binding:

```ts
import {
  createMultiplayerAuthorityBindingStore,
  createMultiplayerAuthorityReceiver
} from "@gamekits/multiplayer-core";

const binding = createMultiplayerAuthorityBindingStore({
  sessionId: "arena-session",
  mode: "host-authoritative",
  authorityPeerId: "host",
  localPlayerId: "player-a"
});

createMultiplayerAuthorityReceiver({
  runtime: multiplayer,
  binding,
  readSnapshot: decodeArenaSnapshot,
  applySnapshot(snapshot) {
    renderArena(snapshot);
  }
});
```

The standard kinds are `game.action`, `game.input`, `game.snapshot`, `game.patch` and `game.result`. Snapshot, patch and result receivers reject messages from non-bound authority sources and record the rejection in diagnostics.

## Host And Local Authority

Host/server authority processes untrusted action/input payloads at a tick boundary:

```ts
import { createMultiplayerAuthorityHostLoop } from "@gamekits/multiplayer-core";

const loop = createMultiplayerAuthorityHostLoop({
  runtime: hostRuntime,
  binding: hostBinding,
  maxActionsPerSourcePerTick: 4,
  maxQueuedActionsPerSource: 16,
  maxQueuedActions: 256,
  readInput: decodeInput,
  inputSequence: (input) => input.sequence,
  inputSequenceKey: (input) => input.playerId,
  inputQueueMode: "latest",
  handleInput({ payload, message }) {
    if (payload.playerId !== message.sourcePeerId) {
      return { allowed: false, code: "player-source-mismatch", reason: "Bad source." };
    }
    applyInput(payload);
  },
  captureSnapshot({ tick }) {
    return captureArenaSnapshot(tick);
  }
});
```

Discrete `game.action` commands use a per-source bounded FIFO backed by a room-wide bounded queue. The host loop defaults to at most 8 actions from one source per authority tick, 32 queued actions per source and 1,024 queued actions for the room; apps can tighten those limits with `maxActionsPerSourcePerTick`, `maxQueuedActionsPerSource` and `maxQueuedActions`. Overflow is rejected as `action-queue-full`, while diagnostics report queue capacity, current/peak depth and overflow count.

Choose `game.input` queue semantics from the input model. Discrete input samples that must all execute use the default `fifo` mode; `maxInputsPerSourcePerTick: 1` prevents a burst from advancing one player multiple simulation steps inside one authority tick, while `maxQueuedInputsPerSource` and `maxQueuedInputs` bound hostile or jittery senders. Continuously sampled movement, aim or steering state uses `inputQueueMode: "latest"`: a newer state replaces an older unconsumed state from the same source, queue depth stays bounded by active sources, and diagnostics report capacity, current/peak depth, overflow and coalescing. The simulation may hold the last applied state until a newer state or game-owned timeout replaces it. Its acknowledgement advances only after that latest state has been adopted by an authoritative simulation tick; superseded samples need not execute individually.

Room-owned or modular server simulation can split the authority frame around app systems:

```ts
loop.beginTick(50); // validate and consume action/latest input
runAiSystems();
stepPhysics();
resolveCombat();
await loop.commitTick(); // capture and publish the completed authority state
```

`beginTick()` rejects re-entry while a frame is active. `commitTick()` rejects when no frame is active, captures the snapshot once, serializes provider publication and advances committed-frame diagnostics. The compatibility `tick(deltaMs)` method performs begin + commit for simulations that still fit inside the loop callback.

When presence reports that a peer left or disconnected, the host composition layer must call `loop.releasePeer(peerId)`. The loop then discards that peer's queued actions and inputs and forgets its input sequence keys, so a restored peer can start a fresh input stream without executing pre-disconnect work or being rejected against an old sequence. Player actor, slot and round-stat retention remain game-owned policy.

Offline/local play should use the same action/input, tick, snapshot/apply and diagnostics contract through `createMultiplayerLocalAuthorityLoop()`. The delivery is in-process, but gameplay should not fork into a second single-player-only rule path.

## Snapshot Presentation

Network and authority ticks are often lower than renderer refresh rate. Presentation code should keep authoritative state and display state separate:

```txt
authoritative snapshot
  -> snapshot playback clock and temporal buffer
  -> sample previous / next / alpha for the current render time
  -> declared Network* presentation tracks
  -> presented values
  -> render-only snapshot, renderer objects or UI view model
```

The stable package boundary is a presentation timing and declared-track toolkit, not a backend adapter feature and not a deep object interpolator. Core utilities should stay provider-neutral:

- play short-lived authoritative snapshots by tick, server time or provider version;
- pace render sampling behind the latest authoritative timeline, adapt within configured delay bounds from measured arrival jitter, and clamp under-runs by default;
- report presentation FPS, sample status, current/target interpolation delay, estimated jitter, snapshot age, stale/drop counters and reset diagnostics;
- provide typed interpolation primitives such as number, angle, vector2, vector3, quaternion/slerp and step/snap value;
- expose small network value shapes such as `NetworkScalar`, `NetworkAngleRadians`, `NetworkVector2`, `NetworkVector3`, `NetworkQuaternion`, `NetworkTransform2` and `NetworkTransform3`;
- project declared `Network*` presentation tracks into typed `presented` values;
- reuse projector buffers and direct-write typed values on hot paths;
- leave field selection, track keys, reset policy and render writes to the game or app presentation layer.

Typical app code declares the tracks once, creates a reusable projector, and reads or writes presented values during render projection:

```ts
const playback = createSnapshotPlayback<ArenaSnapshot>({
  interpolationDelayMs: 50,
  adaptiveDelay: {
    minDelayMs: 50,
    maxDelayMs: 150
  },
  readTime: (entry) => entry.snapshot.tick * tickMs
});
const tracks = [
  defineSnapshotVector2Track<ArenaSnapshot>({
    snapDistance: 96,
    selectInto(snapshot, writer) {
      for (const player of snapshot.players) {
        writer.add(`player:${player.id}:position`, player.position);
      }
    }
  })
];
const projector = createSnapshotPresentationProjector(tracks);

const sample = playback.present({ snapshot, tick: snapshot.tick }, renderDeltaMs);
const presented = projector.present(sample);
const player = snapshot.players[0];
presented.vector2Into(`player:${player.id}:position`, renderPlayer.position, player.position);
```

`presentSnapshotTracks()` remains available as a one-shot convenience for tests and small tools. Runtime presentation loops should prefer `createSnapshotPresentationProjector()`, `selectInto()` and `vector2Into()` / `vector3Into()` / `quaternionInto()` so the core can reuse track buffers and caller-owned render targets. Do not rebuild a complete cloned gameplay snapshot on every frame when the renderer can accept direct transform writes.

When the app uses `@gamekits/app-host` standard game modules, the multiplayer module can own the playback loop and declared-track interpolation for the app:

```ts
standardModules: {
  multiplayer: {
    presentation: {
      interpolationDelayMs: 50,
      adaptiveDelay: { minDelayMs: 50, maxDelayMs: 150 },
      readTime: (entry) => entry.snapshot.tick * tickMs,
      tracks,
      readSnapshot: () => latestAuthoritativeSnapshotEntry,
      applySample: ({ presented, snapshot }) => {
        const player = snapshot.players.find((candidate) => candidate.id === renderPlayer.id);
        if (player) {
          presented.vector2Into(
            `player:${renderPlayer.id}:position`,
            renderPlayer.position,
            player.position
          );
        }
      }
    }
  }
}
```

After the first snapshot, `readSnapshot` may return `undefined` on frames where no new authoritative update arrived; the standard module advances the existing playback buffer with the GameRuntime frame delta.

Games should reset snapshot playback when the authority binding, session, snapshot version, hard phase, teleport or resync state changes. `createSnapshotBuffer()` remains available as a low-level escape hatch for custom netcode, but the default path should use `createSnapshotPlayback()` so render pacing, jitter delay, under-run clamping and diagnostics stay in core. Backend packages such as `@gamekits/multiplayer-colyseus` should expose provider state, tick/version source and diagnostics, not hard-code gameplay interpolation policy.

## Client Prediction

Local player prediction is modeled separately from remote interpolation. `createMultiplayerPredictionBuffer()` keeps a bounded input log, applies local inputs immediately, drops inputs acknowledged by the authoritative snapshot, rewinds to the authoritative state and replays still-pending inputs:

```ts
const positionField = definePredictionVector2StateField<PredictedPlayer>({
  readX: (state) => state.position.x,
  readY: (state) => state.position.y,
  write(state, x, y) {
    state.position.x = x;
    state.position.y = y;
  }
});
const facingField = definePredictionAngleStateField<PredictedPlayer>({
  read: (state) => state.facing,
  write(state, facing) {
    state.facing = facing;
  }
});
const prediction = createMultiplayerPredictionBuffer({
  initialState: readPlayerPredictionState(snapshot),
  cloneState: (state) => ({ ...state, position: { ...state.position } }),
  applyInput(state, input, { stepMs }) {
    return movePredictedPlayer(state, input, stepMs);
  },
  predictionStepMs: 50,
  presentation: definePredictionStatePresentation({
    fields: [positionField, facingField],
    correction: {
      measure: positionField,
      smooth: [positionField],
      durationMs: 100,
      maxMagnitude: 48
    }
  })
});

prediction.predict({ sequence: input.sequence, input, timestamp: input.clientTime });
prediction.reconcile({
  authoritativeState: readPlayerPredictionState(authoritativeSnapshot),
  acknowledgedSequence: authoritativeSnapshot.inputAck,
  timestamp: renderFrame.time
});
const renderState = prediction.present({
  deltaMs: renderFrame.deltaMs,
  timestamp: renderFrame.time
});
```

`positionField` and `facingField` are created once with `definePredictionVector2StateField()` and `definePredictionAngleStateField()`. They only map typed state reads/writes; Core chooses the interpolation primitive and applies correction offsets. Core owns the input queue, ack handling, replay, bounded fixed-step presentation clock, declared-field interpolation, correction smoothing lifecycle and diagnostics. Managed replication also bounds unacknowledged prediction lead with `maxPredictionLeadInputs` (default `8`); when the window is full it pauses new prediction/send steps, reports `throttledInputs`, and resumes from the latest sampled control state after an authority ack. A predicted command computes the next fixed-step simulation endpoint immediately, while `present()` samples between the previous and current endpoint over `predictionStepMs`; it must not extrapolate again from an endpoint that already represents the end of the step. Reconciliation updates prediction state immediately. Small render corrections decay as offsets from the corrected moving target, while corrections above `maxMagnitude`, hard resets and teleports snap. A transition may expose read-only diagnostics, which are nested under prediction diagnostics. The game still owns deterministic input replay, collision, movement rules and final render writes. The callback-based presentation options remain deprecated escape hatches for custom netcode.

Managed replication normally subscribes to normalized Runtime envelopes. A provider-native mapping can instead configure `snapshotSource`; this source exclusively replaces the default subscription, while Core continues to own authority gating, playback, prediction and reconciliation. The optional `current()` returns the latest full normalized snapshot, allowing Core to recover an initial provider callback that arrived before the Runtime authority binding was ready. Source messages use `sequence` for monotonic provider state versions and `tick` for gameplay simulation time, so multiple provider revisions in one tick remain legal. Ordinary Runtime envelope transport sequence is not interpreted as provider state version. Authority binding or session changes reset the source ordering watermark together with playback and prediction state.

## Typed Replication Schema

When snapshot shape is stable, compile the repeated ingress, identity, ack, state, and presentation declarations into one client binding:

```ts
const players = defineMultiplayerReplicationEntityPresentation<ArenaSnapshot, PlayerSnapshot>({
  id: "arena.players",
  select: (snapshot) => snapshot.players,
  identity: (player) => player.networkId,
  generation: (player) => player.generation,
  fields: [
    { id: "position", kind: "vector2", read: (player) => player.position },
    { id: "facing", kind: "angle-radians", read: (player) => player.facing }
  ]
});

const schema = defineMultiplayerReplicationSchema<ArenaSnapshot, string, PlayerSnapshot>({
  id: "arena.snapshot",
  version: "arena.v2",
  decode: decodeArenaSnapshot,
  tick: (snapshot) => snapshot.tick,
  time: (snapshot) => snapshot.tick * tickMs,
  presentation: [players],
  local: {
    select: (snapshot, playerId) => snapshot.players.find((player) => player.id === playerId),
    acknowledgedSequence: (snapshot, playerId) => snapshot.inputAcks[playerId]
  }
}).bindClient({
  identity: () => localPlayerId,
  state: (player) => toPredictedState(player)
});

createMultiplayerClientReplication({
  runtime,
  installContext,
  options: {
    schema,
    prediction: {
      buffer,
      readInput,
      encodeInput
    },
    applyFrame
  }
});
```

The app-owned decoder remains the untrusted provider payload boundary. The compiler rejects an explicitly mismatched message schema version, invalid tick, or decoder exception and creates generation-aware, length-framed presentation keys. It does not scan decorators, recursively reflect arbitrary objects, replace Colyseus/Protobuf serializers, or require a `NetworkObject` base class. Low-level callbacks and extra presentation tracks can be combined with the schema for custom netcode.

## Predicted Lifecycle Domains

Event-started objects and predicted entities use `createMultiplayerPredictedLifecycleDomain()` instead of composing a spawn registry and authority timeline in the app:

```ts
const projectiles = createMultiplayerPredictedLifecycleDomain<ProjectileRecord, ProjectileRecord>({
  kind: "combat.projectile",
  generation: "unbound",
  stepMs: 50,
  maxPending: 16,
  maxBindings: 128,
  hooks: {
    onPredictionRemoved({ prediction, atTick, reason }) {
      predictedRuntime.cancel(prediction.localId, atTick, reason);
    },
    onReset({ generation }) {
      predictedRuntime.reset(String(generation));
    }
  }
});

projectiles.register({
  correlationId: command.correlationId,
  localId: predictedRecord.projectileId,
  tick: predictedRecord.fireTick,
  value: predictedRecord
});

projectiles.sync({
  generation: snapshot.generation,
  authorityTime: snapshot.elapsedMs,
  localTime: frame.elapsedMs,
  authoritySpawns: snapshot.projectiles.map((record) => ({
    correlationId: record.correlationId,
    authorityId: record.projectileId,
    tick: record.fireTick,
    value: record
  }))
});
```

Core owns generation reset, monotonic authority time, predicted/authority identity, matching, rejection, expiry, binding pruning, capacity and diagnostics. The hook boundary only releases domain-specific speculative simulation or presentation state. Combat, Physics and the game still own deterministic trajectory/solver behavior and authoritative gameplay results. Low-level `createMultiplayerPredictedSpawnRegistry()` and `createMultiplayerAuthorityTimeline()` remain available for custom netcode and standard domain implementations.

## Speculative Effects

Replayed simulation must not replay Audio, Camera shake, Renderer objects, UI feedback, or gameplay commits. Use `createMultiplayerSpeculativeEffectJournal()` for reversible local feedback:

```ts
const effects = createMultiplayerSpeculativeEffectJournal<LocalMuzzleFlash, AuthorityShot>({
  generation: binding.generation,
  maxPending: 16,
  maxResolved: 64,
  maxAgeTicks: 120,
  hooks: {
    onAnticipate: showLocalMuzzleFlash,
    onConfirm: ({ effect }) => retainMuzzleFlash(effect.effectId),
    onCancel: ({ effect }) => removeMuzzleFlash(effect.effectId),
    onReplace: ({ effect, authority }) => replaceMuzzleFlash(effect.effectId, authority)
  }
});

effects.anticipate({ effectId: `${command.correlationId}:muzzle`, tick, value: flash });
effects.resolve({
  effectId: `${result.correlationId}:muzzle`,
  generation: result.generation,
  tick: result.tick,
  outcome: "confirm",
  authority: result.shot
});
```

The stable effect id suppresses repeated anticipation during rollback replay and settles a result at most once. The journal bounds pending and resolved identities, cancels pending effects on expiry/capacity/reset/dispose, remembers authority results that arrive before local anticipation, isolates hook failures, and exposes diagnostics. Hooks may only manage reversible speculative feedback. Damage, cost, inventory, GAS/TCA transitions, and other authoritative facts remain outside the journal and commit only on authority.

## Multi-Domain Rollback Checkpoints

When one prediction domain must rewind several independently owned state sources, use `createMultiplayerRollbackCoordinator()` with explicit contributors:

```ts
const rollback = createMultiplayerRollbackCoordinator({
  generation: binding.generation,
  maxHistoryTicks: 120,
  maxCheckpointBytes: 512 * 1024,
  maxHistoryBytes: 16 * 1024 * 1024,
  contributors: [
    worldRollbackContributor,
    createMultiplayerRngRollbackContributor(game.rng),
    physicsRollbackContributor
  ]
});

rollback.capture(simulationTick);
const restored = rollback.restore(authorityTick);
```

Contributors declare stable `id`/`order`, isolated capture data, pre-restore validation, deterministic restore, byte measurement, and a state hash. The coordinator captures all contributors at one generation/tick, enforces per-checkpoint and total-history budgets, restores in stable order only after every validation passes, drops invalid future checkpoints, and exposes the combined hash and diagnostics. A contributor restore exception can still leave a partially restored external runtime; callers must treat `restore-failed` as a hard-correction/rebuild boundary. `createMultiplayerRngRollbackContributor()` uses the seeded RNG's exact captured stream position. World, Physics, GAS, TCA, and app adapters remain owned by their domain/app composition rather than becoming dependencies of Multiplayer Core.

Applications using `@gamekits/app-host` normally call `createStandardMultiplayerRollbackDomain()` instead of assembling the standard contributors themselves. It accepts an explicit World component/entity scope, seeded RNG, Physics handle, optional gameplay contributors, and history/byte budgets, then installs the default World `100` → RNG `150` → Physics `200` order. The lower-level coordinator remains available when a domain has different ownership dependencies.

## Peer / Player Binding

Use `createMultiplayerPeerPlayerBindingStore()` to bind provider peers to app players, display names, slots and active, spectator, next-round or leave states:

```ts
const players = createMultiplayerPeerPlayerBindingStore();

players.bindPeer({
  id: "peer-a",
  playerId: "player-a",
  displayName: "Scout",
  status: "connected"
});

players.markPeerLeft("peer-a", { status: "left", reason: "tab closed" });
players.close("room closed");
```

The helper normalizes and de-duplicates display names per binding set. Configure lifecycle decisions once with `createMultiplayerParticipantPolicy()`. Rules can be static or use app-owned context without teaching core about game phases:

```ts
const participantPolicy = createMultiplayerParticipantPolicy<{
  phase: "lobby" | "running" | "results";
}>({
  join: "active",
  lateJoin: "next-round",
  leave: "remove",
  disconnect: ({ context }) => (context.phase === "lobby" ? "remove" : "disconnected"),
  reconnect: "restore",
  boundary: ({ binding }) =>
    binding.status === "disconnected"
      ? "remove"
      : binding.status === "next-round"
        ? "activate"
        : "retain"
});
```

Core resolves policy decisions and maintains binding vocabulary; the app/server composition layer still applies game-owned actor, slot, team and round-stat changes. Intentional leave and transport disconnect have separate rules even when a particular backend currently reports only generic presence loss.

## Diagnostics

`createMultiplayerAuthorityDiagnostics()` combines authority binding, host/local loop counters, receiver counters and redacted connection summary:

```ts
const summary = createMultiplayerAuthorityDiagnostics({
  binding: binding.current(),
  authoritativePath: "gamekits-envelope",
  loop: hostLoop.diagnostics(),
  receiver: clientReceiver.diagnostics(),
  connection: { reconnectSupported: false, reconnectReason: "unsupported" }
});
```

Diagnostics intentionally exclude provider handles, sockets, room objects, secrets, tokens and full high-frequency payloads.

## Benchmarks

Run the module-level benchmark suite when changing multiplayer hot paths:

```bash
corepack pnpm bench:multiplayer
corepack pnpm bench:multiplayer:check
corepack pnpm bench:multiplayer:stability
```

The suite covers envelope normalization, authority receiver source gates, host/local and staged authority loops, bounded module commands, latest-input coalescing, prediction reconciliation and render-time presentation, snapshot playback and presentation projection. The regular command remains a profiling trend signal. `bench:multiplayer:check` applies deliberately broad CI ceilings that catch order-of-magnitude regressions, while the stability command simulates 30 minutes of bounded prediction/playback/direct-write activity and checks retained heap after GC.

## App Host Integration

`@gamekits/app-host` can own a multiplayer runtime as an optional standard service and install the standard GameModule bridge:

```ts
const profile = createStandardAppProfile({
  multiplayer: {
    runtime: multiplayerRuntime
  },
  game: {
    createRuntime,
    standardModules: {
      multiplayer: {
        commandQueue: {
          capacity: 256,
          maxPerTick: 32,
          maxAgeMs: 1_000,
          overflowPolicy: "reject-newest"
        },
        handleCommand({ message }) {
          handleGameCommand(message);
        }
      }
    }
  }
});
```

App Host owns connection lifecycle and service disposal. The GameModule bridge only handles normalized messages at the GameRuntime tick boundary; it does not create rooms or sockets. Its command queue is bounded and emits `multiplayer.command.overflow` / `multiplayer.command.expired` facts; `onDiagnostics` can expose a redacted queue summary to DevTools.

The GameModule implementation is owned by `@gamekits/multiplayer-core` and exposed as `createMultiplayerModule()`. App Host only resolves the standard service/profile dependencies before calling that factory. `createMultiplayerBridgeModule()` remains as a compatibility alias.

## Conformance

Backend packages should run both conformance helpers:

```ts
await runMultiplayerBackendConformance({ createBackend });
await runMultiplayerAuthorityConformance({ createBackend });
```

The authority conformance runner verifies shared host-authoritative state, local authority equivalence, non-authority snapshot/patch/result rejection, duplicate input rejection, session isolation and client leave cleanup.
