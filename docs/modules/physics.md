# Physics 模块设计

## 定位

Physics 是统一物理 facade 和 GameModule toolkit。它负责把刚体、碰撞体、触发器、空间查询、接触事件和调试快照抽象成 GameKits 稳定协议，让游戏代码不直接依赖 Rapier、Matter.js、Phaser Physics、Box2D 或其他底层物理库。

相关包：

- `@gamekits/physics-core`
- `@gamekits/physics-rapier2d`
- `@gamekits/physics-rapier3d`
- `@gamekits/physics-matter`
- Driver 暴露的 physics backend，例如 `@gamekits/driver-phaser` 中绑定 Phaser Scene 的 Arcade / Matter physics adapter

包归属：

- `@gamekits/physics-core`：Game Module toolkit + facade，定义物理协议、标准组件、DataType、GameModule helper、trace 和 conformance helper。
- `@gamekits/physics-rapier2d` / `@gamekits/physics-rapier3d` / `@gamekits/physics-matter`：backend adapter，只把 `physics-core` 协议映射到底层库，不承载玩法规则。Rapier adapter 按物理维度分包，避免 2D 游戏默认安装 3D WASM/runtime。
- Phaser 这类把 physics 绑定在完整 scene runtime 内的后端，优先由 Driver 持有外部 runtime，再暴露 Physics backend adapter。

Physics 不是 App Host 默认标准服务。物理模拟需要 world、tick、entity binding、gameplay filter、save contributor 和 session lifecycle，应通过 `createPhysicsModule(...)` 这类标准 GameModule helper 安装。App Host 或 profile 可以提供 backend factory、driver adapter、DataRegistry、DevTools 和 SaveManager，但不直接拥有 gameplay physics scene。

使用 configured App Host 时，可以通过 `profile.standard.game.standardModules.physics` 声明 backend、scene、handle、interpolation store、bindings 和 trace policy。App Host helper 只解析这些 profile value 并调用 `@gamekits/physics-core` 的 `createPhysicsModule(...)`；live scene、fixed step、World sync 和 cleanup 仍完全属于 Physics GameModule。

## 非目标

- 不从零实现完整物理引擎。
- 不把某个物理库的类型泄漏到可复用 gameplay、Data、Save 或 public facade。
- 不让 Renderer、Input 或 Camera 承担 gameplay 碰撞判定。
- 不把伤害、阵营、仇恨、投射物 owner、pierce、hit/hurt rule 等玩法语义写进 Physics Core。
- 不把 pathfinding、navmesh、steering、AI avoidance 做成 Physics 首层职责。
- 不承诺所有 backend 都具备 bit-level determinism、网络 rollback 或 lockstep 能力。

## 分层

```txt
GameModule / gameplay system
→ PhysicsModule
→ PhysicsScene / PhysicsBackendAdapter
→ Rapier / Matter.js / Phaser Physics / future backend

DataRegistry
→ physics.body / physics.collider / physics.material definitions
→ PhysicsModule materialization

World
→ physics components / transform / velocity binding
→ Physics sync systems

DevTools / Save
→ physics snapshot / contributor / trace
```

Physics Core 保持薄协议。成熟库负责底层 broadphase、solver、constraint 和 shape implementation；GameKits 负责稳定 id、World integration、Data materialization、EventBus 边界、Save contributor 和可解释 trace。

客户端物理预测使用同一分层，但必须区分两种能力：

- 单主体 transition：`createPhysicsBodyPredictionTransition(...)` 持有一个 backend-owned speculative scene，从
  rollback state 同步一个 subject body，应用调用方声明的 input patch，再按 fixed sub-step 写回 predicted state。
  它用有界 sequence before/after 公开 body checkpoint 复用基线一致的 replay，适合本地角色对共享静态 layout
  的移动与 Dash。
- Prediction-island transition：`createPhysicsPredictionIsland(...)` 为相互作用的多个 dynamic/kinematic body 和
  predicted spawn/despawn 保存并恢复同一 simulation tick 的 backend checkpoint，再按 tick/sequence 稳定顺序
  重放。它只在 backend 明确声明 full-scene capture/restore 与 deterministic replay capability 且调用方提供有界
  history/member/command 预算时启用；late command、authority reconciliation、membership mismatch、overflow、
  reset 和 dispose 都返回或记录显式 diagnostic。

单主体 checkpoint 不是完整 solver 存档，不能用于多个 dynamic body、projectile spawn matching 或复杂弹跳/
制导对象。Prediction island 也不能只恢复部分交互对象；成员缺失、history overflow 或 backend 不支持时必须
返回明确 diagnostic，让上层 hard-correct 或降级 authority-only。

两种 transition 都不拥有 authority、ack、renderer、Combat hit rule 或玩法策略；Multiplayer Core 通过 managed
prediction domain 管理 generation、identity、authority binding、history/predict/replay/reset/dispose，并只读透传
diagnostics。Prediction island adapter 必须把 membership mismatch、history overflow 和 backend capability failure
映射成 domain hard correction 或 authority-only 降级，不能在 app render loop 中私自继续不完整 replay。
`createPhysicsLayoutDefinitions(...)` 让 World layout 与 speculative scene 复用同一 body/collider definition
解析和 stable id 规则。

多人高互动 arena 的 network composition 不进入 Physics Core。Physics island 继续只拥有 solver scene、成员、command、
checkpoint、reconcile 和 hard correction；Multiplayer GameModule bridge 管理 binding/snapshot/input/frame lifecycle，App
Host 的 `createStandardMultiplayerPhysicsArenaPrediction(...)` 负责把二者组合。Authority arena frame 通过显式
`islandId`、generation、tick、membership revision、definition version 和完整 member state 标识可重放 baseline；Physics
Core 不解析 provider payload、player/peer binding 或 input ack。

Prediction island 必须同时限制 member、command、history tick、checkpoint bytes、total history bytes 和单次 replay work。
完整交互集合由 authority policy 声明；客户端不能用 viewport、渲染距离或局部 overlap 结果静默删掉仍可碰撞的 body。
成员 revision 或 definition version 改变时应重建完整 baseline。Island-owned solver state 不能再次进入通用
Physics rollback contributor；World/RNG contributor 只捕获明确不与 island 重复的 gameplay state。

当前公共 prediction-island member 是 body + colliders，不表达 joint/constraint graph。旋转杆、门和移动平台可通过
共享 tick 驱动的 kinematic body 进入 island；需要 joint、ragdoll、绳索或 backend constraint 的游戏应先扩展 Physics
稳定协议与 checkpoint conformance，不能把 native joint handle 写入 member definition、World component 或网络 payload。

直线 kinematic 对象使用 `sweepPhysicsKinematicStep(...)` 运行一个无状态 ray/shape interval。调用方提供
`PhysicsQueries`、position、velocity、delta、shape 与 query filter；Core 强制 closest/stable sweep 并返回
新的 position 与首个 hit。它不拥有 projectile identity、lifetime、authority 或 damage，因此同一个函数可以被
owner prediction 与 authority simulation 复用。直接创建 query-only backend scene 的组合层必须按 backend
contract 在 materialization 和静态 body 移动后推进一次 scene step，使 query pipeline 与最新 collider 对齐。

`PhysicsQueryResult.point` 和 `normal` 必须是命中 collider 表面的世界空间接触信息；shape-cast backend 不能把
provider 的 local witness 直接泄漏到公共结果。`PhysicsKinematicSweepStepResult.position` 则表示移动 ray/shape
在 TOI 时的世界空间原点：ray 的原点与接触点重合，shape 的原点必须按 `distance` / `fraction` 推进，不能把
表面接触点当成圆心、球心或 box origin。Adapter conformance 必须同时断言这两个位置，避免形状中心嵌入 blocker。

## 核心模型

Physics Core 的长期公共模型：

```ts
export type PhysicsSceneId = string;
export type PhysicsBodyId = string;
export type PhysicsColliderId = string;
export type PhysicsMaterialId = string;

export type PhysicsDimension = "2d" | "3d";

export type PhysicsVector = {
  x: number;
  y: number;
  z?: number;
};

export type PhysicsQuaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type PhysicsRotation = number | PhysicsVector | PhysicsQuaternion;

export type PhysicsBodyKind = "static" | "dynamic" | "kinematic";

export type PhysicsBodyDefinition = {
  id?: PhysicsBodyId;
  kind: PhysicsBodyKind;
  position?: PhysicsVector;
  rotation?: PhysicsRotation;
  linearVelocity?: PhysicsVector;
  angularVelocity?: PhysicsRotation;
  gravityScale?: number;
  damping?: { linear?: number; angular?: number };
  continuousCollisionDetection?: boolean;
  lockedAxes?: string[];
  userData?: Record<string, unknown>;
};

export type PhysicsColliderDefinition = {
  id?: PhysicsColliderId;
  bodyId?: PhysicsBodyId;
  shape: PhysicsShapeDefinition;
  material?: PhysicsMaterialId;
  sensor?: boolean;
  filter?: PhysicsCollisionFilter;
  offset?: { position?: PhysicsVector; rotation?: PhysicsRotation };
  userData?: Record<string, unknown>;
};
```

`PhysicsVector.z` 和 `PhysicsQuaternion` 只在 3D backend 中有意义。2D backend 必须忽略或拒绝不支持的 3D 字段，并通过 diagnostic 给出明确错误。Core 不用不同类型层级强迫所有游戏同时接受 2D/3D 复杂度。

## Shape 与 Material

Physics Core 只定义常见、可映射、可保存的 shape envelope：

```ts
export type PhysicsShapeDefinition =
  | { type: "circle"; radius: number }
  | { type: "box"; width: number; height: number; depth?: number }
  | { type: "capsule"; radius: number; height: number }
  | { type: "sphere"; radius: number }
  | { type: "polygon"; points: PhysicsVector[] }
  | { type: "polyline"; points: PhysicsVector[] }
  | { type: "mesh"; assetId: string; convex?: boolean }
  | { type: "custom"; backend: string; props: Record<string, unknown> };

export type PhysicsMaterialDefinition = {
  id: PhysicsMaterialId;
  friction?: number;
  restitution?: number;
  density?: number;
  combine?: {
    friction?: "min" | "max" | "multiply" | "average";
    restitution?: "min" | "max" | "multiply" | "average";
  };
};
```

复杂 backend 专属 shape 可以通过 `custom` 或 backend native path 使用，但 `custom` 不能进入通用 conformance 测试，也不能成为可复用 gameplay module 的默认依赖。

Shape envelope 的长期语义必须稳定：

- `circle` / `sphere` 使用 radius。
- `box` 使用完整宽高深，不使用 half extents 作为公共协议。
- `capsule` 使用 radius 和轴向高度；2D backend 默认沿本地 Y 轴，3D backend 必须通过 offset rotation 或 backend capability 声明支持的轴向。
- `polygon` / `polyline` 是 2D 几何；3D 几何使用 `mesh` 或 backend native path。
- `mesh` 只引用 asset id，不把顶点缓存、BVH 或 native mesh handle 写进 Data / Save。
- `custom` 必须标明 backend id，且只能被显式依赖该 adapter 的 app、Editor 后端工具或 DevTools plugin 使用。

Shape 只描述空间占用，不描述 damage、team、hitbox/hurtbox、projectile owner、selection rule 或 interaction channel。这些玩法语义应放在游戏 DataType、GAS/TCA 或 gameplay component 中，再通过 physics query/contact 返回的稳定 body/collider/entity id 关联解释。

## Collision Filter / Layer Matrix

Physics Core 提供统一的 collision filter envelope：

```ts
export type PhysicsCollisionFilter = {
  groups?: string[];
  collidesWith?: string[];
  categoryBits?: number;
  maskBits?: number;
};
```

语义约束：

- `groups` / `collidesWith` 是面向 Data、Editor 和设计工具的语义层名。
- `categoryBits` / `maskBits` 是低层可移植位掩码，适合生成代码、性能敏感配置和 backend 直接映射。
- 同时提供语义名和 bit mask 时，bit mask 是最终低层表达；语义名仍可保留给 DevTools 和 trace 显示。
- 未注册的 group 名必须产生 diagnostic，不能静默映射成 0。
- Sensor / trigger 只改变接触求解和事件语义，不改变 layer/mask 是否匹配。是否查询 sensor 由 query option 单独控制。

Scene 或 profile 可以提供 layer registry 与 collision matrix：

```ts
export type PhysicsLayerDefinition = {
  name: string;
  bit?: number;
  collidesWith?: string[];
};

export type PhysicsCollisionMatrix = {
  layers: PhysicsLayerDefinition[];
  defaultLayer?: string;
};
```

Layer matrix 是物理空间过滤规则，不是玩法阵营系统。team/faction、damage channel、owner ignore、ability target rule 等可以在游戏层编码为 Data/component，并在 query/contact 结果返回后解释；只有确实需要进入 broadphase/narrowphase 裁剪的部分才映射到 physics filter。

Runtime 还可以提供局部 pair 过滤能力，例如 query 的 `ignoreBodies` / `ignoreColliders`，或 backend 支持的 body pair disable。此类 override 必须是显式命令或 query option，不能通过 EventBus 高频广播。

## Backend Adapter

```ts
export type PhysicsBackendAdapter<TNative = unknown> = {
  id: string;
  kind: string;
  dimension: PhysicsDimension;

  createScene(config: PhysicsSceneConfig): PhysicsScene<TNative>;
  capabilities(): PhysicsBackendCapabilities;
};

export type PhysicsScene<TNative = unknown> = {
  id: PhysicsSceneId;

  createBody(definition: PhysicsBodyDefinition): PhysicsBodyId;
  updateBody(
    id: PhysicsBodyId,
    patch: PhysicsBodyPatch,
    options?: { kinematicTransformMode?: "target" | "teleport" }
  ): void;
  applyBodyCommand?(command: PhysicsBodyCommand): PhysicsBodyCommandResult;
  destroyBody(id: PhysicsBodyId): void;

  createCollider(definition: PhysicsColliderDefinition): PhysicsColliderId;
  updateCollider(id: PhysicsColliderId, patch: PhysicsColliderPatch): void;
  destroyCollider(id: PhysicsColliderId): void;

  step(delta: number, options?: PhysicsStepOptions): PhysicsStepResult;

  getBodyState(id: PhysicsBodyId): PhysicsBodyState | undefined;
  getColliderState(id: PhysicsColliderId): PhysicsColliderState | undefined;

  query(query: PhysicsQuery): PhysicsQueryResult[];
  snapshot(): PhysicsSceneSnapshot;
  captureCheckpoint?(): PhysicsSceneCheckpoint;
  restoreCheckpoint?(checkpoint: PhysicsSceneCheckpoint): void;
  native?(): TNative;
  dispose(): void;
};
```

Adapter 规则：

- Adapter 持有 backend 私有对象、handle map、broadphase cache 和 solver state。
- Adapter 不直接读取游戏业务组件，不执行 damage、ability、quest 或 score 逻辑。
- Adapter 不把 backend body/collider object 存进 World component、Data document 或 Save payload。
- Adapter diagnostic 必须能定位 body id、collider id、backend kind、phase 和错误码。
- 需要 WASM 或异步 boot 的 backend 应由 adapter package 暴露 async factory 或由 app/profile 预初始化；`PhysicsScene` facade 本身保持同步 create/step/query/dispose。
- Rapier 这类官方 2D / 3D 分包的 backend 应在 GameKits adapter 层保持同样拆分；共享语义沉淀到 `physics-core`，dimension-specific shape、rotation、query 和 native path 留在各自 adapter 包。
- 3D backend 可以把 `PhysicsRotation` 的 vector 形式解释为 Euler radians，并把 quaternion 作为无损 state/native round-trip；2D backend 可以把 number 解释为平面角度并拒绝 quaternion。
- Backend native path 只允许 app-specific gameplay integration、Editor 后端工具或 DevTools backend plugin 显式依赖具体 adapter 包时使用。
- Backend capability 必须声明支持的 shape、query family、trigger interaction、filter 映射、result ordering、rotation support 和 native path。公共 API 遇到不支持的能力时应返回明确 diagnostic 或抛出 GameKits error，不能以近似语义静默降级。
- 只有能恢复完整 scene/solver state 并在相同输入下稳定重演的 backend 才能声明 `checkpoints.fullScene` 与
  `checkpoints.deterministicReplay`。Checkpoint payload 始终由 adapter 私有持有，公共 envelope 只公开 backend、
  scene id 和 byte length；不同 backend/scene 的 restore 必须拒绝。
- `PhysicsSceneConfig.materialDefinitions` 是 scene-local material registry。Adapter 必须把 collider 的 friction、
  restitution、density 和 combine rule 映射到底层 solver；未知 material id 必须报错。高速动态 body 通过
  `continuousCollisionDetection` 显式启用 backend CCD，不能靠放大 collider 掩盖 tunneling。
- Kinematic body 的 position/rotation patch 默认是下一次 fixed step 的 target；Rapier adapter 必须用 next-kinematic API，
  让 solver 能从位移推导速度并真实推动接触对象。Rollback reconcile、hard correction 和 authoritative baseline 安装则显式传
  `kinematicTransformMode: "teleport"`，表示快照已经是该 tick 完成后的 pose，当前 tick 必须立即可读。两种语义不能由 adapter
  根据调用栈猜测，也不能把 authority correction 留成 pending target 后被下一帧覆盖。详见
  [`ADR 0055`](../adr/0055-kinematic-target-and-authority-correction.md)。

## Body Command

`PhysicsBodyPatch` 表达 position、rotation、velocity、gravity 或 sleeping 的目标状态；一次性 solver 操作使用
`PhysicsBodyCommand`，不能用 velocity 覆盖伪装 impulse。首个稳定 command 包含 linear impulse、可选 world-space application
point、angular impulse 和 `wake` / `preserve` policy。

Backend 通过 `capabilities().bodyCommands` 分别声明 linear impulse、application point、angular impulse 和 wake policy，并通过
可选的 `PhysicsScene.applyBodyCommand(...)` 执行。返回值必须明确区分 `applied`、`body-missing`、`invalid-command`、
`unsupported` 和 `body-kind-mismatch`；dimension 或 body kind 不匹配不能静默近似。

Prediction island 通过 `body-command` command variant 把 member id 映射成 scene body id，继续复用 tick、sequence、stable
sorting、duplicate/conflict、history 和 replay budget。同一 duplicate sequence 不得再次施加 impulse；checkpoint restore 后必须按
相同顺序得到同一结果。具体决策见 `docs/adr/0051-backend-neutral-physics-body-commands.md`。

## GameModule 集成

标准 Physics module 负责把 World 与 PhysicsScene 连接起来：

```txt
before physics step
→ 读取 World physics components / transform / velocity / command
→ 创建、更新、销毁 backend body/collider
→ 应用 kinematic target、force、impulse、gravity override

physics step
→ backend.step(fixedDelta)
→ 收集 contact enter/exit、trigger、query result 和 diagnostics

after physics step
→ 把 body transform / velocity 写回 World component
→ 发低频 contact enter/exit EventBus fact
→ 写 physics trace / profiler span
```

推荐 helper：

```ts
export type PhysicsModuleOptions = {
  backend: PhysicsBackendAdapter | PhysicsBackendFactory;
  scene: PhysicsSceneConfig;
  handle?: PhysicsHandle;
  interpolationStore?: PhysicsInterpolationStore;
  bindings: PhysicsWorldBindings;
  eventPolicy?: PhysicsEventPolicy;
  save?: PhysicsSaveOptions;
  trace?: PhysicsTraceOptions;
};

export function createPhysicsModule(options: PhysicsModuleOptions): GameModule;
```

Physics module 跟随 GameRuntime lifecycle。`stop()` 后不继续 step；`dispose()` 必须释放 backend scene、订阅、body/collider handle map、query cache 和 trace buffer。

### Fixed-step presentation interpolation

Physics module 可以绑定由组合层创建的 `PhysicsInterpolationStore`，为 Renderer 和 follow camera 提供 previous/current fixed-step transform 与当前 accumulator alpha。Store 只跟踪会从 backend 同步回 World 的动态 body；static body、`syncFromWorld` body 和 gameplay authority 不读取该表现状态。

默认 policy 对 position/vector 做线性插值、对 2D number rotation 做最短角插值、对 quaternion 做归一化线性插值。需要 step/snap、定制曲线或识别 teleport 等不连续状态时，组合层可以在创建 store 时注入 `policy.interpolate` 和 `policy.shouldResetHistory`；回调输入是深只读 history view，避免扩展代码污染 store 内部缓存。Physics Core 不内置游戏单位、移动速度或 teleport 阈值。自定义 interpolator 仍只能产生 transient presentation transform，不能改变权威 state。

`sample(bodyId, target?)` 支持 caller-owned reusable target，避免 transform hot path 每帧分配。World、PhysicsScene、Save、multiplayer snapshot 和 query 始终使用 fixed-step 后的权威 transform；checkpoint restore、body removal 和 module dispose 必须清理或重置插值历史。远端网络 snapshot interpolation 属于 Multiplayer presentation buffer，不由这个 store 代替。

## Physics Handle 与依赖注入

`createPhysicsModule(...)` 是一局游戏内 live `PhysicsScene` 的唯一 owner。它负责创建 scene、推进 fixed step、同步 World、发 contact event、写 trace，并在 GameRuntime dispose 时释放 backend scene。业务模块、AI、Combat、交互选择、placement preview 和 Editor 工具不应各自创建新的 `PhysicsScene` 来做查询。

为了让其他 GameModule 使用同一个 scene，Physics Core 可以提供一个可注入的 handle / facade。组合层为每个 physics scene 创建一次 handle，并把同一个 handle 同时传给 `createPhysicsModule(...)` 和需要物理查询的 gameplay module：

```ts
const worldPhysics = createPhysicsHandle();

const modules = [
  createPhysicsModule({
    backend,
    scene: { dimension: "2d", gravity: { x: 0, y: 9.8 } },
    handle: worldPhysics
  }),
  createCombatModule({ physics: worldPhysics }),
  createAiModule({ physics: worldPhysics })
];
```

Handle 只暴露窄接口，不拥有 scene，也不 boot backend：

```ts
export type PhysicsQueries = {
  query(query: PhysicsQuery): PhysicsQueryResult[];
  queryPoint(point: PhysicsVector, options?: PhysicsQueryOptions): PhysicsQueryResult[];
  raycast(
    origin: PhysicsVector,
    direction: PhysicsVector,
    options?: PhysicsQueryOptions & { maxDistance?: number }
  ): PhysicsQueryResult[];
  shapeCast(
    shape: PhysicsShapeDefinition,
    position: PhysicsVector,
    direction: PhysicsVector,
    options?: PhysicsQueryOptions & {
      maxDistance?: number;
      rotation?: PhysicsRotation;
      stopAtPenetration?: boolean;
      targetDistance?: number;
    }
  ): PhysicsQueryResult[];
  overlapShape(
    shape: PhysicsShapeDefinition,
    position: PhysicsVector,
    options?: PhysicsQueryOptions & { rotation?: PhysicsRotation }
  ): PhysicsQueryResult[];
  checkOverlap(
    shape: PhysicsShapeDefinition,
    position: PhysicsVector,
    options?: PhysicsQueryOptions & { rotation?: PhysicsRotation }
  ): boolean;
  checkCollision(colliderId: PhysicsColliderId, options?: PhysicsQueryOptions): boolean;
  queryBounds(bounds: PhysicsBounds, options?: PhysicsQueryOptions): PhysicsQueryResult[];
  snapshot(): PhysicsSceneSnapshot;
};

export type PhysicsHandle = PhysicsQueries & {
  captureCheckpoint(): PhysicsRuntimeCheckpoint;
  restoreCheckpoint(
    checkpoint: PhysicsRuntimeCheckpoint,
    options?: PhysicsCheckpointRestoreOptions
  ): void;
  isBound(): boolean;
};

export function createPhysicsHandle(): PhysicsHandle;
```

`createPhysicsModule(...)` 在 install 时把 handle 绑定到自己创建的 scene 和 checkpoint controller，在 dispose 时解绑。Handle 在未绑定、已 dispose 或重复绑定时必须给出明确 `GameError`，不能静默创建 fallback scene。测试可以向业务模块注入 fake `PhysicsQueries`，不需要启动 Rapier 或真实 backend。

多人跨模块回滚由 App Host 的 `createStandardMultiplayerPhysicsRollbackContributor(...)` 把 `PhysicsHandle` 接入
Multiplayer rollback coordinator。标准 order 为 200，排在 World identity/component restore（100）和 RNG（150）
之后；可选 `resolveEntityId` 与 Physics checkpoint restore 使用同一 mapping，并在任何 contributor 写入前检查 remap
collision。App 不直接调用一串 World/Physics/RNG restore 来表达通用回滚顺序。

依赖注入优先使用显式 module options：

```ts
createTargetingModule({
  physics: worldPhysics,
  teamRules,
  eventBus
});
```

App Host/profile 可以持有 physics handle、backend factory、layer registry 和 DataRegistry，用于组合标准 GameModule；但 App Host 不直接持有 live gameplay `PhysicsScene`。若一个 app 确实需要多个物理场景，应创建多个具名 handle，例如 `worldPhysics`、`previewPhysics`、`serverValidationPhysics`，并让每个 handle 只绑定一个 owner module。

## World 边界

World 是 gameplay runtime state 的稳定集成面；PhysicsScene 是底层模拟状态。

Physics Core 可以提供标准 component definition 或 component helper，例如：

- `PhysicsBodyComponent`
- `PhysicsColliderComponent`
- `PhysicsVelocityComponent`
- `PhysicsForcesComponent`
- `PhysicsContactsComponent`
- `PhysicsTransformBindingComponent`

长期规则：

- `EntityId` 与 `PhysicsBodyId` 不强制相同。绑定关系由 Physics module 私有 map 或显式 component 维护。
- Dynamic body 在一次 physics step 内由 backend 推进；step 后把稳定 transform / velocity 写回 World。
- Kinematic body 的目标位置、移动意图或速度可以由 World system 写入，再由 Physics module 应用到 backend。
- Static collider 可以由 Data / map / level module 物化，不需要成为 gameplay actor。
- World component 不保存 backend body object、collider handle、manifold、broadphase cache 或 solver private state。

Renderer sync 应读取 World 中同步后的 transform，或读取 Physics module 提供的稳定 snapshot；不要直接从 renderer native object 或 physics backend handle 推导 gameplay 权威状态。

## DataType

Physics Core 可以注册内置 DataType：

- `physics.material`
- `physics.body`
- `physics.collider`
- `physics.scene`
- `physics.layout`

这些类型只描述可重建配置，不表达具体玩法业务语义。

`physics.layout` 是关卡或场景的 companion gameplay data：它引用 `physics.body` / `physics.collider` prototype，并用稳定 instance id、transform 和可选 body/collider override 描述批量静态或动态几何。Body override 不重复定义 instance position/rotation，只覆盖 prototype 的 kind、damping、gravity、velocity 或 user data；布局坐标始终只有一个来源。2D bounds 不带 z，3D bounds 必须同时提供有效的 min/max z。`createPhysicsLayoutModule(...)` 负责在 GameRuntime install 时把布局物化为标准 World physics components，并只清理自己创建的 entity。它不读取纹理像素、不依赖 Renderer，也不把图片、tilemap 或具体 backend handle 放入 Physics Core。

同一 layout body 可以承载多个 collider instance。墙体、掩体等静态场景几何应优先批到少量 static body 上，保留独立 collider id 供 query/contact/DevTools 使用，避免为了每个矩形创建一个刚体。动态对象仍应使用独立 body entity。

示例：

```ts
export type PhysicsBodyData = {
  kind: PhysicsBodyKind;
  colliders?: Array<DataRef<"physics.collider">>;
  material?: DataRef<"physics.material">;
  tags?: string[];
};
```

游戏可以在自定义类型中引用 physics 定义：

```ts
export type MonsterArchetype = {
  actor: DataRef<"gas.actor">;
  renderObject: DataRef<"render.object">;
  physicsBody: DataRef<"physics.body">;
};
```

DataRegistry 只负责校验引用和字段；Physics module 负责在 runtime 中把 definition 物化成 body/collider。游戏自己的 hitbox/hurtbox、阵营、可命中规则、投射物 owner、pierce 和 damage channel 仍属于游戏或 GAS/TCA 数据，不进入 Physics Core。

## Contact 与 EventBus

Physics 是高频系统，EventBus 只能承载低频事实。

允许进入 EventBus 的事实：

- `physics.contact.enter`
- `physics.contact.exit`
- `physics.trigger.enter`
- `physics.trigger.exit`
- `physics.body.sleep`
- `physics.body.wake`

不进入 EventBus 的内容：

- 每帧完整 contact manifold。
- 每帧 position / velocity patch。
- broadphase pair cache。
- backend private collision object。
- 大规模 query result 全量广播。

需要连续碰撞信息的系统应通过 PhysicsScene query、PhysicsContactsComponent 或 Physics module 的窄 snapshot 读取。Contact event 必须包含稳定 body/collider/entity id 和 filter metadata，不能携带 backend native handle。

## 空间查询

Physics Core 提供统一 query envelope。`scene.query(query)` 是最低层稳定入口，便捷 helper 只能包装该入口，不能引入另一套语义。

```ts
export type PhysicsQuery =
  | PhysicsPointQuery
  | PhysicsRaycastQuery
  | PhysicsShapeCastQuery
  | PhysicsOverlapQuery
  | PhysicsCheckQuery
  | PhysicsBoundsQuery;

export type PhysicsQueryOptions = {
  filter?: PhysicsCollisionFilter;
  triggerInteraction?: "use-scene" | "include" | "exclude" | "only";
  mode?: "any" | "closest" | "all";
  sort?: "none" | "distance";
  maxResults?: number;
  ignoreBodies?: PhysicsBodyId[];
  ignoreColliders?: PhysicsColliderId[];
  includeBodies?: PhysicsBodyId[];
  includeColliders?: PhysicsColliderId[];
};

export type PhysicsQueryResult = {
  colliderId: PhysicsColliderId;
  bodyId?: PhysicsBodyId;
  entityId?: EntityId;
  point?: PhysicsVector;
  normal?: PhysicsVector;
  distance?: number;
  fraction?: number;
  inside?: boolean;
  sensor?: boolean;
};
```

查询族：

- `point`：测试一个点命中的 collider，常用于鼠标拾取、placement preview 和 Editor 选择。
- `raycast`：从 origin 沿 direction 查询到 `maxDistance`，对应常见 Raycast / Linecast。
- `shape-cast`：把 box、circle/sphere、capsule 或其他支持的 shape 沿方向 sweep，覆盖 SphereCast、BoxCast、CapsuleCast 等用例。
- `overlap`：在 position / rotation 放置 shape，返回重叠 collider，覆盖 OverlapSphere、OverlapBox、OverlapCapsule 等用例。
- `check`：只回答 boolean 的 overlap / pair test，可由 backend 走 no-allocation 快速路径。
- `bounds`：AABB / bounds 查询，用于大范围候选集、Editor 框选和 DevTools。

查询 option 规则：

- `filter` 使用与 collider collision 相同的 layer/mask 语义。
- `triggerInteraction` 明确 sensor/trigger 是否参与查询；不要用碰撞 layer 隐式表达 trigger 规则。
- `mode: "any"` 可以在第一个有效命中后停止，适合 line of sight、ground check、placement check。
- `mode: "closest"` 返回最近命中；backend 不支持 closest fast path 时可以用 all + sort 实现，但必须在 capability 中声明。
- `mode: "all"` 返回所有命中；`sort: "distance"` 要求 adapter 归一化排序，否则保持 backend/native 顺序并在 capability 中声明。
- `maxResults` 是上限，不是分页协议。需要分页或 streaming 的 Editor 工具应使用 adapter native path。
- `ignoreBodies` / `ignoreColliders` 常用于忽略发起者、当前拖拽物或已知友方 collider；它们不改变 scene-level collision matrix。

Query result 只返回稳定 id 和归一化几何信息。Backend native hit、manifold、feature id、triangle id 和内部 collider handle 只能通过 adapter native path 暴露。

查询可以被 gameplay、Editor、AI、targeting、placement preview 和 DevTools 使用。高频查询结果不进入 EventBus；需要观察 query 行为时使用 trace sampling 或 DevTools pull snapshot。

Core 可以提供便捷 helper，例如 `raycast(...)`、`shapeCast(...)`、`overlapShape(...)`、`checkOverlap(...)`、`checkCollision(...)` 和 `queryBounds(...)`。这些 helper 必须薄包装 `PhysicsQuery`，以保证 backend conformance tests 能覆盖同一条协议路径。

GameModule 内部需要做 targeting、line of sight、ground check 或 placement validation 时，应通过依赖注入得到 `PhysicsQueries` / `PhysicsHandle`，不要 import adapter 包、访问 backend native object，也不要为了查询创建新的 scene。业务模块可以在查询结果返回后结合 GAS/TCA/Data/component 解释 team、damage channel、owner ignore 和 ability target rule。

## Backend 与 Driver

Rapier、Matter.js、Box2D 这类独立物理库通常是 Physics backend adapter，不是 Driver。它们只拥有 physics scene，不拥有 renderer/input/camera/asset runtime。

Phaser Physics 不同：Arcade / Matter physics 绑定在 Phaser Game / Scene runtime 内。它应由 `@gamekits/driver-phaser` 持有 Phaser runtime，再从同一个 runtime slice 暴露 Physics backend adapter。该 adapter 不创建 `Phaser.Game`，也不把 Phaser Scene 交给可复用 gameplay module。

Three.js 本身不是物理引擎。Three Driver 不应为了 3D 物理直接承担 physics solver；如果 3D app 使用 Rapier、Cannon、Ammo、Jolt 或其他后端，应通过 Physics backend adapter 接入，再由 presentation layer 同步到 Three render object。

## Save 边界

Physics 可以提供 `createPhysicsSaveContributor()`，但 Save payload 只能保存可恢复的稳定状态：

- body id / stable entity mapping。
- body kind、transform、velocity、sleep state。
- collider definition id、runtime enabled state、sensor/filter state。
- 需要长期恢复的 joint / constraint 状态。

不保存：

- backend native handle。
- broadphase、narrowphase、manifold、solver cache。
- transient interpolation state。
- debug draw buffers。
- query cache、contact pair cache。

Load 时应先恢复 World entity，再由 Physics contributor 重建 backend scene。若 body id 在 load 后重映射，Physics contributor 必须使用 Save restore context 的 entity mapping。

标准 Physics checkpoint 还保存 fixed-step accumulator，保证半步保存后可以从同一模拟边界续跑。Capture 将 live
position/rotation/velocity 与静态 body definition 分离，避免 restore 后动态初始值写回 definition 造成等价 replay hash
漂移。Restore 先销毁 module-owned backend body/collider 与反向索引，再恢复稳定 World component；下一次 physics
system tick 从 World 重建 scene。Contacts、trace、native id、active pair 与 solver cache 均不恢复。

## DevTools 与 Trace

Physics 必须从一开始提供可解释入口：

- Physics scene snapshot：body/collider count、dimension、backend kind、gravity、fixed step、active/sleeping summary。
- Presentation interpolation snapshot：alpha、fixed delta、tracked body count；不展开每个 body 的逐帧 transform。
- Body / collider detail：entity binding、definition id、shape summary、material、filter、last transform。
- Contact trace：enter/exit、sensor、filter、entity ids、correlation id。
- Query trace：query type、filter、hit count、duration、caller source。
- Performance：step duration、sync duration、created/destroyed body count、query cost。

DevTools Core 不接收 backend native handle。Backend-specific DevTools plugin 可以显式依赖 adapter 包读取更深的 native summary，但必须保持可选。

Physics trace store 可以配置轻量 entry hook，由 App Host 或 app-specific composition 映射到 DevTools correlation source。Hook 和 error reporter 的异常会被 store 隔离，不能中断 step、contact 或 query 结果。Physics entry 只传播调用方明确提供的 `correlationId` / `parentId`；core 不根据 entity、contact 时间或 collider id 推断 combat 因果，通用 DevTools 映射也不默认透传任意 `payload`。

## Determinism

Physics module 应默认使用 fixed timestep 和稳定 system order，减少不同 frame delta 带来的差异。

长期规则：

- Physics step 使用固定 `fixedDelta`，外部 Host tick delta 只用于 accumulator。
- Presentation 可以读取 accumulator alpha 做 transient interpolation，但不能把插值结果写回 World 或用于 gameplay decision。
- 同一 tick 内的 create/destroy/update 顺序应稳定。
- Contact event 排序应按稳定 body/collider id 或 backend-provided pair id 归一化。
- Backend snapshot 只承诺 GameKits 层稳定字段，不承诺 native memory layout。
- 只有 backend 明确声明 deterministic profile 时，游戏才能把它用于 rollback / lockstep 级别的确定性假设。
- Prediction-island restore 必须恢复所有会在 replay window 内相互作用的 body、constraint 与 spawn/despawn
  顺序；一个 body 对未来 tick 的 dynamic scene 重放不能称为确定性 rollback。

## 测试要求

`@gamekits/physics-core` 必须提供 conformance helper。新增 backend adapter 时至少覆盖：

- scene lifecycle、dispose cleanup。
- create/update/destroy body。
- create/update/destroy collider。
- fixed step 后 transform / velocity 行为。
- fixed step 间的 presentation sample、最短角/向量/quaternion 插值、reusable target 和 dispose/reset cleanup。
- static / dynamic / kinematic 基本语义。
- sensor 与 solid contact enter/exit。
- collision filter。
- point / raycast / shape cast / overlap / check / bounds query。
- query trigger interaction、filter、ignore list、closest/all/any mode 和 result ordering。
- body/collider id 与 entity binding。
- 大量 contact 的 entity mapping 使用 body/collider 反向索引，query 次数不随 contact 数量增长。
- entity despawn、body/collider component 移除或 disabled 后释放 backend handle 和反向索引。
- snapshot 不暴露 native handle。
- Save capture/restore 可重建 scene。
- 单主体 prediction transition 覆盖静态碰撞、checkpoint hit/miss、hard reset、history limit 和 dispose。
- 声明 prediction-island capability 的 backend 额外覆盖多 dynamic body 交互、完整 checkpoint restore、
  spawn/despawn replay、partial-member rejection、history overflow 和 retained-state cleanup。
- 声明 body-command capability 的 backend 必须通过 `@gamekits/physics-core/testing` 的共享 conformance，覆盖 missing/static
  rejection、linear/angular impulse、application point、wake policy 与 checkpoint replay；backend adapter 只能补专属误差容限和
  native capability 测试，不能复制另一套 contract。

Adapter 专属测试再覆盖底层库能力，例如 Rapier WASM 初始化、Phaser Scene 绑定、Matter compound body 等。

## 最佳实践

### 模块集成

- Physics 作为 GameModule 集成，随 GameRuntime tick 推进；不要把 gameplay physics scene 默认注册成 App Host standard service。
- 使用 App Host 标准组合时优先声明 `standardModules.physics`；需要自定义安装顺序或多 scene 时，仍可在 `game.modules` 中直接调用 `createPhysicsModule(...)`。
- App Host/profile 可以准备 backend factory、driver physics adapter、DataRegistry、SaveManager 和 DevToolsRuntime，但 Physics scene 生命周期跟随 GameRuntime。
- 组合层为每个 live physics scene 创建一个具名 `PhysicsHandle`，并把它同时注入 `createPhysicsModule(...)` 和需要查询的 gameplay module；handle 不拥有 scene，只由 Physics module 绑定和解绑。
- 需要平滑本地物理表现时，由组合层创建一个 `PhysicsInterpolationStore` 并通过 `standardModules.physics.interpolationStore` 或直接 module option 注入 Physics module，同时注入 Renderer sync 和 camera target resolver；不要在游戏、Renderer 或 Camera 中各自维护 previous transform 与 accumulator。
- 只有应用组合层知道的移动尺度、teleport 语义或表现曲线应通过 interpolation policy 注入；Physics Core 只提供默认数学策略和 history lifecycle，不写死游戏阈值或对象类别。
- 独立物理库进入 `physics-*` adapter 包；绑定完整外部 scene runtime 的物理能力由对应 Driver 暴露 runtime slice。
- Physics module 的 World sync 顺序必须明确。常见顺序是 input/AI 写意图，physics step 推进，再把 transform/velocity 写回 World，最后 renderer sync。
- Physics module 在 World sync 时维护 body/collider handle 到 entity 的反向索引，并在 component disabled、entity despawn 或 handle replacement 时释放 stale backend handle；contact 热路径不能为每个 contact 扫描 World。
- 场景几何通过 `physics.layout` + `createPhysicsLayoutModule(...)` 物化；layout module 与 Physics module 使用同一组 World component binding，并安装在 Physics step module 之前。每个 module 只清理自己创建的 entity，不以全量 World despawn 代替 lifecycle ownership。
- Authority 使用物理 solver 且客户端只预测一个主体与静态 layout 时，通过
  `createPhysicsBodyPredictionTransition(...)` 创建每个 binding 独立的 speculative scene；backend 在 app/profile
  层初始化，transition 只接收 `PhysicsBackendAdapter`。使用 `createPhysicsLayoutDefinitions(...)` 复用权威
  layout，不复制 collider placement；通过 `maxCachedFrames` 约束 sequence checkpoint，观察 `cachedReplays`、
  `replayCacheMisses` 和 `cachedFrames`。Multiplayer managed replication 负责 transition 的创建、诊断透传和释放。
- 多个 dynamic/kinematic body 或 predicted spawn 在 replay window 内会相互影响时，必须选择显式
  `createPhysicsPredictionIsland(...)`，并同时限制 history ticks、member/spawn count、checkpoint bytes 和每帧
  replay work；authority snapshot 必须包含该 tick 的完整成员集合，先完成 predicted-spawn matching 再 reconcile。
  不能继续扩大单主体 helper 或在 app 中复制半套 scene snapshot。普通 Multiplayer 组合使用 App Host 的
  `createStandardMultiplayerPhysicsPredictionDomain(...)`；它统一托管 predicted identity、reconcile 状态和 hard
  correction fallback。Island 的 `hardCorrect(...)` 只接受完整、合法、容量内的 authority snapshot，先解析所有
  缺失 member definition，再以该 tick 建立新的单 checkpoint baseline 并清空旧 command/history；失败不能部分改写 scene。
- Prediction client 使用默认 `historyMode: "rollback"` 保存完整逐 tick solver history；只向前推进且不提供 reconcile 的
  authority 可以显式使用 `historyMode: "initial-only"`，只保留 reset baseline 并逐 tick 释放已消费 command。两种模式不能由
  app 私下维护第二套 history。Auxiliary contributor 若提供 `cloneCommand`，必须深度隔离所有可变字段；未提供时 Core 使用
  `structuredClone` 安全默认值。
- Character motor、可重演 cooldown 等会改变同 tick Physics command、但不属于 solver checkpoint 的少量确定性状态，必须通过
  `PhysicsPredictionIslandAuxiliaryContributor` 注册给 island。Contributor 使用唯一 id/version 和稳定 order，提供
  capture/validate/restore/reconcile/reset/hash/measure/dispose；island 把 solver 与所有 contributor 作为一个原子 checkpoint，
  统一限制 contributor 数、单 contributor bytes、总 checkpoint/history bytes 和 replay work，并在 hard correction、generation
  reset 与 dispose 时一起处理。Contributor 只通过受限 simulation facade 读写 island member，不得持有第二个 scene、推进 solver、
  捕获整个 World/AI/match/presentation 状态，或与通用 Physics rollback contributor 重复拥有 solver state。
- 多人 arena 集成优先使用 App Host 标准 Physics Arena adapter；Authority 显式发布完整 membership revision 和
  definition version；注册 auxiliary contributor 时还要发布同 tick 的完整、按 id 排序的 auxiliary state envelope。应用只提供
  member/input/presentation mapping 和 contributor factory。不要让 client 根据摄像机范围猜 island，也不要让 arena island 与
  PhysicsHandle rollback contributor 捕获同一批 body。
- 离散 throw/projectile 需要预测 body 时，通过标准 Arena adapter 注册 correlation + tick + member；authority correlation 与
  definition 从 typed app snapshot 解析。Physics projection 会清洗 body `userData`，业务不得把它当 wire identity。Rejected 或
  delayed spawn 由同一 island reconcile/hard correction 清理，不在表现层直接销毁 solver body。
- 新 backend 先通过 physics conformance tests，再补 backend-specific behavior test。真实 canvas 或 Phaser Scene 只用于少量集成测试。
- Backend-specific shape-cast 测试必须区分世界空间 contact point 与移动 shape origin，并至少用一个非零半径/
  half-extent 断言 origin 停在 blocker 外；只断言 collider id 会遗漏整半径的穿透错误。
- 改动 Physics World sync、contact mapping、interpolation sampling 或 handle lifecycle 时运行 `corepack pnpm bench:physics:check`，用大实体/固定 contact profile 与大量 reusable-target sampling 观察数量级回归和 dispose 后 retained state。
- 把 Physics trace 接入跨模块 timeline 时使用有界 trace store 和增量 entry hook；不要每帧读取并合并完整 trace history。修改该路径时运行 `corepack pnpm bench:diagnostics:check`。

### 模块使用

- 业务代码只依赖 `@gamekits/physics-core`、World component、query API 和低频 contact event，不直接 import Rapier、Matter、Phaser Physics 或 backend body 类型。
- 需要 raycast、overlap、check 或 point query 的业务模块通过 DI 接收 `PhysicsQueries` / `PhysicsHandle`；测试中注入 fake queries，生产组合中注入 Physics module 绑定的 handle。
- Damage、team/faction、hit/hurt rule、projectile owner、pierce、ability activation 等玩法语义应在游戏模块、GAS 或 TCA 中解释；Physics 只回答空间、碰撞和运动事实。
- Collision layer/mask 只表达物理过滤；不要把所有玩法 target rule 都塞进 physics filter。需要命中后解释的规则应放在 gameplay 数据中。
- 整张背景图、tilemap 或模型只负责表现，不能被 gameplay 当成隐式碰撞来源。关卡必须提供显式 `physics.layout`、tile collision layer 或 mesh collider companion；运行时不要逐像素扫描图片生成 collider。模块化静态场景应以 app-owned scene instance 为唯一 transform/footprint 来源，同时派生 RenderObject placement 与 collider，并用内容测试逐实例比较 position、rotation 和 shape；只锁定整张场景 bounds 不能防止物体漂移。
- 高频移动、碰撞和查询留在 physics/world system 内；不要把每帧 contact manifold、position patch 或 query result 全量发到 EventBus、React UI 或 DevTools UI。
- Renderer/camera 可以读取 interpolation store 的 transient sample；碰撞、能力目标、AI、Save 和 multiplayer authority 仍只读取 World / PhysicsScene 权威 transform。
- 物理 prediction 的 input mapping 可以表达期望 velocity/kinematic target 和非物理 state 更新，但不能在游戏层再次调用 backend `step()`、维护 solver cache 或手写碰撞近似。单主体匹配 checkpoint 只表示公开 body 基线一致，用于避免无意义 replay；它不是完整 solver 存档。Backend 未承诺 deterministic 时仍保留 reconciliation；correction 是安全网，不是长期模型差异的替代品。
- Character motor、Combat knockback、道具投掷和机关冲击通过 `PhysicsBodyCommand` 提交 impulse；业务代码只声明物理量与稳定
  correlation，不读取 native mass/handle 自己换算 velocity。Kinematic target 继续使用显式 position/rotation patch，直到独立
  capability 证明需要新的 command。
- 可见 projectile 会被 blocker、target、bounce 或 expire 改变轨迹时，presentation 不能只沿初始 velocity 前进。
  简单可重放弹丸使用 Combat 的 kinematic fire/finish record 与同一 Physics sweep；复杂动态交互对象使用
  prediction island；Physics Core 不决定 damage 或 authority hit confirmation。
- Save 只保存可恢复 physics state，不保存 backend cache。Load 后由 Physics module 重建 scene 并恢复 stable body/entity mapping。
- 修改 Physics checkpoint、backend reset 或 restore rebuild 时运行 `corepack pnpm bench:checkpoint:check`；该基准将 restore 与首个 rebuild tick 一起计量。
- 修改 prediction island、predicted rigid projectile 或 scene checkpoint 时同时运行
  `corepack pnpm bench:projectile-prediction:check`；该基准约束完整岛 checkpoint capture、late-command restore、
  resimulation、authority hard correction、p95、history bytes/hard limit 与 dispose retained state。
- Prediction replay 热路径在 queue 时取得 command ownership，执行时 backend adapter 不得修改或长期持有 patch；未来 history
  截断只能从有序尾部删除。性能优化不能跳过 replay tick、checkpoint 或仍会碰撞的 member。
- 需要后端专属能力时，通过显式 native path 使用具体 adapter 包，并把这段代码限制在 app-specific integration、Editor backend panel 或 DevTools plugin 中。
