# @gamekits/app-host

## 0.1.0-alpha.8

### Patch Changes

- 0326356: Add scoped assets and transactional save recovery
- Updated dependencies [0326356]
  - @gamekits/asset@0.1.0-alpha.8
  - @gamekits/save@0.1.0-alpha.8
  - @gamekits/animator-core@0.1.0-alpha.8
  - @gamekits/audio-core@0.1.0-alpha.8
  - @gamekits/ai-core@0.1.0-alpha.8
  - @gamekits/combat@0.1.0-alpha.8
  - @gamekits/gas@0.1.0-alpha.8
  - @gamekits/physics-core@0.1.0-alpha.8
  - @gamekits/tca@0.1.0-alpha.8
  - @gamekits/core@0.1.0-alpha.8
  - @gamekits/world@0.1.0-alpha.8
  - @gamekits/platform-core@0.1.0-alpha.8
  - @gamekits/renderer-core@0.1.0-alpha.8
  - @gamekits/game-runtime@0.1.0-alpha.8
  - @gamekits/data@0.1.0-alpha.8
  - @gamekits/input-core@0.1.0-alpha.8
  - @gamekits/camera-core@0.1.0-alpha.8
  - @gamekits/driver-core@0.1.0-alpha.8
  - @gamekits/devtools@0.1.0-alpha.8
  - @gamekits/ui-core@0.1.0-alpha.8
  - @gamekits/multiplayer-core@0.1.0-alpha.8
  - @gamekits/navigation-core@0.1.0-alpha.8

## 0.1.0-alpha.7

### Minor Changes

- ce209d8: Add provider-neutral client prediction domains, bounded redundant fixed-step input delivery, deterministic network-condition simulation, and the standard full-island multiplayer Physics Arena prediction and authority projection workflow.

### Patch Changes

- 398165e: Fix runtime failure and persistence contracts
- Updated dependencies [398165e]
- Updated dependencies [ce209d8]
  - @gamekits/asset@0.1.0-alpha.7
  - @gamekits/game-runtime@0.1.0-alpha.7
  - @gamekits/gas@0.1.0-alpha.7
  - @gamekits/input-core@0.1.0-alpha.7
  - @gamekits/platform-core@0.1.0-alpha.7
  - @gamekits/save@0.1.0-alpha.7
  - @gamekits/tca@0.1.0-alpha.7
  - @gamekits/multiplayer-core@0.1.0-alpha.7
  - @gamekits/physics-core@0.1.0-alpha.7
  - @gamekits/animator-core@0.1.0-alpha.7
  - @gamekits/audio-core@0.1.0-alpha.7
  - @gamekits/ai-core@0.1.0-alpha.7
  - @gamekits/combat@0.1.0-alpha.7
  - @gamekits/navigation-core@0.1.0-alpha.7
  - @gamekits/core@0.1.0-alpha.7
  - @gamekits/world@0.1.0-alpha.7
  - @gamekits/renderer-core@0.1.0-alpha.7
  - @gamekits/data@0.1.0-alpha.7
  - @gamekits/camera-core@0.1.0-alpha.7
  - @gamekits/driver-core@0.1.0-alpha.7
  - @gamekits/devtools@0.1.0-alpha.7
  - @gamekits/ui-core@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- c6fdda9: Add standard Combat, Navigation, AI, and Animator game-module composition, a domain-specific GameAudio app service, live gameplay trace/diagnostic correlation observers with bounded source/playback summaries, gameplay DevTools source kinds, and shared facade conformance fixture exports.
- c73f533: Add a Core-managed client replication runtime that automatically coordinates authoritative snapshot playback, declared remote presentation tracks, local input prediction, acknowledgement reconciliation, correction smoothing, binding resets, and lifecycle cleanup through the standard Multiplayer GameModule configuration.

### Patch Changes

- c73f533: Expose reusable headless renderer and memory asset fixtures, and add an isolated memory PlatformRuntime factory for non-visual AppProfile composition.
- Updated dependencies [c6fdda9]
- Updated dependencies [c6fdda9]
- Updated dependencies [c6fdda9]
- Updated dependencies [16bf100]
- Updated dependencies [c6fdda9]
- Updated dependencies [16bf100]
- Updated dependencies [c73f533]
- Updated dependencies [c6fdda9]
- Updated dependencies [c6fdda9]
- Updated dependencies [94c5113]
  - @gamekits/ai-core@0.1.0-alpha.6
  - @gamekits/animator-core@0.1.0-alpha.6
  - @gamekits/audio-core@0.1.0-alpha.6
  - @gamekits/combat@0.1.0-alpha.6
  - @gamekits/devtools@0.1.0-alpha.6
  - @gamekits/gas@0.1.0-alpha.6
  - @gamekits/multiplayer-core@0.1.0-alpha.6
  - @gamekits/navigation-core@0.1.0-alpha.6
  - @gamekits/asset@0.1.0-alpha.6
  - @gamekits/driver-core@0.1.0-alpha.6
  - @gamekits/physics-core@0.1.0-alpha.6
  - @gamekits/core@0.1.0-alpha.6
  - @gamekits/platform-core@0.1.0-alpha.6
  - @gamekits/renderer-core@0.1.0-alpha.6
  - @gamekits/game-runtime@0.1.0-alpha.6
  - @gamekits/data@0.1.0-alpha.6
  - @gamekits/tca@0.1.0-alpha.6
  - @gamekits/input-core@0.1.0-alpha.6
  - @gamekits/camera-core@0.1.0-alpha.6
  - @gamekits/ui-core@0.1.0-alpha.6
  - @gamekits/save@0.1.0-alpha.6

## 0.1.0-alpha.5

### Minor Changes

- 116b3bd: Add App Host standard Physics module composition, expose the core-owned canonical Multiplayer GameModule factory, and preserve project-reference-compatible declarations for the multi-entry Colyseus adapter.

### Patch Changes

- 42c830b: Add provider-neutral temporal snapshot playback, standard multiplayer presentation module binding, reusable presentation projectors, declared Network presentation tracks, typed interpolation primitives and small Network value shapes outside backend adapters.
- Updated dependencies [d2d3825]
- Updated dependencies [7d88257]
- Updated dependencies [63c2214]
- Updated dependencies [cf78f3f]
- Updated dependencies [42c830b]
- Updated dependencies [c2b4371]
- Updated dependencies [116b3bd]
  - @gamekits/multiplayer-core@0.1.0-alpha.4
  - @gamekits/core@0.1.0-alpha.5
  - @gamekits/platform-core@0.1.0-alpha.5
  - @gamekits/renderer-core@0.1.0-alpha.5
  - @gamekits/game-runtime@0.1.0-alpha.5
  - @gamekits/data@0.1.0-alpha.5
  - @gamekits/tca@0.1.0-alpha.5
  - @gamekits/gas@0.1.0-alpha.5
  - @gamekits/input-core@0.1.0-alpha.5
  - @gamekits/camera-core@0.1.0-alpha.5
  - @gamekits/physics-core@0.1.0-alpha.5
  - @gamekits/driver-core@0.1.0-alpha.5
  - @gamekits/devtools@0.1.0-alpha.5
  - @gamekits/ui-core@0.1.0-alpha.5
  - @gamekits/asset@0.1.0-alpha.5
  - @gamekits/save@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- @gamekits/core@0.1.0-alpha.4
- @gamekits/platform-core@0.1.0-alpha.4
- @gamekits/renderer-core@0.1.0-alpha.4
- @gamekits/game-runtime@0.1.0-alpha.4
- @gamekits/data@0.1.0-alpha.4
- @gamekits/tca@0.1.0-alpha.4
- @gamekits/gas@0.1.0-alpha.4
- @gamekits/input-core@0.1.0-alpha.4
- @gamekits/camera-core@0.1.0-alpha.4
- @gamekits/driver-core@0.1.0-alpha.4
- @gamekits/devtools@0.1.0-alpha.4
- @gamekits/ui-core@0.1.0-alpha.4
- @gamekits/asset@0.1.0-alpha.4
- @gamekits/save@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- Updated dependencies [544f137]
  - @gamekits/driver-core@0.1.0-alpha.3
  - @gamekits/core@0.1.0-alpha.3
  - @gamekits/platform-core@0.1.0-alpha.3
  - @gamekits/renderer-core@0.1.0-alpha.3
  - @gamekits/game-runtime@0.1.0-alpha.3
  - @gamekits/data@0.1.0-alpha.3
  - @gamekits/tca@0.1.0-alpha.3
  - @gamekits/gas@0.1.0-alpha.3
  - @gamekits/input-core@0.1.0-alpha.3
  - @gamekits/camera-core@0.1.0-alpha.3
  - @gamekits/devtools@0.1.0-alpha.3
  - @gamekits/ui-core@0.1.0-alpha.3
  - @gamekits/asset@0.1.0-alpha.3
  - @gamekits/save@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- 3469457: [codex] Make renderer native control explicit
- Updated dependencies [3469457]
  - @gamekits/driver-core@0.1.0-alpha.2
  - @gamekits/renderer-core@0.1.0-alpha.2
  - @gamekits/core@0.1.0-alpha.2
  - @gamekits/platform-core@0.1.0-alpha.2
  - @gamekits/game-runtime@0.1.0-alpha.2
  - @gamekits/data@0.1.0-alpha.2
  - @gamekits/tca@0.1.0-alpha.2
  - @gamekits/gas@0.1.0-alpha.2
  - @gamekits/input-core@0.1.0-alpha.2
  - @gamekits/camera-core@0.1.0-alpha.2
  - @gamekits/devtools@0.1.0-alpha.2
  - @gamekits/ui-core@0.1.0-alpha.2
  - @gamekits/asset@0.1.0-alpha.2
  - @gamekits/save@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- 5a5f227: Merge pull request #1 from ziyu/codex/alpha-package-release
- Updated dependencies [5a5f227]
  - @gamekits/asset@0.1.0-alpha.1
  - @gamekits/camera-core@0.1.0-alpha.1
  - @gamekits/core@0.1.0-alpha.1
  - @gamekits/data@0.1.0-alpha.1
  - @gamekits/devtools@0.1.0-alpha.1
  - @gamekits/driver-core@0.1.0-alpha.1
  - @gamekits/game-runtime@0.1.0-alpha.1
  - @gamekits/gas@0.1.0-alpha.1
  - @gamekits/input-core@0.1.0-alpha.1
  - @gamekits/platform-core@0.1.0-alpha.1
  - @gamekits/renderer-core@0.1.0-alpha.1
  - @gamekits/save@0.1.0-alpha.1
  - @gamekits/tca@0.1.0-alpha.1
  - @gamekits/ui-core@0.1.0-alpha.1
