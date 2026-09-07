# Animator Core 模块设计

## 定位

Animator Core 是 session-scoped presentation Game Module toolkit，负责把 gameplay semantic state 与 cue 转换为稳定动画状态、transition 和 backend-neutral playback command。

相关包：

- `@gamekits/animator-core`：graph、controller、GameModule、marker 与 observability 的游戏侧入口。
- `@gamekits/animator-core/playback`：Driver/Adapter 实现者使用的播放帧和执行端口。
- `@gamekits/animator-core/testing`：Memory Playback Adapter 与 runtime conformance。
- 具体 backend 实现由 `@gamekits/renderer-*` 或 `@gamekits/driver-*` 提供 runtime slice。

Animator Core 不解码纹理、骨骼或模型，不创建 Phaser AnimationManager、Three AnimationMixer 或 renderer object。外部 runtime 仍由 Driver 单一持有。

## 核心职责

- Animator graph、parameter、state、layer、transition 与 one-shot runtime。
- entity/controller lifecycle、playback snapshot 和按历史容量、单次 controller update 双重有界的 marker stream。
- locomotion continuous state 与 action one-shot 的优先级、打断和恢复。
- authority gameplay phase 到表现 playback phase 的映射。
- backend adapter command、trace、diagnostics 和 conformance。

非职责：

- gameplay timing、伤害、能力是否合法或 Physics transform。
- 资源加载与 atlas 解码。
- UI tween、camera motion、particle simulation 或 audio mixing。
- backend 专属 shader、skeleton constraint 或 animation editor。

## Data Definitions

```ts
export type AnimationClipDefinition = {
  id: string;
  asset: AssetRef;
  backendClip?: string;
  durationMs: number;
  loop?: boolean;
  markers?: Array<{ id: string; timeMs: number; tags?: string[] }>;
};

export type AnimatorGraphDefinition = {
  id: string;
  parameters: AnimatorParameterDefinition[];
  layers: AnimatorLayerDefinition[];
};

export type AnimatorBindingDefinition = {
  id: string;
  graph: DataRef<"animator.graph">;
  clips: Record<string, DataRef<"animation.clip">>;
  target?: string | string[];
};
```

Clip definition 描述语义和资源引用，不携带 Phaser frame object 或 Three AnimationClip native handle。Backend adapter 负责把 clip id 绑定到 native animation。

## Animator Parameters

Controller 输入使用少量可复用参数：

- continuous：`speed`、`direction`、`aim-angle`、`vertical-velocity`。
- boolean/tag：`grounded`、`moving`、`downed`、`dead`、`shocked`。
- discrete trigger：`fire`、`reload`、`dash`、`cast`、`hit-react`、`revive`。
- gameplay phase：`execution-id`、`ability-id`、`phase`、`phase-start-time`。

参数由 app presentation mapping 产生。Animator Core 不固定角色职业、武器名或八方向规则。
State 可以通过 `speedParameter` 引用 number parameter；最终播放倍率为静态 `speed` 与非负 parameter 值的乘积。连续倍率变化累积当前 state 的播放时钟并保持 `seek=false`，只有 state/playback identity 变化才重设进度。

## Graph 与 Layer

典型角色图包含：

- Base locomotion layer：idle/run/downed/dead。
- Upper/action layer：aim/fire/reload/cast/interact。
- Reaction layer：hit/stagger/shield-break。
- Additive/effect layer：status pulse、weapon heat 或受控 overlay。

Layer 明确 priority、blend/replace policy、mask target 和 interrupt group。One-shot 必须声明：

- 可否被更高优先级动作打断。
- 被打断后回到哪个 stable state。
- 重复 trigger 是 ignore、restart、queue-one 还是 merge。
- 最大排队长度；默认不允许无界 action queue。

## Gameplay Timing 边界

Ability execution phase 是权威时间源。动画根据 `preparing/active/recovering` 选择 clip 并映射 normalized phase：

```txt
authority execution phase
  -> replicated semantic state
  -> animator controller phase mapping
  -> backend clip/time command
  -> presentation marker
```

Animation marker 只驱动脚步、弹壳、枪口闪光、衣物等表现。伤害、投射物生成、cost commit、无敌窗口和冷却不能等待 renderer marker。

本地预测可以立即播放 locomotion、aim 和已声明的可预测 action anticipation；authority rejection 通过 cancel/recover transition 收敛。远端客户端根据 authority phase start time 恢复 clip 相位，不从第一帧重播已经发生一半的动作。

## Backend Adapter

```ts
export type AnimationPlaybackAdapter = {
  bind(controllerId: string, binding: AnimatorBindingDefinition, renderObjectId: string): void;
  apply(controllerId: string, frame: AnimationPlaybackFrame): void;
  unbind(controllerId: string): void;
  snapshot(): AnimationPlaybackAdapterSnapshot;
};
```

Phaser backend 由共享 Driver/Renderer runtime 创建 animation、控制 Sprite playback 并解析 atlas/spritesheet frames。Three backend 使用 AnimationMixer/Action。Adapter 不拥有 gameplay controller state。

Playback frame 的 layer `weight` 和 `mode` 是 backend capability contract。能够混合的 backend 必须执行对应语义；不能执行的 backend 必须在任何 native mutation 前明确拒绝，不能静默忽略。Phaser Sprite playback 只支持 `weight: 1` 的 `replace` layer；需要并行播放时应绑定到独立 RenderNode。weighted/additive layer 应使用具有混合能力的 backend。

Renderer Core 继续只提供 object lifecycle、node target 和 command envelope；Animator Core 不把所有 clip/mixer 功能塞进 Renderer Core。

## 包内架构

Animator Core 使用领域职责与依赖方向驱动的结构，不采用通用 `data/runtime/types.ts` 模板。graph 定义、controller state、one-shot、authority phase、marker、playback projection、observability、GameModule composition 和测试替身具有不同的状态所有权与变化原因。

```txt
packages/animator-core/
  src/
    index.ts

    contracts/
      controller-binding.ts
      errors.ts

    graph/
      clip-definition.ts
      graph-definition.ts
      binding-definition.ts
      data-type-contract.ts
      content-validation.ts
      animation-clip-data-type.ts
      animator-graph-data-type.ts
      animator-binding-data-type.ts
      animator-data-types.ts

    state/
      compile-controller.ts
      controller-state.ts
      parameter-store.ts
      transition-evaluator.ts
      reset-controller.ts

    action/
      one-shot-controller.ts

    phase/
      gameplay-phase.ts
      gameplay-phase-controller.ts

    marker/
      marker-event.ts
      marker-stream.ts

    projection/
      playback-frame-projector.ts

    playback/
      index.ts
      playback-frame.ts
      animation-playback-adapter.ts

    observability/
      animator-snapshot.ts
      animator-trace.ts
      snapshot-projector.ts
      trace-store.ts

    controller/
      animator-controller.ts
      update-controller.ts
      create-animator-handle.ts

    composition/
      options.ts
      runtime-config.ts
      create-animator-runtime.ts
      create-animator-module.ts

    testing/
      index.ts
      memory-playback-adapter.ts
      runtime-conformance.ts

  test/
    architecture/
    graph/
    controller/
    composition/
    testing/
    fixtures/
```

内部依赖方向：

```txt
contracts / graph definitions / playback contracts
                       ↓
              compiled controller state
                       ↓
 action / phase / marker / projection / observability
                       ↓
               controller update facade
                       ↓
                    composition
```

- `graph` 只拥有 clip、graph、binding 内容定义和 DataType 校验，不推进 controller tick。
- `state` 编译不可变内容索引并持有 controller/layer parameter、transition 与 reset 状态；不调用 Driver 或 GameModule。
- `action` 和 `phase` 分别拥有 one-shot 排队/打断以及 authority phase 映射，不在 composition root 复制状态机。
- `marker` 只产生有界、去重的表现事件；observer、EventBus 和 trace 发布由 composition 协调，失败不反写 controller。
- `projection` 把 controller state 投影为 backend-neutral playback frame；`playback` 只定义 Driver/Adapter port 与 DTO，不依赖高层 controller 或 App Host。
- `observability` 从只读状态和领域事件构建 snapshot/trace；状态机不依赖具体 observer。
- `controller` 协调一次 controller update，`composition` 只管理 controller registry、adapter flush、Handle 和 GameModule lifecycle，不能重新吸收 graph、one-shot、phase、marker 或 projection 算法。
- Root 入口只导出游戏/app 使用的 graph、controller、module、marker 和 observability API。Playback port 通过 `@gamekits/animator-core/playback` 导出，测试替身和 conformance 通过 `@gamekits/animator-core/testing` 导出。
- 类型与语义所有者放在同一目录；不重新创建包级 `types.ts`、`definitions.ts`、`helpers.ts`、`utils.ts` 或通用 `runtime/` 聚合层。
- 测试按 graph、controller、composition、testing 与 architecture 镜像组织；Driver 先通过 Core conformance，再补 native clip 与资源生命周期测试。

## Multiplayer、Save 与 Reset

- 网络复制 gameplay semantic phase、必要的 locomotion parameter 和 cue sequence，不复制 native frame index。
- Local/remote transform 仍由 Multiplayer/Physics presentation 管理，Animator 只读取最终 presentation velocity/facing。
- late join 从当前 stable state 与 active execution phase 构建 controller，不重播旧 marker。
- binding generation、session reset、entity despawn 和 render object replacement 都必须清理 one-shot queue、marker watermark 和 native binding。
- 普通 Save 不保存瞬时播放帧；需要跨 checkpoint 继续的 ability execution 由 GAS 保存，加载后 Animator 从 gameplay phase 重建。

## 性能

- Graph 在 controller bind 时编译 state/transition/one-shot/clip 索引并预排序 transition，运行时不逐帧解析字符串表达式或重建排序数组。
- Controller 按 dirty parameter 或 active transition 更新；静止且无 one-shot 的 controller 不写 backend。
- 同一帧对 renderer 的更新批量提交，支持 caller-owned frame buffer。
- Marker、trace 和 queued one-shot 均有界。`markerHistoryLimit` 限制去重历史；`maxMarkerEventsPerControllerUpdate` 限制单个 controller 每次 update 的补发量，默认保留最近 64 个 marker 并按时间顺序发布。被截断的旧表现 marker 不在后续帧重放，并产生 `animator.marker_catch_up_truncated` diagnostic。
- benchmark 覆盖 500 active / 1,000 mostly-idle controller、state churn、late-join rebuild 和 dispose retained state。

## 最佳实践

### 模块集成

- App composition 创建一个 AnimationPlaybackAdapter runtime slice，并把它与 DataRegistry、presentation state reader 注入 `createAnimatorModule(...)`。
- Driver 先 boot 并加载 clip asset，再绑定 Animator controller；GameRuntime dispose 先解绑 controller，再销毁 Driver。
- Playback frame 的 `seek` 只表示某个 layer 的播放身份或权威相位发生跳变；未触发 transition 的连续 parameter 更新、其他 layer 的状态变化和 one-shot 排队不能让当前 clip 重设进度。
- Marker listener、EventBus subscriber、trace observer 及其错误回调都是隔离旁路；单个订阅者失败可以产生 diagnostic，但不能中断同一帧的 adapter flush。Gameplay 不能依赖被 catch-up limit 丢弃的 presentation marker。
- Adapter 必须完整执行 playback frame 声明的 layer mode/weight，或者在执行整帧前原子拒绝不支持的 capability；禁止部分写入后才报告不支持。
- 每个 adapter 运行 graph/playback conformance，再补 Phaser/Three clip、marker 和 resource lifecycle 测试。
- Graph、state、transition、one-shot 和 clip alias 在 controller bind 时建立索引；DataType 与 runtime 同时拒绝非法 speed/weight/priority/gameplay clock。`onTrace/onTraceError` 和 `onMarker/onMarkerError` 都是隔离的旁路 observer，不能修改内部 marker 或中断 playback decision。

### 模块使用

- Gameplay 只发布 semantic phase/tag/cue，不持有 Animator controller 或 native clip。
- Presentation mapping 可以按游戏定义八方向、武器姿态和 layer mask，但不能修改 authority state。
- 高频 locomotion 参数直接从 presentation frame 批量写入，不经 EventBus 或 React。
- 粒子、音频、camera 和 UI 可以消费相同 cue correlation，但各自管理资源与生命周期。
