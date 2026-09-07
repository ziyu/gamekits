import type { DataRegistry } from "@gamekits/data";
import type { EventBus, GameEvent } from "@gamekits/event-bus";
import type { GameInstallContext } from "@gamekits/game-runtime";

export type TcaRule = {
  id: string;
  trigger: TriggerConfig;
  conditions?: ConditionConfig[] | undefined;
  actions: ActionConfig[];
  priority?: number | undefined;
  once?: boolean | undefined;
  enabled?: boolean | undefined;
  tags?: string[] | undefined;
};

export type TriggerConfig = {
  type: string;
  args?: Record<string, unknown> | undefined;
};

export type ConditionConfig = {
  type: string;
  args?: Record<string, unknown> | undefined;
};

export type ActionConfig = {
  type: string;
  args?: Record<string, unknown> | undefined;
};

export type TcaTriggerDefinition = {
  type: string;
  description?: string | undefined;
  schema?: unknown;
  eventTypes?(config: TriggerConfig): string[];
  matches(ctx: TcaHandlerContext, config: TriggerConfig): boolean;
};

export type TcaConditionDefinition = {
  type: string;
  description?: string | undefined;
  schema?: unknown;
  evaluate(ctx: TcaHandlerContext, config: ConditionConfig): boolean;
};

export type TcaActionDefinition = {
  type: string;
  description?: string | undefined;
  schema?: unknown;
  execute(ctx: TcaHandlerContext, config: ActionConfig): void;
};

export type TcaDefinitionSet = {
  triggers?: TcaTriggerDefinition[] | undefined;
  conditions?: TcaConditionDefinition[] | undefined;
  actions?: TcaActionDefinition[] | undefined;
};

export type TcaTriggerHandler = TcaTriggerDefinition;
export type TcaConditionHandler = TcaConditionDefinition;
export type TcaActionHandler = TcaActionDefinition;
export type TcaHandlerSet = TcaDefinitionSet;

export type TcaHandlerContext = {
  event: GameEvent;
  eventBus: EventBus;
  dataRegistry?: DataRegistry | undefined;
  game?: GameInstallContext | undefined;
  rule: TcaRule;
  traceId: string;
  correlationId?: string | undefined;
  parentId?: string | undefined;
};

export type TcaCompiledRule = {
  rule: TcaRule;
  trigger: TcaTriggerHandler;
  conditions: Array<{
    config: ConditionConfig;
    handler: TcaConditionHandler;
  }>;
  actions: Array<{
    config: ActionConfig;
    handler: TcaActionHandler;
  }>;
  eventTypes: string[];
};

export type TcaCompiledRules = {
  rules: TcaCompiledRule[];
  rulesByEventType: Map<string, TcaCompiledRule[]>;
};

export type TcaTraceStatus = "passed" | "skipped" | "failed";

export type TcaActionTraceStatus = "executed" | "skipped" | "failed";

export type TcaTraceEntry = {
  id: string;
  ruleId: string;
  eventType: string;
  timestamp: number;
  correlationId?: string | undefined;
  parentId?: string | undefined;
  status: TcaTraceStatus;
  reason?: string | undefined;
  conditions: Array<{
    type: string;
    passed: boolean;
    error?: string | undefined;
  }>;
  actions: Array<{
    type: string;
    status: TcaActionTraceStatus;
    error?: string | undefined;
  }>;
};

export type TcaTraceSnapshot = {
  entries: TcaTraceEntry[];
};

export type TcaTraceInput = Omit<TcaTraceEntry, "id"> & {
  id?: string | undefined;
};

export type TcaTraceStore = {
  add(entry: TcaTraceInput): TcaTraceEntry;
  list(): TcaTraceEntry[];
  clear(): void;
  snapshot(): TcaTraceSnapshot;
};

export type TcaRuntime = {
  readonly rules: TcaCompiledRule[];
  readonly traceStore: TcaTraceStore;
  handleEvent(event: GameEvent): void;
  captureCheckpoint(): TcaRuntimeCheckpoint;
  restoreCheckpoint(checkpoint: TcaRuntimeCheckpoint): void;
  dispose(): void;
};

export type TcaRuntimeCheckpoint = {
  runSequence: number;
  executedOnceRuleIds: string[];
};

export type TcaHandle = Pick<TcaRuntime, "captureCheckpoint" | "restoreCheckpoint"> & {
  isBound(): boolean;
};

export type CreateTcaRuntimeConfig = {
  rules: TcaRule[];
  eventBus: EventBus;
  definitions?: TcaDefinitionSet | undefined;
  handlers?: TcaHandlerSet | undefined;
  traceStore?: TcaTraceStore | undefined;
  dataRegistry?: DataRegistry | undefined;
  game?: GameInstallContext | undefined;
};

export type CreateTcaModuleConfig = {
  id?: string | undefined;
  dataRegistry: DataRegistry;
  eventBus?: EventBus | undefined;
  ruleKind?: string | undefined;
  definitions?: TcaDefinitionSet | undefined;
  handlers?: TcaHandlerSet | undefined;
  traceStore?: TcaTraceStore | undefined;
  handle?: TcaHandle | undefined;
  onRuntime?: ((runtime: TcaRuntime) => void) | undefined;
};
