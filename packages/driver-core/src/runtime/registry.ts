import { GameError } from "@gamekits/core";
import type { DriverId, DriverRegistry, GameDriver } from "./types";

export function createDriverRegistry(drivers: GameDriver[] = []): DriverRegistry {
  const registry = new Map<DriverId, GameDriver>();

  const api: DriverRegistry = {
    register(driver) {
      if (registry.has(driver.id)) {
        throw new GameError("driver.duplicate", `Duplicate driver: ${driver.id}`, {
          driverId: driver.id
        });
      }

      registry.set(driver.id, driver);
    },
    has(id) {
      return registry.has(id);
    },
    get<TDriver extends GameDriver = GameDriver>(id: DriverId): TDriver | undefined {
      return registry.get(id) as TDriver | undefined;
    },
    require<TDriver extends GameDriver = GameDriver>(id: DriverId): TDriver {
      const driver = api.get<TDriver>(id);
      if (!driver) {
        throw new GameError("driver.missing", `Missing driver: ${id}`, { driverId: id });
      }

      return driver;
    },
    list() {
      return [...registry.values()];
    },
    snapshot() {
      return {
        drivers: api.list().map((driver) => driver.snapshot())
      };
    }
  };

  for (const driver of drivers) {
    api.register(driver);
  }

  return api;
}
