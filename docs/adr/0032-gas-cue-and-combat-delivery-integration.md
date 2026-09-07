# ADR 0032: GAS Cue And Combat Delivery Integration

Status: Accepted on 2026-07-18.

## Context

GAS 已经拥有 Ability execution phase、Effect 和 Cue，Combat 则负责 melee、hitscan、area、projectile、空间查询和命中去重。若每个游戏手写 `gas.ability_execution_phase` 订阅并直接拼装 Combat request，会重复实现幂等、correlation、目标映射和 lifecycle；若 Combat 再增加一套通用 Cue registry，又会与 GAS 的表现语义所有权冲突。

GAS Cue 只携带 source/target Actor 和静态 payload，不能安全承载命中点、法线、射线路径、遮挡点或每帧 projectile transform。另一方面，Combat 的空间事实本身也不能回答应该播放哪种动画、粒子、声音或 UI 反馈。

## Decision

- GAS 是 Ability/Effect Cue 的唯一 gameplay presentation intent source。Ability phase Cue 表达前摇、释放、恢复和取消；Effect Cue 只在 Effect 成功应用后表达受击、治疗和状态反馈。
- Combat 不增加平行 Cue registry。它继续发出有界 delivery/hit/projectile fact，并把连续 projectile 状态留在 World/Physics。
- `@gamekits/combat` 提供 `combat.ability-delivery` DataType 和可选 module bridge。Bridge 在 GAS execution 首次进入 `committed` 时自动、幂等地调用 Combat delivery，并传播 actor、target、execution、correlation 和 parent identity。
- Delivery definition 承载静态空间配置；动态 aim/socket/charge 数据通过注入的窄 request resolver 提供。Resolver 不拥有订阅、runtime 或命中结算。
- Presentation bridge/consumer 使用 correlation、execution、ticket、projectile id 关联 GAS Cue 与 Combat fact/World state。Cue 决定“播放什么”，Combat/World 决定“在哪里、沿什么方向播放”。
- 环境伤害、关卡脚本和测试工具仍可显式调用 Combat delivery；这不是普通 Ability 集成的默认路径。
- Multiplayer authority 执行 GAS 与 Combat；客户端只消费复制的 execution、Cue/fact 和 projectile presentation state，不重新进行 authority target validation。

## Consequences

普通游戏只需注册 Ability、Effect、Cue、Delivery 和 ability-delivery binding，并在需要时提供动态 request resolver，不需要为每个技能重复编写 phase listener。GAS 保持对 Combat 的零依赖，Combat 也不拥有表现后端。

Cue 与精确空间事实可能在不同事件中到达，表现消费者必须使用有界 correlation state，并允许退化到 Actor/Entity transform。连续 projectile transform 不进入 Cue 或 EventBus。

## Rejected Alternatives

### Add a general Combat Cue registry

拒绝原因：attack、hit、heal、status 和 cancel 的表现语义已经由 GAS Cue 拥有，会产生两个配置源和重复多人去重规则。

### Put delivery definitions on GAS Ability

拒绝原因：GAS 会依赖 Combat 的 melee/hitscan/projectile 语义，破坏包依赖方向并让非战斗 Ability 承担无关字段。

### Let every app subscribe to committed events

拒绝原因：幂等 request id、correlation、source/target 映射、dispose 和错误处理会在武器 handler 中重复出现。

### Put dynamic hit geometry in GAS Cue payload

拒绝原因：Cue definition 是静态内容语义，命中点和弹道来自 authority Physics/Combat runtime，并且连续 transform 属于高频状态。

## References

- `docs/modules/gas.md`
- `docs/modules/combat.md`
- `docs/architecture.md`
- `docs/adr/0026-core-first-domain-semantic-ownership.md`
- `docs/adr/0031-gameplay-foundation-packages-and-agent-ai.md`
