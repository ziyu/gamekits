# Audio Core 模块设计

## 定位

Audio Core 是 GameKits 的游戏音频 facade。它向游戏和应用提供按领域区分的 Music、SFX、Dialogue、Mix 与 Spatial API，并统一逻辑播放实例、生命周期、诊断和 Backend 边界。

Audio Core 不负责解码器、设备输出、DSP graph、streaming、bank、native channel pool 或平台音频 runtime。这些能力由 Phaser/Web Audio adapter、成熟音频中间件或平台 SDK 持有。Core 也不根据音频成功、marker 或播放位置决定命中、资源消耗、AI、剧情分支或 match phase。

相关边界：

- `@gamekits/audio-core`：领域 facade、内容定义、共享播放语义和组合入口。
- `@gamekits/audio-core/backend`：Driver/Adapter 实现的低层执行协议。
- `@gamekits/audio-core/testing`：Backend conformance、Memory/Null Backend 和 fixture。
- `@gamekits/asset`：音频 AssetDefinition、格式变体、加载状态和缓存 identity。
- `@gamekits/app-host`：应用级 boot、unlock、suspend/resume、tick 和 dispose。
- `@gamekits/driver-phaser`：复用同一个 Phaser runtime 的 Audio Backend slice。

领域 API 决策见 `docs/adr/0034-game-audio-domain-facades.md`，包内架构决策见 `docs/adr/0035-audio-core-package-internal-architecture.md`。ADR 0033 仅保留为被取代的历史决策。

## 设计原则

### 内容分类和执行原语分离

音乐、音效和对白是面向游戏开发者的内容领域；Playback Instance、Bus、Emitter 和 Backend request 是共享执行原语。共享底层原语不意味着首层 API 也必须合并。

```txt
Gameplay cue / presentation state
  ├── music command ──────> MusicPlayer
  ├── SFX event ──────────> SoundEffects
  └── dialogue line ──────> DialoguePlayer
                                │
                                v
                    shared playback coordinator
                                │
                   mix intent + spatial state
                                │
                                v
                          AudioBackend
```

Bus 只决定路由和混音，不决定内容行为。`bus: "music"` 不能代替 MusicPlayer，`bus: "dialogue"` 也不能代替对白队列。

### 公共术语无歧义

- `PlaybackInstance` / `PlaybackHandle`：GameKits 可控制的一次逻辑播放。
- `Dialogue` / `VoiceOver`：角色对白、旁白或配音内容。
- `nativeChannel` / `nativePlaybackCount`：Backend 内部播放通道及其诊断计数。
- `voiceChat`：实时通信能力，不属于 Audio Core。

公共 API 不使用裸 `voice` 同时指代上述概念。标准对白 Bus 命名为 `dialogue`。

### Core 负责语义，Backend 负责声音执行

Core 负责内容定义校验、分类控制器、逻辑实例、并发、队列、过渡意图、Bus/Mix 状态、Emitter/Listener identity 和 diagnostics。Backend 负责把已编译请求映射到真实运行时。

Core 不模拟完整音频中间件。Backend 不复制 Core 的 Music/SFX/Dialogue 状态机。

## 公共领域入口

应用侧只依赖 `GameAudio`：

```ts
export interface GameAudio {
  readonly music: MusicPlayer;
  readonly sfx: SoundEffects;
  readonly dialogue?: DialoguePlayer;
  readonly mix: AudioMixer;
  readonly spatial: SpatialAudio;

  unlock(): Promise<boolean>;
  suspend(): void;
  resume(): void;
  update(deltaMs: number, elapsedMs?: number): void;
  subscribe(listener: (event: GameAudioEvent) => void): () => void;
  diagnostics(): AudioDiagnosticEntry[];
  snapshot(): GameAudioSnapshot;
  dispose(): void;
}
```

顶层不提供可播放任意内容的 `audio.play(id)`。调用点必须明确表达是在操作音乐、音效还是对白。

## Music

### 职责

MusicPlayer 是有当前状态的长期控制器，不是一次性事件派发器。它管理当前曲目/程序、播放位置、暂停状态、循环段、切换和自适应参数。

```ts
export interface MusicPlayer {
  play(trackId: MusicTrackId, options?: MusicPlayOptions): MusicState;
  transitionTo(trackId: MusicTrackId, transition?: MusicTransition): MusicState;
  setIntensity(value: number, transitionMs?: number): void;
  pause(): void;
  resume(): void;
  seek(positionMs: number): void;
  stop(options?: FadeOptions): void;
  getState(): MusicState;
}
```

长期协议允许表达：

- cut、fade、crossfade。
- intro → loop → outro。
- 可恢复的播放位置和暂停策略。
- BPM、拍号、marker 和量化切换意图。
- section、stem/layer 与 intensity。
- asset-backed track 或成熟中间件 authored music program。
- streaming/preload hint，但实际 IO 仍归 Asset/Backend。

Backend 不支持某种切换或自适应能力时，通过 capability 和 diagnostic 明确降级。Core 不把“不支持”伪装成已执行。

Music 不参与普通 SFX concurrency stealing。`CreateGameAudioOptions.playbackBudgets` 分别限制 music、sfx 和 dialogue 的逻辑实例与 native playback 数；全局上限只作为最后的总量保护，抢占候选始终限制在同一 category。默认总量为分类预算预留 Music transition 和 Dialogue 槽位，避免枪声峰值或 UI 音影响音乐生命周期。

## SFX

### 职责

SoundEffects 面向离散声音事件：武器、命中、交互、脚步、UI 和可复用环境声 recipe。它负责 variation、layer、空间 emitter、并发、优先级、去重和 owner lifecycle。

```ts
export interface SoundEffects {
  play(eventId: SfxEventId, options?: SfxPlayOptions): SfxPlayResult;
  stop(handle: PlaybackHandle, options?: FadeOptions): boolean;
  stopOwner(ownerId: AudioOwnerId, options?: FadeOptions): number;
  stopEmitter(emitterId: AudioEmitterId, options?: FadeOptions): number;
  snapshot(): SoundEffectsSnapshot;
}
```

短 one-shot 可以 fire-and-forget；loop、持续环境声和需要调节的长音效返回 `PlaybackHandle`。

`SfxEventDefinition` 可以声明：

- 一个或多个 layer。
- 每层的 weighted random、random-no-repeat 或 sequence variation。
- volume/pitch 随机范围和 start offset。
- 2D/3D、distance culling 和默认 emitter policy。
- 命名 concurrency policy、scope、retrigger window、priority 和 steal/reject 行为。
- 默认 Bus：普通 gameplay 音效使用 `sfx`，UI 使用 `sfx/ui`，环境使用 `sfx/ambience`。
- asset-backed clips 或不透明 Backend authored event key。

Gameplay Cue 和 SFX Event 不是同一个概念。GAS/Combat/app presentation mapping 把一次表现事实映射成 SFX Event，并在多人场景传入有界 dedupe identity。

## Dialogue

### 职责

DialoguePlayer 是可选控制器，管理对白和旁白的音频演出生命周期：

```ts
export interface DialoguePlayer {
  play(lineId: DialogueLineId, options?: DialoguePlayOptions): DialogueHandle;
  enqueue(lineId: DialogueLineId, options?: DialogueQueueOptions): DialogueHandle;
  skipCurrent(options?: FadeOptions): boolean;
  stopSpeaker(speakerId: SpeakerId, options?: FadeOptions): number;
  getState(): DialogueState;
}
```

它负责：

- 队列和单句生命周期。
- speaker、priority、interrupt、replace 和 skip policy。
- marker、开始/结束事件和对白专属 ducking intent。
- 对稳定 subtitle/localization key 的可选关联。
- 空间对白和 non-spatial narration。

`skipCurrent()` 只跳过当前句：未提供 fade 时必须立即停止当前 playback；提供 fade 时在 fade 结束后停止。如果队列中仍有对白，它在当前句终止后继续下一句，但不清空队列。

Audio Core 不持有本地化文本、字幕 UI、剧情状态或 lip-sync renderer。它只发布足以让这些模块同步表现的有界事件。对话 marker 和结束回调不能成为剧情 authority；权威剧情时序必须来自 gameplay/narrative runtime。

实时麦克风采集、编码、网络传输、降噪、回声消除和玩家语音频道属于 Voice Chat/Multiplayer/Platform，不进入 DialoguePlayer。

## Playback Instance

Playback 是 Music、SFX 和 Dialogue 共享的执行原语。

```ts
export interface PlaybackHandle {
  readonly id: PlaybackInstanceId;
  getState(): PlaybackInstanceState | undefined;
  pause(): boolean;
  resume(): boolean;
  seek(positionMs: number): boolean;
  set(patch: PlaybackPatch, transitionMs?: number): boolean;
  setParameter(parameterId: AudioParameterId, value: AudioParameterValue): boolean;
  stop(options?: FadeOptions): boolean;
}
```

一次逻辑 instance 可以对应：

- 一个 asset clip。
- SFX layer 产生的多个 native channels。
- 一个成熟中间件 authored event instance。
- 因虚拟化、延迟调度或 Backend rejection 暂时对应零个 native channel 的语义实例。

Snapshot 分开报告 `activePlaybackInstances` 和 `nativePlaybackCount`。Core 用前者解释业务生命周期，用后者观察 Backend 容量；二者不能混用。

Playback coordinator 统一负责调度、fade、ended/marker 回传、owner cleanup、实例控制和 Backend command 顺序。它不决定 Music transition、SFX variation 或 Dialogue queue。

## Mix

标准 Bus 层级：

```txt
master
├── music
├── sfx
│   ├── ui
│   └── ambience
└── dialogue
```

AudioMixer 负责：

- Bus gain、mute、pause 和 effective state。
- 带 transition 的音量变化。
- 可叠加、可按 owner 释放的 Mix Snapshot。
- dialogue、pause、underwater、low-health 等 ducking/mix intent。
- 全局参数和 Backend capability 投影。

App 可以增加标准 Bus 下的子路由，但不能改变标准 Bus 的含义。用户设置只改变稳定 mix state；设置的持久化由 Platform/Save 组合层负责。

复杂 DSP graph、send、VCA、effect plugin、sidechain 和 middleware-native Snapshot 由具体 Backend 或 typed native path 持有。Core 只描述跨 Backend 有意义的 mix intent。

## Spatial

SpatialAudio 管理稳定 Listener/Emitter identity：

- Listener 来自本地玩家/camera presentation，不成为 authority gameplay state。
- Core启动时提供位于原点的隐式 `main` listener作为未装配 presentation时的fallback；一旦注册任意自定义 listener，该隐式 listener不再参与公开 snapshot、距离裁剪、primary选择或Backend同步。调用方显式更新 `main` 时，它转为普通 listener并遵守相同的weight/id规则。
- Emitter 可以绑定 owner，并保存 transform、velocity 和 active state。
- 高频移动声源使用批量更新，不经 EventBus 逐帧广播。
- Instance 可以引用稳定 Emitter，也可以携带一次性 transform。
- Emitter 删除时，调用方明确选择停止关联 loop，或让 one-shot 保留最后位置自然结束。

Core 只做确定性、Backend 无关的有效性校验和可选最大距离拒绝。attenuation、pan、3D panner、doppler、HRTF、occlusion 和 obstruction 由 Backend 执行。

关键机制不能只靠精确空间声定位传达，应同时提供视觉、字幕或震动替代。

## 内容目录与编译

Audio catalog 在创建 GameAudio 时一次性校验并编译，不在 hot play 路径查询 DataRegistry 或重新遍历定义图。

Catalog 分别注册：

- Music track/program definitions。
- SFX event 和 concurrency definitions。
- Dialogue line definitions。
- Bus、Mix Snapshot 和 parameter definitions。

不同分类使用不同 id 类型和 registry，禁止一个 id 通过 Bus 猜测内容类型。共同的 asset/backend source、tag 和 parameter primitive 可以复用，但不能合并领域定义。

AssetManager 负责 audio source、codec/format variant、load group、retry 和 loaded identity。Audio Core 只持有 `AssetRef<"audio">` 或已解析 Backend key，不直接 fetch URL，也不保存二进制资源。

## Backend 协议

Driver/Adapter 通过 `@gamekits/audio-core/backend` 实现低层协议：

```ts
export interface AudioBackend {
  readonly id: string;
  readonly capabilities: AudioBackendCapabilities;

  start(request: BackendPlaybackRequest): BackendStartResult;
  stop(instanceIds: PlaybackInstanceId[], fadeMs: number): void;
  pause(instanceIds: PlaybackInstanceId[]): void;
  resume(instanceIds: PlaybackInstanceId[]): void;
  seek(instanceId: PlaybackInstanceId, positionMs: number): boolean;
  updateInstances(updates: BackendPlaybackUpdate[]): void;

  setBuses(states: BackendBusState[]): void;
  setListeners(states: AudioListenerState[]): void;
  setEmitters(states: AudioEmitterState[]): void;
  setGlobalParameter(id: AudioParameterId, value: AudioParameterValue): void;

  unlock(): Promise<boolean> | boolean;
  suspend(): void;
  resumeOutput(): void;
  setEventListener(listener?: (event: AudioBackendEvent) => void): void;
  snapshot(): AudioBackendSnapshot;
  dispose(): void;
}
```

Backend 接收的是已经选好资源、路由、初始参数和调度信息的请求。它不接收整个 Music/SFX/Dialogue catalog，也不解释上层分类状态机。

Capabilities 至少覆盖 pause、seek、fade、scheduled start、multiple tracks、spatial、multiple listeners、parameter、marker、streaming 和 authored object。Conformance 验证公共 lifecycle；真实 Backend 测试继续验证 native state、cache、autoplay、bank 或平台限制。

Phaser Driver 必须使用 Driver 已持有的 Scene、SoundManager、TweenManager 和 Asset cache，不创建第二个 Phaser runtime。一个逻辑 PlaybackInstance 可以映射为多个 Phaser Sound track，并由同一个 Backend binding 清理。

## 生命周期与 App Host

GameAudio 是应用服务，生命周期归 App Host/composition：

1. Asset 和 Driver 准备完成后创建 GameAudio。
2. 注册并编译 catalog，绑定 Driver 提供的 AudioBackend。
3. UI/Input shell 在用户手势边界触发 `unlock()`；gameplay 不监听原始 DOM event。
4. Host 推进 transition、fade、队列和 diagnostics 所需的稳定时钟。
5. App suspend/resume 显式映射到 Audio，不借 gameplay pause 猜测平台生命周期。
6. dispose 释放实例、订阅和独立 Backend；Driver-owned Backend slice 只由 Driver 销毁 native runtime。

Gameplay session presentation module 负责 cue/state 到 Music/SFX/Dialogue 的映射、Listener/Emitter 更新和 owner cleanup。它不在 App Host service factory 内写具体玩法规则。

Dedicated server 和 deterministic test profile 使用 Null/Memory Backend，仍验证 catalog、分类控制器、队列、并发、实例和 diagnostics，不声称模拟真实声音、DSP 或设备时序。

## 包内架构

Audio Core 使用 feature-first、dependency-directed 结构。目录用于表达领域职责和变化原因，不套用统一的 `runtime/adapter/components/modules/types.ts` 模板。

```txt
packages/audio-core/
  src/
    index.ts

    contracts/
      game-audio.ts
      lifecycle.ts
      playback.ts
      identifiers.ts

    catalog/
      audio-catalog.ts
      compile-audio-catalog.ts
      source-definition.ts
      parameter-definition.ts

    playback/
      playback-coordinator.ts
      instance-registry.ts
      scheduler.ts
      fade-controller.ts
      owner-index.ts

    music/
      music-player.ts
      music-definition.ts
      music-state.ts
      transition-controller.ts

    sfx/
      sound-effects.ts
      sfx-event-definition.ts
      variation-selector.ts
      concurrency-policy.ts

    dialogue/
      dialogue-player.ts
      dialogue-line-definition.ts
      dialogue-queue.ts
      dialogue-state.ts

    mix/
      audio-mixer.ts
      bus-tree.ts
      mix-snapshot.ts
      parameter-store.ts

    spatial/
      spatial-audio.ts
      listener-registry.ts
      emitter-registry.ts

    backend/
      index.ts
      audio-backend.ts
      backend-capabilities.ts
      backend-requests.ts
      backend-events.ts

    observability/
      audio-snapshot.ts
      audio-diagnostics.ts
      lifecycle-events.ts

    composition/
      create-game-audio.ts
      game-audio-runtime.ts

    testing/
      index.ts
      backend-conformance.ts
      memory-audio-backend.ts
      null-audio-backend.ts

  test/
    catalog/
    playback/
    music/
    sfx/
    dialogue/
    mix/
    spatial/
    composition/
```

目录名表示长期边界，文件名可以随具体职责微调，但必须维持以下依赖规则：

```txt
contracts / catalog / backend ports
              ↑
playback / mix / spatial
              ↑
music / sfx / dialogue
              ↑
composition
```

- `contracts` 只放真正跨领域稳定的 id、生命周期和 handle 协议，不成为杂项类型仓库。
- `catalog` 负责定义注册、交叉引用校验和不可变编译结果，不推进播放状态。
- `playback` 只负责共享执行生命周期，不导入 Music/SFX/Dialogue controller。
- `music`、`sfx`、`dialogue` 彼此不直接依赖，通过 playback/mix/spatial 的窄接口协作。
- `backend` 定义端口和 DTO，不导入 composition 或领域 controller。
- `observability` 从只读状态和事件构建 snapshot/diagnostic；业务状态机不依赖具体 observer。
- `composition` 是唯一同时装配全部领域 controller、共享 coordinator 和 Backend 的位置。`game-audio-runtime.ts` 只协调生命周期，不能重新吸收各领域算法。
- `testing` 通过 `@gamekits/audio-core/testing` 导出，不从 root 入口泄漏 fixture。
- 不创建覆盖全部模块的 `types.ts`、`definitions.ts`、`helpers.ts` 或 `utils.ts`。类型与行为放在拥有它们的领域目录中。
- 内部 barrel 只用于明确的 public subpath；领域实现之间优先直接导入目标文件，避免循环依赖和无意扩大导出面。

Root `src/index.ts` 只导出游戏/app 需要的 `GameAudio`、Music/SFX/Dialogue/Mix/Spatial 协议、内容定义和创建函数。Backend 与 testing 通过独立 subpath 导出，内部 registry、compiled definition、调度队列和 native binding 永不公开。

## Diagnostics 与性能

GameAudioSnapshot 分领域报告：

- Music 当前 track/program、transition、position、pause 和 intensity。
- SFX active/rejected/deduplicated/concurrency/culling summary。
- Dialogue current line、queue depth、speaker 和 interruption summary。
- Bus/Mix activation、Listener/Emitter、global parameter 和 unlock/output state。
- 逻辑 `activePlaybackInstances` 与 Backend `nativePlaybackCount`。

Diagnostics 使用有界、克隆后的白名单 payload。Observer failure 不改变播放、队列、切曲或 cleanup 结果。Snapshot 不保存 native object、完整资源 payload 或无界历史。

性能约束：

- Catalog 只在创建/替换内容时编译。
- Emitter transform 和 Backend instance patch 使用批处理。
- SFX concurrency 使用由 Playback lifecycle 同步的有界 active view；普通 burst 不为每次事件深拷贝全部实例，依赖实时音量或 emitter scope 的策略在裁决前刷新公开状态。owner 和 emitter 查询使用索引，不扫描历史记录。
- Music transition、Dialogue queue 和 Mix activation 分别有独立有界状态。
- Benchmark 分开覆盖 SFX burst/variation/concurrency、Music transition、Dialogue queue/interruption、Emitter batch、Mix Snapshot 和 dispose retained state。

## 测试策略

- Music 测试切曲、crossfade、pause/resume/seek、循环段、intensity 和 capability degradation。
- SFX 测试 variation 可复现性、layer、并发 scope、retrigger、priority、dedupe、distance culling 和 owner cleanup。
- Dialogue 测试 queue、speaker、priority、interrupt、skip、ducking activation 和 marker observer isolation。
- Playback 测试 scheduled/playing/paused/stopping/completed/failed 状态、fade、Backend rejection 和 ended callback 幂等。
- Mix 测试 Bus 继承、mute/pause、ramp、Snapshot priority/weight/owner cleanup。
- Spatial 测试隐式fallback替换、Listener选择、Emitter batch、删除策略和单 Listener Backend降级；真实Backend必须覆盖运行中 Listener移动后已有实例重新衰减和pan。
- 每个 Backend 先通过 `@gamekits/audio-core/testing` conformance，再补真实 runtime 行为。
- App Host 集成测试从 `GameAudio` facade 和 Driver snapshot 同时观察结果，不能只断言 Backend 私有对象。

## 最佳实践

### 模块集成

- Profile/content 分别注册 Music、SFX、Dialogue、Bus/Mix 和 parameter definition，不使用 Bus 推断内容分类。
- App Host 只组合 GameAudio 生命周期和 Backend；session presentation module 才映射 gameplay cue/state。
- Driver-owned Backend 复用 Driver runtime slice；独立 Backend 的 dispose ownership 必须在创建时明确。
- Browser unlock 在 UI/Input shell 的用户手势边界触发，并合并同一轮并发请求。
- Headless 使用 Memory/Null Backend，但仍走同一 GameAudio facade、catalog 和 controller。

### 模块使用

- 背景音乐通过 `audio.music` 控制，不通过 `audio.sfx` 播放一个 loop 模拟。
- 武器、命中、脚步和 UI 反馈通过 `audio.sfx`；只在需要后续控制时保存 handle。
- 对白通过 `audio.dialogue` 排队和打断，不把配音当作普通 SFX 后在 app 自建第二套队列。
- `voiceChat` 使用独立能力，不复用 DialoguePlayer 或 `dialogue` Bus 表示实时玩家语音。
- 并发、variation、默认 Bus 和空间策略优先进入内容定义；调用点只传本次实例确实变化的 owner、emitter、transform、priority 和参数。
- 大量空间声源复用稳定 Emitter id 并批量更新；不为每帧位置变化重建声音。
- 音频生命周期、marker 和 Backend 成功状态只驱动表现和工具，不决定 gameplay authority。
