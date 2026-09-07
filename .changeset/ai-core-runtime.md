---
"@gamekits/ai-core": minor
---

Add the data-driven AI runtime with bounded perception and decision scheduling, utility goals,
interruptible task execution, intent output, checkpoints, diagnostics, and GameModule integration.
Expose isolated trace observers while keeping the future planner adapter contract out of runtime configuration until it has an implemented bounded execution path.
Compile sensor, goal, task, and scheduler definition indexes once per agent definition and use oldest-due scheduling to prevent low-budget starvation.
