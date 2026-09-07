# ADR 0035: Audio Core Package Internal Architecture

Status: Accepted on 2026-07-19.

Related decision: ADR 0034 defines the public Game Audio domain facades.

## Context

`@gamekits/audio-core` 同时包含内容编译、共享播放调度、音乐状态、音效选择与并发、对白队列、混音、空间状态、Backend port、diagnostics、组合入口和测试能力。这些职责具有不同的变化原因和测试策略。

初版目录照搬了其他 package 的通用 `src/runtime` 平铺结构，把几乎所有公共类型放进单个 `types.ts`，把定义编译、播放调度、并发、混音、空间、生命周期和 diagnostics 聚合到单个 runtime 文件。这种结构没有表达 Audio 自身的领域边界，并形成高耦合的 god runtime。

通用的 `runtime/adapter/components/modules/types.ts` 目录外观不能替代包内架构设计。Audio Core 需要根据 ADR 0034 已经确定的领域边界组织实现，同时保持一个共享 Backend 和应用音频生命周期。

## Decision

### 使用 feature-first、dependency-directed 结构

Audio Core 按领域职责和内部依赖方向拆分：

```txt
src/
  index.ts
  contracts/
  catalog/
  playback/
  music/
  sfx/
  dialogue/
  mix/
  spatial/
  backend/
  observability/
  composition/
  testing/
```

各目录职责：

- `contracts`：真正跨领域稳定的 id、生命周期和 handle 协议。
- `catalog`：定义注册、交叉引用校验和不可变编译结果，不推进播放状态。
- `playback`：共享实例 registry、调度、fade、owner cleanup 和 Backend command 顺序，不决定 Music/SFX/Dialogue 策略。
- `music`：MusicPlayer、音乐定义、状态和 transition controller。
- `sfx`：SoundEffects、SFX Event、variation selector 和 concurrency policy。
- `dialogue`：DialoguePlayer、Dialogue Line、queue 和 read model。
- `mix`：AudioMixer、Bus tree、Mix Snapshot 和 parameter store。
- `spatial`：SpatialAudio、Listener/Emitter registry 和批量更新。
- `backend`：Driver/Adapter 实现的 port、capabilities、request DTO 和 Backend event。
- `observability`：只读 snapshot、diagnostics 和 lifecycle event projection。
- `composition`：创建 GameAudio、连接共享 coordinator/controller/Backend 并管理应用生命周期。
- `testing`：Backend conformance、Memory/Null Backend 和 fixture。

### 固定内部依赖方向

```txt
contracts / catalog / backend ports
              ↑
playback / mix / spatial
              ↑
music / sfx / dialogue
              ↑
composition
```

具体约束：

- `music`、`sfx`、`dialogue` 彼此不直接依赖，通过 playback/mix/spatial 的窄接口协作。
- `playback` 不导入 Music/SFX/Dialogue controller，也不根据 Bus 猜测内容分类。
- `backend` 不依赖 composition、高层 controller、App Host 或具体 Driver。
- `observability` 从只读状态和生命周期事件构建投影；业务状态机不依赖具体 observer。
- `composition` 是唯一允许同时装配所有领域 controller、共享 playback coordinator 和 Backend 的位置。
- composition 中的 runtime 只协调 lifecycle、clock 和 flush，不能重新吸收各领域算法。

### 使用有意图的公共入口

包提供三个入口：

- `@gamekits/audio-core`：游戏/app 使用的领域 API、内容定义和创建函数。
- `@gamekits/audio-core/backend`：Driver/Adapter 实现的低层协议。
- `@gamekits/audio-core/testing`：conformance、Memory/Null Backend 和测试 fixture。

Root 入口不导出内部 registry、编译状态、native handle 或测试替身。Backend 与 testing 使用独立 subpath，避免为了 Driver 或测试扩大游戏侧默认 API。

### 类型和测试跟随领域所有权

类型与拥有其语义的领域放在一起。禁止用包级 `types.ts`、`definitions.ts`、`helpers.ts` 或 `utils.ts` 聚合所有不相关概念。

内部 barrel 只用于明确的 public subpath；领域实现之间优先直接导入目标文件，避免循环依赖和无意扩大导出面。

测试目录按 `catalog`、`playback`、`music`、`sfx`、`dialogue`、`mix`、`spatial` 和 `composition` 镜像实现。共享 Backend contract 使用 conformance；真实 Driver/Adapter 在自己的 package 补 native runtime 行为测试。

## Consequences

Positive consequences:

- 目录直接表达 Audio 领域职责，音乐状态机、音效并发、对白队列、混音和空间更新可以独立测试与演进。
- Playback 与 Backend 仍可复用，不需要为每个领域复制底层播放生命周期。
- App Host、Driver 和测试代码通过明确 subpath 只依赖各自需要的协议。
- composition root 的权限和体积受到约束，不再形成新的 god runtime。

Costs and constraints:

- 从平铺 runtime 迁移时需要同时调整 import、public export、package export、测试目录和 Driver/App Host 依赖。
- feature 目录之间必须维护单向依赖，不能用 barrel 或共享类型文件重新制造隐式耦合。
- Audio Core 的文件数量会增加，但每个文件和目录拥有更清晰的变化原因。

## Rejected Alternatives

### Reuse the generic package directory template

Rejected because package 目录必须表达该领域的稳定职责和依赖方向。技术类别可以存在，但不能成为所有 package 的固定骨架。

### Keep one private runtime and only split public types

Rejected because 这只改善文件外观，不会分离 Music transition、SFX concurrency、Dialogue queue、Mix、Spatial 和 Backend orchestration 的状态所有权。

### Split every Audio domain into a separate npm package immediately

Rejected because Music、SFX、Dialogue、Mix 和 Spatial 需要共享同一个 Backend、播放协调器和应用音频生命周期。先在 `audio-core` 内形成清晰 feature boundary；只有出现独立依赖、独立版本或独立消费证据时才分包。

## References

- Public API decision: `docs/adr/0034-game-audio-domain-facades.md`
- Architecture: `docs/architecture.md`
- Audio module: `docs/modules/audio.md`
- Implementation principles: `docs/implementation-principles.md`
