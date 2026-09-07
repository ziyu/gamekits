# @gamekits/asset

## 0.1.0-alpha.8

### Patch Changes

- 0326356: Add scoped assets and transactional save recovery
  - @gamekits/core@0.1.0-alpha.8
  - @gamekits/data@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- 398165e: Fix runtime failure and persistence contracts
  - @gamekits/core@0.1.0-alpha.7
  - @gamekits/data@0.1.0-alpha.7

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

- @gamekits/core@0.1.0-alpha.6
- @gamekits/data@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- @gamekits/core@0.1.0-alpha.5
- @gamekits/data@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- @gamekits/core@0.1.0-alpha.4
- @gamekits/data@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- @gamekits/core@0.1.0-alpha.3
- @gamekits/data@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- @gamekits/core@0.1.0-alpha.2
- @gamekits/data@0.1.0-alpha.2

## 0.1.0-alpha.1

### Patch Changes

- 5a5f227: Merge pull request #1 from ziyu/codex/alpha-package-release
- Updated dependencies [5a5f227]
  - @gamekits/core@0.1.0-alpha.1
  - @gamekits/data@0.1.0-alpha.1
