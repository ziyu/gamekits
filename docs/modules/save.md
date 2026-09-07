# Save 模块设计

本文档只描述 Save / Load / Migration 的长期模块设计，不记录当前实现状态、阶段计划或 TODO。具体工作流状态放在任务系统、PR 或 `../implementation/`。

## 定位

Save 负责游戏长期状态的捕获、序列化、持久化、恢复、版本迁移和诊断。它让真实游戏可以在不同平台上可靠保存进度，并能随着游戏和框架版本演进迁移旧存档。

相关包：

- `@gamekits/save`
- `@gamekits/platform-core`
- `@gamekits/app-host`

协作包：

- `@gamekits/game-runtime`
- `@gamekits/world`
- `@gamekits/data`
- `@gamekits/asset`
- `@gamekits/tca`
- `@gamekits/gas`
- `@gamekits/physics-core`
- `@gamekits/ui-core`

Save 不是 DataPack、Content Package、Asset bundle 或编辑器工程文件。Save 保存一次游戏会话的长期运行状态；DataPack / Content Package 保存内容定义和资源分发；编辑器工程保存创作状态。

## 设计目标

- 统一 save / load / list / delete / migrate / inspect 能力。
- 支持 Web、Tauri 和未来平台，不直接依赖 localStorage、Tauri FS 或浏览器私有 API。
- 通过 module contributor 机制保存 World、GameRuntime、TCA、GAS、Physics 和游戏自定义状态，避免 `@gamekits/save` 依赖具体 gameplay 包。
- 支持版本迁移，旧存档缺失迁移路径时给出明确错误。
- 支持固定 seed 下 save/load 后继续 tick 的确定性验证。
- 支持 slot metadata、diagnostics、checksum / corruption detection 和 DevTools 可见性。
- 默认存储格式稳定、可调试、可迁移；压缩、加密和云同步作为 adapter / codec 扩展，不进入核心默认假设。

## 非目标

- 不保存 Phaser、Three.js、DOM、React component 或 native renderer handle。
- 不把完整 Asset binary、DataPack 内容或 Content Package payload 嵌入普通存档。
- 不负责云同步、冲突合并、多人回放、反作弊、平台成就或账号系统。
- 不要求所有游戏状态都自动可序列化；游戏必须显式注册保存贡献者。
- 不把 SaveRuntime 放进 GameRuntime 顶层。Save 由 App Host service 持有，通过标准 GameModule / contributor bridge 与游戏会话协作。

## 核心模型

Save 分为四层：

```txt
SaveManager
  -> SaveStore / SaveCodec / MigrationRegistry
  -> SaveContributors
  -> PlatformStorage / PlatformFileSystem
```

- `SaveManager`：面向 App Host 和游戏 app 的统一入口。
- `SaveStore`：slot 列表、读取、写入、删除和元数据存储。
- `SaveCodec`：序列化、反序列化、校验、可选压缩或加密。
- `SaveMigrationRegistry`：版本迁移路径查找和执行。
- `SaveContributor`：各模块声明如何捕获和恢复自己的状态。

## Save Envelope

存档文件应有稳定 envelope，用于在不完全解析 payload 的情况下读取元数据、版本、校验和兼容性。

```ts
export type SaveVersion = string;
export type SaveSlotId = string;

export type SaveEnvelope<TPayload = unknown> = {
  format: "gamekits.save";
  formatVersion: SaveVersion;
  appId: string;
  gameId: string;
  gameVersion: string;
  createdAt: number;
  updatedAt: number;
  slot: SaveSlotMetadata;
  compatibility: SaveCompatibilityMetadata;
  checksum?: string;
  payload: TPayload;
};

export type SaveSlotMetadata = {
  id: SaveSlotId;
  label?: string;
  description?: string;
  playtimeMs?: number;
  screenshotAssetId?: string;
  tags?: string[];
};

export type SaveCompatibilityMetadata = {
  frameworkVersion?: string;
  dataRevision?: string;
  contentPackages?: Array<{
    id: string;
    version: string;
    optional?: boolean;
  }>;
  requiredCapabilities?: string[];
};
```

`formatVersion` 描述 Save schema 版本，不等同于 game version。`gameVersion` 可以辅助 UI 和诊断，但迁移应以 `formatVersion` 和 payload schema 版本为准。

## Save Payload

推荐的标准 payload 是按 contributor 分区的结构，而不是一个硬编码巨型 schema。

```ts
export type SavePayload = {
  runtime: RuntimeSaveSection;
  sections: Record<string, SaveSection>;
  custom?: Record<string, unknown>;
};

export type RuntimeSaveSection = {
  seed: string;
  clock: {
    ticks: number;
    elapsed: number;
  };
  rng?: unknown;
};

export type SaveSection<TData = unknown> = {
  id: string;
  version: SaveVersion;
  data: TData;
};
```

长期保留的常见 section id：

- `runtime`：seed、clock、rng state。
- `world`：可保存 entity/component 状态。
- `tca`：once-rule、cooldown、runtime-local rule state。
- `gas`：actor attributes、tags、cooldowns、active effects。
- `physics`：可恢复 body/collider 状态、稳定 entity mapping、sleep state。
- `camera`：可选镜头状态，通常只保存玩家偏好或当前视角。
- `ui`：可选 UI layout / open panels，不保存 React component state。
- `game.*`：具体游戏自定义状态。

继续游戏型存档必须恢复 runtime clock。也就是说，如果玩家在 tick 1587 保存并刷新页面后加载同一 slot，加载后的 GameRuntime clock 应回到 tick 1587，再从 1588 继续推进。Checkpoint、debug snapshot 或 settings-only save 可以通过 contributor selection 保存不同范围，但普通 progress save 不应丢失 tick / elapsed，否则 TCA interval、cooldown、periodic effect 和 autosave 诊断都会产生时间线偏移。

`@gamekits/save` 只定义 section 协议，不直接理解 `gas`、`tca` 或具体游戏 section 的内部结构。

## Save Contributor

模块通过 contributor 显式声明 capture / restore / validate 行为。

```ts
export type SaveContributor<TData = unknown> = {
  id: string;
  version: SaveVersion;
  order?: number;
  scope?: string;
  tags?: string[];
  saveByDefault?: boolean;
  capture(
    ctx: SaveCaptureContext
  ): SaveSection<TData> | undefined | Promise<SaveSection<TData> | undefined>;
  restore?(ctx: SaveRestoreContext, section: SaveSection<TData>): void | Promise<void>;
  validate?(section: SaveSection<TData>, ctx: SaveValidationContext): SaveValidationResult;
};
```

设计规则：

- Contributor id 必须稳定，例如 `world`, `physics`, `gas`, `tca`, `game.inventory`。
- Contributor 应声明 `scope` 和 `tags`，例如 `world`、`gameplay`、`camera`、`ui-preferences`，方便 app、DevTools 或 autosave 策略决定保存范围。
- `saveByDefault: false` 只用于 debug、presentation、cache 或可重建状态；核心进度默认应可保存。
- Capture 不应读取 renderer native object、DOM 或 React internal state。
- Capture 默认不应保存当前选中对象、hover/focus target、确认弹窗状态、按键 held state 等即时交互上下文；这些状态只在游戏明确把它们转化为长期玩法事实时才应进入进度存档。
- Restore 应可重复推理，不能隐式启动 runtime tick。
- Restore 顺序按 contributor dependency / order 执行，World 通常早于 Physics、GAS/TCA。
- 缺失 optional section 可以降级；缺失 required section 必须报错。
- 高频临时缓存、pathfinding cache、render patch cache 不进入存档，恢复后由系统重建。

各模块的关系：

- `@gamekits/save` 提供 contributor 协议和 manager。
- `@gamekits/gas` 可以提供 `createGasSaveContributor()`。
- `@gamekits/tca` 可以提供 `createTcaSaveContributor()`。
- `@gamekits/physics-core` 可以提供 `createPhysicsSaveContributor()`。
- `@gamekits/camera-core` 可以提供可选 camera state contributor。
- 游戏项目提供 `game.*` contributor。

这样可以避免 `@gamekits/save` 直接依赖 GAS/TCA/Camera，也避免每个游戏在 app 入口手写保存流水线。

领域包只依赖 `@gamekits/save` 的稳定 contributor/section/context 类型，不依赖 SaveManager、store 或平台实现。标准 gameplay contributor 使用 module-bound handle 捕获和恢复状态，默认顺序是 World identity → Physics (`200`) → GAS (`300`) → TCA (`400`) → app gameplay；restore 本身不启动 tick，组合层恢复 runtime clock 后再 resume。

## 保存范围策略

真实游戏不会每次都保存所有内容。手动存档、自动存档、关卡 checkpoint、调试快照和云同步可能需要不同范围。

SaveManager 应支持全局 contributor policy 和单次操作 selection：

```ts
export type SaveContributorSelection = {
  includeIds?: string[];
  excludeIds?: string[];
  includeTags?: string[];
  excludeTags?: string[];
  includeScopes?: string[];
  excludeScopes?: string[];
};

export type SaveContributorPolicy = SaveContributorSelection & {
  defaultIncluded?: boolean;
};
```

规则：

- 全局 policy 表达游戏默认保存策略，例如排除 `presentation`、`debug`、`cache`。
- 单次 save/load selection 表达本次操作范围，例如只保存 `checkpoint` 或只恢复 `settings`。
- `exclude*` 永远优先于 `include*`。
- 被排除的 required contributor 不应阻止本次操作；required 只对本次选中的 contributor 生效。
- Save selection 只决定 contributor 是否执行，不改变 SaveEnvelope schema；存档里仍以 section id 隔离不同模块。

## World 保存边界

World 保存是最容易膨胀的部分，必须显式声明可保存组件。

长期建议：

```ts
export type WorldSaveComponentDefinition<TData = unknown> = {
  componentId: string;
  version: SaveVersion;
  capture(entity: EntityId, value: TData, ctx: SaveCaptureContext): unknown;
  restore(entity: EntityId, data: unknown, ctx: SaveRestoreContext): TData;
};
```

World section 不保存具体 ECS adapter 内部结构，也不保存 Koota object、query cache 或 entity table 私有状态。

World section 应保存：

- stable entity key / runtime entity mapping。
- 已声明可保存的 component 数据。
- entity 之间的引用关系，使用稳定 id 而不是 adapter 内部引用。
- spawn archetype 或 data definition id，用于恢复结构。

World section 不应保存：

- query cache。
- renderer object handle。
- physics broadphase cache。
- transient interpolation state。
- one-frame commands。

EntityId 是否稳定由游戏决定。框架应支持两种模式：

- stable id 模式：entity 有长期 id，save/load 后保留该 id。
- remap 模式：load 时重新创建 entity，SaveRestoreContext 提供 old → new mapping。

GAS actor、TCA trace、renderer presentation 等引用 entity 时，必须通过 mapping 恢复。

## Data / Asset 关系

Save 不复制 DataRegistry 的全部内容。存档只记录运行时状态和必要引用：

- Data entry 通过 `{ type, id, version? }` 或业务字段引用。
- Asset 通过 `assetId` 或 DataRef 引用。
- Content package 未来通过 package id / version 记录兼容性。

Load 时应先准备 Data / Asset / Content 环境，再 restore runtime state。缺失 Data entry、Asset definition 或 Content package 时，SaveManager 给出 compatibility diagnostic，由 app 决定拒绝加载、降级加载或提示用户安装内容。

## Store 与 Platform

SaveStore 负责持久化，不直接暴露 localStorage 或 Tauri FS。

```ts
export type SaveStore = {
  list(): Promise<SaveSlotSummary[]>;
  read(slotId: SaveSlotId): Promise<Uint8Array>;
  write(slotId: SaveSlotId, data: Uint8Array, metadata: SaveSlotMetadata): Promise<void>;
  delete(slotId: SaveSlotId): Promise<void>;
  exists(slotId: SaveSlotId): Promise<boolean>;
};
```

标准 store：

- `PlatformStorageSaveStore`：适合 Web local storage / key-value storage，小型存档。
- `PlatformFileSaveStore`：适合 Tauri / desktop / large save，默认路径 `appData/saves`。
- `MemorySaveStore`：适合测试。

路径策略：

- saves：`appData/saves`
- autosaves：`appData/saves/autosave`
- settings：不属于 SaveGame，通常放 `appConfig/settings`
- thumbnails：可放 `appCache/save-thumbnails` 或作为 asset id 引用

写入规则：

- File store 使用单个 `.slot` 记录封装 opaque bytes 与 summary，先写临时文件，再通过 Platform 原子替换同时提交数据和 metadata。缺少 replaceFile/remove 能力时在写入前报错。旧 `.save` / `.json` 保持读取兼容，新记录优先；删除同时清理旧副本。
- File store 写入/替换失败不能破坏已有可读存档。PlatformStorage store 的修改在共享平台对象的包装实例间串行化，但多 key 存储不提供崩溃或跨窗口事务保证。
- Store 层报告权限、容量、路径不可用、编码失败等稳定错误。

## Codec

SaveCodec 负责 envelope 编码、解码和校验。

```ts
export type SaveCodec = {
  encode(envelope: SaveEnvelope): Promise<Uint8Array> | Uint8Array;
  decode(data: Uint8Array): Promise<SaveEnvelope> | SaveEnvelope;
};
```

默认 codec：

- JSON UTF-8。
- 稳定字段名。
- 可读性优先。
- checksum 可选但推荐。

扩展 codec：

- compressed JSON。
- binary codec。
- encrypted codec。
- platform cloud codec。

加密和压缩不改变 contributor 协议，只改变 store payload。

## Migration

MigrationRegistry 管理 schema 迁移。

```ts
export type SaveMigration = {
  id: string;
  from: SaveVersion;
  to: SaveVersion;
  migrate(envelope: SaveEnvelope): SaveEnvelope | Promise<SaveEnvelope>;
};

export type SaveMigrationRegistry = {
  register(migration: SaveMigration): void;
  plan(from: SaveVersion, to: SaveVersion): SaveMigration[];
  migrate(envelope: SaveEnvelope, to: SaveVersion): Promise<SaveEnvelope>;
};
```

要求：

- 未知版本给明确错误。
- 缺失迁移路径给明确错误。
- 迁移必须是可测试的纯数据转换，不启动 GameRuntime，不读取 renderer。
- 每个 migration 应尽量小步前进，例如 `1.0.0 -> 1.1.0`。
- Migration 可以更新 envelope、payload section 版本和 section data。
- Contributor 可以提供 section-level migration，但 SaveMigrationRegistry 负责全局迁移编排。

迁移失败后原始存档必须仍可保留，除非用户显式确认覆盖。

## SaveManager

SaveManager 是 App Host 暴露的标准 service。

```ts
export type SaveManager = {
  registerContributor(contributor: SaveContributor): void;
  unregisterContributor(id: string): void;
  list(): Promise<SaveSlotSummary[]>;
  save(slotId: SaveSlotId, options?: SaveOptions): Promise<SaveResult>;
  load(slotId: SaveSlotId, options?: LoadOptions): Promise<LoadResult>;
  delete(slotId: SaveSlotId): Promise<void>;
  inspect(slotId: SaveSlotId): Promise<SaveInspection>;
  snapshot(): SaveManagerSnapshot;
};
```

Save 流程：

```txt
read runtime/app metadata
-> run contributors.capture in order
-> assemble envelope
-> encode + checksum
-> write via SaveStore
-> emit diagnostics / low-frequency events
```

Load 流程：

```txt
read bytes from SaveStore
-> decode envelope
-> verify checksum / compatibility
-> migrate if needed
-> stop or pause runtime if required
-> restore contributors in order
-> rebuild transient caches
-> emit diagnostics / low-frequency events
```

SaveManager 不直接 tick GameRuntime。App Host 或 game app 决定保存前是否 pause，以及 load 后是否 resume。

## App Host 集成

Save 是混合能力：存储、codec、slot 管理属于 App Service；capture/restore 需要 GameRuntime 和 GameModule contributor。

App Host 可以提供 `services.save` 标准入口：

```txt
platform
-> data / assets
-> game
-> save
-> ui / devtools
```

设计原则：

- App Host 管理 SaveManager lifecycle 和 store/codec/migration registry。
- App Host 提供可配置的 contributor service context，默认只暴露 Data、Assets 和 GameRuntime；Renderer、Input、UI、Platform 等运行时对象需要显式 opt-in。
- GameRuntime 不直接依赖 Platform 或 SaveStore。
- 标准 GameModule helper 可以把 TCA/GAS/Camera/game contributors 注册到 SaveManager。
- Headless 测试可以使用 MemorySaveStore 和 deterministic clock。
- UI / DevTools 通过 `services.save.snapshot()` 和 diagnostics 展示存档状态。

## Event 与 Diagnostics

Save 可以向 EventBus 或 Host diagnostics 发送低频事实：

- `save.started`
- `save.completed`
- `save.failed`
- `load.started`
- `load.completed`
- `load.failed`
- `save.migration_applied`

Event payload 不应包含完整存档数据、敏感内容或大对象。详细错误应进入 diagnostics。

诊断信息至少包含：

- slot id
- phase：capture / encode / write / read / decode / migrate / restore
- contributor id
- error code
- path / section id
- compatibility issue

## 错误模型

稳定错误码建议：

- `save.slot_missing`
- `save.slot_duplicate`
- `save.store_unavailable`
- `save.permission_denied`
- `save.encode_failed`
- `save.decode_failed`
- `save.corrupted`
- `save.unsupported_version`
- `save.migration_missing`
- `save.migration_failed`
- `save.compatibility_failed`
- `save.contributor_missing`
- `save.contributor_failed`
- `save.restore_failed`

错误必须带上下文，但不能把完整 payload 打进普通日志。

## 确定性

确定性是 Save 的核心验收要求。

测试策略：

1. 固定 seed 启动 runtime。
2. tick N 次。
3. save。
4. 在新 runtime 中 load。
5. 继续 tick M 次。
6. 与未中断 runtime 的 snapshot 对比。

对比应使用稳定 snapshot，不依赖 renderer native handle、DOM、绝对时间或随机 test 环境。

## 安全与隐私

- 普通存档不应记录用户本地绝对路径，除非该路径是用户显式选择的外部资源引用。
- EventBus 不发送完整存档。
- DevTools 展示存档内容时应能隐藏敏感字段。
- 加密不是默认要求，但 SaveCodec 必须允许扩展。
- Cloud save / remote sync 必须作为 store 扩展，并处理冲突、身份和网络失败。

## 测试要求

单元测试：

- SaveManager contributor 注册、捕获、恢复顺序。
- SaveStore list/read/write/delete。
- JSON codec decode/encode/corruption error。
- MigrationRegistry plan / migrate / missing path。
- 错误码和 diagnostics。

集成测试：

- fixed seed save/load/tick continuation。
- World entity remap。
- Physics body/collider restore and backend cache rebuild。
- GAS attributes/tags/effects restore。
- TCA once-rule/cooldown restore。
- Platform memory/web store。
- App Host `services.save` lifecycle snapshot。

边界测试：

- Save 包不依赖 Phaser、React、Koota、Tauri adapter 或具体 game app。
- Renderer native handle 不进入 save payload。
- Physics backend native handle、broadphase cache、manifold 和 solver cache 不进入 save payload。
- Asset/Data 通过 id/version/reference 恢复，不复制完整定义或资源 payload。

## 最佳实践

### 模块集成

- SaveManager、SaveStore、SaveCodec、migration registry、contributor policy 和 service context 由 App Host/app profile 组合；GameRuntime 不直接依赖 PlatformStorage、PlatformFileSystem 或 SaveStore。
- Contributor 负责具体模块 capture/restore，SaveManager 不直接理解 World/GAS/TCA/Camera 或游戏组件结构。
- Load 时先准备 Data/Asset/Content 环境，再恢复 runtime state。缺失内容包、Data entry 或 Asset definition 应形成 compatibility diagnostic。
- 测试必须覆盖固定 seed save/load/tick continuation、corrupted payload、missing slot、unsupported version、missing migration、contributor selection/policy 和 excluded UI/transient state。

### 模块使用

- Load 在任何 restore 前完整预检选中 contributor：envelope 结构、appId/gameId、迁移结果、必需 section、section id/version 和 validate。section 版本必须精确匹配，升级通过迁移显式完成；未选中 contributor 不参与恢复校验。业务内容包与平台 capability 的兼容策略由 app/contributor 校验提供。
- 预校验失败不调用任何 restore；restore 自身异常不保证全局回滚。需要事务性恢复的 app 应在隔离会话中 staging，或销毁失败会话后重建，不能继续使用半恢复的游戏。

- 普通继续游戏存档保存长期玩法事实和 runtime clock。tick 1587 保存后，加载同一 slot 应回到 tick 1587，再从后续 tick 继续推进。
- 不保存当前选中目标、hover/focus target、confirm UI 交互上下文、held input、Timeline 日志、React component state、renderer native handle、adapter cache 或 pathfinding cache。
- 每个 contributor 必须有稳定 id、version、scope、tags、validate 和可定位 diagnostics；capture/restore 失败必须能定位到 contributor、section 和 path。
- Save payload 引用 Data、Asset、Content Package 时使用 id/version/compatibility metadata，不复制完整 DataPack、Asset binary 或内容包 payload。

## IndexedDB adapter 与可恢复进度

`@gamekits/save-indexeddb` 提供 `createIndexedDbSaveStore({ databaseName, indexedDB?, maxSaveBytes?, onDiagnostic? })`。它只在首次操作时打开数据库，使用原生事务保存 slot 的 current、metadata、backup 和 revision；`dispose()` 关闭连接，versionchange 自动释放旧连接。

所有写入/删除在 readwrite transaction 内比较实际 revision。新槽可直接写；已有槽覆盖前必须 read/load/inspect，list/exists 不更新已接受的 revision。其他窗口提交后，旧连接写入返回 `save.write_conflict`，调用方必须重新读取并由应用决定采用哪个进度。同一 store 内修改串行化；失败写入不会推进已接受的 revision。

完整性摘要覆盖 bytes 和 metadata。主版本损坏时 read/list 选择上一有效版本并发出 `save.backup_recovered`，不会在读取时覆盖数据库；下次提交只保留有效备份。两个版本都损坏时，该槽读取失败且不影响其他可读槽的列表。`SaveStore.readBackup` 是可选扩展，`SaveManager.load(id, { backup: true })` 显式读取上一版；没有能力时返回 `save.backup_unsupported`。

`save.size_exceeded` 表示超过配置的单份字节上限；`save.quota_exceeded` 表示平台空间不足。两者都保留旧记录，应用应提供可见反馈，不能无限重试。备份只保留一代；浏览器持久性、导出及云同步策略由应用选择，旧 storage/file 槽位不自动迁移。

`SaveManager.restore(envelope, { contributors? })` 对隔离副本执行身份、目标 formatVersion、完整 contributor 预校验和恢复。它复用 load 的恢复链路，不再读取 store，也不隐式迁移。候选会话通常接收来源 manager 用 `load(..., { restore: false })` 已经读取并迁移的 envelope。App Host 的切换组合见 `docs/modules/app-host.md`。

### 模块集成

- IndexedDB adapter 是独立具体包；通过标准 Save service 的 store 选项注入，并由 owning app 关闭连接，不能把 IDBFactory/transaction 暴露给 contributor。
- 候选会话必须拥有独立 World/Physics/GAS/TCA 可变状态；存储连接可以由应用共享，但不能共享 SaveManager。候选构造期间失败的局部资源由工厂自行清理。
- `onDiagnostic` 和 `onDiagnosticError` 都是旁路，失败不改变提交结果。SaveManager diagnosticLimit 默认 200，诊断存储有界。
- 迁移 storage/file 到 IndexedDB 时，先读取和验证旧数据，成功提交新槽后再由应用显式决定是否删除旧槽。

### 模块使用

- 写入冲突代表当前会话落后于存储进度；重新读取前不要自动重试覆盖。备份恢复也应向玩家显示发生了进度回退。
- 用 backup 选项恢复逻辑上不需要的最近一次保存；它与完整性损坏后的自动回退是不同入口。
- 从已有游戏恢复时优先使用候选会话 helper；直接向当前会话 restore 仍可能发生部分副作用，不承诺事务回滚。
