# ADR 0052：可复用 Character Controller Toolkit

## 状态

Accepted

## 背景

Arena 现有 `createArenaActorMotionPatch(...)` 只把 move 映射成水平速度，并用垂直速度阈值判断 jump。它无法可靠表达 ground
probe、坡度、台阶、coyote time、jump buffer、moving platform、dive、stagger 和 rollback state。把这些逻辑继续写在 Arena
authority/client session 中会复制 Physics query、timer、checkpoint 与 diagnostics；把它们塞进 Physics Core 又会让底层 facade
拥有具体角色玩法。

GameKits 需要可复用的角色 motor，但不需要自研完整 locomotion engine。该能力必须是可选 gameplay toolkit，使用 Physics Core
协议驱动成熟 solver，并让玩家和 authority AI 消费同一种 intent。

## 决策

### 独立可选包

新增 `@gamekits/character-controller`。它只依赖 GameKits Core/Data、Physics Core，以及实现 GameModule helper 时所需的
GameRuntime/World 协议；不依赖 DOM、Input adapter、Renderer、Camera、Three、Rapier、AI 或 Multiplayer。

Physics Core 继续只拥有 body/query/command/checkpoint。Arena 的拾取、使用、投掷、攻击、淘汰和胜负不进入 controller 包。

### 公共领域模型

首个公共 contract 包含：

```ts
export type CharacterControlIntent = {
  move: PhysicsVector;
  facing?: PhysicsVector;
  jumpPressed: boolean;
  jumpHeld: boolean;
  divePressed: boolean;
};

export type CharacterMotorDefinition = {
  maxGroundSpeed: number;
  groundAcceleration: number;
  groundBraking: number;
  airAcceleration: number;
  maxSlopeRadians: number;
  stepHeight: number;
  groundProbeDistance: number;
  coyoteTimeMs: number;
  jumpBufferMs: number;
  jumpSpeed: number;
  diveSpeed: number;
  diveDurationMs: number;
  recoveryDurationMs: number;
};
```

`CharacterMotorState` 显式保存 locomotion mode、grounded、ground normal/body、platform velocity、facing、coyote/buffer/dive/
recovery timers 和必要的稳定 tick。字段必须为 backend-neutral、可 clone/hash/checkpoint；native controller、collider handle、动画
状态和 input device state 不得进入其中。

### Pure Motor 与 Runtime Helper

底层提供 pure fixed-step transition：输入是 definition、前一 motor state、`CharacterControlIntent`、只读 body state/query facade、
tick/delta；输出是下一 motor state、Physics body commands/patches 和有界 trace。Transition 不读取 wall clock，不直接提交 EventBus、
GAS、Audio、Renderer 或 Camera 副作用。

标准 runtime/helper 负责：

1. 在 fixed tick 开始前读取 body 与 ground/platform query；
2. 归一化并限制 intent；
3. 运行 pure motor；
4. 按稳定顺序提交 Physics command/patch；
5. capture/restore/reset motor state；
6. 汇总 grounded/mode/transition/rejection 与预算 diagnostics。

Camera-relative 输入由 app/input composition 先转换为 world-space desired direction。AI 只能写同一 `CharacterControlIntent`，不能
绕过 motor 直接更新 body。

### Backend Strategy 边界

默认 motor 只依赖 `PhysicsQueries`、`PhysicsBodyState` 和 ADR 0051 body command。若某 backend 的 step/slope semantics 不能由通用
query 合理实现，包允许注册窄的 backend strategy，但 strategy 只能映射 probe/step/ground resolution，不能把 native type暴露到
definition/state/intent。

Arena 是第一个真实 consumer；Physics 3D Lab 必须作为第二 fixture 提供 controller course。至少用 memory fixture 验证 pure timer/
state contract，用 Rapier3D course 验证平地、坡、台阶、移动平台、边缘、推挤、落地和 dive/recovery。后续 2D 游戏可复用 intent/
state contract，但不强迫首轮 motor 同时承诺所有 2D backend 语义。

### Multiplayer 与表现

Controller 包不依赖 Multiplayer。Motor state 通过显式 checkpoint contributor 接入 prediction/rollback；authority frame 只复制客户端
重演所需的最小 auxiliary state。Animator、Audio、Camera 和 UI 只消费 motor mode/facts，不通过动画 marker决定 jump、hit 或 recovery
结束。

## 备选方案

### 继续把 controller 留在 Arena

拒绝。Physics 3D Lab、未来派对竞技和动作游戏会再次实现相同 ground/timer/replay 逻辑，也无法形成 backend conformance。

### 把 controller 并入 Physics Core

拒绝。角色 locomotion 是可选 gameplay policy，不是每个 Physics consumer 都应承担的 facade 语义。

### 直接采用 Rapier character controller 作为公共 API

拒绝作为 GameKits 公共边界。可以在窄 backend strategy 中使用成熟实现，但 native state、配置和行为差异不能泄漏给 gameplay、
Data 或多人 snapshot。

## 后果

- 仓库新增一个可选 gameplay package 和对应模块文档、conformance、benchmark 与第二 fixture。
- Arena 不再维护 authority/prediction 两套 motor；玩家和 AI 共享 intent 与 transition。
- Physics Core 不因具体 locomotion 规则膨胀，Input/Camera/Renderer 依赖方向保持不变。
- Ragdoll、攀爬、游泳、载具和完整 root-motion locomotion 不在首轮 contract 中。
