import type { AssetLoaderAdapter } from "@gamekits/asset";
import type { AudioBackend } from "@gamekits/audio-core/backend";
import { GameError } from "@gamekits/core";
import type { CameraState2D } from "@gamekits/camera-core";
import type { DriverRegistry, GameDriver } from "@gamekits/driver-core";
import type { InputSourceAdapter, NormalizedInputEvent } from "@gamekits/input-core";
import type { RendererAdapter } from "@gamekits/renderer-core";

export type StandardDriverAdapterContext = {
  app: { id: string };
  profile: { id: string };
  service: { id: string };
  state: { drivers?: DriverRegistry | undefined };
};

export type DriverInputSourceFactory = {
  createInputSource(options: {
    onInput(event: NormalizedInputEvent): void;
    source?: string | undefined;
    clock?: (() => number) | undefined;
  }): InputSourceAdapter;
};

export type DriverCameraAdapter = {
  applyCameraState(state: CameraState2D): void;
};

export function resolveDriver(
  ctx: StandardDriverAdapterContext,
  driverId: string | undefined,
  capability: string
): GameDriver {
  const drivers = ctx.state.drivers;
  if (!drivers) {
    throw new GameError("app_host.missing_driver_registry", "Missing standard driver registry", {
      serviceId: ctx.service.id,
      capability,
      profileId: ctx.profile.id,
      appId: ctx.app.id
    });
  }

  if (driverId) {
    return drivers.require(driverId);
  }

  const driver = drivers.list().find((candidate) => hasAdapter(candidate, capability));
  if (!driver) {
    throw new GameError("app_host.missing_driver_capability", "Missing driver capability", {
      serviceId: ctx.service.id,
      capability,
      profileId: ctx.profile.id,
      appId: ctx.app.id
    });
  }

  return driver;
}

export function resolveDriverRenderer(
  ctx: StandardDriverAdapterContext,
  driverId?: string | undefined
): RendererAdapter {
  return requireAdapter<RendererAdapter>(resolveDriver(ctx, driverId, "renderer"), "renderer");
}

export function resolveDriverAssetLoader(
  ctx: StandardDriverAdapterContext,
  driverId?: string | undefined
): AssetLoaderAdapter {
  return requireAdapter<AssetLoaderAdapter>(
    resolveDriver(ctx, driverId, "assetLoader"),
    "assetLoader"
  );
}

export function resolveDriverAudioBackend(
  ctx: StandardDriverAdapterContext,
  driverId?: string | undefined
): AudioBackend {
  return requireAdapter<AudioBackend>(resolveDriver(ctx, driverId, "audio"), "audio");
}

export function resolveDriverInputSourceFactory(
  ctx: StandardDriverAdapterContext,
  driverId?: string | undefined
): DriverInputSourceFactory {
  const adapters = resolveDriver(ctx, driverId, "createInputSource").adapters();
  if (isInputSourceFactory(adapters)) {
    return adapters;
  }

  throw missingAdapter("createInputSource", "input source factory");
}

export function resolveDriverCamera(
  ctx: StandardDriverAdapterContext,
  driverId?: string | undefined
): DriverCameraAdapter {
  return requireAdapter<DriverCameraAdapter>(resolveDriver(ctx, driverId, "camera"), "camera");
}

function hasAdapter(driver: GameDriver, adapterName: string): boolean {
  const adapters = driver.adapters() as Record<string, unknown>;
  return adapters[adapterName] !== undefined;
}

function requireAdapter<TAdapter>(driver: GameDriver, adapterName: string): TAdapter {
  const adapter = (driver.adapters() as Record<string, unknown>)[adapterName];
  if (adapter !== undefined) {
    return adapter as TAdapter;
  }

  throw missingAdapter(adapterName, adapterName);
}

function missingAdapter(adapterName: string, label: string): GameError {
  return new GameError("app_host.missing_driver_adapter", `Missing driver ${label}`, {
    adapterName
  });
}

function isInputSourceFactory(value: unknown): value is DriverInputSourceFactory {
  return (
    typeof value === "object" &&
    value !== null &&
    "createInputSource" in value &&
    typeof (value as { createInputSource?: unknown }).createInputSource === "function"
  );
}
