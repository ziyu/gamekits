import type { GameEvent } from "@gamekits/event-bus";

export function recordEvents() {
  const events: GameEvent[] = [];

  return {
    events,
    push(event: GameEvent) {
      events.push(event);
    },
    types() {
      return events.map((event) => event.type);
    }
  };
}
