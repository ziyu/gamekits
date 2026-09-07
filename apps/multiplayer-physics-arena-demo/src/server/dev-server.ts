import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { createGameKitsColyseusServer } from "@gamekits/multiplayer-colyseus/server";
import { createServer as createViteServer } from "vite";

import { ARENA_BROWSER_CONFIG_PATH, ARENA_ROOM_NAME } from "../shared/config";
import { KnockoutArenaRoom } from "./arena-room";

const host = process.env.ARENA_HOST ?? "127.0.0.1";
const webPort = readPort(process.env.ARENA_WEB_PORT, 5184);
const colyseus = await createGameKitsColyseusServer({
  host,
  port: 0,
  roomName: ARENA_ROOM_NAME,
  roomClass: KnockoutArenaRoom
});
const vite = await createViteServer({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  plugins: [
    {
      name: "knockout-arena-config",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (
            request.method !== "GET" ||
            request.url?.split("?", 1)[0] !== ARENA_BROWSER_CONFIG_PATH
          ) {
            next();
            return;
          }
          writeConfig(request, response);
        });
      }
    }
  ],
  server: { host, port: webPort, strictPort: false }
});

await vite.listen();
vite.printUrls();
console.log(`  Knockout authority: ${colyseus.endpoint}`);
console.log(`  Room type: ${ARENA_ROOM_NAME}`);

let shuttingDown = false;
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await vite.close();
  await colyseus.dispose();
  process.exit(0);
}

function writeConfig(request: IncomingMessage, response: ServerResponse<IncomingMessage>): void {
  const requestHostname = readRequestHostname(request.headers.host) ?? host;
  const endpoint = `http://${formatHostname(requestHostname)}:${colyseus.port}`;
  response.statusCode = 200;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify({ endpoint, roomName: ARENA_ROOM_NAME }));
}

function readRequestHostname(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) return undefined;
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return undefined;
  }
}

function formatHostname(value: string): string {
  return value.includes(":") && !value.startsWith("[") ? `[${value}]` : value;
}

function readPort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid Knockout Arena web port: ${value}`);
  }
  return port;
}
