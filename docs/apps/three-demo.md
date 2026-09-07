# Three Demo 应用设计

## 定位

Three Demo 是 `@gamekits/driver-three` 的独立能力实验台。它展示 App Host 如何持有 Three Driver lifecycle，并通过 Data、Asset、RendererAdapter 和 camera adapter 组合远程模型、贴图材质、动画、粒子、灯光和诊断快照。

Three Demo 不是 Sandbox 的子面板，也不是玩法承载层。它只验证 Three driver、renderer adapter、camera adapter 和 app shell 的组合方式。

## 体验结构

- 主视口显示由 RenderObject / RenderNode 创建和追踪的 Three 场景骨架，覆盖远程 glTF model、procedural fallback model、texture material sample、particle field、灯光预设和 camera preset。
- 侧边面板展示 App Host、driver、renderer、AssetManager、driver resource cache、材质、模型、贴图、动画 clip、场景快照和 diagnostics。
- 控制区切换 renderer 示例状态，例如模型资产、材质预设、贴图资产、animation clip、timeline、camera preset、lighting preset、动画速度和 wireframe；不引入 gameplay input、world 或 save。
- 启动时 viewport 先显示 loading overlay；App Host 完成 boot 后立即显示场景和 procedural fallback，再后台加载首屏必要远程资产。体积较大的可选模型使用 lazy load，避免单个远程模型拖住首屏。

## 模块协作

- App Host boot `three.demo` Driver，并把 DOM viewport、尺寸和 diagnostics bridge 传给 driver。
- Data service 注册 Three Demo 的 `asset.definition` DataPack；Assets service 通过同一个 Three Driver 暴露的 asset loader 加载远程 `model` 和 `texture` 资源。
- glTF model 使用 Three.js 官方仓库 `r181` 的 jsDelivr CDN URL，避免 `threejs.org` examples 代理或 raw GitHub 偶发 pending 影响首屏；texture 继续使用 Three examples texture URL。
- Renderer standard service 通过 driver id 解析 Three Driver 暴露的 RendererAdapter。
- 示例场景依赖 AssetManager、RendererAdapter、Three Driver camera adapter 和 `@gamekits/driver-three` 暴露的 typed native bridge；作为显式选择 Three 后端的 app presentation，示例可以直接 import Three.js 并操作 driver 创建和追踪的 native object。
- 可重建的场景骨架、远程模型引用、基础 mesh/light 创建参数通过 RenderObject / RenderNode 表达；运行时材质、texture material sample、particle field、AnimationMixer clip sampling 和后端专属视觉细节通过 Three native object 实现。Three Driver 不把这些能力重新包装成 GameKits 版 Three API。
- 远程资产加载失败或超时不会阻止 app boot；renderer 使用 procedural placeholder 或 textureless material 保持视口可见，并通过 AssetManager state / driver diagnostics 暴露失败事实。
- Resize 由 app shell 监听 viewport 尺寸后同步给 RendererAdapter；GameRuntime 不参与 renderer lifecycle。

## 约束

- 可复用 gameplay、Data、Save 和 core facade 不得依赖 Three.js native handle；Three Demo 这种已显式选择 Three 后端的表现层可以通过 typed native bridge 直接使用 Three.js API。
- Three Driver 继续是唯一创建和持有 Three renderer / scene / camera 的边界。
- 远程资产 URL 只存在于 Three Demo 的 asset definition 数据中；Renderer 不直接解析 URL。
- 场景内容保持为 renderer 协议示例，不沉淀长期玩法规则。
