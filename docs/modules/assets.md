# Assets 模块设计

## 定位

Assets 负责资源声明、来源解析、加载状态、adapter 委托和低频诊断。它不负责定义英雄、怪物、建筑、规则或任意 gameplay 数据结构。

相关包：

- `@gamekits/asset`
- `@gamekits/driver-phaser`
- `@gamekits/driver-three`

核心原则：

- Asset 是资源运行时，不是内容数据模型。
- AssetDefinition 可以作为 `asset.definition` DataType 注册进 DataRegistry，也可以由编辑器、导入器、远程 manifest 或测试夹具直接提供给 AssetManager。
- 游戏数据通过显式 AssetRef 引用资源，不直接引用 URL。
- 资源定义不要求和引用它的数据位于同一个 DataPack。
- Asset adapter 只接收资源定义和加载请求，不读取整个 DataPack，不管理 gameplay definitions。

## AssetRef

AssetRef 是数据字段中的轻量资源引用。

```ts
export type AssetRef<TAssetType extends AssetType = AssetType> = {
  assetId: string;
  type?: TAssetType;
  variant?: string;
};
```

示例：

```ts
export type HeroVisuals = {
  portrait: AssetRef<"image">;
  model?: AssetRef<"model">;
  voiceBank?: AssetRef<"audio">;
};
```

AssetRef 只表达引用，不表达资源必须在哪里定义。资源可以来自基础包、DLC、mod、远程 manifest、平台 resource 或编辑器工作区。

## AssetDefinition

AssetDefinition 描述资源是什么、从哪里来、如何加载，但不代表资源已经进入 renderer、audio backend 或 GPU。

```ts
export type AssetType =
  | "image"
  | "spritesheet"
  | "atlas"
  | "audio"
  | "json"
  | "tilemap"
  | "font"
  | "shader"
  | "model"
  | "texture"
  | "custom";

export type AssetDefinition = {
  id: string;
  type: AssetType;
  source: AssetSource;
  group?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  preload?: boolean;
  lazy?: boolean;
  frame?: SpritesheetFrameConfig;
  atlas?: AtlasAssetMetadata;
  audio?: AudioAssetMetadata;
  variants?: Record<string, AssetVariantDefinition>;
  animations?: AssetAnimationManifest[];
};
```

`asset.definition` 是 GameKits 内置 DataType。DataRegistry 负责校验定义、追踪来源和引用关系；AssetManager 负责加载状态。

Atlas metadata 只描述 atlas data source，Audio metadata 只描述可选格式 source 与实例策略，Animation manifest 只描述 clip/frame range；这些字段都保持 backend-neutral。`variants` 可以按 profile 替换 source 和附加 metadata，`resolveAssetVariant(...)` 只解析声明，不加载资源。DataType 必须校验 source、frame、variant key、audio source 和 animation id/range 的有效性，native texture、frame、sound 或 animation object 不进入 AssetDefinition。

## AssetSource

资源来源要兼容 Web、Tauri、编辑器和 Mod。

```ts
export type AssetSource =
  | { type: "url"; url: string }
  | { type: "platform-file"; path: string; baseDir: FsBaseDir }
  | { type: "resource"; path: string }
  | { type: "memory"; data: Uint8Array; mimeType?: string };
```

AssetSource 只描述来源，不直接暴露平台私有 API。具体解析由 Platform service 或 asset adapter 完成。

## AssetManager

职责：

- 从 DataRegistry 读取 `asset.definition`。
- register assets from manifest/editor/importer。
- lookup asset。
- load group。
- load single asset。
- track loading state。
- unload/retry where adapter supports it。
- emit low-frequency asset events。
- expose asset snapshot for UI/DevTools。

AssetManager 只保存运行时加载状态，例如 registered、loading、loaded、failed。它不替代 DataRegistry，也不保存 Actor、Ability、Rule 等 gameplay definition。

注册时 AssetManager 持有 AssetDefinition 的隔离副本，lookup/snapshot 和 adapter 调用也不暴露内部可变定义。同一 asset 的并发 load 合并为一个 in-flight adapter 请求；diagnostic observer/error reporter 的异常不改变 register/load 结果。

AssetManager 也不是 Content Package manager。它读取资源定义、解析资源来源、委托 adapter 加载资源；实际资源文件可能来自 URL、platform resource、编辑器 workspace、远程 CDN 或未来 Content Package mount。Asset 模块只关心最终可解析的 AssetDefinition / AssetSource，不关心内容包如何被发现、启用或卸载。

## Preload Plan

AssetManager 应能从已注册的 `asset.definition` 生成 preload plan。preload plan 是资源运行时计划，不是 DataPack，也不改变游戏内容结构。

preload plan 的输入可以来自：

- `asset.definition.preload`
- `asset.definition.group`
- app/profile 指定的 preload groups
- editor/devtools 发起的显式加载请求
- gameplay runtime 发起的 lazy load 请求

preload plan 的输出应包含：

- 待加载 asset id。
- asset type / source。
- group / tags / priority。
- source pack metadata where available。
- content package metadata where available。
- 预计使用的 asset adapter 或 driver adapter。

AssetManager 可以按 group 加载资源，例如：

```txt
boot
→ load preload group
→ start game
→ lazy load optional groups
```

资源加载失败不能伪装成 Data 校验失败。Data 缺失引用和 Asset adapter 加载失败是两类诊断，必须在 snapshot 中区分。

## Adapter

实际加载由 adapter 执行。对于 Phaser、Three.js 这类拥有共享资源 cache / loader / scene 的外部运行时，asset loader adapter 应由对应 Driver 暴露，而不是单独持有底层 runtime。

- Phaser Driver 的 asset loader adapter 映射到 Phaser loader / texture manager。
- Three Driver 的 asset loader adapter 映射到 texture、GLB/glTF、material 和 environment map loader。
- 音频、字体、shader、bundle 等资源通过对应 adapter 接入；Phaser 这类共享 runtime 的 audio/atlas loader 仍由同一个 Driver 暴露。

Asset adapter 边界：

- 接收 AssetDefinition。
- 执行 load/unload/retry where supported。
- 返回稳定加载状态或错误。
- 不读取 DataPack。
- 不解释 gameplay 数据。
- 不把 Phaser、Three.js、平台私有对象泄漏到 `@gamekits/asset` 公共 API。

## 与 Data 的关系

Data 和 Asset 的关系是声明与运行时加载的关系：

```txt
DataRegistry
→ asset.definition documents
→ preload plan
→ AssetManager
→ Asset adapter
→ renderer/audio/platform backend
```

Animation clip/atlas manifest 属于可引用内容 metadata：Asset 负责源与加载状态，Animator Core 负责 clip/graph 语义，Renderer/Driver adapter 负责把 frame/clip 映射到 native runtime。AssetManager 不解析 gameplay animator state，也不保存 native frame 或 audio buffer。

Data 负责：

- 注册 `asset.definition`。
- 追踪哪些数据字段引用了 AssetRef。
- 报告缺失 AssetRef 目标和来源位置。

Asset 负责：

- 根据 AssetDefinition 加载资源。
- 根据 preload / group / lazy 策略生成加载计划。
- 记录加载状态。
- 报告加载失败、重试、卸载和 adapter 状态。

App Host 可以编排 Data pipeline 与 Asset preload 的顺序，但 Asset 模块本身仍不读取 DataPack、不解释 gameplay data。

## 与 Renderer 的关系

Renderer 不直接解析 URL。RenderObject、game presentation 或 adapter-specific props 可以引用 AssetRef / asset id，AssetManager 负责确保资源被加载并能被 renderer adapter 使用。

Renderer adapter 可以持有底层资源句柄，但这些句柄不进入 gameplay 数据模型。

## 校验重点

- duplicate asset id
- unknown asset type
- unsupported asset source for current platform
- missing AssetRef target
- invalid source path or URL
- preload group missing
- adapter load failure

缺失引用和加载失败是两类问题：缺失引用属于数据/声明错误，加载失败属于运行时资源错误。两者都必须能在 snapshot 和 diagnostics 中区分。

## 最佳实践

### 模块集成

- App Host 声明的 preloadGroups 是启动必需组，任一资源加载失败使 boot 失败；可选资源应在启动后按需加载并由 app 处理 failed 状态。

- App Host/profile 负责按 Data → AssetManager → adapter preload 的顺序集成资源系统；AssetManager 不自己读取 DataPack 或猜测 gameplay document。
- Phaser、Three 等资源加载必须通过 Driver 暴露的 asset loader adapter，共享同一个外部 runtime cache；不要为 Asset 单独创建另一套 Phaser/Three runtime。
- 美术源文件与运行时资源必须显式分层：SVG、PSD、Blender 等 authoring source 留在源码目录，由可复现的内容构建步骤生成 PNG/WebP、atlas、压缩纹理或模型产物；`AssetDefinition.source` 只指向当前 profile 实际加载的运行时产物。源文件不应因为位于 Web `public` 目录而被意外发布。
- 运行时格式由内容构建和目标平台决定，不由 gameplay 或 Renderer 临时猜测。SVG 适合编辑、图标 UI 或确实需要无级缩放的少量内容；大量场景/实体纹理默认应预栅格化或进入 atlas，避免在加载和渲染路径重复解析、栅格化或产生额外纹理切换。
- 烘焙场景纹理只描述视觉，不隐式拥有 gameplay collision。有关墙体、掩体、trigger 或 nav 区域的数据应进入 Physics/Data 或对应关卡 DataType；AssetManager 不解析或物化碰撞体。对模块化静态场景，优先把有碰撞物拆成可复用的紧边界资源，并让 app-owned scene instance 的单一 transform/footprint 同时派生 RenderObject placement 与 physics companion；内容测试应逐实例对齐，不能只比较整张场景 bounds。
- Preload group 应面向启动体验和场景切换，不应把所有资源一次性塞进首屏加载。大资源、可选包和编辑器预览应支持 lazy/retry/unload。
- 有界 group retry 使用 `loadAssetGroupWithRetry(...)`；已成功资源由 AssetManager cache 跳过，只重试 failed member。调用方必须显式设置最大尝试次数并通过 attempt hook 接入进度或诊断，不能在 app 内实现无界重试循环；attempt observer 及其 error reporter 的异常不能改变资源加载结果。
- 空 group 返回失败结果并产生 `asset.group_missing` diagnostic，不把“没有任何加载目标”当成成功，也不重复空重试。

### 模块使用

- 同一 asset ID 的并发 load 共享进行中的加载；loaded 状态复用，失败状态允许下次调用重试。同步抛错与异步拒绝都进入 failed 状态，并清理进行中的请求。

- AssetDefinition 是资源声明，AssetManager 是运行时加载状态管理；不要把 gameplay data、DataPack 解析或 renderer native object 放进 AssetManager。
- 资源引用应使用 AssetRef 或业务数据里的明确资源引用字段，不要求资源定义与使用者处于同一 DataPack。
- AssetManager 默认只读取 `asset.definition` 或外部显式指定的同形资源定义；不要让它扫描任意 gameplay document 猜测资源。
- 内容 manifest 应记录运行时资源的格式、尺寸和必要 variant，并用构建或测试校验产物真实存在且与声明一致；对首屏纹理数量、总传输字节和最大单文件建立粗粒度预算，不能只测 AssetManager 的内存注册耗时。
- 栅格运行时纹理尺寸应接近“最大预期 display footprint × profile pixel ratio”，并为 zoom/atlas/filtering 留出有数据支撑的余量。不要把任意高分辨率 authoring source 原样发布，也不要让同一透明小物体在默认视角长期做大比例 minification；传输字节、纹理内存、fill-rate 和闪烁风险需要一起衡量。
- 资源加载失败、缺失引用和平台 source 不支持要分成不同 diagnostics，方便编辑器和 DevTools 给出正确修复建议。
- Renderer 使用 asset id 或 adapter-specific props 取资源句柄；gameplay、DataType 和 Save payload 不保存 texture、image element、WebGL resource 或 Phaser cache object。

## 作用域与驻留预算

`createScope(id)` 创建独立资源所有者。`scope.load(id)` / `loadGroup(group)` 同时加载并持有，每个 scope/id 只计一次；同名 scope 也是不同所有者。`release(id)` 释放一个引用，`dispose()` 释放全部引用并关闭作用域。没有其他 scope 或 legacy load 保留时，资源通过 adapter.unload 回收。

```ts
const sceneAssets = manager.createScope("level");
await sceneAssets.loadGroup("level-1");
// 创建并使用 render object / audio playback。
// 离开场景时先移除这些对象、停止播放，再释放资源。
await sceneAssets.dispose();
```

普通 `load/loadGroup` 保持缓存语义；`unload(id)` 显式回收无主资源，有主资源返回 `asset.in_use`。`dispose()` 终止 manager、取消任务、尝试所有清理并清空声明/状态。自定义 AssetManager 必须实现这些新增方法；加载 adapter 可以没有 unload，但不能创建 scope。

`load(id, { signal })` 取消当前等待者。共享请求仍有等待者时继续加载，最后一个等待者退出才取消底层请求；取消结果为 AbortError，状态回到 registered。重载同一 id 必须等待旧请求清理完成。无法终止 IO 的 adapter 必须负责晚到结果；Phaser 等共享 loader 不通过重置整个 runtime 来取消单个资源。

`maxConcurrentLoads` 默认 4；`maxResidentAssets/maxResidentBytes` 是显式 opt-in 的驻留预算。预算包含正在加载的预留，只能淘汰无主 LRU 缓存；有主资源占满预算时新加载失败。字节预算必须提供非负安全整数 `AssetDefinition.estimatedBytes`，该数字描述内容估算而非 GPU 实测。`lifecycleSnapshot()` 暴露排队/活跃加载数、驻留数/字节与引用计数；诊断区分 retained/released/unloaded/cancelled/failed。

### 模块集成

- 使用 Driver 提供的 unload 实现；Three 释放模型几何、材质、纹理及拥有的 image bitmap，Phaser 释放对应 texture/audio 和本资源创建的 animation。不要用卸载单资源替代整个 Driver dispose。
- 标准 Host 的 preload scope 在 Host 生命周期内保留启动资源。自定义生命周期必须按“游戏对象和播放实例 → scope → manager → Driver”的顺序清理；共享外部 manager 的 Host 可以显式配置 `dispose: false`，但仍释放自身 preload scope。
- 开启驻留预算后，所有持续使用的资源都应由 scope 持有；legacy load 的无主缓存允许淘汰。使用确定性的资源数量和字节估算预算测试，并另外测真实设备 GPU/内存。

### 模块使用

- 作用域只持有显式加载的资源，不自动推断材质或模型之间的业务依赖；声明资源集时应包含场景需要的全部资源。
- 同一资源被多个 scene/UI 使用时分别持有 scope；释放其中一个不能破坏其他消费者。不要手动从 native cache 删除仍被 scope 持有的资源。
- 取消后等待 scope.dispose/unload 完成再复用同一资源身份；无法释放的 native 资源不能被报告为成功回收。
