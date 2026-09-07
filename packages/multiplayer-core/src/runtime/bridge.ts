import type { EventBus } from "@gamekits/event-bus";
import type { GameModule } from "@gamekits/core";
import {
  createSnapshotPresentationProjector,
  createSnapshotPlayback,
  type PresentedSnapshotTracks,
  type SnapshotBufferEntry,
  type SnapshotPlayback,
  type SnapshotPlaybackOptions,
  type SnapshotPlaybackSample,
  type SnapshotPresentationTrack
} from "./presentation";
import type {
  MultiplayerAuthorityDecision,
  MultiplayerMessageEnvelope,
  MultiplayerRuntime
} from "./types";
import {
  createMultiplayerClientReplication,
  type MultiplayerClientPredictionEncodeContext,
  type MultiplayerClientReplicationFrameContext,
  type MultiplayerClientReplicationOptions,
  type MultiplayerClientReplicationSnapshotContext
} from "./client-replication";
import type { MultiplayerAuthorityBinding } from "./authority-types";
import { createBoundedQueue } from "./bounded-queue";

export type MultiplayerBridgeInstallContext = {
  eventBus: EventBus;
  systems: {
    register(system: MultiplayerBridgeSystem): void;
  };
};

export type MultiplayerBridgeSystemContext = {
  delta?: number;
  elapsed?: number;
  tick?: number;
};

export type MultiplayerBridgeSystem = {
  id: string;
  update(ctx?: MultiplayerBridgeSystemContext): void;
};

export type MultiplayerCommandContext<TInstallContext extends MultiplayerBridgeInstallContext> = {
  installContext: TInstallContext;
  runtime: MultiplayerRuntime;
  message: MultiplayerMessageEnvelope;
};

export type MultiplayerAuthorityPolicy<TInstallContext extends MultiplayerBridgeInstallContext> = (
  ctx: MultiplayerCommandContext<TInstallContext>
) => MultiplayerAuthorityDecision;

export type MultiplayerCommandHandler<TInstallContext extends MultiplayerBridgeInstallContext> = (
  ctx: MultiplayerCommandContext<TInstallContext>
) => void;

export type MultiplayerCommandQueueOverflowPolicy = "reject-newest" | "drop-oldest";

export type MultiplayerCommandQueueDiagnostics = {
  capacity: number;
  queued: number;
  maxQueued: number;
  received: number;
  handled: number;
  rejected: number;
  overflowed: number;
  expired: number;
  lastCode?: string;
  lastMessageId?: string;
};

export type MultiplayerCommandQueueOptions = {
  capacity?: number;
  maxPerTick?: number;
  maxAgeMs?: number;
  overflowPolicy?: MultiplayerCommandQueueOverflowPolicy;
  clock?: () => number;
  onDiagnostics?(diagnostics: MultiplayerCommandQueueDiagnostics): void;
};

export type MultiplayerPresentationReadContext<
  TInstallContext extends MultiplayerBridgeInstallContext
> = {
  installContext: TInstallContext;
  runtime: MultiplayerRuntime;
  frame: MultiplayerBridgeSystemContext;
};

export type MultiplayerPresentationApplyContext<
  TSnapshot,
  TInstallContext extends MultiplayerBridgeInstallContext
> = MultiplayerPresentationReadContext<TInstallContext> & {
  playback: SnapshotPlayback<TSnapshot>;
  sample: SnapshotPlaybackSample<TSnapshot>;
  presented: PresentedSnapshotTracks;
  snapshot: TSnapshot;
};

export type MultiplayerPresentationBridgeOptions<
  TSnapshot = any,
  TInstallContext extends MultiplayerBridgeInstallContext = MultiplayerBridgeInstallContext
> = SnapshotPlaybackOptions<TSnapshot> & {
  id?: string;
  tracks?: Iterable<SnapshotPresentationTrack<TSnapshot>>;
  readSnapshot(
    ctx: MultiplayerPresentationReadContext<TInstallContext>
  ): SnapshotBufferEntry<TSnapshot> | undefined;
  applySample(ctx: MultiplayerPresentationApplyContext<TSnapshot, TInstallContext>): void;
};

export type MultiplayerClientPredictionDomainCreateContext<
  TInstallContext extends MultiplayerBridgeInstallContext
> = {
  installContext: TInstallContext;
  runtime: MultiplayerRuntime;
  binding: MultiplayerAuthorityBinding;
};

export type MultiplayerClientPredictionDomainInputContext<
  TSnapshot,
  TInput,
  TInstallContext extends MultiplayerBridgeInstallContext
> = MultiplayerClientPredictionEncodeContext<TSnapshot, TInput, TInstallContext> & {
  encodedInput: unknown;
};

export type MultiplayerClientPredictionDomainRuntime<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  TPredictedState
> = {
  applyAuthoritative?(
    context: MultiplayerClientReplicationSnapshotContext<TSnapshot, TInstallContext>
  ): void;
  applyInput?(
    context: MultiplayerClientPredictionDomainInputContext<TSnapshot, TInput, TInstallContext>
  ): void;
  applyFrame?(
    context: MultiplayerClientReplicationFrameContext<TSnapshot, TPredictedState, TInstallContext>
  ): void;
  diagnostics?(): object;
  dispose(): void;
};

export type MultiplayerClientPredictionDomainDescriptor<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  TPredictedState
> = {
  id: string;
  create(
    context: MultiplayerClientPredictionDomainCreateContext<TInstallContext>
  ): MultiplayerClientPredictionDomainRuntime<TInstallContext, TSnapshot, TInput, TPredictedState>;
};

export type MultiplayerClientPredictionDomainView = {
  diagnostics(): Readonly<Record<string, object | undefined>>;
};

export type MultiplayerModuleOptions<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot = any,
  TInput = any,
  TPredictedState = any
> = {
  id?: string;
  runtime: MultiplayerRuntime;
  commandKinds?: string[];
  commandQueue?: MultiplayerCommandQueueOptions;
  authority?: MultiplayerAuthorityPolicy<TInstallContext>;
  handleCommand?: MultiplayerCommandHandler<TInstallContext>;
  presentation?: MultiplayerPresentationBridgeOptions<TSnapshot, TInstallContext>;
  clientReplication?: MultiplayerClientReplicationOptions<
    TSnapshot,
    TInput,
    TPredictedState,
    TInstallContext
  >;
  clientPredictionDomains?: readonly MultiplayerClientPredictionDomainDescriptor<
    TInstallContext,
    TSnapshot,
    TInput,
    TPredictedState
  >[];
  exposeClientPredictionDomains?(view: MultiplayerClientPredictionDomainView | undefined): void;
};

/** @deprecated Use MultiplayerModuleOptions. */
export type CreateMultiplayerBridgeModuleOptions<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot = any,
  TInput = any,
  TPredictedState = any
> = MultiplayerModuleOptions<TInstallContext, TSnapshot, TInput, TPredictedState>;

export function createMultiplayerModule<
  TInstallContext extends MultiplayerBridgeInstallContext = MultiplayerBridgeInstallContext,
  TSnapshot = any,
  TInput = any,
  TPredictedState = any
>(
  options: MultiplayerModuleOptions<TInstallContext, TSnapshot, TInput, TPredictedState>
): GameModule<TInstallContext> {
  const moduleId = options.id ?? "gamekits.multiplayer.bridge";
  const predictionDomainDescriptors = validatePredictionDomainDescriptors(
    options.clientPredictionDomains ?? []
  );
  if (predictionDomainDescriptors.length > 0 && options.clientReplication === undefined) {
    throw new Error("Client prediction domains require managed client replication.");
  }
  const commandKinds = new Set(options.commandKinds ?? ["game.command"]);
  const commandQueueCapacity = normalizePositiveInteger(options.commandQueue?.capacity, 256);
  const maxCommandsPerTick = normalizePositiveInteger(options.commandQueue?.maxPerTick, 64);
  const maxCommandAgeMs = normalizeDuration(options.commandQueue?.maxAgeMs);
  const overflowPolicy = options.commandQueue?.overflowPolicy ?? "reject-newest";
  const commandQueueClock = options.commandQueue?.clock ?? (() => Date.now());

  return {
    id: moduleId,
    install(ctx: TInstallContext) {
      const queue = createBoundedQueue<{
        message: MultiplayerMessageEnvelope;
        enqueuedAt: number;
      }>(commandQueueCapacity);
      const queueDiagnostics: MultiplayerCommandQueueDiagnostics = {
        capacity: queue.capacity,
        queued: 0,
        maxQueued: 0,
        received: 0,
        handled: 0,
        rejected: 0,
        overflowed: 0,
        expired: 0
      };
      const cleanup: Array<() => void> = [];
      const predictionDomains = createPredictionDomainManager<
        TInstallContext,
        TSnapshot,
        TInput,
        TPredictedState
      >(ctx, options.runtime, predictionDomainDescriptors);
      if (predictionDomainDescriptors.length > 0) {
        options.exposeClientPredictionDomains?.(predictionDomains.view);
        cleanup.push(() => {
          predictionDomains.dispose();
          options.exposeClientPredictionDomains?.(undefined);
        });
      }

      function emitQueueDiagnostics(code?: string, messageId?: string): void {
        queueDiagnostics.queued = queue.length;
        queueDiagnostics.maxQueued = Math.max(queueDiagnostics.maxQueued, queue.length);
        if (code === undefined) {
          delete queueDiagnostics.lastCode;
        } else {
          queueDiagnostics.lastCode = code;
        }
        if (messageId === undefined) {
          delete queueDiagnostics.lastMessageId;
        } else {
          queueDiagnostics.lastMessageId = messageId;
        }
        options.commandQueue?.onDiagnostics?.(cloneCommandQueueDiagnostics(queueDiagnostics));
      }

      function emitOverflow(message: MultiplayerMessageEnvelope, code: string): void {
        queueDiagnostics.overflowed += 1;
        ctx.eventBus.emit(
          "multiplayer.command.overflow",
          {
            messageId: message.id,
            peerId: message.sourcePeerId,
            code,
            policy: overflowPolicy
          },
          moduleId,
          messageCorrelation(message)
        );
        emitQueueDiagnostics(code, message.id);
      }

      if (options.handleCommand) {
        const unsubscribe = options.runtime.subscribe((message) => {
          if (commandKinds.has(message.kind)) {
            queueDiagnostics.received += 1;
            const entry = { message, enqueuedAt: commandQueueClock() };
            if (queue.enqueue(entry)) {
              emitQueueDiagnostics();
              return;
            }

            if (overflowPolicy === "drop-oldest") {
              const dropped = queue.dequeue();
              if (dropped !== undefined) {
                emitOverflow(dropped.message, "command-queue-dropped");
              }
              queue.enqueue(entry);
              emitQueueDiagnostics();
              return;
            }

            emitOverflow(message, "command-queue-full");
          }
        });
        cleanup.push(unsubscribe);

        ctx.systems.register({
          id: `${moduleId}.commands`,
          update() {
            const pending = Math.min(queue.length, maxCommandsPerTick);
            for (let index = 0; index < pending; index += 1) {
              const entry = queue.dequeue();
              if (!entry) {
                continue;
              }
              const message = entry.message;
              if (commandQueueClock() - entry.enqueuedAt > maxCommandAgeMs) {
                queueDiagnostics.expired += 1;
                ctx.eventBus.emit(
                  "multiplayer.command.expired",
                  {
                    messageId: message.id,
                    peerId: message.sourcePeerId,
                    code: "command-expired"
                  },
                  moduleId,
                  messageCorrelation(message)
                );
                emitQueueDiagnostics("command-expired", message.id);
                continue;
              }

              const commandContext: MultiplayerCommandContext<TInstallContext> = {
                installContext: ctx,
                runtime: options.runtime,
                message
              };
              const decision = options.authority?.(commandContext) ?? { allowed: true };
              if (!decision.allowed) {
                queueDiagnostics.rejected += 1;
                ctx.eventBus.emit(
                  "multiplayer.command.rejected",
                  {
                    messageId: message.id,
                    peerId: message.sourcePeerId,
                    code: decision.code,
                    reason: decision.reason
                  },
                  moduleId,
                  messageCorrelation(message)
                );
                emitQueueDiagnostics(decision.code, message.id);
                continue;
              }

              ctx.eventBus.emit(
                "multiplayer.command.accepted",
                {
                  messageId: message.id,
                  peerId: message.sourcePeerId,
                  kind: message.kind
                },
                moduleId,
                messageCorrelation(message)
              );
              options.handleCommand?.(commandContext);
              queueDiagnostics.handled += 1;
              emitQueueDiagnostics();
            }
            emitQueueDiagnostics();
          }
        });
      }

      if (options.presentation && options.clientReplication) {
        throw new Error(
          "Multiplayer module cannot install legacy presentation and managed client replication together"
        );
      }

      if (options.clientReplication) {
        const clientReplicationOptions = wrapClientReplicationWithPredictionDomains(
          options.clientReplication,
          predictionDomains
        );
        const clientReplication = createMultiplayerClientReplication({
          runtime: options.runtime,
          installContext: ctx,
          options: clientReplicationOptions
        });
        ctx.systems.register({
          id: options.clientReplication.id ?? `${moduleId}.client-replication`,
          update(frame = {}) {
            clientReplication.update(frame);
            predictionDomains.syncBinding(clientReplication.binding());
          }
        });
        cleanup.push(() => clientReplication.dispose());
      } else if (options.presentation) {
        const presentation = options.presentation;
        const playback = createSnapshotPlayback<TSnapshot>(presentation);
        const projector = createSnapshotPresentationProjector<TSnapshot>(presentation.tracks ?? []);
        ctx.systems.register({
          id: presentation.id ?? `${moduleId}.presentation`,
          update(frame = {}) {
            const entry = presentation.readSnapshot({
              installContext: ctx,
              runtime: options.runtime,
              frame
            });
            const sample =
              entry === undefined
                ? playback.advance(frame.delta ?? 0)
                : playback.present(entry, frame.delta ?? 0);
            const snapshot = entry?.snapshot ?? sample.next?.snapshot ?? sample.previous?.snapshot;
            if (snapshot === undefined) {
              return;
            }
            const presented = projector.present(sample);

            presentation.applySample({
              installContext: ctx,
              runtime: options.runtime,
              frame,
              playback,
              sample,
              presented,
              snapshot
            });
          }
        });
        cleanup.push(() => {
          playback.reset();
          projector.reset();
        });
      }

      return () => {
        queue.clear();
        emitQueueDiagnostics();
        for (const dispose of cleanup.splice(0).reverse()) {
          dispose();
        }
      };
    }
  };
}

type ActivePredictionDomain<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  TPredictedState
> = {
  bindingKey: string;
  runtime: MultiplayerClientPredictionDomainRuntime<
    TInstallContext,
    TSnapshot,
    TInput,
    TPredictedState
  >;
};

type PredictionDomainManager<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  TPredictedState
> = {
  authoritative(
    context: MultiplayerClientReplicationSnapshotContext<TSnapshot, TInstallContext>
  ): void;
  input(
    context: MultiplayerClientPredictionDomainInputContext<TSnapshot, TInput, TInstallContext>
  ): void;
  frame(
    context: MultiplayerClientReplicationFrameContext<TSnapshot, TPredictedState, TInstallContext>
  ): void;
  syncBinding(binding: MultiplayerAuthorityBinding | undefined): void;
  view: MultiplayerClientPredictionDomainView;
  dispose(): void;
};

function createPredictionDomainManager<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  TPredictedState
>(
  installContext: TInstallContext,
  multiplayer: MultiplayerRuntime,
  descriptors: readonly MultiplayerClientPredictionDomainDescriptor<
    TInstallContext,
    TSnapshot,
    TInput,
    TPredictedState
  >[]
): PredictionDomainManager<TInstallContext, TSnapshot, TInput, TPredictedState> {
  const active = new Map<
    string,
    ActivePredictionDomain<TInstallContext, TSnapshot, TInput, TPredictedState>
  >();
  let disposed = false;

  const manager: PredictionDomainManager<TInstallContext, TSnapshot, TInput, TPredictedState> = {
    authoritative(context) {
      forEachDomain(context.binding, (domain) => domain.applyAuthoritative?.(context));
    },
    input(context) {
      forEachDomain(context.binding, (domain) => domain.applyInput?.(context));
    },
    frame(context) {
      forEachDomain(context.binding, (domain) => domain.applyFrame?.(context));
    },
    syncBinding(binding) {
      if (disposed) {
        return;
      }
      const nextKey = binding === undefined ? undefined : predictionDomainBindingKey(binding);
      for (const [id, entry] of active) {
        if (nextKey === undefined || entry.bindingKey !== nextKey) {
          entry.runtime.dispose();
          active.delete(id);
        }
      }
    },
    view: {
      diagnostics() {
        return Object.freeze(
          Object.fromEntries(
            descriptors.map((descriptor) => [
              descriptor.id,
              active.get(descriptor.id)?.runtime.diagnostics?.()
            ])
          )
        );
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const entry of active.values()) {
        entry.runtime.dispose();
      }
      active.clear();
    }
  };
  return manager;

  function forEachDomain(
    binding: MultiplayerAuthorityBinding,
    callback: (
      domain: MultiplayerClientPredictionDomainRuntime<
        TInstallContext,
        TSnapshot,
        TInput,
        TPredictedState
      >
    ) => void
  ): void {
    if (disposed) {
      return;
    }
    const bindingKey = predictionDomainBindingKey(binding);
    for (const descriptor of descriptors) {
      let entry = active.get(descriptor.id);
      if (entry === undefined || entry.bindingKey !== bindingKey) {
        entry?.runtime.dispose();
        entry = {
          bindingKey,
          runtime: descriptor.create({ installContext, runtime: multiplayer, binding })
        };
        active.set(descriptor.id, entry);
      }
      callback(entry.runtime);
    }
  }
}

function wrapClientReplicationWithPredictionDomains<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  TPredictedState
>(
  options: MultiplayerClientReplicationOptions<TSnapshot, TInput, TPredictedState, TInstallContext>,
  domains: PredictionDomainManager<TInstallContext, TSnapshot, TInput, TPredictedState>
): MultiplayerClientReplicationOptions<TSnapshot, TInput, TPredictedState, TInstallContext> {
  const prediction = options.prediction;
  return {
    ...options,
    applyAuthoritative(context) {
      domains.authoritative(context);
      options.applyAuthoritative?.(context);
    },
    ...(prediction === undefined
      ? {}
      : {
          prediction: {
            ...prediction,
            encodeInput(context) {
              const encodedInput = prediction.encodeInput(context);
              domains.input({ ...context, encodedInput });
              return encodedInput;
            }
          }
        }),
    applyFrame(context) {
      domains.frame(context);
      options.applyFrame(context);
    }
  };
}

function validatePredictionDomainDescriptors<
  TInstallContext extends MultiplayerBridgeInstallContext,
  TSnapshot,
  TInput,
  TPredictedState
>(
  descriptors: readonly MultiplayerClientPredictionDomainDescriptor<
    TInstallContext,
    TSnapshot,
    TInput,
    TPredictedState
  >[]
): readonly MultiplayerClientPredictionDomainDescriptor<
  TInstallContext,
  TSnapshot,
  TInput,
  TPredictedState
>[] {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    const id = descriptor.id.trim();
    if (id.length === 0) {
      throw new Error("Client prediction domain id must not be empty.");
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate client prediction domain: ${id}`);
    }
    ids.add(id);
  }
  return descriptors;
}

function predictionDomainBindingKey(binding: MultiplayerAuthorityBinding): string {
  return JSON.stringify([
    binding.sessionId,
    binding.mode,
    binding.authorityEndpoint?.kind,
    binding.authorityEndpoint?.id,
    binding.authorityPeerId,
    binding.localPlayerId
  ]);
}

/** @deprecated Use createMultiplayerModule. */
export function createMultiplayerBridgeModule<
  TInstallContext extends MultiplayerBridgeInstallContext = MultiplayerBridgeInstallContext,
  TSnapshot = any,
  TInput = any,
  TPredictedState = any
>(
  options: CreateMultiplayerBridgeModuleOptions<TInstallContext, TSnapshot, TInput, TPredictedState>
): GameModule<TInstallContext> {
  return createMultiplayerModule<TInstallContext, TSnapshot, TInput, TPredictedState>(options);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.floor(value));
}

function normalizeDuration(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value)
    ? Number.POSITIVE_INFINITY
    : Math.max(0, value);
}

function messageCorrelation(message: MultiplayerMessageEnvelope): {
  correlationId?: string;
  parentId: string;
} {
  return {
    ...(message.correlationId === undefined ? {} : { correlationId: message.correlationId }),
    parentId: message.id
  };
}

function cloneCommandQueueDiagnostics(
  diagnostics: MultiplayerCommandQueueDiagnostics
): MultiplayerCommandQueueDiagnostics {
  return {
    capacity: diagnostics.capacity,
    queued: diagnostics.queued,
    maxQueued: diagnostics.maxQueued,
    received: diagnostics.received,
    handled: diagnostics.handled,
    rejected: diagnostics.rejected,
    overflowed: diagnostics.overflowed,
    expired: diagnostics.expired,
    ...(diagnostics.lastCode === undefined ? {} : { lastCode: diagnostics.lastCode }),
    ...(diagnostics.lastMessageId === undefined ? {} : { lastMessageId: diagnostics.lastMessageId })
  };
}
