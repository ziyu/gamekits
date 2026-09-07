# ADR 0033: Event-Instance Game Audio Contract

Status: Superseded by ADR 0034 on 2026-07-19.

ADR 0033 正确区分了逻辑播放实例和底层 native voice，也确立了 Backend 不泄漏第三方 handle 的边界；但它错误地把 Audio Event + Instance 提升成音乐、音效和对白共用的首层业务 API。新的领域入口以 `docs/adr/0034-game-audio-domain-facades.md` 为准；包内实现结构由 ADR 0035 独立记录。

## Context

ADR 0031 确立了 `@gamekits/audio-core` 的可选表现 facade 边界，但最初实现把 cue、底层 sound voice 和游戏可控播放实例合并成同一个对象。`play(cueId)` 只返回一次性状态，Adapter 只提供 play/stop/bus/listener/source update。这种模型可以验证“发出过一个声音命令”，却不能覆盖实际游戏音频需要的稳定控制面：

- 一次游戏音频事件可能由多个 layer 同时播放，每层还可能选择不同 variation；逻辑 event instance 与 native voice 不是一一对应关系。
- 音乐、环境 loop、对白和长尾音效需要可寻址 instance handle，以及 pause/resume/seek/fade/parameter/transform 控制。
- 并发限制应是可复用、命名且可按 global/owner/emitter 作用域配置的 content policy，不应在每次 play 调用里临时传 `maxVoices/steal`。
- 游戏混音需要 bus hierarchy、ramp、pause/mute、可叠加 Mix Snapshot 和 global/instance parameter；单次 `set-bus` 不能表达暂停菜单、低血量、潜水或剧情侧链等状态化混音。
- 空间音频需要独立 Listener/Emitter lifecycle 和批量 transform update；把 source snapshot 塞进每个 voice 会丢失稳定 emitter identity。
- Phaser 可以直接播放 asset-backed clips，而 FMOD/Wwise 一类成熟中间件应保留其 authored event、parameter、routing 和 native voice 管理。Core 不能迫使这类 Adapter 为每个 event 伪造单个 AssetRef。

Phaser 自身的声音实例已经提供 play/pause/resume/stop/seek、volume/rate/pan/loop 和 lifecycle event；FMOD Studio 也以 EventInstance、local/global parameter、3D attributes、Bus/VCA 和 Snapshot 为主要游戏控制边界。GameKits 的协议应映射这些稳定领域概念，而不是退化成一次性命令队列。

## Decision

### 以 Audio Event 和 Audio Instance 为公共中心

`AudioEventDefinition` 是内容定义，支持两种互斥 playback source：

1. Asset-backed layers：一个 event 包含多个 layer；每层使用 random、random-no-repeat 或 sequence 选择 clip，可以配置 probability、weight、volume、pitch、loop 和 start offset。
2. Adapter-authored event：通过不透明 `adapterEvent` key 映射 FMOD/Wwise 或其他成熟中间件的 authored event，不在 Core 重建其内部 track、effect 或 routing graph。

`AudioRuntime.play(eventId, options)` 返回稳定 `instanceId`。调用方通过 `AudioInstanceHandle` 或 runtime target API 控制 pause、resume、stop/fade、seek、volume、pitch、pan、loop、parameter 和 emitter/transform。逻辑 instance 可以拥有零个 Core clip（adapter-authored event）、一个 clip 或多个 native voices；公共 snapshot 分别报告 `activeInstances` 与 adapter 的 `nativeVoices`。

旧的 `AudioCueDefinition`、`AudioSourceRef`、`AudioVoiceState` 和 play-time `maxVoices/steal` 不作为兼容层保留。项目仍可把 GAS/Combat cue 映射成 Audio Event，但 gameplay cue 不是 audio runtime 的实例模型。

### 内容化并发、参数和混音

- `AudioConcurrencyDefinition` 使用稳定 id、`maxInstances`、global/owner/emitter scope、retrigger window 和 reject/oldest/quietest/lowest-priority resolution。Event 只引用命名 policy。
- `AudioParameterDefinition` 区分 continuous、discrete 和 boolean，以及 global/instance scope。Core 校验和保存稳定值，Adapter 决定如何映射到 native parameter。
- Bus hierarchy 保存 volume target、mute、pause、instance limit 和 effective state；volume 可以按 Host tick ramp。
- `AudioMixSnapshotDefinition` 对多个 bus 声明可叠加 override，activation 使用稳定 id、owner、priority、weight 和 fade lifecycle。Core 计算通用 bus mix；成熟 Adapter 仍可通过 adapter-authored event/typed native path 使用更复杂 DSP、send、VCA 或 sidechain。

### Listener、Emitter 与批量更新

Listener 和 Emitter 是独立稳定对象。Instance 可以引用 emitter，也可以携带一次性 transform。Runtime 提供批量 `setEmitters(...)`，避免大量空间声源逐个触发 adapter flush。Core 只做确定性的最大距离拒绝；距离曲线、pan 和底层 3D panner 由 Adapter 实现。

Core 支持多 Listener 状态。Adapter 通过 capabilities 明确是否原生支持 multiple listeners；单 Listener backend（例如当前 Phaser adapter）稳定选择权重最高的 Listener，不把 backend 限制泄漏到 gameplay API。

### Adapter 是实例执行边界

`AudioAdapter` 以 `start/stop/pause/resume/seek/updateInstances` 为实例控制面，以批量 `setBuses/setListeners/setEmitters` 和 `setGlobalParameter` 为运行时控制面。Adapter 发布 capabilities 与 ended/marker event，不把 Phaser Sound、AudioBuffer、FMOD handle 或 Wwise playing id 暴露到 Core。

Phaser Driver 的共享 audio slice 让一个逻辑 instance 持有多个 Phaser Sound track，并统一执行 scheduled start、fade、pause/resume/seek、volume/rate/pan/loop 和清理。它继续使用 Driver 已持有的 Scene、SoundManager、TweenManager 和 Asset cache，不创建第二个 Phaser runtime。

Memory/Null Adapter 复用同一 event-instance contract，供 headless、deterministic fixture、conformance 和 benchmark 使用。它们验证语义生命周期，不声称模拟真实 DSP。

### Audio 不成为 gameplay authority

Audio lifecycle event、marker、parameter、adapter rejection 和 browser unlock 都属于表现事实。Gameplay 可以产生待映射的 cue/state，但不能等待声音成功、marker 或播放位置来决定命中、资源消耗、AI 或 match phase。Observer、diagnostic 和 marker callback failure 必须与实例生命周期隔离。

## Consequences

Positive consequences:

- 普通 app 使用熟悉的 event + instance handle API；短 one-shot、持续 loop、音乐、对白和空间 emitter 共用一套生命周期。
- Layered asset event 可以覆盖 Phaser/Web Audio 等轻量 backend；adapter-authored event 又不会削弱未来 FMOD/Wwise 集成。
- 并发、混音、参数和空间 identity 成为可测试、可诊断的内容协议，而不是散落在 play call 的临时选项。
- Core snapshot、Adapter snapshot 和 DevTools 能区分逻辑 instance 与 native voice，避免错误容量判断。

Costs and constraints:

- 这是对未进入 app 集成阶段的初版 Audio API 的破坏性替换；App Host profile、Phaser Driver、conformance、benchmark 和文档必须同步迁移。
- Core 只提供跨 backend 稳定语义，不重写完整 DSP graph、effect plugin、stream decoder、codec、bank loader 或 middleware authoring tool。
- 不同 Adapter 对 multiple listener、marker、parameter、native event 和复杂 spatialization 的支持不同，必须通过 capabilities、conformance 和真实 backend test 公开差异。

## Rejected Alternatives

### Keep cue command and add more optional fields

Rejected because pause/resume/seek/fade、layered playback、parameter 和 native event ownership 都需要稳定实例；继续扩展一次性 command 只会把同一个生命周期拆散在调用方。

### Expose native Phaser/FMOD/Wwise handles from Core

Rejected because这会让 gameplay、Data 和 App Host 绑定具体 runtime，并破坏 Driver/Adapter 替换边界。Native control 只能留在具体 Driver 的 typed escape hatch。

### Rebuild a complete middleware mixer in Audio Core

Rejected because DSP、effect graph、streaming、codec、bank、platform output 和 authoring 已由成熟 runtime 负责。Core 只统一游戏侧 event、instance、mix intent、lifecycle 和 diagnostics。

## References

- Architecture: `docs/architecture.md`
- Audio module: `docs/modules/audio.md`
- Gameplay foundation: `docs/adr/0031-gameplay-foundation-packages-and-agent-ai.md`
- [Phaser BaseSound API](https://docs.phaser.io/api-documentation/4.0.0/class/sound-basesound)
- [Phaser Audio concepts](https://docs.phaser.io/phaser/concepts/audio)
- [FMOD parameters reference](https://www.fmod.com/docs/2.03/studio/parameters-reference.html)
- [FMOD event instance reference](https://www.fmod.com/docs/2.03/unreal/blueprint-reference-eventinstance.html)
