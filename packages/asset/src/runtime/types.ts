import type { DataRegistry } from "@gamekits/data";

export type AssetType =
  | "image"
  | "spritesheet"
  | "atlas"
  | "audio"
  | "json"
  | "tilemap"
  | "font"
  | "shader"
  | "model"
  | "texture"
  | "custom";

export type AssetSource =
  | { type: "url"; url: string }
  | { type: "platform-file"; path: string; baseDir?: string }
  | { type: "resource"; path: string }
  | { type: "memory"; data: Uint8Array; mimeType?: string };

export type SpritesheetFrameConfig = {
  width: number;
  height: number;
  margin?: number;
  spacing?: number;
};

export type AtlasAssetMetadata = {
  dataSource: AssetSource;
  format?: "json-array" | "json-hash" | undefined;
};

export type AudioAssetMetadata = {
  sources?: AssetSource[] | undefined;
  stream?: boolean | undefined;
  instances?: number | undefined;
};

export type AssetVariantDefinition = {
  source: AssetSource;
  metadata?: Record<string, unknown> | undefined;
};

export type AssetAnimationFrameRange = {
  start: number;
  end: number;
  prefix?: string | undefined;
  suffix?: string | undefined;
  zeroPad?: number | undefined;
};

export type AssetAnimationManifest = {
  id: string;
  frames: number[] | string[] | AssetAnimationFrameRange;
  frameRate?: number | undefined;
  durationMs?: number | undefined;
  repeat?: number | undefined;
  yoyo?: boolean | undefined;
};

export type AssetDefinition = {
  id: string;
  type: AssetType;
  source: AssetSource;
  group?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  preload?: boolean;
  lazy?: boolean;
  /** Estimated resident bytes, required when a byte budget is configured. */
  estimatedBytes?: number;
  frame?: SpritesheetFrameConfig;
  atlas?: AtlasAssetMetadata | undefined;
  audio?: AudioAssetMetadata | undefined;
  variants?: Record<string, AssetVariantDefinition> | undefined;
  animations?: AssetAnimationManifest[] | undefined;
};

export type AssetRef<TAssetType extends AssetType = AssetType> = {
  assetId: string;
  type?: TAssetType;
  variant?: string;
};

export type AssetLoadStatus = "registered" | "loading" | "loaded" | "failed";

export type AssetLoadState = {
  id: string;
  status: AssetLoadStatus;
  error?: string;
  loadedAt?: number;
};

export type AssetDiagnosticEvent = {
  type: string;
  assetId?: string;
  payload: Record<string, unknown>;
  source?: string;
};

export type AssetLoaderAdapter = {
  id: string;
  supports(asset: AssetDefinition): boolean;
  load(asset: AssetDefinition, options?: AssetLoadOptions): Promise<void>;
  /** Release native resources. Repeated calls and absent resources must be safe. */
  unload?(asset: AssetDefinition): void | Promise<void>;
};

export type AssetLoadOptions = { signal?: AbortSignal | undefined };

export type AssetScope = {
  readonly id: string;
  load(id: string): Promise<AssetLoadState>;
  loadGroup(group: string): Promise<AssetLoadState[]>;
  release(id: string): Promise<void>;
  dispose(): Promise<void>;
};

export type AssetLifecycleSnapshot = {
  disposed: boolean;
  activeLoads: number;
  queuedLoads: number;
  residentAssets: number;
  estimatedResidentBytes: number;
  references: Array<{ assetId: string; owners: number }>;
};

export type CreateAssetManagerOptions = {
  adapter: AssetLoaderAdapter;
  clock?: () => number;
  onDiagnostic?: (event: AssetDiagnosticEvent) => void;
  onDiagnosticError?: (error: unknown, event: AssetDiagnosticEvent) => void;
  maxConcurrentLoads?: number;
  maxResidentAssets?: number;
  maxResidentBytes?: number;
};

export type RegisterAssetsFromDataOptions = {
  type?: string;
};

export type AssetManager = {
  register(asset: AssetDefinition): void;
  registerMany(assets: AssetDefinition[]): void;
  registerFromDataRegistry(
    registry: DataRegistry,
    options?: RegisterAssetsFromDataOptions
  ): AssetDefinition[];
  has(id: string): boolean;
  get(id: string): AssetDefinition;
  assets(): AssetDefinition[];
  state(id: string): AssetLoadState;
  states(): AssetLoadState[];
  load(id: string, options?: AssetLoadOptions): Promise<AssetLoadState>;
  loadGroup(group: string, options?: AssetLoadOptions): Promise<AssetLoadState[]>;
  createScope(id: string): AssetScope;
  unload(id: string): Promise<void>;
  dispose(): Promise<void>;
  lifecycleSnapshot(): AssetLifecycleSnapshot;
};
