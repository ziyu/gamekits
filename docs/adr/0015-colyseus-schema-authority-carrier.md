# ADR 0015: Colyseus Schema Authority Carrier

Status: Accepted

## Context

ADR 0013 允许 provider-native state sync 成为 authoritative path，但要求 core、玩法和可复用 GameModule 不依赖 provider 类型。Multiplayer Demo 需要真实验证 Colyseus Schema，而不是继续把 Colyseus 只当普通 message transport。

直接为每个游戏在 adapter 包内定义完整玩法 Schema 会让 provider package 拥有游戏 domain；把 Schema 暴露给 browser gameplay 或 `multiplayer-core` 又会破坏 backend 可替换边界。Envelope snapshot 和 Schema 同时写入客户端还会形成两个事实源。

## Decision

`@gamekits/multiplayer-colyseus/server` 提供一个小型、版本化的 `GameKitsColyseusNativeState` Schema carrier。它只保存 session/source identity、gameplay tick、app schema version、timestamp、编码后的 app-owned state、state bytes 和单调 `updateCount`。

- 每个 room 只声明一个 authoritative path。选择 Schema 时，GameKits envelope 不再发布同一 gameplay snapshot。
- Authority simulation 和 snapshot capture 仍由 app-owned host loop 完成；core 只允许把 captured snapshot delivery 委托给 provider publisher。
- Room 只接受 authority host 写入并负责递增 `updateCount`。Gameplay tick 可以在多个合法更新间相同，因此客户端以 provider `updateCount` 排序，以 tick 作为 simulation metadata。
- Colyseus adapter 把 Schema state 解码成 app-local value，再经过 authority binding、session/source/version/size/resync gate。Schema、Room 和 raw provider state不进入 core 或 gameplay API。
- Provider SDK 对同一 state version 的重复 callback 在 adapter 边界去重；直接提交到 authority bridge 的重复或倒序 update 仍被拒绝并进入 diagnostics。

## Consequences

- GameKits 能真实使用 Colyseus Schema patch lifecycle，同时保持 gameplay snapshot 和 presentation pipeline provider-neutral。
- Carrier 当前编码完整 app snapshot；它验证 native authority lane 和 provider patch/version contract，但不是针对大型生产游戏的字段级带宽优化。游戏需要更细粒度 Schema 时，应在 app/server 边界提供专用 mapping，仍遵守同一 authority binding 和 diagnostics contract。
- Native lane 增加 `@colyseus/schema` 直接依赖和 provider-specific tests，但不会把该依赖引入 `multiplayer-core`。
