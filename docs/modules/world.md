# World 模块设计

## 定位

World 是 ECS facade。业务层只依赖 `@gamekits/world`，不直接依赖 Koota 或其他 ECS 库。

相关包：

- `@gamekits/world`
- `@gamekits/world-koota`
- 可替换 adapter：`@gamekits/world-bitecs`、`@gamekits/world-custom`

## 核心职责

`@gamekits/world` 定义稳定协议：

- `EntityId`
- `ComponentDef<T>`
- `defineComponent`
- `GameWorld`
- `WorldSystem`
- `WorldQuery`

基础 `GameWorld` 不强制所有 adapter 支持 identity restore。需要 Save、多人回滚或场景 checkpoint 的组合显式收窄为
`CheckpointGameWorld`：

```ts
export type CheckpointGameWorld = GameWorld & {
  spawnWithId(entityId: EntityId): EntityId;
};
```

`createWorldCheckpointController(...)` 接受显式 component descriptor 与 entity selector，捕获该 scope 内稳定排序的
entity/component membership。Restore 先完整验证 version、component schema、entity/component identity 和自定义 value，
再删除 scope 内瞬时实体、以 `spawnWithId(...)` 重建缺失实体，并精确恢复组件存在性和值；scope 外实体保持不变。
默认 descriptor 使用 `structuredClone`，需要压缩、迁移或自定义验证的组件通过
`defineWorldCheckpointComponent(...)` 声明 capture/restore/validate。

核心接口：

```ts
export type GameWorld = {
  spawn(): EntityId;
  despawn(entity: EntityId): void;
  has(entity: EntityId): boolean;
  add<T extends object>(entity: EntityId, component: ComponentDef<T>, data?: Partial<T>): void;
  get<T extends object>(entity: EntityId, component: ComponentDef<T>): T | undefined;
  set<T extends object>(entity: EntityId, component: ComponentDef<T>, data: Partial<T>): void;
  remove<T extends object>(entity: EntityId, component: ComponentDef<T>): void;
  query(components?: Array<ComponentDef<any>>): EntityId[];
  count(): number;
};
```

## Adapter 边界

`@gamekits/world-koota`：

- 内部使用 Koota。
- 实现 `CheckpointGameWorld`，public stable id 与 Koota native entity 映射留在 adapter 内。
- 不向公共 API 暴露 Koota 类型。
- 必须通过 world conformance tests，包括 stable-id spawn、精确 component membership、scope 外状态保留和失败前验证。

替换 ECS 时，业务代码不应重写。

## System 边界

高频 gameplay logic 进入 system：

- movement
- render sync
- camera sync
- input command processing
- effect duration tick

低频事实进入 EventBus：

- actor died
- road placed
- clue revealed
- ability activated

## 数据与存档

ECS runtime state 需要可序列化，但序列化不应由 `@gamekits/world` 强行规定全部格式。职责划分：

- `@gamekits/world` 提供基本遍历/组件访问能力。
- `@gamekits/save` 负责 SaveGame schema。
- 游戏模块声明哪些组件可存档、如何迁移。

World runtime checkpoint 与长期 Save schema 不等价。Checkpoint 面向同版本、同 simulation domain 的短期 rewind；
Save 仍负责版本迁移、跨内容版本兼容和业务 identity mapping。

## 性能原则

- 查询需要 adapter 内部优化，不能长期依赖昂贵全量扫描。
- 高频 system 避免大量临时对象。
- EventBus 不广播每帧 component patch。
- benchmark 只做趋势参考，不写死成脆弱测试。

## 最佳实践

### 模块集成

- World adapter 必须持续跑 conformance tests。新增 adapter 时先证明 spawn/despawn/add/get/set/remove/query/count 行为一致，再优化底层性能。
- 游戏或 App Host 集成 World 时只暴露 `GameWorld` facade 给 GameModule，不把 Koota、bitecs 或其他 ECS 后端实例传给业务层。
- Save 集成 World 时通过显式可保存组件和 entity mapping，不让 `@gamekits/world` 强行规定完整存档 schema。
- Multiplayer rollback 集成只把实际参与该 domain 的 entity/component 交给 checkpoint controller；使用独立 Physics
  contributor 时，World contributor 不再重复拥有 Physics component。

### 模块使用

- 业务和游戏模块只依赖 `@gamekits/world` facade，不直接导入 Koota、bitecs 或其他 ECS 后端类型。
- ComponentDef 应表达运行时状态，不要把 DataRegistry document、AssetDefinition、renderer native handle 或 physics backend body/collider handle 直接塞进 component。
- 高频系统中优先复用 query 结果和临时对象；不要在每个 entity 更新中深拷贝、JSON 序列化、动态解析路径或触发 UI 更新。
- 基础 `GameWorld` 的 EntityId 是否可恢复由 adapter capability 决定。短期多人回滚需要 `CheckpointGameWorld` 的
  stable id；跨 save/load、内容版本或场景切换仍使用稳定业务 id 或 Save entity mapping，不依赖 ECS adapter 私有 id。
- System 只处理高频状态推进；actor died、ability activated、resource delivered 等低频事实再发 EventBus，方便 TCA、UI、DevTools 和 Save 观察。
- World snapshot 用于测试和调试时应是稳定派生数据，不暴露 adapter 内部 object、query cache 或底层存储结构。
