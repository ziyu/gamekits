import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { AddressInfo } from "node:net";

import { GameKitsColyseusRoom } from "./gamekits-colyseus-room";
import type {
  ColyseusRoomClass,
  CreateGameKitsColyseusServerOptions,
  GameKitsColyseusRoomDefinition,
  GameKitsColyseusServerHandle
} from "./types";

export async function createGameKitsColyseusServer(
  options: CreateGameKitsColyseusServerOptions = {}
): Promise<GameKitsColyseusServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 0;
  const transport = new WebSocketTransport(options.transportOptions);
  const server = new Server({
    ...options.serverOptions,
    transport,
    greet: options.serverOptions?.greet ?? false,
    gracefullyShutdown: options.serverOptions?.gracefullyShutdown ?? false
  });
  const roomDefinitions = normalizeRoomDefinitions(options);

  for (const [roomName, definition] of roomDefinitions) {
    server.define(roomName, definition.room, definition.options);
  }

  await server.listen(requestedPort, host);
  const address = transport.server?.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve Colyseus server address.");
  }

  const port = (address as AddressInfo).port;
  let disposed = false;

  return {
    server,
    transport,
    host,
    port,
    endpoint: `http://${host}:${port}`,
    roomNames: [...roomDefinitions.keys()],
    async dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      await server.gracefullyShutdown(false);
      for (const roomName of roomDefinitions.keys()) {
        server.removeRoomType(roomName);
      }
    }
  };
}

function normalizeRoomDefinitions(
  options: CreateGameKitsColyseusServerOptions
): Map<string, { room: ColyseusRoomClass; options?: unknown }> {
  const definitions = new Map<string, { room: ColyseusRoomClass; options?: unknown }>();
  definitions.set(options.roomName ?? "gamekits", {
    room: options.roomClass ?? GameKitsColyseusRoom,
    options: options.roomOptions
  });

  for (const [roomName, definition] of Object.entries(options.rooms ?? {})) {
    definitions.set(roomName, normalizeRoomDefinition(definition));
  }

  return definitions;
}

function normalizeRoomDefinition(definition: GameKitsColyseusRoomDefinition): {
  room: ColyseusRoomClass;
  options?: unknown;
} {
  if (typeof definition === "function") {
    return { room: definition };
  }

  return {
    room: definition.room,
    options: definition.options
  };
}
