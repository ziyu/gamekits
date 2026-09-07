# ADR 0042: Animator Core Package Internal Architecture

Status: Accepted on 2026-07-22.

## Context

`@gamekits/animator-core` 同时包含 clip/graph/binding DataType、controller parameter 与 transition、one-shot queue、authority gameplay phase、marker 去重、playback frame、adapter port、snapshot/trace、Handle、GameModule 和测试替身。这些职责具有不同的状态所有权、依赖方向和测试策略。

初版采用 `src/data + src/runtime + runtime/types.ts` 结构，把全部公共类型聚合到一个文件，并在一个千行 `createAnimatorRuntime()` 闭包内同时完成内容解析、索引编译、状态切换、动作排队、phase 恢复、marker 发布、playback projection、observer 和 adapter flush。Root 入口还同时导出 Driver port、Memory Adapter 与 conformance。

这种结构不符合包内架构标准：目录表达的是通用技术类别而不是 Animator 领域职责；composition root 成为 god runtime；Driver、游戏代码和测试代码共享同一个扩大后的默认 API；测试也无法按状态所有权组织。

## Decision

### 使用 Animator 领域职责结构

Animator Core 按以下边界拆分：

```txt
src/
  index.ts
  contracts/
  graph/
  state/
  action/
  phase/
  marker/
  projection/
  playback/
  observability/
  controller/
  composition/
  testing/
```

各目录职责：

- `contracts`：跨 Animator 领域稳定的 controller binding、parameter value 和错误。
- `graph`：clip、graph、binding 内容定义、DataType 和不可变定义 clone，不推进 tick。
- `state`：把 DataRegistry 内容编译为 controller/layer 索引，并拥有 parameter、transition 和 reset 状态。
- `action`：one-shot repeat、queue、priority、interrupt 和 completion 语义。
- `phase`：authority gameplay phase 校验、mapping、late-join seek 和 cancellation。
- `marker`：marker range、generation/playback identity 去重和有界历史。
- `projection`：把当前 controller state 投影为 backend-neutral playback frame。
- `playback`：Driver/Adapter 实现的执行端口和 DTO，不持有 controller state。
- `observability`：snapshot projection、trace store 和 observer isolation。
- `controller`：游戏侧 runtime/handle contract 与单 controller update 协调。
- `composition`：controller registry、adapter batch flush、runtime config、Handle/GameModule lifecycle。
- `testing`：Memory Playback Adapter、runtime conformance 和测试支持。

### 固定内部依赖方向

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

具体约束：

- graph validation 不依赖 controller lifecycle，playback port 不依赖 controller、composition、App Host 或具体 Driver。
- state 不调用 adapter；action、phase 和 marker 只能通过窄 state contract 修改各自拥有的语义。
- projection 只创建 playback DTO，不执行 native clip。
- controller update 可以组合 transition、action、phase、marker 与 projection，但不拥有 controller registry 或 GameModule lifecycle。
- composition 是唯一连接 DataRegistry、EventBus、adapter flush、observer、Handle 和 GameModule 的位置；它不能重新实现各领域算法。
- observability observer 失败不改变 controller、marker 或 playback 结果。

### 公共入口按消费者拆分

包提供三个入口：

- `@gamekits/animator-core`：游戏/app 使用的 graph、controller、GameModule、marker 与 observability API。
- `@gamekits/animator-core/playback`：Driver/Adapter 使用的 playback frame、adapter、batch/reset 和 adapter snapshot 协议。
- `@gamekits/animator-core/testing`：Memory Playback Adapter、runtime conformance 和测试类型。

Root 不导出 playback adapter port、Memory Adapter、conformance、compiled state、trace store、marker watermark 或 projection helper。现有游戏侧 controller API 和数据定义保持语义兼容；Driver、测试、benchmark 和 Sandbox probe 改用对应 subpath。

### 类型和测试跟随语义所有者

删除包级 `runtime/types.ts` 和通用 `runtime/` barrel。类型放在拥有其语义的 graph、state、phase、marker、playback、observability 或 controller 文件中。Root、`/playback` 和 `/testing` 是仅有的公共 barrel，内部实现使用窄文件 import。

测试目录镜像 `graph`、`controller`、`composition`、`testing` 和 `architecture`。Architecture test 明确验证测试替身不从 root 泄漏；Phaser/Three Driver 通过 `/playback` 实现 port，并在具体包测试 native clip 行为。

## Consequences

Positive consequences:

- 目录直接表达 graph、controller state、one-shot、phase、marker、projection、observability 和 lifecycle 的所有权。
- controller registry 与 adapter flush 不再与各领域算法共享一个千行闭包。
- 游戏、Driver 和测试消费者只看到各自需要的公共入口。
- transition、action、phase、marker 和 playback projection 可以独立测试与演进。
- Core 继续是 Animator 语义唯一来源，Driver 只执行 playback port，不建立平行 controller runtime。

Costs and constraints:

- Driver、App Host 测试、test-utils、Sandbox 和 benchmark 必须迁移到新 subpath。
- 文件数量增加，内部依赖方向需要持续由 build、lint 和 architecture tests 维护。
- 新 Animator 能力必须先确认状态所有者，不能重新堆回 composition factory 或创建新的包级类型聚合文件。

## Rejected Alternatives

### Keep the runtime directory and only split types

Rejected because graph compilation、one-shot、phase、marker、projection 和 lifecycle 仍会由同一个 god runtime 推进，类型移动不能修正状态所有权。

### Export playback and testing from root for convenience

Rejected because Driver port、游戏 facade 和测试替身面向不同消费者；继续共享 root 会扩大默认 API，并让业务代码误用 adapter 或 fixture。

### Move native animation execution into Animator Core

Rejected because Phaser AnimationManager、Three AnimationMixer、clip asset 和 native object 仍由 Driver/Renderer runtime 持有。Animator Core 只拥有 backend-neutral semantic state 和 playback command。

## References

- Architecture: `docs/architecture.md`
- Animator module: `docs/modules/animator.md`
- Implementation principles: `docs/implementation-principles.md`
- Related domain decision: `docs/adr/0031-gameplay-foundation-packages-and-agent-ai.md`
