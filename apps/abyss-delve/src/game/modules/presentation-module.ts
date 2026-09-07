import { defineGameModule } from "@gamekits/core";
import type { DataRegistry } from "@gamekits/data";
import type { GameInstallContext } from "@gamekits/game-runtime";
import type {
  RenderNodePath,
  RenderObjectDefinition,
  RendererAdapter,
  RenderTransform
} from "@gamekits/renderer-core";
import { Actor, Combat, FloatingText, Lifetime, Position, Presentation } from "../components";
import { RENDER_OBJECT_TYPE } from "../content";
import type { AbyssRuntimeState } from "../runtime-state";

export type AbyssPresentationTargetState = {
  transform?: RenderTransform;
  visible?: boolean | undefined;
  alpha?: number | undefined;
  layer?: string | undefined;
  props?: Record<string, unknown> | undefined;
};

export type AbyssRenderTargetWriter = (
  native: unknown,
  state: AbyssPresentationTargetState
) => void;

export type CreateAbyssPresentationModuleOptions = {
  renderer: RendererAdapter;
  dataRegistry: DataRegistry;
  state: AbyssRuntimeState;
  applyRenderTargetState?: AbyssRenderTargetWriter | undefined;
};

export function createAbyssPresentationModule(options: CreateAbyssPresentationModuleOptions) {
  return defineGameModule<GameInstallContext>({
    id: "abyss.presentation",
    install(ctx) {
      const activeObjects = new Set<string>();
      ctx.systems.register({
        id: "abyss.presentation.system",
        update(system) {
          syncPresentation(ctx, options, system.elapsed, activeObjects);
        }
      });
    }
  });
}

function syncPresentation(
  ctx: GameInstallContext,
  options: CreateAbyssPresentationModuleOptions,
  elapsed: number,
  activeObjects: Set<string>
): void {
  const visible = new Set<string>();
  for (const entity of ctx.world.query([Presentation, Position])) {
    const presentation = ctx.world.get(entity, Presentation);
    const position = ctx.world.get(entity, Position);
    if (!presentation || !position) {
      continue;
    }

    if (!presentation.objectId) {
      const definition = cloneRenderObject(
        options.dataRegistry.getValue<RenderObjectDefinition>(
          RENDER_OBJECT_TYPE,
          presentation.renderKey
        ),
        String(entity),
        presentation.layer
      );
      presentation.objectId = options.renderer.createObject(definition);
      options.state.trace({
        kind: "runtime",
        label: `render ${presentation.renderKey}`,
        entityId: entity
      });
    }

    visible.add(presentation.objectId);
    const actor = ctx.world.get(entity, Actor);
    const combat = ctx.world.get(entity, Combat);
    const lifetime = ctx.world.get(entity, Lifetime);
    const floating = ctx.world.get(entity, FloatingText);
    const alpha =
      lifetime && lifetime.lifetimeMs > 0
        ? Math.max(0, 1 - lifetime.ageMs / lifetime.lifetimeMs)
        : 1;

    applyObjectState(options.renderer, options.applyRenderTargetState, presentation.objectId, {
      alpha,
      transform: {
        position: { x: position.x, y: position.y },
        rotation: { z: position.rotation }
      }
    });

    if (combat && actor?.faction === "enemy") {
      updateHealthBar(options, presentation.objectId, combat);
    }
    if (combat && elapsed < combat.hitFlashUntil) {
      applyNodeState(
        options.renderer,
        options.applyRenderTargetState,
        presentation.objectId,
        "body",
        {
          props: { tint: 0xffffff }
        }
      );
    }
    if (floating) {
      updateFloatingText(options, presentation.objectId, floating.tone);
    }
  }

  for (const objectId of activeObjects) {
    if (!visible.has(objectId)) {
      options.renderer.destroyObject(objectId);
    }
  }
  activeObjects.clear();
  for (const objectId of visible) {
    activeObjects.add(objectId);
  }
}

function cloneRenderObject(
  definition: RenderObjectDefinition,
  entityId: string,
  depth: number
): RenderObjectDefinition {
  return {
    ...structuredClone(definition),
    id: `abyss.${entityId}.${definition.id ?? definition.type}`,
    props: {
      ...definition.props,
      depth
    }
  };
}

function updateHealthBar(
  options: CreateAbyssPresentationModuleOptions,
  objectId: string,
  combat: { health: number; maxHealth: number }
): void {
  const ratio = Math.max(0, Math.min(1, combat.health / Math.max(1, combat.maxHealth)));
  applyNodeState(options.renderer, options.applyRenderTargetState, objectId, "hp-fill", {
    props: {
      width: Math.max(2, 34 * ratio),
      tint: ratio < 0.35 ? 0xff3848 : 0x7cff92
    },
    transform: {
      position: { x: -17 + (34 * ratio) / 2, y: -28 }
    }
  });
}

function updateFloatingText(
  options: CreateAbyssPresentationModuleOptions,
  objectId: string,
  tone: string
): void {
  applyNodeState(options.renderer, options.applyRenderTargetState, objectId, "text", {
    props: {
      tint: tone === "damage" ? 0xff4f59 : tone === "reward" ? 0xb7ff73 : 0xffd76d
    }
  });
}

function applyObjectState(
  renderer: RendererAdapter,
  writer: AbyssRenderTargetWriter | undefined,
  objectId: string,
  state: AbyssPresentationTargetState
): void {
  if (!writer) {
    return;
  }
  const handle = renderer.getObjectHandle?.(objectId);
  if (!handle) {
    return;
  }
  writer(handle.native, state);
}

function applyNodeState(
  renderer: RendererAdapter,
  writer: AbyssRenderTargetWriter | undefined,
  objectId: string,
  nodePath: RenderNodePath,
  state: AbyssPresentationTargetState
): void {
  if (!writer) {
    return;
  }
  const handle = renderer.getNodeHandle?.(objectId, nodePath);
  if (!handle) {
    return;
  }
  writer(handle.native, state);
}
