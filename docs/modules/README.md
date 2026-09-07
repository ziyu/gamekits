# 模块设计文档

本目录按模块维护最终长期设计。这里记录模块职责、边界、核心协议、adapter 策略、扩展点和长期约束。

## 职责边界

- 模块最终长期设计放在本目录。
- 跨模块依赖方向和包边界摘要放在 `../architecture.md`。
- 模块相关工作流的当前状态、任务拆分和完成定义放在任务系统、PR 或 `../implementation/`。
- 开发文档治理规则放在 `../development-governance.md`。
- 高影响决策的历史背景放在 `../adr/`。
- 已验证实践和性能经验放在 `../best-practices.md`。
- 模块专属最佳实践可以放在对应模块文档的“最佳实践”段落；跨模块通用实践仍放在 `../best-practices.md`。

模块文档不是阶段状态文档，也不是临时计划文档。禁止写入：

- 当前实现状态。
- 临时方案或过渡方案。
- 阶段计划、下一步计划、完成定义。
- TODO / backlog / milestone。
- 某次决策的历史背景。

不要把同一段模块协议复制到多个文档。其他文档需要提及时，只引用本目录对应文件。

## 最佳实践写法

模块文档中的“最佳实践”必须区分“模块集成”和“模块使用”：

- 模块集成：把模块接入 app、App Host、Driver、Adapter、GameRuntime、测试夹具、内容管线或 Save pipeline 的一次性装配规则。
- 模块使用：游戏模块、业务代码、工具 UI、DataPack、SaveContributor 等日常如何消费模块能力。

集成和使用的频率、责任人和风险不同。不要把一次性启动装配写成业务日常要求，也不要把业务调用习惯塞进 profile、driver 或 Host 组合层。

模块文档中的“最佳实践”只写长期可维护规则：

- 该模块应该如何被使用。
- 该模块如何扩展 adapter、driver、helper 或 contributor。
- 与相邻模块协作时的正确分工。
- 常见反模式和边界风险。
- 该模块应重点覆盖的测试和诊断。

不要在模块最佳实践中写：

- 当前代码实现进度。
- 某个阶段还没做的 TODO。
- Sandbox 的具体玩法细节。
- 与多个模块都有关的通用规则全文。

如果一条实践会影响多个模块，优先写到 `../best-practices.md`，模块文档只保留一句指向或模块化补充。

## 模块索引

- `core-runtime.md`：Core、EventBus、GameRuntime、GameModule。
- `app-host.md`：应用组合层、Service Registry、统一生命周期、配置和诊断。
- `driver.md`：外部运行时统一集成层、Driver lifecycle、adapter map 和 native boundary。
- `world.md`：World facade、ECS adapter、系统边界。
- `renderer.md`：RenderObject、RenderNode、RenderCommand、Renderer Adapter。
- `input.md`：Input Core、DOM/Phaser/Tauri input adapter、Action Mapping。
- `camera.md`：Camera Core、Camera Rig、Renderer Camera Adapter。
- `physics.md`：Physics Core、body/collider/query/contact、Backend Adapter。
- `combat.md`：Effect delivery、target relationship、hit resolution、projectile executor。
- `ai.md`：Perception、Utility goal、Task lifecycle、budget scheduler。
- `navigation.md`：Path/route query、agent profile、dynamic blocker、backend adapter。
- `animator.md`：Semantic Animator graph、controller、layer、marker、playback adapter。
- `audio.md`：GameAudio 的 Music/SFX/Dialogue 领域 API、Playback、Mix、Spatial 和 Backend 边界。
- `platform.md`：Platform Core、Web/Tauri adapter、权限与文件系统。
- `data.md`：DataType、DataPack、DataRef、自由游戏数据模型、数据校验。
- `assets.md`：AssetRef、AssetDefinition、AssetManager、资源来源和加载状态。
- `tca.md`：Trigger / Condition / Action 规则系统。
- `gas.md`：Actor、Ability、Effect、Cue、Clue。
- `multiplayer.md`：成熟多人 backend adapter、GameKits facade、authority、命令同步与状态摘要。
- `ui.md`：UI Core、React UI、游戏样式、组件库、窗口与交互层。
- `save.md`：Save / Load / Migration、slot、store、codec、contributor。
- `devtools.md`：Trace、Inspector、Profiler。
