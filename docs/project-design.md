# GameKits 整体设计

## 项目是什么

GameKits 是一个面向独立游戏开发的 TypeScript 游戏框架实验项目。

它不是从零自研的完整游戏引擎，也不是某个单一游戏的业务代码仓库。它的定位是可复用的 Game Framework：把多个独立游戏都会需要的运行时协议、玩法模块边界、数据驱动能力、渲染适配、UI 运行时、调试能力和工程实践沉淀下来。

GameKits 更接近“游戏应用框架”而不是“游戏引擎”。它关心的是多个游戏如何共享一套稳定的组合方式：模块如何安装，数据如何注册，规则如何触发，状态如何保存，渲染和 UI 如何接入，调试工具如何解释运行过程。

## 为什么做这个项目

独立游戏开发常见问题不是缺少库，而是缺少稳定的组合边界。

如果每个游戏都直接散落依赖 ECS、渲染库、UI 组件、动画库、资源加载、存档格式和调试工具，短期开发会很快，但长期会出现几个问题：

- 玩法代码和底层库耦合，替换技术栈成本高。
- 数据驱动规则变多后难以解释和调试。
- 每个新游戏重复搭建 runtime、模块系统、资源系统和 UI 基础设施。
- 示例 demo 和真实项目之间缺少可复用的中间层。
- 高频逻辑、低频事件、表现动画、React UI 容易互相污染。

GameKits 的存在意义是把这些易重复、易失控、又足够通用的部分沉淀为清晰协议、可替换 adapter 和可组合 driver。

## 项目目标

GameKits 的长期目标是支撑多个独立游戏快速开发，同时保持架构可解释、可测试、可替换。

核心目标：

- 建立薄内核：核心包只定义稳定协议、运行时边界和共享基础能力。
- 隔离第三方库：Koota 这类单协议库通过 adapter 接入；Phaser、Three.js 这类跨多个协议的外部运行时通过 driver 统一集成；GSAP、UI primitives 等限制在对应实现层。
- 支持数据驱动：Actor、Ability、Effect、TCA Rule、AssetManifest、UI Window Definition 等由数据定义。
- 保持可解释性：事件、规则、能力、效果、资源、系统执行都应能被 trace/debug。
- 支撑长期复用：具体游戏通过 GameModule、DataPack、Driver/Adapter、typed native boundary 和 UI Window 扩展。
- 降低应用启动成本：通过 App Host 统一组合平台、资源、输入、镜头、渲染、数据和运行时服务，让游戏上层主要关注玩法逻辑。
- 支持多人会话与预测边界：通过 Multiplayer facade、成熟 backend adapter、local/remote authority binding、标准复制 helper、托管 prediction domain 和 GameModule bridge 组合离线单机、Colyseus、Nakama、平台联机 SDK 或测试替身；不同对象选择输入 replay、事件 record、prediction island 或 authority-only 等窄策略，但共享 generation、identity、回滚预算、权威接管、副作用和 diagnostics 协议，不让 gameplay 绑定具体网络 SDK，也不把“已连接 room”误当成“gameplay state 已同步”。
- 保持性能分层：高频逻辑在 ECS system，低频规则在 TCA/GAS/EventBus，表现层在 Renderer/Cue/Camera，UI 在 React/Zustand。
- 保持平台独立：文件、窗口、权限、输入、镜头、资源来源都通过 GameKits 协议或 adapter 接入。

## 非目标

GameKits 不追求成为完整通用引擎。

明确非目标：

- 不从零实现完整 ECS、渲染引擎、UI 组件库或动画引擎。
- 不让某个具体游戏需求反向污染核心协议。
- 不把 React 放进主循环。
- 不把 TCA/GAS 用作每帧高频逻辑。
- 不在核心包中直接绑定 Phaser、Koota、GSAP、shadcn/ui 等具体库。
- 不把 Tauri、DOM、Phaser input、renderer camera 等平台/后端能力直接泄漏给 gameplay。
- 不为 clip/mixer、粒子或 tween 重新包装独立 Effect/Fx/Animation 引擎；跨后端的语义动画状态控制只进入可选 Animator toolkit，底层播放仍归 Renderer/Driver。
- 不为了提前泛化而设计没有真实使用场景的复杂抽象。

## 设计信条

### 成熟库负责底层能力，GameKits 负责架构协议

底层库提供能力，但不能决定 GameKits 的公共边界。公共协议必须表达游戏框架自己的领域模型。

### Driver / Adapter 是替换边界

任何外部技术选型都必须被限制在 driver、adapter 或 app 层。单协议实现用 adapter，跨 renderer/input/camera/asset 等多个协议的外部运行时用 driver。若未来替换 Koota、Phaser、Three.js 或 UI primitive，业务模块不应大面积重写。

### 数据驱动必须可追踪

规则、能力、效果和事件越数据化，越需要 trace。不能只做到“能跑”，还必须能回答为什么触发、为什么没触发、改了什么状态。

### Sandbox 是验证场，不是目的地

Sandbox 用于验证框架能力的最小闭环。真正的游戏 demo 应建立在稳定框架能力之上，而不是把临时玩法堆在 sandbox 中。

### 文档是架构的一部分

项目设计、实现原则、最佳实践、阶段目标和 ADR 必须随着实现演进。代码改变架构时，文档必须同步改变。
