import type { DataPackEntry } from "@gamekits/data";

export const sandboxWorkerEntries: DataPackEntry[] = [
  {
    type: "sandbox.actor",
    id: "actor.sandbox.camp_crew",
    data: {
      id: "actor.sandbox.camp_crew",
      name: "Camp Crew",
      entityCount: 5,
      baseSpeed: 24,
      renderRigId: "renderRig.sandbox.camp_crew",
      abilityIds: ["ability.sandbox.phase_dash", "ability.sandbox.camp_ping"],
      tags: ["sandbox", "runtime-seed", "complex-data"]
    }
  },
  {
    type: "sandbox.ability",
    id: "ability.sandbox.phase_dash",
    data: {
      id: "ability.sandbox.phase_dash",
      name: "Phase Dash",
      cooldownMs: 1600,
      trigger: {
        type: "input.action",
        actionId: "game.confirm"
      },
      costs: [
        {
          resource: "energy",
          amount: 18
        }
      ],
      effects: [
        {
          type: "movement.impulse",
          params: {
            distance: 64,
            durationMs: 180
          }
        },
        {
          type: "renderer.command",
          params: {
            command: "animation.play",
            animationId: "dash-flash"
          }
        }
      ],
      tags: ["sandbox", "ability", "movement"]
    }
  },
  {
    type: "sandbox.ability",
    id: "ability.sandbox.camp_ping",
    data: {
      id: "ability.sandbox.camp_ping",
      name: "Camp Ping",
      cooldownMs: 2400,
      trigger: {
        type: "runtime.interval",
        everyTicks: 180
      },
      costs: [],
      effects: [
        {
          type: "event.emit",
          params: {
            eventType: "sandbox.camp_ping"
          }
        },
        {
          type: "renderer.nodePulse",
          params: {
            nodePath: "aura",
            intensity: 0.5
          }
        }
      ],
      tags: ["sandbox", "ability", "diagnostic"]
    }
  },
  {
    type: "sandbox.biome",
    id: "biome.sandbox.forest_clearing",
    data: {
      id: "biome.sandbox.forest_clearing",
      name: "Forest Clearing",
      navigation: {
        friction: 0.08,
        preferredAltitude: 0,
        hazards: [
          {
            id: "heat-haze",
            severity: 0.2,
            bounds: {
              x: 12,
              y: 18,
              width: 28,
              height: 16
            }
          },
          {
            id: "night-fog",
            severity: 0.35,
            bounds: {
              x: 58,
              y: 42,
              width: 20,
              height: 24
            }
          }
        ]
      },
      lighting: {
        ambient: 1052686,
        accents: [8376683, 14497319, 6603472]
      },
      tags: ["sandbox", "environment"]
    }
  },
  {
    type: "sandbox.spawnProfile",
    id: "spawn.sandbox.camp_shift",
    data: {
      id: "spawn.sandbox.camp_shift",
      actorId: "actor.sandbox.camp_crew",
      biomeId: "biome.sandbox.forest_clearing",
      formation: {
        type: "arc",
        radius: 36,
        jitter: 0.18
      },
      waves: [
        {
          delayMs: 0,
          count: 3
        },
        {
          delayMs: 1200,
          count: 2
        }
      ],
      tags: ["sandbox", "spawn"]
    }
  },
  {
    type: "gas.attribute",
    id: "health",
    data: {
      id: "health",
      name: "Health",
      min: 0,
      max: 120,
      defaultValue: 100,
      tags: ["gas", "vital"]
    }
  },
  {
    type: "gas.attribute",
    id: "energy",
    data: {
      id: "energy",
      name: "Energy",
      min: 0,
      max: 80,
      defaultValue: 40,
      tags: ["gas", "resource"]
    }
  },
  {
    type: "gas.attribute",
    id: "focus",
    data: {
      id: "focus",
      name: "Focus",
      min: 0,
      max: 100,
      defaultValue: 12,
      tags: ["gas", "resource"]
    }
  },
  {
    type: "gas.attribute",
    id: "stability",
    data: {
      id: "stability",
      name: "Stability",
      min: 0,
      max: 100,
      defaultValue: 100,
      tags: ["gas", "building"]
    }
  },
  {
    type: "gas.attribute",
    id: "throughput",
    data: {
      id: "throughput",
      name: "Throughput",
      min: 0,
      max: 200,
      defaultValue: 60,
      tags: ["gas", "production"]
    }
  },
  {
    type: "gas.tag",
    id: "team.worker",
    data: {
      id: "team.worker",
      name: "Worker Team",
      tags: ["sandbox", "team"]
    }
  },
  {
    type: "gas.tag",
    id: "state.overcharged",
    data: {
      id: "state.overcharged",
      name: "Overcharged",
      tags: ["sandbox", "state"]
    }
  },
  {
    type: "gas.tag",
    id: "state.marked",
    data: {
      id: "state.marked",
      name: "Marked",
      tags: ["sandbox", "state"]
    }
  },
  {
    type: "gas.tag",
    id: "state.interfered",
    data: {
      id: "state.interfered",
      name: "Interfered",
      tags: ["sandbox", "state"]
    }
  },
  {
    type: "gas.cue",
    id: "cue.sandbox.damage_hit",
    data: {
      id: "cue.sandbox.damage_hit",
      type: "ui.floating_text",
      payload: {
        text: "-7 health",
        tone: "warning"
      },
      tags: ["sandbox", "cue", "ui"]
    }
  },
  {
    type: "gas.cue",
    id: "cue.sandbox.pulse",
    data: {
      id: "cue.sandbox.pulse",
      type: "renderer.node_pulse",
      payload: {
        nodePath: "aura",
        intensity: 0.7
      },
      tags: ["sandbox", "cue", "renderer"]
    }
  },
  {
    type: "gas.ability",
    id: "gas.ability.sandbox.spark_strike",
    data: {
      id: "gas.ability.sandbox.spark_strike",
      name: "Spark Strike",
      costs: [
        {
          attribute: "energy",
          amount: 3
        }
      ],
      cooldownMs: 200,
      effects: [
        {
          effectId: "gas.effect.sandbox.bite_damage",
          target: "target"
        }
      ],
      tags: ["sandbox", "ability", "attack"]
    }
  },
  {
    type: "gas.ability",
    id: "gas.ability.sandbox.overcharge",
    data: {
      id: "gas.ability.sandbox.overcharge",
      name: "Overcharge",
      cooldownMs: 500,
      effects: [
        {
          effectId: "gas.effect.sandbox.overcharge_regen",
          target: "self"
        }
      ],
      cues: ["cue.sandbox.pulse"],
      tags: ["sandbox", "ability", "periodic"]
    }
  },
  {
    type: "gas.ability",
    id: "gas.ability.sandbox.overcharge_relay",
    data: {
      id: "gas.ability.sandbox.overcharge_relay",
      name: "Overcharge Relay",
      cooldownMs: 900,
      effects: [
        {
          effectId: "gas.effect.sandbox.campfire_boost",
          target: "self"
        }
      ],
      cues: ["cue.sandbox.pulse"],
      tags: ["sandbox", "ability", "building"]
    }
  },
  {
    type: "gas.ability",
    id: "gas.ability.sandbox.field_repair",
    data: {
      id: "gas.ability.sandbox.field_repair",
      name: "Field Repair",
      costs: [
        {
          attribute: "energy",
          amount: 4
        }
      ],
      cooldownMs: 600,
      effects: [
        {
          effectId: "gas.effect.sandbox.field_repair",
          target: "target"
        }
      ],
      tags: ["sandbox", "ability", "repair"]
    }
  },
  {
    type: "gas.actor",
    id: "gas.actor.sandbox.worker",
    data: {
      id: "gas.actor.sandbox.worker",
      name: "Worker",
      attributes: {
        health: 100,
        energy: 40,
        focus: 12
      },
      tags: ["team.worker"],
      abilities: ["gas.ability.sandbox.spark_strike", "gas.ability.sandbox.overcharge"],
      metadata: {
        role: "sandbox-validation"
      }
    }
  },
  {
    type: "gas.actor",
    id: "gas.actor.sandbox.building",
    data: {
      id: "gas.actor.sandbox.building",
      name: "Camp Building",
      attributes: {
        health: 120,
        energy: 30,
        focus: 0,
        stability: 100,
        throughput: 60
      },
      tags: ["team.worker"],
      abilities: ["gas.ability.sandbox.overcharge_relay"],
      metadata: {
        role: "building"
      }
    }
  },
  {
    type: "gas.actor",
    id: "gas.actor.sandbox.monster",
    data: {
      id: "gas.actor.sandbox.monster",
      name: "Monster",
      attributes: {
        health: 160,
        energy: 80,
        focus: 0,
        stability: 100,
        throughput: 0
      },
      tags: ["state.marked"],
      abilities: ["gas.ability.sandbox.spark_strike"],
      metadata: {
        role: "monster"
      }
    }
  }
];
