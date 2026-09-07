import { createServer as createViteServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createGameKitsColyseusServer } from "@gamekits/multiplayer-colyseus/server";
import {
  MULTIPLAYER_DEMO_SESSION_ID,
  MULTIPLAYER_DEMO_ROOM_NAME,
  type LocalMultiplayerDemoHost
} from "./create-local-demo-server";
import { normalizeMultiplayerDemoSessionId } from "./session-id";
import {
  createMultiplayerDemoSessionRegistry,
  MultiplayerDemoSessionConflictError
} from "./session-registry";
import {
  readRealtimeArenaAuthorityPath,
  REALTIME_ARENA_DEFAULT_AUTHORITY_PATH,
  REALTIME_ARENA_SCHEMA_VERSION
} from "../realtime/authority-path";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 5177;
const MAX_REQUEST_BYTES = 4 * 1024;
const authoritativePath =
  readRealtimeArenaAuthorityPath(process.env.MULTIPLAYER_DEMO_AUTHORITY_PATH) ??
  REALTIME_ARENA_DEFAULT_AUTHORITY_PATH;
const schemaStateSync = authoritativePath === "colyseus-schema";

const colyseus = await createGameKitsColyseusServer({
  roomName: `${MULTIPLAYER_DEMO_ROOM_NAME}_dev_${Date.now()}`,
  roomOptions: schemaStateSync
    ? {
        nativeStateSync: {
          enabled: true,
          schemaVersion: REALTIME_ARENA_SCHEMA_VERSION
        },
        nativeCapabilities: { authoritativePath }
      }
    : {}
});
const sessions = createMultiplayerDemoSessionRegistry({
  endpoint: colyseus.endpoint,
  roomName: colyseus.roomNames[0] ?? MULTIPLAYER_DEMO_ROOM_NAME,
  authoritativePath
});
const tickInterval = setInterval(() => {
  for (const session of sessions.hosts()) {
    session.tick(50);
  }
}, 50);

const vite = await createViteServer({
  root: new URL("../../", import.meta.url).pathname,
  plugins: [
    {
      name: "multiplayer-demo-api",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          void handleApiRequest(req, res, next).catch((error: unknown) => {
            writeJson(res, 500, {
              error: error instanceof Error ? error.message : String(error)
            });
          });
        });
      }
    }
  ],
  server: {
    host: HOST,
    port: DEFAULT_PORT,
    strictPort: false
  }
});

await vite.listen();
vite.printUrls();
console.log(`  Colyseus: ${colyseus.endpoint}`);
console.log(`  Room type: ${colyseus.roomNames.join(", ")}`);
console.log(`  Authority path: ${authoritativePath}`);

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

async function shutdown(): Promise<void> {
  clearInterval(tickInterval);
  await vite.close();
  await sessions.dispose();
  await colyseus.dispose();
  process.exit(0);
}

async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  next: () => void
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${DEFAULT_PORT}`}`);

  if (url.pathname === "/api/multiplayer-demo/config" && req.method === "GET") {
    writeJson(res, 200, {
      endpoint: colyseus.endpoint,
      roomName: colyseus.roomNames[0] ?? MULTIPLAYER_DEMO_ROOM_NAME,
      defaultSessionId: MULTIPLAYER_DEMO_SESSION_ID,
      authoritativePath,
      sessions: sessions.sessionIds()
    });
    return;
  }

  if (url.pathname !== "/api/multiplayer-demo/session") {
    next();
    return;
  }

  if (req.method === "GET") {
    const sessionId = normalizeMultiplayerDemoSessionId(url.searchParams.get("sessionId"));
    const session = sessions.getSession(sessionId);
    if (!session) {
      writeJson(res, 404, {
        error: `Session is not hosted: ${sessionId}`,
        sessionId
      });
      return;
    }

    writeJson(res, 200, createSessionResponse(session));
    return;
  }

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    const sessionId = normalizeMultiplayerDemoSessionId(readSessionId(body));
    const hostOwnerId = readHostOwnerId(body);
    if (!hostOwnerId) {
      writeJson(res, 400, {
        error: "Host owner id is required to host a multiplayer demo session.",
        sessionId
      });
      return;
    }

    try {
      const hosted = await sessions.hostSession(sessionId, hostOwnerId);
      writeJson(res, 200, {
        ...createSessionResponse(hosted.session),
        created: hosted.created
      });
    } catch (error) {
      if (error instanceof MultiplayerDemoSessionConflictError) {
        writeJson(res, 409, {
          error: `Session is already hosted: ${error.sessionId}. Use Join to enter as a client.`,
          sessionId: error.sessionId
        });
        return;
      }

      throw error;
    }
    return;
  }

  if (req.method === "DELETE") {
    const body = await readJsonBody(req);
    const sessionId = normalizeMultiplayerDemoSessionId(
      readSessionId(body) ?? url.searchParams.get("sessionId")
    );
    const disposed = await sessions.closeSession(sessionId);

    writeJson(res, 200, {
      sessionId,
      disposed
    });
    return;
  }

  writeJson(res, 405, {
    error: `Unsupported multiplayer demo method: ${req.method ?? "unknown"}`
  });
}

function createSessionResponse(session: LocalMultiplayerDemoHost) {
  return {
    endpoint: session.endpoint,
    roomName: session.roomName,
    sessionId: session.sessionId,
    hostPeerId: session.hostPeerId,
    authoritativePath: session.authoritativePath,
    snapshot: session.app.snapshot()
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      throw new Error("Multiplayer demo request body is too large.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function readSessionId(body: unknown): string | undefined {
  return readStringField(body, "sessionId");
}

function readHostOwnerId(body: unknown): string | undefined {
  return readStringField(body, "hostOwnerId");
}

function readStringField(body: unknown, field: string): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

function writeJson(res: ServerResponse<IncomingMessage>, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(text));
  res.end(text);
}
