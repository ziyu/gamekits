# @gamekits/multiplayer-core

## 0.1.0-alpha.8

### Patch Changes

- @gamekits/core@0.1.0-alpha.8
- @gamekits/event-bus@0.1.0-alpha.8

## 0.1.0-alpha.7

### Minor Changes

- ce209d8: Add provider-neutral client prediction domains, bounded redundant fixed-step input delivery, deterministic network-condition simulation, and the standard full-island multiplayer Physics Arena prediction and authority projection workflow.

### Patch Changes

- @gamekits/core@0.1.0-alpha.7
- @gamekits/event-bus@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- c73f533: Add a Core-managed client replication runtime that automatically coordinates authoritative snapshot playback, declared remote presentation tracks, local input prediction, acknowledgement reconciliation, correction smoothing, binding resets, and lifecycle cleanup through the standard Multiplayer GameModule configuration.
- 94c5113: Add bounded full-scene physics prediction islands with checkpoint restore and resimulation diagnostics, expose scene checkpoint and CCD capabilities, and map scene-local material response through the Rapier 2D and 3D adapters.

### Patch Changes

- @gamekits/core@0.1.0-alpha.6
- @gamekits/event-bus@0.1.0-alpha.6

## 0.1.0-alpha.5

### Minor Changes

- 116b3bd: Add App Host standard Physics module composition, expose the core-owned canonical Multiplayer GameModule factory, and preserve project-reference-compatible declarations for the multi-entry Colyseus adapter.

### Patch Changes

- d2d3825: Bound host authority action processing with configurable per-source tick and queue limits, expose action queue diagnostics, and reject overflow with a stable error code.
- 7d88257: Add an authority host-loop peer release hook that clears disconnected peers' queued work and input sequence state, plus a configurable participant lifecycle policy resolver and standard next-round binding status for join, leave, disconnect, reconnect and round-boundary composition.
- 63c2214: Allow authority host loops to publish captured snapshots through a provider-native state writer while preserving the standard tick, diagnostics, and error boundary.
- cf78f3f: Add a provider-neutral client prediction buffer with bounded pending input replay, authoritative reconciliation, fixed-step presentation sampling, moving-target correction decay and diagnostics; add bounded FIFO and latest-per-source authority input queue modes with queue/coalescing diagnostics; and extend snapshot playback with bounded adaptive jitter delay diagnostics.
- 42c830b: Add provider-neutral temporal snapshot playback, standard multiplayer presentation module binding, reusable presentation projectors, declared Network presentation tracks, typed interpolation primitives and small Network value shapes outside backend adapters.
- c2b4371: Add the first reusable multiplayer authority baseline with provider-neutral diagnostics, peer/player binding utilities, result receiver source gates, expanded backend conformance, reconnect unsupported semantics, and package documentation.
  - @gamekits/core@0.1.0-alpha.5
  - @gamekits/event-bus@0.1.0-alpha.5

## 0.1.0-alpha.3

Initial multiplayer core package.
