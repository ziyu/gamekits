# 实现原则

## 薄内核

框架核心只维护稳定协议和运行时边界。能通过成熟库完成的底层能力，应放在 adapter 中。

已经验证的边界：

- Koota 被限制在 `@gamekits/world-koota`。
- 业务代码通过 `@gamekits/world` 访问 ECS。
- Sandbox 只依赖 GameKits 的公共接口。

## Core 语义唯一来源

实现任何 adapter、driver、backend 或 app 组合前，先列出它触及的领域概念，并定位对应 core/facade 的公共创建函数、类型、生命周期和 conformance。已有 core 概念必须由 core runtime 推进，具体包不能只实现一个同形接口就宣称完成复用。

Code review 至少检查：

- 是否直接调用对应 core 的 runtime/factory/helper，而不是在具体包复制 phase、session、snapshot、sequence、dispose 或错误语义。
- 第三方对象是否只存在于 adapter/driver/native boundary，并通过 core 类型对外投影。
- Core 缺少的能力究竟是通用协议缺口，还是 provider 专属能力；前者先修正 core 并补 conformance，后者保留 typed native path。
- 集成测试是否从 core facade 观察结果，而不只读取 adapter 私有 snapshot 或第三方对象。仅断言两个对象字段相同，不能证明它们由同一 core runtime 驱动。

允许 adapter 维护 provider id、native handle、连接索引和映射缓存；这些是实现状态，不得演化为与 core 同名的第二套业务状态机。

## Adapter 隔离

第三方库不得成为业务边界。引入库时必须回答：

- 这个库是否有对应 adapter 包或 adapter 文件夹。
- 公共 API 是否泄漏了库类型。
- 替换该库时哪些包需要改动。

若答案不清晰，先不要把库暴露到公共接口。

具体 adapter / driver 包可以导出 typed native control path 给 app-specific presentation、Editor 后端专属面板或 DevTools plugin 使用。这个类型泄漏必须停留在具体实现包和显式选择该后端的 app/tooling 代码中，不能进入 core facade、Data、Save、TCA/GAS 或可复用 gameplay module。

## 扩展/逃生口

通用架构不能接管一切。热点路径、复杂表现、平台能力和第三方生态接入需要受控 escape hatch。

要求：

- 默认路径保持稳定协议和可调试性。
- Escape hatch 必须由 adapter 创建和释放。
- Runtime 仍负责生命周期。
- 调用方必须明确知道自己进入 renderer/platform/object-specific 路径。
- DevTools 需要能标记 escaped/native/direct/custom path。
- Escape hatch 不作为默认数据驱动路径。

## 可测试优先

每个 facade/adapter 必须有契约测试。

当前规则：

- `@gamekits/world` 的实现必须通过 world conformance tests。
- `@gamekits/event-bus` 必须测试顺序、取消订阅、timestamp/source。
- `@gamekits/game-runtime` 必须测试生命周期和系统调度顺序。
- 新增 facade 必须补 conformance helper；新增 adapter 必须通过 facade 契约测试。

## 代码质量

代码质量优先级高于短期速度。任何新增实现都必须先守住可读性、边界清晰和可验证性，再考虑抽象复用。

基础要求：

- 公共 API 使用明确类型，不用 `any`、隐式结构或第三方库类型穿透包边界。
- 函数保持单一职责；当一个函数同时处理构造、校验、调度、渲染或 IO 时，应拆分。
- `src/index.ts` 只做 re-export，不承载业务实现。
- 命名应表达领域含义，避免 `manager`、`helper`、`util` 这类没有边界的兜底名称。
- 错误必须带上下文。框架层优先使用 `GameError` 和稳定 `code`。
- 不写“顺手重构”。除非当前任务需要，否则不要改动无关模块。
- 不把临时实验代码、调试输出、构建产物提交进仓库。
- 交互 UI、游戏内容 UI、Editor UI 不使用 `innerHTML`、HTML 字符串模板或 `insertAdjacentHTML` 拼接。优先使用 React/组件系统，或使用 DOM API、`textContent`、`replaceChildren` 和显式事件绑定。
- 如果确实需要渲染外部 HTML，必须限定为受信任/已清洗内容，并通过独立 helper、测试和 ADR 说明边界；不能把它作为常规 UI 构建方式。

复杂度控制：

- 新抽象必须解决真实重复或隔离真实变化点。
- 新依赖必须有明确归属：核心协议、adapter、app 示例或开发工具。
- 一个文件超过清晰阅读范围时，优先按类型、创建函数、运行时实现、adapter 私有实现拆分。
- 测试应覆盖行为契约，而不是锁死无意义的内部实现细节。

## 可解释性从一开始进入设计

Runtime、EventBus、Physics、TCA、GAS、Asset、Save 和 DevTools 都必须产生可观察信息。低频事实、物理接触、空间查询、规则匹配、能力执行、资源加载、存档操作和性能热点应能被测试或工具解释。

## 模块拆分

不要把一个模块所有代码写在 `index.ts`，也不要把其他 package 的目录外观复制成当前模块的架构。

拆分顺序：

1. 先列出模块自己的领域职责、变化轴和内部依赖方向。
2. 按领域行为拆分状态机、策略和只读模型；类型与拥有其语义的行为放在一起。
3. 把公共 contract、第三方 port、composition root、observability 和 testing boundary 分开。
4. 只有确有共享语义时才提取跨领域 primitive；不能用 `types.ts`、`helpers.ts`、`utils.ts` 或大型 `runtime` 掩盖未完成的边界设计。
5. Root、backend/adapter 和 testing 面向不同消费者时使用 subpath export，避免扩大默认公共 API。
6. 测试按领域边界组织，契约测试、策略测试和具体 adapter/backend 测试分开。

包内架构的共同约束见 `docs/architecture.md`；具体长期结构写入对应模块文档。
