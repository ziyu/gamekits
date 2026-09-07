import type { DataRegistry } from "@gamekits/data";
import type { EventBus } from "@gamekits/event-bus";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type { NavigationQueries } from "@gamekits/navigation-core";
import type { PhysicsQueries } from "@gamekits/physics-core";
import type { AiIntentSink } from "../contracts/intent";
import type { AiSharedFactQueries } from "../contracts/shared-fact-queries";
import type { AiWorldReadModel } from "../contracts/world-read-model";
import type { AiHandle, AiRuntime } from "../controller/runtime";
import type { AiUtilityInputResolver } from "../decision/utility";
import type {
  AiTraceEntry,
  AiTraceProductionOptions,
  AiTraceRetentionOptions
} from "../observability/trace";
import type { AiSensorSampler } from "../perception/sensor-sampler";
import type { AiSchedulerClass } from "../scheduler/scheduler-class";
import type { AiTaskExecutor } from "../task/task-executor";

export type CreateAiRuntimeOptions = {
  id?: string | undefined;
  dataRegistry: DataRegistry;
  world: AiWorldReadModel;
  eventBus?: EventBus | undefined;
  navigation?: NavigationQueries | undefined;
  physics?: PhysicsQueries | undefined;
  sharedFacts?: AiSharedFactQueries | undefined;
  intentSink: AiIntentSink;
  sensors?: AiSensorSampler[] | undefined;
  inputs?: AiUtilityInputResolver[] | undefined;
  tasks?: AiTaskExecutor[] | undefined;
  schedulerClasses?: AiSchedulerClass[] | undefined;
  maxSensorSamplesPerTick?: number | undefined;
  maxDecisionsPerTick?: number | undefined;
  maxPathRequestsPerTick?: number | undefined;
  failureBackoffMs?: number | undefined;
  defaultBlackboardLimit?: number | undefined;
  maxBlackboardValueDepth?: number | undefined;
  maxBlackboardValueNodes?: number | undefined;
  maxBlackboardStringLength?: number | undefined;
  traceRetention?: AiTraceRetentionOptions | undefined;
  traceProduction?: AiTraceProductionOptions | undefined;
  /** @deprecated Use traceRetention.limit. */
  traceLimit?: number | undefined;
  onTrace?: ((entry: AiTraceEntry) => void) | undefined;
  onTraceError?: ((error: unknown, entry: AiTraceEntry) => void) | undefined;
};

export type CreateAiModuleOptions = Omit<CreateAiRuntimeOptions, "world" | "eventBus"> & {
  eventBus?: EventBus | undefined;
  handle?: AiHandle | undefined;
  onRuntime?: ((runtime: AiRuntime, context: GameInstallContext) => void) | undefined;
};
