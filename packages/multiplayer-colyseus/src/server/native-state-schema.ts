import { schema, type SchemaType } from "@colyseus/schema";

export type GameKitsColyseusNativeStateMessage = {
  sessionId: string;
  sourcePeerId: string;
  tick: number;
  version: string;
  timestamp: number;
  stateJson: string;
};

export const GameKitsColyseusNativeState = schema({
  sessionId: "string",
  sourcePeerId: "string",
  tick: "number",
  version: "string",
  timestamp: "number",
  stateJson: "string",
  stateBytes: "number",
  updateCount: "number"
});

export type GameKitsColyseusNativeState = SchemaType<typeof GameKitsColyseusNativeState>;
