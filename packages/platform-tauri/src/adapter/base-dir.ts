import type { FsBaseDir } from "@gamekits/platform-core";
import type { TauriBaseDirectoryMap, TauriFsDriver } from "./types";

export function createBaseDirectoryMap(driver: TauriFsDriver): TauriBaseDirectoryMap {
  const baseDirectory = driver.BaseDirectory;

  return {
    appData: baseDirectory.AppData ?? baseDirectory.AppLocalData,
    appConfig: baseDirectory.AppConfig,
    appCache: baseDirectory.AppCache ?? baseDirectory.AppLocalData,
    document: baseDirectory.Document,
    download: baseDirectory.Download,
    resource: baseDirectory.Resource,
    temp: baseDirectory.Temp
  };
}

export function toTauriFsOptions(
  baseDirectoryMap: TauriBaseDirectoryMap,
  baseDir?: FsBaseDir,
  recursive?: boolean
): Record<string, unknown> {
  return {
    ...(baseDir ? { baseDir: baseDirectoryMap[baseDir] } : {}),
    ...(recursive === undefined ? {} : { recursive })
  };
}
