# ADR 0019: Domain-owned Gameplay Save Contributors

Status: Accepted on 2026-07-12.

## Context

Outpost Siege 的 authority checkpoint 必须恢复 Physics、GAS 和 TCA 后继续确定性 tick。`@gamekits/save` 已定义通用 contributor、section、validation 和 entity map 协议，但不能反向依赖所有 gameplay domain；各 app 也不应通过闭包读取 domain runtime 私有状态并重复实现序列化。

Physics、GAS 和 TCA runtime 都由 GameModule 持有。SaveManager 是 App Service，不能拥有这些 runtime，也不能为了 restore 隐式启动 GameRuntime tick。

## Decision

标准 gameplay Save contributor 由对应领域包提供：

- `@gamekits/physics-core` 提供 `createPhysicsSaveContributor()`。
- `@gamekits/gas` 提供 `createGasSaveContributor()`。
- `@gamekits/tca` 提供 `createTcaSaveContributor()`。

领域包单向依赖 `@gamekits/save` 的稳定 contributor/section/context 类型。`@gamekits/save` 不依赖 Physics、GAS 或 TCA，也不理解 section 内部结构。

Contributor 通过 module-bound handle 访问 checkpoint API。Handle 不拥有 runtime；GameModule install 时绑定，dispose 时解绑。默认 restore order 是：

```txt
World identity/entity mapping
  -> Physics (200)
  -> GAS (300)
  -> TCA (400)
  -> app gameplay
  -> replication rebuild
```

保存内容保持最小稳定状态：

- Physics：body/collider definition、transform、velocity、sleep state、fixed-step accumulator 和 entity mapping。
- GAS：elapsed、actor attributes/tags/abilities/cooldowns 和 active effects。
- TCA：executed once-rule ids 与 run sequence。

不保存 trace history、EventBus subscription、compiled handler、backend native handle、contacts、broadphase/solver cache、connection、replication projection或 presentation state。Physics restore 清空 module-owned backend objects，由下一次 system tick 从 World component 重建；GAS/Physics 使用 `SaveRestoreContext.entityMap` 处理 entity remap。Contributor restore 不 tick runtime，组合层负责恢复 runtime clock 后再 resume。

## Consequences

Positive consequences：

- Save 核心继续保持与 gameplay domain 解耦。
- Headless server、测试夹具和真实 app 使用同一套 checkpoint 实现。
- Handle lifecycle 防止 SaveManager 捕获失效 runtime 或全局单例。
- Physics 半步、GAS effect/cooldown 和 TCA once-rule 可以跨 checkpoint 继续。

Costs and constraints：

- Physics、GAS、TCA 发布包新增对 `@gamekits/save` 协议包的依赖。
- World contributor 或 app spawn contributor 必须先创建 entity 并填充 entity map；不能重复保存 domain-owned components。
- Section schema 变化需要版本迁移；runtime trace 和 backend cache 在 restore 后重新建立。

## Rejected Alternatives

### Make `@gamekits/save` import every gameplay domain

Rejected because it turns Save into a dependency hub, creates optional-domain coupling, and reverses the intended protocol ownership.

### Let every app serialize runtime snapshots through closures

Rejected because runtime access, validation, entity remap, restore order, and effect/body sequence handling would diverge across games.

### Serialize backend or compiled runtime object graphs

Rejected because native handles, compiled handlers, subscriptions, caches, and provider state are not portable or migratable save data.
