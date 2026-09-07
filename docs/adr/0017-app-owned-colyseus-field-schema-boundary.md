# ADR 0017：高频 Colyseus 字段级 Schema 保持 App-owned Boundary

## Status

Accepted

## Context

ADR 0015 的 `GameKitsColyseusNativeState` carrier 已验证 Colyseus Schema authority lane、provider version、source gate 和 resync contract，但它把完整 app snapshot 编码为单个 JSON 字段，不适合大量玩家、敌人、投射物、建筑和掉落物的字段级 patch 与带宽测量。

把 Outpost Siege 的完整玩法 Schema 放进 `@gamekits/multiplayer-colyseus` 会让 provider package 拥有具体游戏 domain；把 raw Schema 暴露给 browser gameplay、UI 或 `multiplayer-core` 又会破坏 provider-neutral boundary。与此同时，为尚未出现第二个使用场景的 AOI、replication contributor 或通用对象图 mapping 提前设计 core API，会形成未经压力验证的过度抽象。

## Decision

Outpost Siege 的高频复制使用 app-owned、字段级 Colyseus Schema：

- Schema class、collection、gameplay-to-schema projection 和 schema-to-app-view mapping 位于 app 的 provider-specific server/client adapter 边界。
- `@gamekits/multiplayer-colyseus` 只提供通用 typed hook：Room/native state subscription、provider update metadata、authority/source/version/size/resync gate、redacted diagnostics 和 cleanup。它不定义 player、enemy、projectile、buildable 或 pickup Schema。
- Browser gameplay、prediction、presentation 和 UI 只消费 app-local、provider-neutral authoritative view。只有 app-local provider adapter 可以 import Colyseus Schema 类型。
- Server gameplay world、replication projection、Schema state、client authoritative shadow 和 presented state 是不同对象；任何层都不能把下游可变对象回写到上游事实源。
- Schema entity 使用稳定 `entityId + generation`。Despawn、id reuse、room reset、schema version change 和 resync 必须清理旧 authoritative shadow、prediction history 和 presentation track。
- Client 以 provider 的单调 update/version 处理增量，gameplay tick 只作为 simulation metadata。Initial sync、duplicate/stale update、schema mismatch、size limit 和 resync 都需要显式状态与 diagnostics。
- App provider adapter 把字段 Schema 映射为 provider-neutral Core `snapshotSource`；配置 source 后它互斥替换默认 envelope snapshot subscription，但 playback、prediction、reconciliation 和 frame writer lifecycle 仍只由 Multiplayer Core 持有。
- 每个 room 只声明一个 authoritative gameplay state path。选择字段级 Schema 时，GameKits envelope 继续承载低频 command/result/diagnostic fact，但不再双写同一份高频 snapshot。
- 全量可见实体是性能基线。AOI、interest management 和 replication partition 先保持 app/server-specific；只有第二个稳定应用证明存在相同抽象后，才评估下沉到 backend package 或 core。

ADR 0015 carrier 继续保留为小型 demo、迁移和 conformance baseline；本 ADR 不废弃它，而是定义复杂游戏使用专用字段级 Schema 时的长期边界。

## Consequences

收益：

- 可以真实测量 Colyseus 字段级 patch、spawn/despawn 和大规模 collection，而不把完整 JSON carrier 当作生产优化方案。
- Provider-specific 类型被限制在 app adapter 与 backend package，gameplay contract 和 presentation pipeline 保持可替换。
- Schema 结构可以针对 Outpost Siege 的热字段和生命周期优化，不迫使 Multiplayer core 理解任意对象图。
- 后续是否下沉 mapping、partition 或 AOI primitive 将由真实的第二使用场景和 benchmark 证据决定。

代价：

- App 需要维护显式 replication projection、Schema mapping 和 provider-neutral view model。
- Carrier lane 与字段级 lane 都需要各自的 integration test，但同一 room 不能同时写同一 authority state。
- Provider patch bytes、apply time 和 collection churn 需要 app/server 侧 diagnostics，不能只依赖 core envelope counters。

约束：

- Colyseus Schema、Room、Client 和 collection instance 不进入 `multiplayer-core`、DataType、Save payload 或可复用 GameModule API。
- Presented value、prediction cache 和 client authoritative shadow 不得写回 provider state。
- Schema mapping callback 不直接逐对象更新 renderer；先更新 authoritative shadow，再由 presentation frame 批量投影。
- 未经全量同步基线和第二稳定场景验证，不新增通用 AOI/replication graph API。

## References

- ADR 0015：`docs/adr/0015-colyseus-schema-authority-carrier.md`
- Multiplayer 模块：`docs/modules/multiplayer.md`
- Outpost Siege 应用：`docs/apps/multiplayer-outpost-siege-demo.md`
