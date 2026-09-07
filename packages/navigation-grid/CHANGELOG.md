# @gamekits/navigation-grid

## 0.1.0-alpha.8

### Patch Changes

- @gamekits/data@0.1.0-alpha.8
- @gamekits/navigation-core@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- @gamekits/navigation-core@0.1.0-alpha.7
- @gamekits/data@0.1.0-alpha.7

## 0.1.0-alpha.6

### Minor Changes

- c6fdda9: Add the backend-neutral Navigation facade with bounded queued/submitted request scheduling, immediate or deferred Backend completion, cancellation, revision-safe results, path and shared route-field sampling, layout-driven Backend factories, tracing, progress tracking, and conformance fixtures.

  Expose Backend-neutral portal traversal samples for discontinuous path and shared-field connections so gameplay can reach the projected entry, execute its movement/authority policy, and continue from the projected exit without treating off-mesh links as walkable chords.
  Split application, Backend-authoring, and testing APIs across the root, `/backend`, and `/testing` entry points.
  Expand the authored Graph Backend with deterministic reverse route fields, agent geometry constraints, area/portal traversal state, dynamic dependency-aware invalidation, and layout/Data Registry composition.
  Add the deterministic Grid Backend, backend-neutral NavMesh authoring source, and a Recast/Detour WebAssembly adapter with explicit initialization, area-aware baking, path projection, shared directed polygon route fields, area/portal filtering, authored portal costs shared by point-path corridor selection and route fields, dependency-aware field invalidation, bounded generation-safe retention, native cleanup, transferable bake artifacts, and generated debug geometry.

### Patch Changes

- Updated dependencies [c6fdda9]
  - @gamekits/navigation-core@0.1.0-alpha.6
  - @gamekits/data@0.1.0-alpha.6
