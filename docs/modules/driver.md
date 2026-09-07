# Driver 模块设计

## 定位

Driver 是外部引擎或外部运行时的一体化集成入口。它统一持有第三方库的 runtime、scene、resource manager、camera、input、physics plugin 和其他 plugin 句柄，并从同一个外部运行时中派生 GameKits 所需的多个 adapter。

Driver 解决的是“一个外部运行时横跨多个 GameKits 协议时如何统一集成”的问题。它不是 gameplay module，也不是单一协议 adapter。

相关包：

- `@gamekits/driver-core`
- `@gamekits/driver-phaser`
- `@gamekits/driver-three`

## 核心原则

- Core protocol 只定义稳定协议，不依赖具体第三方运行时。
- Adapter 只实现一个稳定协议，例如 renderer、input source、asset loader、camera sync、physics backend。
- Driver 统一拥有一个第三方运行时，并暴露一组 GameKits adapter。
- 同一个第三方运行时只能由一个 Driver 实例负责生命周期。
- 可复用 gameplay module 和 core package 不直接 import Phaser、Three.js 等底层库。
- App-specific presentation、Editor 后端专属面板和 DevTools renderer plugin 可以显式依赖具体 Driver / Adapter 包，并通过 typed native handle 使用底层库 API。
- Driver 不能读取或修改 gameplay state；需要 world/tick/gameplay context 的能力仍属于 GameModule。

## Core Protocol、Adapter 与 Driver

三者职责不同：

```txt
Core Protocol
  定义 GameKits 稳定接口，例如 RendererAdapter、InputSource、AssetLoaderAdapter、RendererCameraAdapter、PhysicsBackendAdapter。

Adapter
  把一个 Core Protocol 映射到某个具体后端能力。

Driver
  统一持有一个外部 runtime，并从中派生多个 Adapter。
```

判断一个集成是否应该成为 Driver：

- 第三方库拥有自己的 game / scene / renderer / loader / input / camera / physics plugin 生命周期。
- 多个 GameKits 协议都需要访问同一个底层 runtime。
- 多个 adapter 独立初始化会导致重复 scene、重复 loader、重复 input listener 或 camera 坐标不一致。
- 需要统一管理外部 runtime 的 boot、resize、pause、resume、dispose 和 diagnostic snapshot。

判断一个实现只需要 Adapter：

- 它只实现单个协议。
- 它不需要长期持有跨协议共享 runtime。
- 它可以被任意 Driver、App Service 或测试夹具注入。

## Driver Runtime

Driver 的长期形态：

```ts
export type GameDriver = {
  id: string;
  kind: string;

  boot(ctx: DriverBootContext): Promise<void>;
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  resize?(size: DriverViewportSize): void;
  dispose(): Promise<void> | void;

  adapters(): DriverAdapterMap;
  native?(): unknown;
  snapshot(): DriverSnapshot;
};
```

Driver lifecycle 归 App Host 或 app composition 层管理。GameRuntime 不直接拥有 Driver。

Driver 可以是 App Host service，因为它主要管理应用级外部句柄和平台/窗口生命周期；Driver 暴露出来的 camera controller、physics scene、TCA、GAS 等 gameplay 行为不能因此变成 App Service。

## Driver Adapters

Driver 通过 `adapters()` 暴露已创建或可懒创建的 GameKits protocol adapter：

```ts
export type DriverAdapterMap = {
  renderer?: RendererAdapter;
  inputSource?: InputSource;
  assetLoader?: AssetLoaderAdapter;
  camera?: RendererCameraAdapter;
  animation?: AnimationPlaybackAdapter;
  audio?: AudioBackend;
  physics?: unknown;
  uiOverlay?: unknown;
  custom?: Record<string, unknown>;
};
```

约束：

- `adapters()` 返回的是 GameKits protocol adapter，不是 Phaser Scene、Three Camera 等原生对象。
- 原生 runtime 或 object 通过 `native()`、renderer handle 或 driver-specific typed bridge 暴露，调用方必须显式依赖具体 Driver / Adapter 包。
- adapter 共享同一个 Driver 内部 runtime，不各自创建第三方 runtime。
- adapter 的错误、diagnostic 和 snapshot 应能关联到同一个 driver id。

## Driver Adapter Discovery

Driver 不维护完整后端 API 的 capability catalog。Phaser、Three.js 等底层库的能力面太大且持续演进，GameKits 不应通过 `DriverCapabilities` 或 `RendererCapabilities` 枚举这些能力。

App Host、DevTools、Editor 和测试夹具只依赖明确的 adapter presence、driver kind、snapshot 和 app profile 选择结果来判断当前组合：

- 是否存在 renderer、inputSource、assetLoader、camera、physics 等 GameKits adapter。
- 当前 driver id / kind / lifecycle phase。
- 当前 app profile 是否选择该 driver 作为标准 renderer、asset、input、camera 或 physics 来源。
- 后端专属工具是否显式依赖对应 Driver / Adapter 包。

Gameplay rule 不应直接依赖 driver adapter、native runtime 或后端特性做核心判定；玩法能力应通过 Data、TCA、GAS、World、Physics module 和配置表达。

## Phaser Driver

Phaser 是典型 Driver，而不是一组互不相关的单协议 adapter。

Phaser Driver 统一持有：

- `Phaser.Game`
- active scene / scene registry
- texture manager
- loader
- input plugin
- camera manager
- physics systems / Matter plugin / Arcade physics world
- tween / animation / particle runtime objects
- sound manager / decoded audio cache / native playback channels

Phaser Driver 可以暴露：

- RendererAdapter：创建、销毁、映射和追踪 RenderObject。
- AssetLoaderAdapter：把 AssetDefinition 加载到 Phaser texture/cache。
- InputSource：把 Phaser input 归一化为 NormalizedInputEvent。
- RendererCameraAdapter：把 CameraState 同步到 Phaser camera。
- AnimationPlaybackAdapter：把 Animator Core playback frame 映射到 Phaser AnimationManager / Sprite。
- AudioBackend：把 Audio Core 已编译的 PlaybackInstance、实例控制、bus、listener/emitter 和 parameter 映射到 Phaser sound manager 或其他 driver-owned audio runtime；一个逻辑实例可以持有多个 native playback channels。Backend 不解释 Music、SFX 或 Dialogue 的领域策略。
- PhysicsBackendAdapter：把 Phaser Arcade / Matter Physics 绑定为 Physics module 可用的 backend adapter。
- Typed native bridge：供 app presentation、Editor 后端专属面板或 DevTools renderer plugin 直接访问 Phaser Scene、GameObject、texture/cache 等对象。

边界：

- `@gamekits/driver-phaser` 是默认直接依赖 `phaser` 的包。
- Phaser asset、input、camera、animation、audio backend、physics adapter 是 `@gamekits/driver-phaser` 的内部 adapter / module，不作为长期独立 package 暴露。
- `@gamekits/renderer-phaser` 只把 RenderObject 协议映射到 Driver 提供的 Phaser Scene runtime，不创建 `Phaser.Game`，也不从 renderer 内部派生 input、camera、physics 或 asset 能力。
- `@gamekits/renderer-core`、`@gamekits/input-core`、`@gamekits/camera-core`、`@gamekits/physics-core`、`@gamekits/animator-core`、`@gamekits/audio-core`、`@gamekits/asset` 不依赖 Phaser。
- CameraController 和 CameraRig 仍属于 GameModule toolkit；Phaser Driver 只提供 camera sync adapter。
- Physics scene 仍通过 GameModule helper 跟随 GameRuntime lifecycle；Phaser Driver 只提供绑定 Phaser Scene 的 physics backend adapter。
- Phaser 原生类型只出现在 `@gamekits/driver-phaser`、`@gamekits/renderer-phaser` 或显式选择 Phaser 的 app/tooling 代码中，不进入 renderer-core、Data、Save 或可复用 gameplay module。

Phaser Driver 的 render options 可以选择 pixel ratio、antialias、round pixels 和 mipmap filter。Factory 创建时统一补全并校验配置，boot、resize 和 diagnostic snapshot 复用同一份 resolved render options，不能根据某个 app 当前使用的字段维护平行默认值。Canvas CSS size、CameraState、Input event 和 RenderObject/world transform 始终使用 logical viewport/world units；Driver 内部才把 backing store 与 native zoom 放大到 profile pixel ratio，并把 pointer coordinate 归一化回来。Camera sync 优先使用 Phaser native center operation，不能把 Camera Core 的 world-view top-left 直接写成 raw `scrollX/scrollY`，因为 native camera viewport 和 zoom 会改变 Phaser scroll property 的实际语义。

## Three.js Driver

Three.js 也应该按 Driver 集成，而不是让 renderer、asset、input、camera 各自持有 Three 相关句柄。Three.js 本身不是物理引擎；3D 物理应通过 `physics-*` backend adapter 接入，再同步到 Three render object。

Three Driver 统一持有：

- WebGL renderer
- scene
- camera objects
- loader manager
- raycaster / pointer picking bridge
- optional controls / post-processing / effect composer

Three Driver 可以暴露：

- RendererAdapter：创建和追踪基础 mesh、asset-backed model、light、group 等 RenderObject，并维护 object id / node path 到 Three native object 的映射。
- AssetLoaderAdapter：加载 texture、GLB/glTF 等资源进入共享 Three runtime cache。
- InputSource：把 canvas pointer / raycast 结果归一化为 input event 或 picking fact。
- RendererCameraAdapter：同步 2D/3D CameraState 到 Three camera。
- Typed native bridge：供 app presentation、Editor 后端专属面板或 DevTools renderer plugin 直接访问 Three renderer、scene、camera、object、mesh、material、AnimationMixer、post-processing 或 particle 等原生能力。

## 与 App Host 的关系

App Host 负责创建、注册和编排 Driver service。

推荐组合方向：

```ts
const driver = createPhaserDriver(phaserOptions);

const host = createConfiguredAppHost({
  profile: createStandardAppProfile({
    drivers: { drivers: [driver], boot },
    renderer: { driver: "phaser" },
    input: { router, driverSources: [{ driver: "phaser" }] },
    assets: { driver: "phaser" }
  })
});
```

App Host 只知道 Driver 的 GameKits 协议和 lifecycle，不理解 Phaser / Three 原生类型。Profile 可以选择某个 driver adapter 作为标准 renderer、asset loader、input source 或 camera sync 来源。

多个 Driver 可以同时存在，例如：

- Phaser 负责 2D game stage。
- React UI 负责 DOM overlay。
- Three 负责 isolated 3D preview panel。
- Headless memory driver 负责测试。

如果多个 Driver 同时存在，App Host profile 必须显式选择每个标准服务使用哪个 driver adapter，避免隐式抢占。

## 与 GameRuntime 的关系

GameRuntime 不直接拥有 Driver。

GameModule 可以通过 app/profile 注入的 core adapter 使用 Driver 暴露出的能力：

```txt
CameraModule
  → CameraController
  → RendererCameraAdapter from Driver

RenderSyncModule
  → RendererAdapter from Driver

Asset preload service
  → AssetLoaderAdapter from Driver
```

可复用 GameModule 不应该拿到 Phaser Scene 或 Three Scene 后直接写 gameplay 行为。具体 app 的 presentation module、renderer-specific tooling 或 DevTools plugin 需要原生能力时，应通过显式 typed native path 获取，并保持这些代码不写玩法权威状态。

## Diagnostics

Driver snapshot 应能说明：

- driver id / kind / lifecycle phase。
- active external runtime 状态。
- exposed adapter map。
- viewport size / render surface 状态。
- logical viewport、backing-store pixel ratio 和低频 native camera summary；不暴露 native handle。
- loaded asset / texture / cache 摘要。
- input source 状态。
- camera sync 状态。
- recent driver diagnostics。

Driver diagnostic 是低频应用事实，进入 App Host diagnostics 或 DevTools；高频 per-frame render patch、raw input 和底层对象状态不进入 EventBus。

## 反模式

- asset、camera、input 各自作为独立 Phaser package 创建或持有独立 Phaser runtime。
- Camera GameModule 直接 import Phaser 并修改 `Scene.cameras.main`。
- AssetManager 直接依赖 Phaser loader。
- RendererAdapter 试图包装完整 Phaser / Three API，或维护无限扩展的后端能力清单。
- RendererAdapter 重新定义 input event 或 gameplay command。
- App Host 根据包名猜测某个 adapter 属于哪个底层 runtime。
- 业务数据里保存 Phaser Texture、Three Mesh 或 native object reference。

## 最佳实践

### 模块集成

- 只要第三方库同时影响 renderer、asset、input、camera、physics 或 scene lifecycle，就优先建 Driver，而不是散落多个独立 adapter。
- Driver 是外部 runtime owner：负责 boot、resize、pause/resume、dispose、diagnostics 和 adapter 暴露；Adapter 是协议映射者，不重新创建 runtime。
- Asset adapter 的单资源释放、取消和晚到结果清理遵循 [Assets 的作用域与驻留预算](./assets.md#作用域与驻留预算)；音频资源释放还必须结束引用它的播放实例并移除对应 tween/监听器。
- Profile 必须显式选择标准服务使用哪个 driver adapter。多 Driver 并存时不要靠默认顺序或包名猜测。
- 新增 Three、Pixi、Godot bridge 等 Driver 时，先复用现有 Renderer/Input/Asset/Camera/Physics 协议，不够用再通过 ADR 调整协议。
- Driver 调整 render density 时必须把 backing store、camera、input/picking 和 resize 作为一个坐标契约测试；profile 对 pixel ratio 设置设备上限，默认值保持 1 以避免让所有应用承担额外 fill-rate。
- 测试 Driver 时优先使用 fake runtime/driver harness 验证 lifecycle、adapter mapping 和 native handle boundary，浏览器或真实 canvas 只用于少量端到端验证。

### 模块使用

- Driver / Adapter 的具体包可以导出 Phaser、Three 等原生类型给 app presentation、Editor 后端专属面板和 DevTools plugin；这些类型不能进入 core facade、Data、Save 或可复用 gameplay module。
- Driver 的 typed native bridge 应优先暴露真实后端类型；内部测试夹具或 helper 需要结构化目标时，只使用按能力命名的窄 internal target，不维护 `*Like` 形式的后端 shadow API。
- Driver diagnostics 只发低频事实，例如 runtime phase、adapter map、surface size、asset cache summary；不要把每帧 render patch 或 raw input 打进 diagnostics。
- 可复用 GameModule 和非表现层业务代码只消费 Driver 派生的 RendererAdapter、AssetLoaderAdapter、InputSource、camera sync adapter 或 physics backend adapter，不直接拿 Phaser Scene 或 Three Scene 写玩法。
