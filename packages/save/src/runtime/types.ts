export type SaveVersion = string;
export type SaveSlotId = string;
export type SaveDiagnosticSeverity = "info" | "warning" | "error";
export type SavePhase =
  | "capture"
  | "encode"
  | "write"
  | "read"
  | "decode"
  | "migrate"
  | "validate"
  | "restore"
  | "delete"
  | "inspect";

export type SaveSlotMetadata = {
  id: SaveSlotId;
  label?: string;
  description?: string;
  playtimeMs?: number;
  screenshotAssetId?: string;
  tags?: string[];
};

export type SaveCompatibilityMetadata = {
  frameworkVersion?: string;
  dataRevision?: string;
  contentPackages?: Array<{
    id: string;
    version: string;
    optional?: boolean;
  }>;
  requiredCapabilities?: string[];
};

export type RuntimeSaveSection = {
  seed: string;
  clock: {
    ticks: number;
    elapsed: number;
  };
  rng?: unknown;
};

export type SaveSection<TData = unknown> = {
  id: string;
  version: SaveVersion;
  data: TData;
};

export type SavePayload = {
  runtime: RuntimeSaveSection;
  sections: Record<string, SaveSection>;
  custom?: Record<string, unknown>;
};

export type SaveEnvelope<TPayload = SavePayload> = {
  format: "gamekits.save";
  formatVersion: SaveVersion;
  appId: string;
  gameId: string;
  gameVersion: string;
  createdAt: number;
  updatedAt: number;
  slot: SaveSlotMetadata;
  compatibility: SaveCompatibilityMetadata;
  checksum?: string;
  payload: TPayload;
};

export type SaveSlotSummary = SaveSlotMetadata & {
  updatedAt?: number;
  formatVersion?: SaveVersion;
  gameVersion?: string;
};

export type SaveDiagnosticEvent = {
  type: string;
  severity: SaveDiagnosticSeverity;
  timestamp: number;
  phase?: SavePhase;
  slotId?: SaveSlotId;
  contributorId?: string;
  sectionId?: string;
  code?: string;
  payload: Record<string, unknown>;
};

export type SaveValidationIssue = {
  code: string;
  message: string;
  severity: SaveDiagnosticSeverity;
  path?: string;
};

export type SaveValidationResult = {
  issues: SaveValidationIssue[];
};

export type SaveEntityMap = {
  get(oldEntityId: string | number): string | number | undefined;
  set(oldEntityId: string | number, newEntityId: string | number): void;
  entries(): Array<[string | number, string | number]>;
};

export type SaveContributorServices = Record<string, unknown>;

export type SaveContributorScope = string;

export type SaveContributorSelection = {
  includeIds?: string[] | undefined;
  excludeIds?: string[] | undefined;
  includeTags?: string[] | undefined;
  excludeTags?: string[] | undefined;
  includeScopes?: SaveContributorScope[] | undefined;
  excludeScopes?: SaveContributorScope[] | undefined;
};

export type SaveContributorPolicy = SaveContributorSelection & {
  defaultIncluded?: boolean | undefined;
};

export type SaveCaptureContext = {
  now: number;
  services?: SaveContributorServices;
};

export type SaveRestoreContext = {
  now: number;
  services?: SaveContributorServices;
  entityMap: SaveEntityMap;
};

export type SaveValidationContext = {
  services?: SaveContributorServices;
};

export type SaveContributor<TData = unknown> = {
  id: string;
  version: SaveVersion;
  order?: number;
  scope?: SaveContributorScope | undefined;
  tags?: string[] | undefined;
  saveByDefault?: boolean | undefined;
  required?: boolean;
  capture(
    ctx: SaveCaptureContext
  ): SaveSection<TData> | undefined | Promise<SaveSection<TData> | undefined>;
  restore?(ctx: SaveRestoreContext, section: SaveSection<TData>): void | Promise<void>;
  validate?(section: SaveSection<TData>, ctx: SaveValidationContext): SaveValidationResult;
};

export type SaveStore = {
  list(): Promise<SaveSlotSummary[]>;
  read(slotId: SaveSlotId): Promise<Uint8Array>;
  readBackup?(slotId: SaveSlotId): Promise<Uint8Array>;
  write(slotId: SaveSlotId, data: Uint8Array, metadata: SaveSlotSummary): Promise<void>;
  delete(slotId: SaveSlotId): Promise<void>;
  exists(slotId: SaveSlotId): Promise<boolean>;
};

export type SaveCodec = {
  encode(envelope: SaveEnvelope): Promise<Uint8Array> | Uint8Array;
  decode(data: Uint8Array): Promise<SaveEnvelope> | SaveEnvelope;
};

export type SaveMigration = {
  id: string;
  from: SaveVersion;
  to: SaveVersion;
  migrate(envelope: SaveEnvelope): SaveEnvelope | Promise<SaveEnvelope>;
};

export type SaveMigrationRegistry = {
  register(migration: SaveMigration): void;
  plan(from: SaveVersion, to: SaveVersion): SaveMigration[];
  migrate(envelope: SaveEnvelope, to: SaveVersion): Promise<SaveEnvelope>;
  migrations(): SaveMigration[];
};

export type SaveOptions = {
  metadata?: Partial<Omit<SaveSlotMetadata, "id">>;
  runtime: RuntimeSaveSection;
  custom?: Record<string, unknown>;
  compatibility?: SaveCompatibilityMetadata;
  contributors?: SaveContributorSelection | undefined;
};

export type LoadOptions = {
  restore?: boolean;
  migrate?: boolean;
  /** Explicitly read the previous revision, when the store supports it. */
  backup?: boolean;
  contributors?: SaveContributorSelection | undefined;
};

export type SaveResult = {
  slotId: SaveSlotId;
  envelope: SaveEnvelope;
  bytes: number;
};

export type LoadResult = {
  slotId: SaveSlotId;
  envelope: SaveEnvelope;
  restored: boolean;
  migrated: boolean;
};

export type SaveInspection = {
  slotId: SaveSlotId;
  envelope: Omit<SaveEnvelope, "payload">;
  sections: Array<{ id: string; version: SaveVersion }>;
};

export type SaveManagerSnapshot = {
  formatVersion: SaveVersion;
  contributors: Array<{
    id: string;
    version: SaveVersion;
    required: boolean;
  }>;
  lastOperation?: {
    type: "save" | "load" | "delete" | "inspect";
    slotId: SaveSlotId;
    status: "completed" | "failed";
    timestamp: number;
  };
  diagnostics: SaveDiagnosticEvent[];
};

export type SaveManager = {
  registerContributor(contributor: SaveContributor): void;
  unregisterContributor(id: string): void;
  listContributors(): SaveContributor[];
  list(): Promise<SaveSlotSummary[]>;
  save(slotId: SaveSlotId, options: SaveOptions): Promise<SaveResult>;
  load(slotId: SaveSlotId, options?: LoadOptions): Promise<LoadResult>;
  /** Restore an already decoded/migrated snapshot, e.g. into an isolated candidate session. */
  restore(envelope: SaveEnvelope, options?: Pick<LoadOptions, "contributors">): Promise<void>;
  delete(slotId: SaveSlotId): Promise<void>;
  inspect(slotId: SaveSlotId): Promise<SaveInspection>;
  snapshot(): SaveManagerSnapshot;
};

export type CreateSaveManagerOptions = {
  appId: string;
  gameId: string;
  gameVersion: string;
  formatVersion: SaveVersion;
  store: SaveStore;
  codec?: SaveCodec;
  migrations?: SaveMigrationRegistry;
  clock?: () => number;
  compatibility?: SaveCompatibilityMetadata;
  contributorPolicy?: SaveContributorPolicy | undefined;
  services?: () => SaveContributorServices;
  onDiagnostic?: (event: SaveDiagnosticEvent) => void;
  onDiagnosticError?: (error: unknown, event: SaveDiagnosticEvent) => void;
  diagnosticLimit?: number;
};
