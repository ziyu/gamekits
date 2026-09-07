# @gamekits/multiplayer-colyseus

Colyseus backend adapter for GameKits Multiplayer.

This package connects Colyseus Room / client lifecycle to GameKits's multiplayer facade and GameModule bridge. Colyseus owns the mature multiplayer runtime: room creation, room membership, message transport, state synchronization, reconnection behavior, server-side lifecycle, load testing, and provider diagnostics. GameKits owns the stable integration boundary: semantic command envelopes, App Host service lifecycle, GameRuntime tick-boundary command handling, redacted snapshots, and provider-neutral diagnostics.

Long-term design sources:

- `docs/modules/multiplayer.md`
- `docs/adr/0012-mature-multiplayer-backend-adapter.md`
- `docs/implementation/multiplayer-demo-validation.md`

## Responsibilities

This package is responsible for:

- Creating a GameKits `MultiplayerBackendAdapter` backed by a Colyseus client.
- Mapping Colyseus room lifecycle to GameKits session, peer, phase, and diagnostics snapshots.
- Sending and receiving GameKits semantic message envelopes through Colyseus room messages.
- Providing opt-in provider-native capability bridges for Colyseus Schema state sync, room metadata, reconnect / seat reservation summaries, and provider diagnostics.
- Providing server-only helpers for local Colyseus test/demo servers.
- Implementing Room-side backend connections that are consumed by multiplayer-core instead of replacing its runtime/session facade.
- Providing a typed native bridge for app-specific tooling that explicitly opts into Colyseus types.
- Keeping Colyseus Room, Client, Schema, matchmaker, reconnection token, socket, and server objects out of `@gamekits/multiplayer-core`, gameplay modules, DataType, Save payloads, and reusable GameModule public APIs.

This package is not responsible for:

- Reimplementing Colyseus rooms, matchmaking, reconnection, presence, transport, or state sync.
- Providing production account, auth, invitation, friends, lobby UI, NAT traversal, or deployment orchestration.
- Defining Tiny Camp or any other app-specific command payload as a core type.
- Letting Renderer, Input, UI, TCA, GAS, Save, or gameplay systems call Colyseus directly.
- Saving live room handles, sockets, reconnection tokens, auth tokens, message queues, or transient presence.

## Package Shape

The root entry is safe for app/client composition and should not export server-only Colyseus types:

```ts
import { createColyseusMultiplayerBackend } from "@gamekits/multiplayer-colyseus";
import { createMultiplayerRuntime } from "@gamekits/multiplayer-core";

const backend = createColyseusMultiplayerBackend({
  endpoint: "http://localhost:2567",
  roomName: "tiny_camp"
});

const multiplayer = createMultiplayerRuntime({
  id: "sandbox.multiplayer",
  backend,
  connectContext: {
    localPeer: { id: "player.local", role: "client" }
  }
});
```

The server entry is server-only and may expose Colyseus Room / server harness helpers:

```ts
import { createGameKitsColyseusServer } from "@gamekits/multiplayer-colyseus/server";

const server = await createGameKitsColyseusServer({
  rooms: {
    tiny_camp: createTinyCampRoomDefinition()
  }
});
```

Room-owned authority apps should compose their own Room around the typed lifecycle bridge:

```ts
import { Room, type Client } from "@colyseus/core";
import { createColyseusRoomRuntimeBridge } from "@gamekits/multiplayer-colyseus/server";

type GameRoomOptions = { sessionId?: string };

class GameRoom extends Room {
  private readonly authority = createColyseusRoomRuntimeBridge<GameRoom, Client, GameRoomOptions>({
    resolveSessionId: (room, options) => options.sessionId ?? room.roomId,
    createRuntime: ({ multiplayer }) => createGameServerRuntime({ multiplayer })
  });

  async onCreate(options) {
    await this.authority.create(this, options);
    this.onMessage("gamekits.message", (client, message) => {
      this.authority.receive(client, message);
    });
  }

  onJoin(client, options) {
    this.authority.join(client, resolveGamePeer(options));
  }

  onLeave(client, code) {
    this.authority.leave(client, code);
  }

  async onDispose() {
    await this.authority.dispose();
  }
}
```

The bridge owns one Room simulation interval and exposes a server-side `MultiplayerRuntime` created by multiplayer-core. Internally, a private Room-side backend connection binds the existing provider Room to the stable GameKits session without creating a server-to-self Colyseus client. The app still owns Room metadata, authentication, peer/participant policy, command payload validation, gameplay modules, field-level Schema, replication projection, and close/reconnect policy. The bridge performs the one core session binding during Room creation; app code does not create, replace, leave, or reconnect that session afterward.

The root entry must not re-export `Room`, `Client`, `Schema`, server transports, or test server helpers. Server-side exports must stay behind `@gamekits/multiplayer-colyseus/server` or app-specific server packages.

## Capability Lanes

Colyseus should not be reduced to a generic message transport. The adapter supports two complementary lanes:

| Lane              | Purpose                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| GameKits envelope | Cross-backend baseline for `game.action`, `game.input`, `game.snapshot`, `game.patch`, results, authority source gate and conformance. |
| Colyseus native   | Opt-in use of Colyseus Schema / state sync, room metadata, reconnect / seat reservation, matchmaker and provider diagnostics.          |

An app may choose either lane as the authoritative state writer for a room, but it must not let both lanes write the same gameplay state. The active lane must be reflected in GameKits authority binding / diagnostics so UI and DevTools can explain the current source of truth.

Provider-native bridge rules:

- Colyseus Schema, Room, Client and server runtime types may appear only in this package, its server subpath, or app-specific server/tooling code that explicitly imports the native bridge.
- Native state sync must map back to provider-neutral authority diagnostics such as source, tick/version, snapshot age, resync reason, rejected source and state size.
- Browser gameplay and reusable GameModules should consume app-local snapshots or view models, not raw Colyseus Schema instances.
- Reconnect / seat reservation tokens and room secrets must stay inside provider-specific code and must not enter Save payloads or public diagnostics.

## Dependency Policy

Expected dependency ownership:

| Area           | Allowed dependencies                                                            | Notes                                                                         |
| -------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Root adapter   | `@gamekits/multiplayer-core`, Colyseus client SDK                               | Browser/client-facing integration only.                                       |
| Server subpath | `@gamekits/multiplayer-core`, Colyseus server packages, Colyseus schema package | Room-side backend mapping, server-only exports and local test/demo harnesses. |
| Tests          | Vitest, Colyseus local server harness                                           | Must clean up ports, rooms, listeners, and pending messages.                  |

Colyseus SDK types can appear in `@gamekits/multiplayer-colyseus` public native bridge types, but not in `@gamekits/multiplayer-core`, app gameplay modules, Data definitions, Save contributors, or provider-neutral DevTools sources.

## Session Mapping

The adapter maps Colyseus concepts into provider-neutral GameKits summaries:

| GameKits concept    | Colyseus source                             | Notes                                                                                  |
| ------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `backend.id`        | Adapter option                              | Stable id such as `colyseus` or `colyseus:sandbox`.                                    |
| `session.id`        | Stable GameKits id supplied in Room options | Maps deterministically to a provider room; it is not a Colyseus Client session id.     |
| Provider room id    | Colyseus `roomId`                           | Private adapter mapping target; do not expose the Room object in core snapshots.       |
| `session.kind`      | Room metadata / adapter option              | Examples: `private`, `public`, `matchmade`, `local-dev`.                               |
| `session.authority` | Adapter option / room metadata              | Common first demo value: `host-authoritative` or `server-authoritative`.               |
| `peer.id`           | App-provided peer id                        | Stable GameKits identity; use Colyseus Client session id only as a private fallback.   |
| `peer.playerId`     | App/account metadata                        | Do not infer from secrets or tokens.                                                   |
| `phase`             | Client/room lifecycle                       | Normalize to GameKits phases such as `connecting`, `in-session`, `closed`, `disposed`. |

Current `multiplayer-core` exposes `createSession()` and `joinSession()`. A Colyseus adapter can map them to Colyseus room operations as follows:

| GameKits call                     | Colyseus behavior                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `createSession({ id, ... })`      | `joinOrCreate(roomName, options)` and treat the returned Room id as the session id.  |
| `joinSession({ sessionId, ... })` | Join by Room id when available, or join/create by room name for local demo profiles. |
| `leaveSession(reason)`            | `room.leave()` plus redacted close/leave diagnostics.                                |
| `send(envelope)`                  | `room.send(messageType, envelope)` with validation and size checks.                  |
| `subscribe(listener)`             | Subscribe to normalized room messages and state summary updates.                     |
| `snapshot()`                      | Return GameKits-safe summaries only.                                                 |

When `multiplayer-core` converges on a `createOrJoinSession()` facade, this package should collapse the create/join distinction at the adapter boundary without changing gameplay command contracts.

For `host-authoritative` rooms, the peer with `role: "host"` is the authority owner. When that peer leaves, the server room closes and remaining clients are disconnected instead of leaving an orphan room that can still accept late clients. Ordinary client leave only updates presence and leaves the room open.

## Reconnect Support Level

The first usable GameKits multiplayer version marks reconnect as unsupported at the provider-neutral runtime boundary:

- `MultiplayerBackendCapabilities.reconnect` is `false`.
- `createMultiplayerRuntime().reconnect()` rejects with `MULTIPLAYER_UNSUPPORTED_CAPABILITY`.
- Diagnostics should report reconnect as unsupported or as a provider-specific redacted summary only.
- Colyseus seat reservation tokens, if introduced later, must remain inside this package or app-specific server code and must surface only as redacted summaries.

Host close, expired reconnect, same-name session recreate and player binding recovery are not silently treated as reconnect. Apps must handle them as explicit leave, close or new-session lifecycle until a backend-specific reconnect facade is implemented and tested.

## Message Mapping

GameKits message envelopes stay provider-neutral:

```ts
type GameKitsColyseusMessage = {
  id: string;
  sessionId: string;
  channel: string;
  kind: string;
  sourcePeerId: string;
  targetPeerIds?: string[];
  sequence?: number;
  tick?: number;
  schemaVersion?: string;
  correlationId?: string;
  timestamp: number;
  payload: unknown;
};
```

Recommended Colyseus message types:

| Colyseus message type     | Purpose                                                   |
| ------------------------- | --------------------------------------------------------- |
| `gamekits.message`        | Provider-neutral GameKits semantic envelope.              |
| `gamekits.presence`       | Core session/peer presence summary.                       |
| `gamekits.command.result` | Low-frequency accepted/rejected command result summary.   |
| `gamekits.state.summary`  | Redacted provider-neutral state summary for HUD/DevTools. |
| `gamekits.diagnostic`     | Low-frequency backend diagnostic event.                   |

`targetPeerIds` is interpreted by the server helper or app-specific Room. The root adapter should not assume every provider has identical targeted-message semantics.

Remote payload is always untrusted. The adapter or Room helper must validate:

- Message shape and required envelope fields.
- Supported `kind`, `channel`, and `schemaVersion`.
- Payload size.
- Target peer existence.
- Sender peer identity.
- Optional app-provided command schema.

## Server Room Contract

The generic server helpers should provide Colyseus integration without importing app gameplay:

- Define a reusable Room base/helper that accepts GameKits envelope messages.
- Normalize join, leave, drop, reconnect, and close events into provider-neutral summaries.
- Optionally expose a state-summary hook for DevTools/HUD snapshots.
- Allow an app-specific room to attach a headless GameRuntime or host-authoritative command handler.
- Provide a Room-owned lifecycle bridge that boots/starts/ticks/stops/disposes an app-provided runtime, implements a private Room-side `MultiplayerBackendConnection`, and delegates the server facade to multiplayer-core without a server self-connection.
- Keep app command decoders and authority policy outside `@gamekits/multiplayer-core`.

Tiny Camp's Colyseus Room belongs in Sandbox app/server code or a Sandbox-specific helper. This package may provide the reusable Colyseus bridge it uses, but it must not export Tiny Camp worker/building/monster command types from the adapter root.

## Diagnostics

Snapshots and diagnostics should answer:

- Backend id, room name, room id, phase, authority mode.
- Local peer and connected peer summaries.
- Sent/received message counts.
- Last connect, join, leave, drop, reconnect, and close reasons.
- Invalid message counts and rejection reasons.
- Redacted command result summary.
- Optional provider-native details only through an explicit native bridge.

Diagnostics must not include:

- Auth token, room secret, reconnection token, invite code, raw IP, socket object, Room object, Client object, full high-frequency payload, or Colyseus Schema instances.

## Native Bridge

The package may expose an explicit native bridge for advanced app/tooling code:

```ts
const native = backend.native?.();
```

Native bridge usage rules:

- It is an escape hatch, not the default gameplay path.
- It can expose Colyseus client/server handles only from this adapter package or a server-only subpath.
- It must never enter Save payloads, DataType definitions, reusable GameModule public APIs, or provider-neutral DevTools sources.
- DevTools must label native/provider-specific details as Colyseus-specific.

The root adapter exposes a typed native bridge from `createColyseusMultiplayerBackend()`:

```ts
import { createColyseusMultiplayerBackend } from "@gamekits/multiplayer-colyseus";
import { createMultiplayerAuthorityBindingStore } from "@gamekits/multiplayer-core";

const backend = createColyseusMultiplayerBackend({
  endpoint: "http://localhost:2567",
  roomName: "relay_arena",
  nativeStateSync: {
    enabled: true,
    schemaVersion: "arena.v1"
  },
  nativeCapabilities: {
    authoritativePath: "colyseus-schema",
    stateSync: {
      available: true,
      lane: "colyseus-schema",
      schemaVersion: "arena.v1"
    }
  }
});

const binding = createMultiplayerAuthorityBindingStore({
  sessionId: "relay-arena-session",
  mode: "server-authoritative",
  authorityEndpoint: {
    kind: "server",
    id: "colyseus-schema"
  }
});

const stateBridge = backend.native().createStateBridge({
  binding,
  authoritativePath: "colyseus-schema",
  sourceEndpointId: "colyseus-schema",
  readState(state) {
    return typeof state === "object" && state !== null ? state : undefined;
  },
  applyState(state, ctx) {
    // Map provider-native state into an app-owned view model here.
    console.log(ctx.tick, state);
  }
});

const unsubscribe = backend.native().subscribeState((update) => {
  stateBridge.receiveState(update);
});
```

The authority publisher can write the app-owned snapshot through the same native boundary:

```ts
backend.native().publishState({
  sessionId: "relay-arena-session",
  sourcePeerId: "host",
  tick: snapshot.tick,
  version: "arena.v1",
  timestamp: Date.now(),
  state: snapshot
});
```

The server room must enable the matching lane with `roomOptions.nativeStateSync`. `GameKitsColyseusNativeState` is a small versioned Schema carrier: it stores identity, tick, schema version, timestamp, encoded app state, byte size and a monotonic provider `updateCount`. Gameplay state remains app-owned. The adapter suppresses duplicate provider callbacks for one `updateCount`; the bridge rejects stale versions, wrong sessions, wrong authority sources, invalid state and oversized state.

The bridge records provider-neutral diagnostics for provider state version, gameplay tick, schema version, source endpoint, state size, resync and rejected updates. It does not make Colyseus Schema a `multiplayer-core` type.

Apps with a field-level Schema can provide `nativeStateSync.readRoomState`. The callback owns provider-specific Schema-to-app-view mapping and returns a `ColyseusNativeStateUpdate`; the adapter invokes it after its backend session/local-peer state exists, then for later provider state changes. Because the outer Core Runtime facade may complete its binding one async boundary later, the app's normalized `snapshotSource.current()` should retain that latest full update so managed replication can consume it on the first bound frame. `stateVersion` is the monotonic provider order and `tick` remains simulation metadata. A decoder may provide a conservative `stateBytes` value to avoid a second serialization; otherwise the adapter measures the mapped state. Both paths enforce `maxStateBytes` before notifying subscribers. The app must not also publish the same high-frequency state through `game.snapshot` envelopes.

## App Host Integration

App profiles should create the Colyseus backend as an App Service dependency:

```ts
const multiplayerBackend = createColyseusMultiplayerBackend({
  endpoint: config.multiplayer.endpoint,
  roomName: config.multiplayer.roomName
});
```

`services.multiplayer` exposes the GameKits facade. `profile.standard.game.standardModules.multiplayer` installs the GameModule bridge that processes incoming commands at the GameRuntime tick boundary.

The bridge consumes only normalized GameKits messages. It does not import Colyseus, hold a Room handle, or call the Colyseus SDK.

## Sandbox Demo Contract

The first visible demo is `Tiny Camp Colyseus Co-op Loopback`.

Acceptance criteria:

- A local Colyseus server starts for tests/dev.
- Host/server and client join the same Colyseus Room.
- At least one Tiny Camp command travels through Colyseus Room messaging.
- The host/server authority boundary validates and applies the command on a GameRuntime tick.
- The result is broadcast as a redacted command result or state summary.
- HUD and DevTools show backend, room, peers, message counts, and last command result.
- Sandbox gameplay code does not import Colyseus types.
- Save payloads do not include live Colyseus state.

## Verification

Package-level verification should include:

```bash
corepack pnpm --filter @gamekits/multiplayer-colyseus test
corepack pnpm --filter @gamekits/multiplayer-colyseus build
corepack pnpm --filter @gamekits/multiplayer-colyseus lint
```

Repository gate before merging related implementation:

```bash
corepack pnpm test
corepack pnpm build
corepack pnpm lint
corepack pnpm format
git diff --check
```

Tests should cover:

- Core backend conformance where Colyseus supports the capability.
- Join/create, leave, close, dispose cleanup.
- Broadcast and targeted command routing.
- Invalid message and payload size handling.
- Drop/reconnect summary when enabled.
- Redaction of diagnostics and snapshots.
- Local server harness cleanup with dynamic ports.

## References

- Colyseus documentation: https://docs.colyseus.io/
- GameKits Multiplayer design: `docs/modules/multiplayer.md`
- Mature backend decision: `docs/adr/0012-mature-multiplayer-backend-adapter.md`
