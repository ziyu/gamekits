import { createGameKitsColyseusServer } from "@gamekits/multiplayer-colyseus/server";
import { createColyseusMultiplayerBackend } from "@gamekits/multiplayer-colyseus";
import {
  createMultiplayerRuntime,
  type MultiplayerMessageEnvelope,
  type MultiplayerRuntime
} from "@gamekits/multiplayer-core";
import { createMultiplayerDemoRuntime, type MultiplayerDemoRuntime } from "../domain";
import { createRealtimeArenaHost, type RealtimeArenaHost } from "../realtime/host";
import {
  REALTIME_ARENA_DEFAULT_AUTHORITY_PATH,
  REALTIME_ARENA_SCHEMA_VERSION,
  type RealtimeArenaAuthorityPath
} from "../realtime/authority-path";

export const MULTIPLAYER_DEMO_ROOM_NAME = "gamekits_multiplayer_demo";
export const MULTIPLAYER_DEMO_SESSION_ID = "multiplayer-demo-session";
export const MULTIPLAYER_DEMO_HOST_PEER_ID = "demo-host";

export type LocalMultiplayerDemoHostOptions = {
  endpoint: string;
  roomName: string;
  sessionId?: string;
  hostPeerId?: string;
  authoritativePath?: RealtimeArenaAuthorityPath;
};

export type LocalMultiplayerDemoServerOptions = {
  roomName?: string;
  sessionId?: string;
  hostPeerId?: string;
  authoritativePath?: RealtimeArenaAuthorityPath;
  port?: number;
};

export type LocalMultiplayerDemoHost = {
  endpoint: string;
  roomName: string;
  sessionId: string;
  hostPeerId: string;
  authoritativePath: RealtimeArenaAuthorityPath;
  app: MultiplayerDemoRuntime;
  realtime: RealtimeArenaHost;
  host: MultiplayerRuntime;
  hostMessages: MultiplayerMessageEnvelope[];
  tick(delta?: number): void;
  disposeHost(): Promise<void>;
  dispose(): Promise<void>;
};

export type LocalMultiplayerDemoServer = LocalMultiplayerDemoHost;

export async function createLocalMultiplayerDemoServer(
  options: LocalMultiplayerDemoServerOptions = {}
): Promise<LocalMultiplayerDemoServer> {
  const roomName = options.roomName ?? MULTIPLAYER_DEMO_ROOM_NAME;
  const sessionId = options.sessionId ?? MULTIPLAYER_DEMO_SESSION_ID;
  const hostPeerId = options.hostPeerId ?? MULTIPLAYER_DEMO_HOST_PEER_ID;
  const authoritativePath = options.authoritativePath ?? REALTIME_ARENA_DEFAULT_AUTHORITY_PATH;
  const colyseus = await createGameKitsColyseusServer({
    roomName,
    ...(options.port === undefined ? {} : { port: options.port }),
    roomOptions: {
      maxClients: 12,
      authority: "host-authoritative",
      ...(authoritativePath === "colyseus-schema"
        ? {
            nativeStateSync: {
              enabled: true,
              schemaVersion: REALTIME_ARENA_SCHEMA_VERSION
            },
            nativeCapabilities: {
              authoritativePath,
              stateSync: {
                available: true,
                lane: "colyseus-schema" as const,
                schemaVersion: REALTIME_ARENA_SCHEMA_VERSION
              }
            }
          }
        : {})
    }
  });

  const host = await createLocalMultiplayerDemoHost({
    endpoint: colyseus.endpoint,
    roomName,
    sessionId,
    hostPeerId,
    authoritativePath
  });
  let disposed = false;

  return {
    ...host,
    async dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      await host.dispose();
      await colyseus.dispose();
    }
  };
}

export async function createLocalMultiplayerDemoHost(
  options: LocalMultiplayerDemoHostOptions
): Promise<LocalMultiplayerDemoHost> {
  const sessionId = options.sessionId ?? MULTIPLAYER_DEMO_SESSION_ID;
  const hostPeerId = options.hostPeerId ?? MULTIPLAYER_DEMO_HOST_PEER_ID;
  const authoritativePath = options.authoritativePath ?? REALTIME_ARENA_DEFAULT_AUTHORITY_PATH;
  const schemaStateSync = authoritativePath === "colyseus-schema";
  const backend = createColyseusMultiplayerBackend({
    endpoint: options.endpoint,
    roomName: options.roomName,
    joinByIdFallback: true,
    nativeCapabilities: {
      authoritativePath,
      stateSync: {
        available: schemaStateSync,
        lane: "colyseus-schema",
        schemaVersion: REALTIME_ARENA_SCHEMA_VERSION
      }
    },
    nativeStateSync: {
      enabled: schemaStateSync,
      schemaVersion: REALTIME_ARENA_SCHEMA_VERSION
    },
    ...(schemaStateSync
      ? {
          createOptions: {
            nativeStateSync: {
              enabled: true,
              schemaVersion: REALTIME_ARENA_SCHEMA_VERSION
            },
            nativeCapabilities: {
              authoritativePath,
              stateSync: {
                available: true,
                lane: "colyseus-schema",
                schemaVersion: REALTIME_ARENA_SCHEMA_VERSION
              }
            }
          }
        }
      : {})
  });
  const host = createMultiplayerRuntime({
    id: `multiplayer-demo.host.${sessionId}`,
    backend,
    connectContext: {
      localPeer: {
        id: hostPeerId,
        displayName: "Demo Host",
        role: "host"
      }
    },
    idGenerator: createHostMessageIdGenerator()
  });
  const hostMessages: MultiplayerMessageEnvelope[] = [];
  const unsubscribeHostMessages = host.subscribe((message) => {
    hostMessages.push(message);
    if (hostMessages.length > 64) {
      hostMessages.shift();
    }
  });
  const app = createMultiplayerDemoRuntime({ multiplayer: host });

  await host.createSession({
    id: sessionId,
    kind: "private",
    authority: "host-authoritative",
    localPeer: {
      id: hostPeerId,
      displayName: "Demo Host",
      role: "host"
    }
  });
  const realtime = createRealtimeArenaHost({
    runtime: host,
    sessionId,
    hostPeerId,
    ...(schemaStateSync
      ? {
          publishSnapshot(snapshot: unknown, tick: number) {
            backend.native().publishState({
              sessionId,
              sourcePeerId: hostPeerId,
              tick,
              version: REALTIME_ARENA_SCHEMA_VERSION,
              timestamp: Date.now(),
              state: snapshot
            });
          }
        }
      : {})
  });
  app.runtime.start();

  let hostDisposed = false;
  let disposed = false;

  async function disposeHost(): Promise<void> {
    if (hostDisposed) {
      return;
    }

    hostDisposed = true;
    app.runtime.dispose();
    realtime.dispose();
    unsubscribeHostMessages();
    await host.dispose();
  }

  return {
    endpoint: options.endpoint,
    roomName: options.roomName,
    sessionId,
    hostPeerId,
    authoritativePath,
    app,
    realtime,
    host,
    hostMessages,
    tick(delta = 16) {
      app.runtime.tick(delta);
      realtime.tick(delta);
    },
    disposeHost,
    async dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      await disposeHost();
    }
  };
}

function createHostMessageIdGenerator(): () => string {
  let nextId = 0;
  return () => `multiplayer-demo.host.message.${++nextId}`;
}
