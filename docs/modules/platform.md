# Platform 模块设计

## 定位

Platform 隔离 Web、Tauri、Electron、移动端等平台差异。业务代码不直接调用 Tauri API、浏览器文件 API 或系统窗口 API。

相关包：

- `@gamekits/platform-core`
- `@gamekits/platform-web`
- `@gamekits/platform-tauri`

## PlatformRuntime

```ts
export type PlatformRuntime = {
  id: "web" | "tauri" | "electron" | "native" | string;

  services: PlatformServices;
  capabilities: PlatformCapabilityRegistry;
};

export type PlatformServices = PlatformServiceRegistry & {
  fs: PlatformFileSystem;
  path: PlatformPath;
  storage: PlatformStorage;
  window: PlatformWindow;
  dialog: PlatformDialog;
  clipboard: PlatformClipboard;
  shell: PlatformShell;
  permissions: PlatformPermissions;
  app: PlatformApp;
};
```

PlatformRuntime 不是一张无限膨胀的底层 API 列表。它由三层组成：

- Runtime identity：平台 id、运行环境 profile。
- Services：标准服务和扩展服务的统一入口。
- Capabilities：能力发现、权限状态和调试可见性。

标准服务只覆盖跨游戏最稳定、最基础的能力，例如 `platform.services.fs`、`platform.services.storage`、`platform.services.window`。其他能力通过 service/capability 扩展，不继续往 PlatformRuntime 顶层增加字段。

## Capability / Service 扩展

Platform 需要同时表达“有没有能力”和“能力由哪个服务提供”。

```ts
export type PlatformServiceKey<TService> = {
  id: string;
  optional?: boolean;
  description?: string;
};

export type PlatformServiceRegistry = {
  has<TService>(key: PlatformServiceKey<TService>): boolean;
  get<TService>(key: PlatformServiceKey<TService>): TService | undefined;
  require<TService>(key: PlatformServiceKey<TService>): TService;
  register<TService>(key: PlatformServiceKey<TService>, service: TService): void;
  list(): string[];
};

export type PlatformCapabilityDescriptor = {
  id: string;
  service?: string;
  description?: string;
  details?: Record<string, unknown>;
};
```

设计原则：

- `capabilities` 负责 feature detection、权限状态、DevTools 可见性。
- `services` 负责实际高层能力访问。
- 标准服务必须能通过 `platform.services.fs` 直接访问，也必须注册为标准 service key，例如 `platform.fs`、`platform.storage`、`platform.window`。
- service 可以是底层 adapter 包装，也可以是由多个标准端口组合出的高层服务。
- 业务模块依赖 service key / service interface，不依赖 Tauri、DOM 或 adapter 私有对象。
- 缺失 required service 必须抛明确错误；optional service 由调用方降级。

示例服务：

- `platform.saveLocation`：基于 fs/path/storage 组合出存档目录策略。
- `platform.assetSourceResolver`：把 `resource`、`platform-file`、`url` 转成 loader 可消费的 source。
- `platform.modMounts`：管理用户授权的 Mod 目录。
- `platform.editorWorkspace`：编辑器工作区、recent files、import/export。
- `platform.windowManager`：多窗口、窗口布局、窗口间消息。
- `platform.systemMenu`：桌面菜单和命令。
- `platform.notifications`：系统通知。
- `platform.telemetry`：可关闭的诊断/遥测上报。
- `platform.cloudStorage`：云存档或远端同步。

这些服务不进入 Platform Core 顶层字段。Platform Core 只定义注册、查询、错误和边界。

## 文件系统

```ts
export type PlatformFileSystem = {
  readText(path: string, options?: FsOptions): Promise<string>;
  writeText(path: string, content: string, options?: FsOptions): Promise<void>;
  readBinary(path: string, options?: FsOptions): Promise<Uint8Array>;
  writeBinary(path: string, data: Uint8Array, options?: FsOptions): Promise<void>;
  replaceFile?(source: string, target: string, options?: FsOptions): Promise<void>;
  remove?(path: string, options?: FsOptions): Promise<void>;
  exists(path: string, options?: FsOptions): Promise<boolean>;
  createDir(path: string, options?: FsOptions): Promise<void>;
  listDir(path: string, options?: FsOptions): Promise<PlatformDirEntry[]>;
};

export type FsBaseDir =
  | "appData"
  | "appConfig"
  | "appCache"
  | "document"
  | "download"
  | "resource"
  | "temp";
```

业务层写语义路径，不写绝对路径。

## 路径策略

- 内置资源：`resource`
- 用户存档：`appData/saves`
- 用户设置：`appConfig/settings`
- 缓存：`appCache`
- 导出文件：`document` 或用户选择路径
- Mod：`appData/mods` 或用户授权目录

## Tauri Adapter

`@gamekits/platform-tauri` 负责映射：

- `@tauri-apps/plugin-fs`
- `@tauri-apps/plugin-dialog`
- `@tauri-apps/plugin-shell`
- `@tauri-apps/api/window`

这些包不能散落到 gameplay、save、asset、editor 代码中。

## Tauri 权限

Tauri v2 capabilities 必须最小授权：

- 默认游戏运行：读取内置资源，读写 appData saves，读写 appConfig settings。
- 编辑器模式：额外允许文件对话框和 DataPack import/export。
- Mod 模式：用户选择目录后授权访问。

不要为了方便开放整个文件系统。

## 与 Asset 的关系

AssetManager 不假设资源一定来自 HTTP URL。

```ts
export type AssetSource =
  | { type: "url"; url: string }
  | { type: "platform-file"; path: string; baseDir: FsBaseDir }
  | { type: "resource"; path: string }
  | { type: "memory"; data: Uint8Array; mimeType?: string };
```

## 与 Save 的关系

SaveSystem 通过 PlatformStorage / PlatformFileSystem 读写，不直接调用 localStorage 或 Tauri FS。

## 与 Input 的关系

Tauri 桌面端需要额外处理：

- 窗口焦点
- 应用快捷键
- 菜单命令
- 文件拖拽导入
- 窗口大小变化
- 多窗口编辑器

这些应转成 platform/input/system event，再由 Runtime 分发。

## 最佳实践

### 模块集成

- 文件存档集成须检查 `fs.replaceFile` 与 `fs.remove`。`replaceFile(source, target, options)` 只用于同目录原子替换，失败保留目标文件，成功移走源文件；adapter 无此保证时应不暴露方法。Web memory 与 Tauri rename 映射均遵守该协议，实际 Tauri 部署需为目标目录授权 rename/remove。原子可见性不代表断电后的持久性，见 ADR 0009。

- Platform service 可以进入 App Host lifecycle，但 GameRuntime 不直接依赖 Platform；需要平台能力的 GameModule 通过 app/profile 注入稳定 bridge。
- Tauri/Web/Headless adapter 必须实现相同 core protocol，平台私有类型不能泄漏到 Save、Asset、Data、GameRuntime 或 gameplay 包。
- Web app 应通过 `measureElementViewport()` / `observeElementViewport()` 在 renderer container 挂载后读取 logical CSS viewport。应用组合层把同一尺寸同时交给 Renderer Core `resize()` 和 Camera Core `viewport`，并在 app dispose 时释放 observer；不要只靠 CSS 拉伸 canvas，也不要让 Camera Core 或具体 Driver 反向拥有 DOM lifecycle。详细取舍见 [ADR 0027](../adr/0027-web-element-viewport-composition.md)。
- `createMemoryPlatform()` 显式创建隔离的 memory fs/storage，适合 deterministic/headless/SSR AppProfile 和生命周期 benchmark；它可以设置诊断 id，但仍是 `platform-web` 提供的 fixture，不是生产 Node server adapter。
- 权限按能力最小化声明。游戏运行、编辑器、mod 导入、导出文件应使用不同 permission profile，不为了方便开放整个文件系统。

### 模块使用

- Platform 只抽象运行环境能力，例如 storage、filesystem、window、dialog、clipboard、shell、permissions；不承载 gameplay、renderer object 或 editor-specific data model。
- 业务层使用语义路径和 baseDir，不写用户机器绝对路径。Save、Asset、Editor import/export 都应通过 Platform path policy。
- Platform diagnostics 要区分 permission denied、unsupported capability、path unavailable、quota exceeded、user cancelled 等错误，不要只返回 generic failure。
- 测试应使用 memory/headless platform 覆盖 storage/fs/permission 行为，再用少量 Web/Tauri adapter 测试验证平台映射。
- Element viewport observer 只用于 container resize 这类低频平台事件；调用方应依赖 helper 的尺寸去重，不要从 GameRuntime tick 或 renderer frame loop 重复注册、测量或 resize。
