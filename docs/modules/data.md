# Data 模块设计

## 定位

Data 是游戏内容定义的统一注册、校验、索引、引用追踪和来源追踪层。它不是某个玩法模块的私有 Map，也不是一套强制开发者遵循的内容模板。

相关包：

- `@gamekits/data`

核心原则：

- 游戏开发者拥有自己的数据模型。GameKits 不强制定义“英雄应该长什么样”“怪物应该有哪些字段”“建筑必须有哪些配置”。
- Data 只提供弱约束：进入 DataRegistry 的数据必须能声明 `type` 和 `id`，并能被对应 DataTypeDefinition 理解。
- DataType 可以由 GameKits 内置，也可以由游戏项目、插件、mod、编辑器工具自由定义。
- DataPack 是数据交付单元，不是内容包模型，也不是内容分类模型。用户可以按英雄、怪物、建筑、关卡、章节、DLC、mod 或任意业务方式组织文件。
- 内置类型是可引用的能力积木，不是必须继承的数据模板。游戏可以定义自己的 `game.hero`，再选择性引用 `gas.actor`、`gas.ability`、`render.object`、`physics.body`、`tca.rule` 等内置类型。
- 资源引用可以作为数据字段存在，但资源加载和状态管理属于 Asset 模块。

## 自由数据模型

Data 模块必须优先服务真实游戏内容生产，而不是要求所有项目先适配框架预设分类。

允许的真实组织方式：

```txt
content/
  heroes/
    ember-knight.ts
    frost-archer.ts
  monsters/
    forest-slime.ts
  buildings/
    stone-workshop.ts
  chapters/
    chapter-01.ts
```

一个业务文件里可以混合多种数据：

```ts
export const emberKnightEntries = [
  { type: "game.hero", id: "hero.ember_knight", data: { ... } },
  { type: "gas.actor", id: "actor.ember_knight", data: { ... } },
  { type: "gas.ability", id: "ability.flame_guard", data: { ... } },
  { type: "render.object", id: "render.hero.ember_knight", data: { ... } },
  { type: "physics.body", id: "physics.hero.ember_knight", data: { ... } },
  { type: "tca.rule", id: "rule.ember_knight.low_health_guard", data: { ... } },
];
```

也允许一个 DataPack 只包含某类数据，例如纯 localization、纯 map、纯 mod manifest。GameKits 不从文件夹、文件名或 DataPack id 推断业务语义。

## DataType

DataType 是加载器和运行时理解数据的入口。它只说明某一类数据如何校验、归一化、提取引用和建立索引，不规定用户必须如何组织内容。

```ts
export type DataTypeId = string;
export type DataId = string;

export type DataKey<TType extends DataTypeId = DataTypeId> = {
  type: TType;
  id: DataId;
};

export type DataTypeDefinition<TData> = {
  type: DataTypeId;
  validate?: DataValidator<TData>;
  normalize?: DataNormalizer<TData>;
  references?: DataReferenceExtractor<TData>;
  indexes?: DataIndexDefinition<TData>[];
  metadata?: Record<string, unknown>;
};
```

类型命名应使用命名空间，避免不同游戏、mod 或插件冲突：

- GameKits 内置类型：`asset.definition`、`render.object`、`physics.material`、`physics.body`、`physics.collider`、`tca.rule`、`gas.actor`、`gas.ability`、`gas.effect`。
- 游戏自定义类型：`game.hero`、`game.monster`、`game.building`、`game.quest`、`game.biome`。
- 工具或插件类型：`editor.brush`、`mod.manifest`、`localization.bundle`。

DataRegistry 不硬编码 gameplay 类型。模块或项目通过注册 `DataTypeDefinition` 扩展能力。

## DataDocument

DataDocument 是 DataRegistry 的最小注册单位。每条文档必须声明自己的 `type`，加载器只需要知道“这条数据是什么类型”，不需要理解用户的目录分类。

```ts
export type DataDocument<TData = unknown> = {
  type: DataTypeId;
  id: DataId;
  data: TData;
  sourcePackId?: string;
  namespace?: string;
  priority?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
};
```

DataDocument 的 `data` 字段完全由对应 DataTypeDefinition 解释。GameKits 不要求 `game.hero` 必须引用 GAS，也不要求 `game.monster` 必须有 health、level、loot、sprite 等字段。这些都是游戏自己的设计。

## DataPack

DataPack 是数据交付单元。它负责把一批已物化的数据交给 DataRegistry，并保留来源、版本、优先级和依赖信息。它不表达“这是英雄域、怪物域、建筑域”这种业务分类，也不代表完整 Content Package；这类分类由用户自己的数据类型、文件目录、tag 或编辑器项目结构表达。

```ts
export type DataPack = {
  id: string;
  version: string;
  namespace?: string;
  priority?: number;
  entries: DataPackEntry[];
  dependencies?: DataPackDependency[];
  patches?: DataPatch[];
  metadata?: Record<string, unknown>;
};

export type DataPackEntry<TData = unknown> = {
  type: DataTypeId;
  id: DataId;
  data: TData;
  namespace?: string;
  priority?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
};
```

DataPack 的职责是运输数据和追踪数据来源，不是替用户设计内容分类。一个 DataPack 可以代表：

- 基础游戏数据。
- 某个章节的数据 section。
- 某个英雄包的数据 section。
- 某个 mod 的数据 section。
- 某个编辑器导入批次的数据 section。
- 某个远程活动配置的数据 section。

## DataPack 与 Content Package 边界

Data 模块只处理已经物化的 DataPack 对象。它不负责发现内容来源、读取文件、解压内容包、解析远程 manifest、处理权限、执行脚本或挂载资源文件。

长期边界：

```txt
Content Package / App Host profile / Editor / Test Fixture
→ materialized DataPack[]
→ DataRegistry.registerPack(...)
```

因此 `@gamekits/data` 不定义 `DataPackSource`、`DataPackLoader` 或 `DataPackManifest`。这些概念属于未来 Content Package System、平台 adapter、编辑器导入器或 app/profile 层。

DataPack 可以携带轻量元数据，例如 source pack id、namespace、priority、metadata。若未来保留 DataPack 间顺序依赖，它只表达 DataRegistry 注册顺序约束，不表达文件加载、内容包依赖、资源挂载或 mod 权限。

DataRegistry 职责保持稳定：

- 校验 unknown type。
- 校验 duplicate `type + id`。
- normalize / validate / references / indexes。
- 构建 reference graph。

这个边界避免 Data 模块变成泛化内容包系统。未来 Content Package 可以把 data section 解包成 DataPack，再交给 DataRegistry；DataRegistry 不需要知道这些 DataPack 来自 DLC、mod、远程活动、编辑器工作区还是测试夹具。

## DataRef

DataRef 是跨数据的标准引用形态。它是类型化字段，不是 DataPack 组织约束。

```ts
export type DataRef<TType extends DataTypeId = DataTypeId> = {
  type: TType;
  id: DataId;
};
```

示例：

```ts
export type HeroDefinition = {
  displayName: string;
  actor?: DataRef<"gas.actor">;
  abilities?: DataRef<"gas.ability">[];
  renderObject?: DataRef<"render.object">;
};
```

这个示例不是模板，只是说明引用方式。真实游戏可以把 hero 写成卡牌、单位、建筑、技能树节点、叙事角色或完全不同的结构。

## 外部引用

DataTypeDefinition 可以提取 DataRef，也可以提取其他轻量引用，例如资源引用。DataRegistry 负责记录引用事实和来源位置，但不负责加载图片、音频或模型。

```ts
export type ExternalDataReference = {
  category: "data" | "asset" | "custom";
  target: string;
  path?: string;
  metadata?: Record<string, unknown>;
};
```

Asset 相关引用的长期设计见 `docs/modules/assets.md`。资源目标可以来自同一个 DataPack，也可以来自独立资源包、DLC、mod、远程 manifest 或编辑器工作区。

## DataRegistry

职责：

- register DataTypeDefinition
- register DataPack
- normalize documents
- validate documents
- track source pack / namespace / priority
- query by type/id/tag/source/index
- build reference graph
- report duplicate id、missing reference、unknown type、schema error

默认策略：

- 未注册 DataType 默认报错。
- 编辑器、导入器或 mod 工具可以显式开启 unknown type 暂存模式，但 runtime 默认不允许 unknown type 静默进入游戏。
- 同一 `type + id` 重复注册默认报错；允许 override 时必须记录来源和优先级。
- DataTypeDefinition 的 `indexes` 面向运行时查询性能，不决定用户文件组织方式。

DataRegistry 不加载图片、音频或模型；这些由 AssetManager 和 adapter 处理。

## 加载流程

```txt
register DataTypeDefinition
→ parse user/project content into DataPack entries
→ register DataPack
→ resolve entry type
→ normalize document
→ validate document
→ extract references
→ register document
→ build indexes
→ validate reference graph
→ expose snapshot/query API
```

加载器只需要识别 DataPack、DataPackEntry、DataTypeDefinition 和引用提取结果。用户自己的 hero、monster、building、level 文件结构不应该进入框架核心。

## Diagnostics

Data 诊断必须优先服务真实内容生产中的定位问题。错误不能只说“引用缺失”，而要能定位到内容来源和字段。

Data loading / registry diagnostics 应尽量包含：

- source id / source type
- loader id
- pack id / pack version
- entry type
- entry id
- field path
- target key
- stable error code

App Host、DevTools 和编辑器可以消费这些诊断并组织 UI，但诊断事实本身应由 Data loading pipeline 和 DataRegistry 产生。

## 与内置模块的关系

TCA、GAS、Renderer、Physics、Asset 都可以提供内置 DataTypeDefinition，但它们不限制游戏数据模型。

例如游戏可以定义 `game.hero`，其中引用 `gas.actor`、`gas.ability` 和 `tca.rule`；也可以完全不定义 hero 类型，而直接用 GAS actor 数据驱动生成实体。

模块只读取自己关心的 DataType：

- TCA 读取 `tca.rule`。
- GAS 读取 `gas.actor`、`gas.ability`、`gas.effect`。
- Renderer sync 读取 `render.object` 或游戏自定义 presentation 类型。
- Physics module 读取 `physics.material`、`physics.body`、`physics.collider` 或游戏自定义 spawn/archetype 类型。
- AssetManager 读取 `asset.definition` 或外部注册的同形资源定义。

## 校验重点

- duplicate `type + id`
- unknown data type
- schema error with field path
- missing DataRef
- missing external reference target
- override / priority 冲突
- patch target missing

校验错误必须报告 source pack、entry type、entry id、字段路径和目标 key。数据驱动越自由，错误定位越重要。

## 最佳实践

### 模块集成

- App/profile/content package 负责注册 DataTypeDefinition、接收或物化 DataPack，并把它们注册进 DataRegistry；业务系统日常只读取稳定 registry。
- Content Package 到来后，Data loader 只接收已经从内容包 section 中物化出的 DataPack；不要在 DataRegistry 里提前实现资源、脚本、权限或包挂载系统。
- DataTypeDefinition 的 `normalize`、`validate`、`references` 和 `indexes` 应保持纯数据处理，不读取 DOM、renderer、Platform FS 或外部 runtime。

### 模块使用

- 游戏开发者可以自由定义 `game.hero`、`game.monster`、`game.building`、`game.dialogue` 等 DataType；框架只要求注册、校验、引用和诊断，不要求套内置模板。
- DataPack 应按真实业务内容组织，而不是为了框架方便按全局类型大表拆散。一个业务文件可以同时包含 `game.hero`、`gas.actor`、`render.object` 和 `asset.definition`。
- Runtime system 不应把运行时状态写回 DataRegistry。DataRegistry 是定义来源，World/GAS/TCA/Save 才是运行态。
- 引用校验优先给出人能修文件的信息：source pack、entry type、entry id、字段 path、目标 type/id。
- 查询热点应通过 indexes 或预编译结构解决，不要让 runtime 每帧扫描所有 documents 或做动态 JSON path 匹配。
