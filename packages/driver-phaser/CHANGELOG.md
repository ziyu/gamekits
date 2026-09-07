# @gamekits/driver-phaser

## 0.1.0-alpha.8

### Patch Changes

- 0326356: Add scoped assets and transactional save recovery
- Updated dependencies [0326356]
  - @gamekits/asset@0.1.0-alpha.8
  - @gamekits/animator-core@0.1.0-alpha.8
  - @gamekits/audio-core@0.1.0-alpha.8
  - @gamekits/renderer-phaser@0.1.0-alpha.8
  - @gamekits/core@0.1.0-alpha.8
  - @gamekits/renderer-core@0.1.0-alpha.8
  - @gamekits/input-core@0.1.0-alpha.8
  - @gamekits/camera-core@0.1.0-alpha.8
  - @gamekits/driver-core@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- Updated dependencies [398165e]
  - @gamekits/asset@0.1.0-alpha.7
  - @gamekits/input-core@0.1.0-alpha.7
  - @gamekits/animator-core@0.1.0-alpha.7
  - @gamekits/audio-core@0.1.0-alpha.7
  - @gamekits/renderer-phaser@0.1.0-alpha.7
  - @gamekits/core@0.1.0-alpha.7
  - @gamekits/renderer-core@0.1.0-alpha.7
  - @gamekits/camera-core@0.1.0-alpha.7
  - @gamekits/driver-core@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- c6fdda9: Add validated atlas, audio, variant, and animation manifest metadata, load those resources through
  the shared Phaser runtime, expose Animator playback mapping, and support animated sprites,
  particle emitters, semantic commands, and batched native state writes.
  Expose the corresponding animation and audio slices through the shared Driver adapter map. Map one
  logical Audio Event instance to one or more Phaser Sound tracks with scheduled start, fade,
  pause/resume, seek, volume/rate/pan/loop control, spatial emitter mixing, and deterministic cleanup.
  Report the shared animation slice through Driver capabilities.
  Make AssetManager definitions mutation-safe, coalesce concurrent loads, isolate diagnostic observers, and harden metadata validation for malformed external manifests.

### Patch Changes

- Updated dependencies [c6fdda9]
- Updated dependencies [c6fdda9]
- Updated dependencies [c6fdda9]
  - @gamekits/animator-core@0.1.0-alpha.6
  - @gamekits/audio-core@0.1.0-alpha.6
  - @gamekits/asset@0.1.0-alpha.6
  - @gamekits/driver-core@0.1.0-alpha.6
  - @gamekits/renderer-phaser@0.1.0-alpha.6
  - @gamekits/core@0.1.0-alpha.6
  - @gamekits/renderer-core@0.1.0-alpha.6
  - @gamekits/input-core@0.1.0-alpha.6
  - @gamekits/camera-core@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- @gamekits/core@0.1.0-alpha.5
- @gamekits/renderer-core@0.1.0-alpha.5
- @gamekits/input-core@0.1.0-alpha.5
- @gamekits/camera-core@0.1.0-alpha.5
- @gamekits/driver-core@0.1.0-alpha.5
- @gamekits/asset@0.1.0-alpha.5
- @gamekits/renderer-phaser@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- @gamekits/core@0.1.0-alpha.4
- @gamekits/renderer-core@0.1.0-alpha.4
- @gamekits/input-core@0.1.0-alpha.4
- @gamekits/camera-core@0.1.0-alpha.4
- @gamekits/driver-core@0.1.0-alpha.4
- @gamekits/asset@0.1.0-alpha.4
- @gamekits/renderer-phaser@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- 544f137: [codex] Restore driver capabilities release guard
- Updated dependencies [544f137]
  - @gamekits/driver-core@0.1.0-alpha.3
  - @gamekits/core@0.1.0-alpha.3
  - @gamekits/renderer-core@0.1.0-alpha.3
  - @gamekits/input-core@0.1.0-alpha.3
  - @gamekits/camera-core@0.1.0-alpha.3
  - @gamekits/asset@0.1.0-alpha.3
  - @gamekits/renderer-phaser@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- 3469457: [codex] Make renderer native control explicit
- Updated dependencies [3469457]
  - @gamekits/driver-core@0.1.0-alpha.2
  - @gamekits/renderer-core@0.1.0-alpha.2
  - @gamekits/renderer-phaser@0.1.0-alpha.2
  - @gamekits/core@0.1.0-alpha.2
  - @gamekits/input-core@0.1.0-alpha.2
  - @gamekits/camera-core@0.1.0-alpha.2
  - @gamekits/asset@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- 5a5f227: Merge pull request #1 from ziyu/codex/alpha-package-release
- Updated dependencies [5a5f227]
  - @gamekits/asset@0.1.0-alpha.1
  - @gamekits/camera-core@0.1.0-alpha.1
  - @gamekits/core@0.1.0-alpha.1
  - @gamekits/driver-core@0.1.0-alpha.1
  - @gamekits/input-core@0.1.0-alpha.1
  - @gamekits/renderer-core@0.1.0-alpha.1
  - @gamekits/renderer-phaser@0.1.0-alpha.1
