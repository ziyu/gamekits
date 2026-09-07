---
"@gamekits/multiplayer-core": patch
---

Add an authority host-loop peer release hook that clears disconnected peers' queued work and input sequence state, plus a configurable participant lifecycle policy resolver and standard next-round binding status for join, leave, disconnect, reconnect and round-boundary composition.
