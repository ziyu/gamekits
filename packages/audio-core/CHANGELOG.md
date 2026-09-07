# @gamekits/audio-core

## 0.1.0-alpha.8

### Patch Changes

- Updated dependencies [0326356]
  - @gamekits/asset@0.1.0-alpha.8
  - @gamekits/core@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- Updated dependencies [398165e]
  - @gamekits/asset@0.1.0-alpha.7
  - @gamekits/core@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- c6fdda9: Add a backend-neutral `GameAudio` facade with separate Music, SFX, Dialogue, Mix, and Spatial
  control surfaces. Support music state and transitions, layered and weighted SFX variations,
  backend-authored objects, dialogue queue and interrupt policy, controllable playback handles,
  scheduled playback, lifecycle and marker events, typed global/instance parameters, stable
  listeners and batch emitters, hierarchical buses, volume ramps, stackable mix snapshots, named
  global/owner/emitter concurrency policies, retrigger windows, multiplayer deduplication, browser
  unlock state, bounded diagnostics, and distinct logical-instance/native-playback snapshots.

  Add an isolated backend contract subpath, memory and null backends, and a reusable conformance
  suite that verifies the same playback-control, spatial, mix, lifecycle, ownership, and dispose
  contracts used by production backends.

### Patch Changes

- Updated dependencies [c6fdda9]
  - @gamekits/asset@0.1.0-alpha.6
  - @gamekits/core@0.1.0-alpha.6
