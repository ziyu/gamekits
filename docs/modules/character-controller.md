# Character Controller 模块

## 定位

`@gamekits/character-controller` 是可选 gameplay toolkit，把玩家或 AI 的 world-space 语义意图转换为 backend-neutral Physics
patch/command，并维护可 checkpoint 的角色 motor state。它不读取输入设备、Camera、Renderer、AI blackboard 或 Multiplayer，
也不决定攻击、伤害、淘汰和胜负。

Physics Core 继续拥有 body/query/command/checkpoint 协议和 solver adapter；Character Controller 只拥有 locomotion policy。Rapier、
Phaser、Three 或其他 native controller 类型不能进入本包公共 API。

## 包边界

```txt
character-controller → core / data / physics-core
arena / physics lab → character-controller + physics backend
character-controller -X→ input / camera / renderer / ai / multiplayer / rapier
```

首轮公共能力分为三层：

- `CharacterControlIntent`：玩家和 AI 共用的 move/facing/jump/dive 语义输入与稳定 sequence。
- `createCharacterControlIntentBuffer(...)`：在 presentation/input sampling 与 fixed tick 不同频时保留 jump/dive 离散边沿；连续
  move/facing/held 使用最新样本，每次 fixed tick 消费后才清除边沿。
- Pure motor：读取已编译 definition、上一状态、Physics body state 和本 tick 稳定环境观测，输出下一状态、body patch/command、
  diagnostics 与有界 trace。
- Runtime strategy/helper：负责 ground/ceiling/step query、稳定排序、Physics 提交和 lifecycle；多人 Physics Arena 使用
  `createCharacterMotorPredictionContributor(...)` 把该状态机接入 island，同步重演 timer/state/command，不能由 app 重建
  另一套历史或 timer state machine。

## Definition 与 Data

公共 DataType 为 `character.motor`。Definition 声明 capsule 尺寸、ground/air speed 与 acceleration、坡度、台阶、probe/snap、
jump/coyote/buffer、dive/recovery/cooldown、platform inheritance、stagger/recovery control scale 和 facing rate。

业务启动时必须通过 `compileCharacterMotorDefinition(...)` 验证并冻结 profile；fixed tick 热路径只消费编译结果，不能逐 tick 查询
DataRegistry、解析字符串或容忍 NaN/Infinity。App 可以在编译前组合 carry/surface/stage modifier，但不能复制 motor transition。

## Pure Motor 契约

`stepCharacterMotor(...)` 必须满足：

- 只读取参数，不读取 wall clock、全局 registry 或 native runtime，不提交 EventBus、Audio、Renderer、Camera、GAS/Combat 副作用。
- 相同 definition/state/intent/body/observation/tick/delta 产生相同 command 与 state signature。
- diagonal move 归一化；ground/air acceleration 与 braking 有界，不把 external impulse 在下一 tick 直接清零。
- ground normal 决定 walkable slope；grounded 使用相对支撑面的法向分离速度判定，移动目标投影到 walkable ground tangent，
  并使用独立的小量速度容差吸收成熟 solver 的接触法线/速度噪声；不能复用向量零值 epsilon，也不能用 world-space `velocity.y`
  把上坡或升降平台误判为空中。容差仍须显著小于真实跳跃或击飞速度，过陡面不刷新 ground。Step 只有高度、clearance、landing
  slope 和最终 capsule clearance 全部通过才输出位置 patch。
- platform velocity 先限幅，支撑期间作为相对速度参考；离地只保留 definition 声明的 departure fraction。
- jumpPressed 进入有界 buffer，ground/coyote 有效时按 sequence 只消费一次；held jump、ceiling 和 timer 都由 fixed delta 推进。
- dive 按 sequence 只提交一次 impulse，并经过 duration、recovery、cooldown；stagger 同样通过确定性 timer 进入 recovery。
- `CharacterMotorState` 只保存 backend-neutral 重演字段；query hit/native handle/input device/animation time 不进入 checkpoint。

环境观测是 query/runtime strategy 交给 pure motor 的稳定事实，不是新的 Physics 状态源。Strategy 必须忽略 self collider、使用 stable
closest/sort 规则，并把 query/rejection 数写入 diagnostics。Authority 与 prediction 必须在相同 tick 使用等价观测。

`observeCharacterGround(...)` 是最小 backend-neutral ground strategy：从公开 body state 发起向下 capsule shape cast，排除自身
body/collider 和 sensor，使用 closest/distance contract 生成稳定 ground/surface/platform velocity 事实。Definition 的
`capsuleHeight` 表示包含两端半球的总高度，映射 Physics capsule query 时转换为中段高度；backend 不支持 shape-cast `all` 时不要求
app 分支，标准 helper 使用成熟 backend 均支持的 closest 模式。当贴墙导致 closest capsule cast 的零距离侧面遮蔽脚下地面时，helper
从脚底中心补充一次有界向下 raycast，只恢复符合 slope policy 的向上 support；补探针为空或仍不可行走时保留原侧面事实供 Motor 明确
拒绝，不能把墙或陡坡提升成地面。

完整动态角色应使用 `observeCharacterEnvironment(...)`。它在 ground 事实之上按移动方向依次执行低位阻挡、高位净空、落点和最终
capsule clearance probe，并在上升且保持跳跃时检查 ceiling；输出仍只有 backend-neutral observation、query count 与 rejection count。
特殊 surface strategy 可以在这个结果上窄扩展，但不能另建 locomotion timer。

## Diagnostics 与重演

每次 transition 返回 mode、ground/body/surface、坡度、timer、last consumed sequence、query/rejection、command count 和最多 16 条
语义 trace。`characterMotorStateSignature(...)` 与 `characterMotorCommandSignature(...)` 用于测试、checkpoint hash 和 replay 对照；
它们不是网络 wire format。

`createCharacterMotorPredictionContributor(...)` 只拥有 `memberId → CharacterMotorState`，消费 typed control/remove command，
通过注入的 definition/observation resolver 调用 pure motor，再经 island 的受限 simulation facade 更新 body 和提交 body command。
它不拥有 Physics scene、solver step、input device、AI、match state 或 presentation。Contributor 的 capture/validate/restore/reconcile/
reset/hash/measure/dispose 由 Physics island 统一调度；authority auxiliary envelope 缺失 id、version 不匹配或状态非法时，整次
reconcile 在写入前拒绝。Physics body checkpoint 与 motor timer 必须在同一 tick 恢复；generation、membership 或 definition version
改变时安装完整 baseline，不能跨 stage 继承 timer。

## 集成最佳实践

- App composition 先把 keyboard/gamepad/camera-relative 输入映射成 world-space intent；AI task 写入同构 intent。
- Presentation frame 不能直接拥有 fixed-step intent 的消费时机。渲染帧采到的 jump/dive edge 必须先进入
  `createCharacterControlIntentBuffer(...)`，由 simulation owner 在实际执行 fixed tick 时消费并分配 sequence；`jumpBufferMs` 只负责
  Motor 已收到请求后的 coyote/落地窗口，不能补偿请求在进入 Motor 前被 render frame 清除的问题。
- Authority/prediction runtime 在 fixed tick 前完成 query observation，运行 pure motor，按稳定顺序提交 patch/command，再推进 Physics。
- Arena client 通过 `createAuxiliaryContributors()` factory 为每个 binding baseline 创建新的 motor contributor，并把 control intent
  映射成 island `auxiliary` command；不要跨 membership revision 复用已经 reset/dispose 的 contributor 实例。
- Backend-specific strategy 只映射 probe/step/ground resolution，不拥有 gameplay timer、dive、stagger 或公共 state。
- 新 backend 声明支持前，必须通过 shared motor fixture；Arena 之外至少保留 Physics 3D Lab controller course 作为第二真实 fixture。
- Arena authority 与 client prediction 都创建 `createCharacterMotorPredictionContributor(...)`，Human 和 authority AI 只写同构
  `CharacterControlIntent`；authority projection 发布 contributor checkpoint 和每个 actor 实际 control sequence，client 不再从
  velocity 手写 actor motion patch，也不使用 authority frame tick 猜 jump/dive 去重序列。
- 非多人 fixture 可以直接组合 `observeCharacterEnvironment(...) + stepCharacterMotor(...) + PhysicsScene update/command`；Physics 3D Lab
  保留一个可见 Rapier capsule、键盘 intent 和 motor diagnostics，证明 toolkit 不依赖 Multiplayer 或 Arena。
- Sandbox Character Controller Lab 是面向日常调参与回归的独立可玩 fixture：场景通过 Input Router/game scope 接收局部输入，在 app
  composition 中使用第三人称 camera basis 生成 world-space intent，并在可自由探索的 Rapier3D 综合园区展示可行走/拒绝坡面、台阶、
  低顶、coyote gap、平衡木、多轴移动平台、动态推动与 external impact。第三人称镜头可以由场景表现层组合，但不能进入 motor state、
  checkpoint 或 prediction command。Lab 只能调用公共 compile/observe/step/Physics command 路径；故障注入通过公开 stagger
  observation 与 linear impulse 完成，不能访问 Rapier native controller 或维护 app-local locomotion timer。

## 使用最佳实践

- 业务代码只选择编译后的 profile、写 intent、读取公开 mode/diagnostics；不要直接设置 native velocity 或维护 coyote/dive timer。
- External hit 先通过 Physics body command 提交冲量，再把 bounded stagger duration 作为 motor observation；damage/KO 仍归 Combat/Arena。
- Animation、Audio、Camera 和 UI 只消费 motor semantic state/fact，不能用 marker 或完成回调解锁 gameplay。
- 淘汰成员停止接收 intent，并由 owner 清理 Physics member 和 motor state；不要 teleport 回出生点模拟淘汰。

## 非目标

首轮不承诺 ragdoll、攀爬、游泳、载具、root motion 或所有 2D backend 的同构 step semantics。这些能力需要独立使用证据、窄
strategy 和 ADR，不能膨胀 pure motor 基础协议。

决策背景见 [`ADR 0052`](../adr/0052-reusable-character-controller-toolkit.md)。
