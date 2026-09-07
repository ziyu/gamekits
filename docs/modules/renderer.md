# Renderer 模块设计

## 定位

Renderer 是表现层 facade。可复用 gameplay、ECS、DataPack 和 core package 不直接依赖 Phaser Sprite、Three Mesh 或任何具体渲染对象。

具体游戏的 app presentation 层、Editor 后端专属面板和 DevTools renderer plugin 可以显式选择某个 renderer adapter / driver，并通过 typed native handle 直接调用底层 renderer API。这是受控的表现层逃生口，不是 renderer-core 的通用协议。

相关包：

- `@gamekits/renderer-core`
- `@gamekits/renderer-phaser`
- `@gamekits/driver-phaser`
- `@gamekits/driver-three`

## 核心原则

- Renderer Core 只定义最小 render object lifecycle、id 映射和观察协议。
- Render type 是开放字符串，由 adapter 解释；core 不维护类型能力目录。
- 复合渲染对象是一等能力。
- Renderer 不拥有 gameplay input 语义。
- Renderer Core 不包装 Phaser、Three.js 等后端的完整 API。
- 复杂对象、热点路径和后端专属表现能力必须允许 typed native control path。

## Render Object

Render object 是可配置渲染对象，可以是简单对象，也可以是对象树根节点。

长期目标结构：

```ts
export type RenderObjectDefinition = {
  id?: RenderObjectId;
  type: string;
  assetRefs?: Record<string, AssetRef>;
  transform?: RenderTransform;
  layer?: string;
  visible?: boolean;
  props?: Record<string, unknown>;
  children?: RenderNodeDefinition[];
  animations?: RenderAnimationDefinition[];
  tags?: string[];
};
```

`type` 不由 core 固定枚举。示例：

- `debug.square`
- `sprite`
- `animated-sprite`
- `tilemap`
- `mesh`
- `model`
- `particle-emitter`
- `container`
- `composite`
- `phaser-custom`
- `three-custom`

## Transform

Transform 需要兼容 2D 和 3D。

长期目标：

```ts
export type RenderTransform = {
  position?: { x?: number; y?: number; z?: number };
  rotation?: { x?: number; y?: number; z?: number };
  scale?: { x?: number; y?: number; z?: number };
  origin?: { x?: number; y?: number; z?: number };
};
```

协议可以在保持语义完整的前提下采用精简 envelope，但不得回退到 sprite-only API。

## Renderer Adapter

RendererAdapter 长期方向：

```ts
export type RendererAdapter<TNative = unknown, TObjectNative = unknown> = {
  id: string;
  kind?: string;

  boot(ctx: RendererBootContext): Promise<void>;
  destroy(): void;
  getView(): HTMLElement | HTMLCanvasElement;
  resize(width: number, height: number): void;

  createObject(definition: RenderObjectDefinition): RenderObjectId;
  destroyObject(id: RenderObjectId): void;

  native(): TNative;
  getObjectHandle?(objectId: RenderObjectId): RenderObjectHandle<TObjectNative>;
  getNodeHandle?(
    objectId: RenderObjectId,
    nodePath: string | string[]
  ): RenderObjectHandle<TObjectNative>;

  command?(objectId: RenderObjectId, command: RenderCommand): void;
};
```

Renderer Core 不定义 `createSprite`、`updateSprite`、`onInput` 作为长期公共协议。
Renderer Core 也不定义 `RendererCapabilities` 这类后端能力目录，不用中央 union 枚举所有 renderer-specific update。

`RenderObjectPatch` / `RenderNodePatch` 这类宽泛 partial patch 不应继续作为长期扩展方向。通用工具确实需要的 transform、visibility、selection、inspect 等能力，应保持为少量明确的 core/tooling 协议；Phaser tint、Three material、shader uniform、pipeline、post-processing、particle emitter 等后端能力走 native control path。

## Native Control Path

GameKits 不包装完整 Phaser / Three.js API。具体 renderer adapter 或 driver 包负责导出带真实后端类型的 specialized adapter：

```ts
export type PhaserRendererNative = {
  scene: Phaser.Scene;
  gameObject(id: RenderObjectId): Phaser.GameObjects.GameObject;
  node(objectId: RenderObjectId, path: RenderNodePath): Phaser.GameObjects.GameObject;
  applyObjectState?(id: RenderObjectId, state: PhaserRenderTargetState): void;
  applyNodeState?(
    objectId: RenderObjectId,
    path: RenderNodePath,
    state: PhaserRenderTargetState
  ): void;
};

export type PhaserRendererAdapter = RendererAdapter<
  PhaserRendererNative,
  Phaser.GameObjects.GameObject
>;
```

具体游戏如果已经选择 Phaser renderer，可以在 app presentation 层直接使用：

```ts
const phaser = renderer.native();
const body = phaser.node(actorObjectId, "body") as Phaser.GameObjects.Sprite;

body.setTint(0xff0000);
body.setPipeline("Outline");
```

Adapter / Driver 包也可以导出 renderer-specific state writer，例如 Phaser 的
`PhaserRenderTargetState` / `applyPhaserRenderTargetState`。这类 writer 属于具体后端包，
用于复用“如何把有限 app presentation state 写到 Phaser object”的实现；它不是
renderer-core 的通用 patch/update 协议，也不要求 Three.js、Pixi 或其他 renderer 实现同名接口。

Three.js adapter / driver 同理可以暴露 Three scene、renderer、camera、object 或 mesh handle。Renderer Core 只要求这些 native 入口保持显式、可追踪，并默认以 `unknown` 存在；具体类型只在具体 adapter / driver 包中出现。

边界：

- 对象仍由 RendererAdapter / Driver 创建和销毁。
- GameKits object id 和 node path 到 native object 的映射由 adapter 私有维护。
- Native mutation 只用于 app presentation、renderer-specific tooling 或性能热点路径。
- 可复用 gameplay module、DataType、TCA/GAS rule、Save payload 不保存 native handle。
- 进入 native path 后，调用方负责避免和通用 render sync 争写同一底层状态。

## Render Command

复杂表现可以使用命令扩展，但 core 不预设所有方法，也不把 command 变成后端 API 目录。

```ts
export type RenderCommand = {
  type: string;
  target?: string | string[];
  args?: Record<string, unknown>;
};
```

常见示例：

- `animation.play`
- `particles.emit`
- `shader.set_uniform`
- `camera.shake`

这些 command 类型由具体 adapter、driver 或 app presentation 约定。Renderer Core 只定义 envelope，不声明 Phaser / Three 支持清单。

## Driver 提供的 Renderer Adapter

Phaser、Three.js 等后端应优先由 Driver 统一持有外部 runtime，再从 Driver 暴露 RendererAdapter。Renderer 模块只关心 RendererAdapter 协议，不关心该 adapter 来自独立测试夹具、Phaser Driver、Three Driver 还是其他 app service。

Renderer adapter 不负责创建整套外部 runtime。对 Phaser 来说，`Phaser.Game`、active Scene、texture manager、input plugin 和 camera manager 都属于 Phaser Driver；`renderer-phaser` 只能绑定到 Driver 提供的 Scene runtime，并把 RenderObject / RenderNode / RenderCommand 映射到 Phaser display objects。

Phaser Driver 暴露的 RendererAdapter：

- 面向 Phaser Scene / DisplayList API，但不创建或拥有 Phaser runtime。
- 不把 Phaser 类型导出到 renderer-core；可以在 `@gamekits/renderer-phaser` 或 `@gamekits/driver-phaser` 中导出 typed native bridge。
- 内部维护 render type registry。
- 映射 `debug.square`、`sprite`、`container` 等类型到 Phaser object。
- 可以提供 debug texture。
- `props` 可作为对象创建参数或简单 adapter hint；复杂运行时控制应直接使用 Phaser native API。
- 不承担 gameplay input；input 归 `input-*` 模块。
- 不创建 `Phaser.Game`，不读取 Phaser input，不同步 Phaser camera，不加载 gameplay asset；这些能力由同一个 Phaser Driver 的独立 adapter 或 native bridge 提供。
- Canvas backing-store pixel ratio、antialias、round pixels、texture filtering 和 native camera/input coordinate normalization 属于 Phaser Driver render policy；Renderer Core 和 RenderObject definition 始终使用 logical viewport/world units。

Three Driver 暴露的 RendererAdapter：

- 依赖 Three.js。
- 不把 Three 原生类型导出到 renderer-core；可以在 `@gamekits/driver-three` 中导出 typed native bridge。
- 映射基础 `mesh`、asset-backed `model`、`group`、`light` 等 render type；复杂材质、粒子、后处理、shader、controls 和 AnimationMixer 控制通过 Three native control path 实现。
- 与同一个 Three Driver 内部的 asset loader、raycaster 和 camera adapter 共享 scene / renderer / resource cache。

## Escape Hatch

通用 API 负责生命周期和可追踪对象映射。复杂对象和热点路径需要受控逃生口：

```ts
export type RenderObjectHandle<TNative = unknown, TApi = unknown> = {
  id: RenderObjectId;
  type: string;
  native: TNative;
  api?: TApi;
  escaped?: boolean;
};
```

边界：

- 对象仍由 RendererAdapter 创建和销毁。
- Runtime 仍持有 objectId 和生命周期。
- 直接控制 API 只用于表现层或工具层，不写 gameplay 状态。
- DevTools 需要能标记 escaped/native/direct/custom path。

## 与 DataPack 的关系

RenderObjectDefinition 通过 `render.object` DataType 注册。Actor、Ability、Cue 或游戏自定义 presentation 数据应通过 `DataRef<"render.object">` 引用 render object，而不是直接写 sprite 或底层 renderer 对象。

```ts
export type ActorPresentation = {
  renderObject: DataRef<"render.object">;
};
```

## 与 Cue/Animator/Animation Playback 的关系

`@gamekits/animator-core` 负责 semantic Animator graph、controller、layer、transition、one-shot、marker 和 playback snapshot；Renderer 仍只负责 native object 与 clip/mixer 执行：

- RenderObjectDefinition / RenderNodeDefinition 声明可绑定动画的表现结构。
- Renderer Adapter 或 Driver runtime slice 解析 clip asset 并执行 backend playback frame。
- Cue / Presentation 把 gameplay event 映射成 animation trigger、renderer command 或 native effect。
- App-specific presentation layer 可以对 shader、粒子、骨骼约束等使用 typed native control path。
- UI 动画继续在 react-ui 内部处理，不进入 Animator Core 的角色 controller。

Gameplay 不直接等待 Renderer marker。Ability execution phase 决定玩法时序，animation marker 只用于脚步、枪口、弹壳等表现。

## 最佳实践

### 模块集成

- RendererAdapter 由 Driver runtime slice 创建或绑定；不要在 renderer adapter 内部创建 Phaser.Game、Three renderer、input plugin、asset loader 或 gameplay camera。
- Renderer 测试应覆盖 object tree、native handle resolution、unknown object type、missing object、command dispatch、diagnostics callback 和 lifecycle cleanup。
- App Host/profile 负责 renderer boot、surface/container 注入、diagnostics bridge 和 resize；GameRuntime 不拥有 renderer lifecycle。
- 高密度 canvas 必须由持有 renderer、camera 和 input plugin 的 Driver 统一实现：CSS viewport 保持 logical size，backing store 可以按 profile pixel ratio 放大，camera/input adapter 再归一化回 GameKits 坐标。不要只缩放 canvas 或只修改 RendererAdapter。
- Adapter / Driver 包可以导出具体 native bridge 类型；renderer-core 只能使用 generic `unknown` 边界。
- 具体 renderer 的 native bridge 应使用真实后端类型；若 adapter 内部需要测试或跨真实/假 runtime 的结构化 helper，类型必须保持 internal、窄能力命名，并且不能演变成完整后端 API 的 `*Like` 镜像。
- Adapter-specific state writer 应放在对应 adapter / driver 包中，并让对象创建和运行时表现状态复用同一套后端映射逻辑；app module 不应重复维护 Phaser / Three object duck type。
- Adapter-specific inspect API 应返回稳定摘要，例如 object/node type、asset id、mesh/material counts 和 bounds；DevTools 或 demo snapshot 不应持有 Phaser / Three native handle。

### 模块使用

- Renderer Core 只暴露 RenderObject、RenderNode、RenderTransform、RenderCommand、RendererAdapter、native handle envelope 和 diagnostics，不暴露 sprite-first API、Phaser Scene、Three Mesh 或 gameplay input。
- RenderObjectDefinition 应描述可重建的表现结构；运行时 native handle 由 adapter 私有维护，不进入 Data、World component 或 Save payload。
- `props` 只适合作为创建定义或简单 adapter hint；不要把运行时后端 API 塞进 `RenderObjectPatch` 或 renderer-core 字段。
- 可复用模块优先通过 object tree、少量通用状态和 command 表达。具体游戏表现层可以显式拿 native handle 调用 Phaser / Three API，或调用对应 adapter 包导出的 renderer-specific state writer。
- 高频 render sync 只同步必要变更，不通过 EventBus 发每帧 patch。object create/destroy、unsupported type、adapter lifecycle 可以发低频 diagnostics。
- Fixed-step dynamic object 的表现 transform 可以从 Physics interpolation store 采样，但 interpolation state 不进入 RenderObject definition、World authority 或 Renderer Core。
- Escape hatch 只用于表现层热点路径、DevTools、Editor 后端专属面板或 adapter extension。使用 direct/native path 时必须保持 GameKits object lifecycle 可追踪。
