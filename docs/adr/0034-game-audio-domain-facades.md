# ADR 0034: Game Audio Domain Facades

Status: Accepted on 2026-07-19.

Supersedes: ADR 0033.

## Context

ADR 0033 解决了最初 cue/voice command API 缺少稳定播放实例、分层音效、并发、混音和空间状态的问题，但它继续把所有游戏音频内容归为一个 `AudioEventDefinition`，并让业务通过顶层 `audio.play(eventId)` 使用音乐、音效、对白和环境声。

游戏音频的内容分类不是 Bus 标签，而是不同的领域行为：

- 音乐是少量、长期存在并具有当前状态的播放程序，需要切曲、过渡、循环段、暂停恢复、播放位置和自适应强度。
- 音效是大量离散事件，需要 variation、layer、空间 emitter、并发、抢占、去重和 fire-and-forget。
- 对白/配音是带队列、说话人、优先级、打断、字幕时间和 ducking 语义的演出流程。
- UI 音和环境声可以复用音效播放原语，但使用不同的默认路由和会话控制策略。

`bus: "music"` 只能决定混音路由，不能把一个通用事件播放器变成音乐状态机。让音乐、音效和对白共享顶层 `play()`，会迫使调用方自己实现本应由框架持有的切曲、队列、打断和生命周期策略。

`voice` 也存在领域歧义：在游戏内容中通常表示语音/配音，在底层音频引擎中又常表示一个 native playback channel。把 `AudioVoice` 或 `voice` Bus 暴露为公共术语会混淆对白、逻辑播放实例和底层容量。

## Decision

### 首层 API 按游戏音频领域拆分

`@gamekits/audio-core` 的应用侧入口是 `GameAudio`，不提供可播放任意内容的顶层 `play(eventId)`：

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

内容定义使用不同的领域名：

- `MusicTrackDefinition` / `MusicProgramDefinition` 描述音乐资源、循环段、section/stem、节拍信息和默认过渡。
- `SfxEventDefinition` 描述音效 layer、variation、空间设置、并发和默认路由。
- `DialogueLineDefinition` 描述对白音频、说话人、优先级、打断、marker 和可选字幕关联键。
- `AudioClipRef` 只表示 asset-backed 音频资源；成熟中间件 authored object 使用不透明 backend key。

`AudioEventDefinition` 不再作为音乐、音效和对白共用的公共内容模型。共同的 asset-backed 资源引用命名为 `AudioClipRef`。Gameplay Cue 仍是表现事实，由 app/session presentation mapping 显式映射到 music command、SFX event 或 dialogue line。

### Music、SFX 与 Dialogue 使用不同控制面

`MusicPlayer` 是有当前状态的控制器，负责 `play`、`transitionTo`、`pause`、`resume`、`seek`、`setIntensity` 和 `stop`。音乐切换策略明确表达 cut、fade 和 crossfade；Backend 支持时可以映射量化切换、section 或 stem，Backend 不支持时必须通过 capabilities 和 diagnostics 公开降级，不能默默伪装。

`SoundEffects` 是事件入口，负责 `play(eventId, options)`、实例/owner/emitter 定向停止以及 SFX 内容策略。短音效允许 fire-and-forget；持续 loop 或需要后续控制的音效返回 `PlaybackHandle`。

`DialoguePlayer` 是可选领域控制器，负责 enqueue/play、队列、说话人、优先级、打断、skip 和结束事件。它可以向字幕、本地化和 lip-sync 组合层发布时间信息，但 Audio Core 不拥有本地化文本、剧情 authority 或 UI。`voiceChat` 是实时通信能力，完全不属于这个 API。

### Playback Instance 是共享执行原语

Music、SFX 和 Dialogue 可以共享内部 playback coordinator、逻辑 instance registry、调度器、fade 和 Backend request。需要控制的播放返回 `PlaybackHandle`；一次逻辑 playback 可以映射零个、一个或多个 native channels。

公共术语使用：

- `PlaybackInstance` / `PlaybackHandle`：GameKits 可控制的逻辑播放生命周期。
- `Dialogue` / `VoiceOver`：人声对白内容。
- `nativeChannel` 或 `nativePlaybackCount`：Backend 内部播放槽位或 diagnostics 计数。

公共 API、Bus 和 snapshot 不再用裸 `voice` 同时表达这三种概念。

### Mix 与 Spatial 是共享横切能力

标准 Bus 层级为：

```txt
master
├── music
├── sfx
│   ├── ui
│   └── ambience
└── dialogue
```

App 可以扩展子 Bus，但不能删除或重定义标准 Bus 的语义。`AudioMixer` 负责 Bus gain/mute/pause、可叠加 Mix Snapshot 和 ducking intent；用户音量持久化由 Platform/Save 组合层负责。

`SpatialAudio` 负责 Listener/Emitter identity 和批量 transform 更新。SFX 和 Dialogue 可以选择空间 emitter；Music 和 UI 默认 non-spatial。实际 attenuation、panner、HRTF、occlusion 和 DSP 由 Backend/成熟中间件实现。

### Backend 只接收编译后的播放原语

Driver/Adapter 实现 `AudioBackend`，只接收已经解析分类、资源、路由和控制意图的 `BackendPlaybackRequest`，并提供 start/stop/pause/resume/seek/update、Bus、Listener/Emitter、parameter、marker 和 lifecycle 映射。

Backend 不解释 MusicPlayer 的切曲规则、SfxEvent 的 variation 选择或 DialoguePlayer 的队列。它不把 Phaser Sound、AudioBuffer、FMOD EventInstance、Wwise playing id 或平台 handle 暴露给 root public API。成熟中间件 authored event/program 可以通过不透明 key 和 typed native escape hatch 保留其 authoring 能力。

## Consequences

Positive consequences:

- 游戏代码从 API 就能看出音乐、音效和对白的不同意图，常见策略由框架而不是每个 app 重复实现。
- `voice` 歧义被消除；逻辑实例、对白和 native channel 可以分别诊断和预算。
- Backend 保持足够小，可以映射 Phaser/Web Audio，也不会阻碍 FMOD/Wwise 的 authored event、parameter 和 mixer 能力。

Costs and constraints:

- 现有 Audio Event + 顶层 `play()` 草案需要破坏性替换；App Host、Phaser Driver、测试、benchmark 和尚未集成的 demo 必须在同一实现工作流迁移。
- Music、SFX 和 Dialogue 共享 playback 内核，但不能为了减少类型数量重新合并首层领域 API。
- Core 仍不重写完整音频中间件。量化音乐、复杂 DSP、streaming、codec、bank、VCA、sidechain、occlusion 和 voice chat 继续由成熟库或独立能力负责。

## Rejected Alternatives

### Keep one Audio Event API and distinguish by Bus

Rejected because Bus 只表示混音路由，不能表达音乐过渡、对白队列和音效并发等生命周期差异。

### Keep `voice` as the public playback name

Rejected because 它与人声对白和 voice chat 冲突。底层音频术语即使技术上成立，也不应成为含义模糊的游戏框架公共 API。

## References

- Architecture: `docs/architecture.md`
- Audio module: `docs/modules/audio.md`
- Audio Core package architecture: `docs/adr/0035-audio-core-package-internal-architecture.md`
- Superseded decision: `docs/adr/0033-event-instance-game-audio-contract.md`
- Core-first ownership: `docs/adr/0026-core-first-domain-semantic-ownership.md`
