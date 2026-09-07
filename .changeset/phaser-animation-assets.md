---
"@gamekits/asset": minor
"@gamekits/driver-core": patch
"@gamekits/driver-phaser": minor
"@gamekits/renderer-phaser": minor
---

Add validated atlas, audio, variant, and animation manifest metadata, load those resources through
the shared Phaser runtime, expose Animator playback mapping, and support animated sprites,
particle emitters, semantic commands, and batched native state writes.
Expose the corresponding animation and audio slices through the shared Driver adapter map. Map one
logical Audio Event instance to one or more Phaser Sound tracks with scheduled start, fade,
pause/resume, seek, volume/rate/pan/loop control, spatial emitter mixing, and deterministic cleanup.
Report the shared animation slice through Driver capabilities.
Make AssetManager definitions mutation-safe, coalesce concurrent loads, isolate diagnostic observers, and harden metadata validation for malformed external manifests.
