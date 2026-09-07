# @gamekits/multiplayer-memory

In-process multiplayer backend for GameKits tests and deterministic conformance.

This package is useful for unit tests, local headless fixtures and package conformance. It is not a production multiplayer backend and should not be used to prove network behavior, latency, reconnect, matchmaking or provider-native state sync.

## Usage

```ts
import { createMultiplayerRuntime } from "@gamekits/multiplayer-core";
import { createMemoryMultiplayerBackend } from "@gamekits/multiplayer-memory";

const backend = createMemoryMultiplayerBackend();

const host = createMultiplayerRuntime({ id: "host", backend });
const client = createMultiplayerRuntime({ id: "client", backend });

await host.createSession({
  id: "test-session",
  localPeer: { id: "host", role: "host" }
});

await client.joinSession({
  sessionId: "test-session",
  localPeer: { id: "client", role: "client" }
});
```

All runtimes must share the same backend instance to participate in the same in-memory session.

## Intended Role

- Deterministic backend conformance for `@gamekits/multiplayer-core`.
- Local unit tests for action/input/snapshot/patch/result contracts.
- Offline/local authority tests where delivery is in-process but gameplay still uses the multiplayer authority contract.

It does not provide a room server, transport, socket lifecycle, reconnect token, matchmaking, persistence or provider-native state sync.

## Verification

```bash
corepack pnpm --filter @gamekits/multiplayer-memory test
corepack pnpm --filter @gamekits/multiplayer-memory build
corepack pnpm --filter @gamekits/multiplayer-memory lint
```
