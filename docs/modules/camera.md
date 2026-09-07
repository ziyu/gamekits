# Camera 模块设计

## 定位

Camera 是游戏会话能力和 GameModule toolkit，不是 App Host 标准服务，也不是 Phaser 或 Three.js 私有对象。Input、Cue、TCA、Editor 和 UI 都可能控制 camera，因此需要独立抽象。

相关包：

- `@gamekits/camera-core`
- `@gamekits/driver-phaser`
- `@gamekits/driver-three`

包归属：

- `@gamekits/camera-core`：Game Module toolkit，提供 `CameraController`、camera state、rig、system/action helper。
- Phaser / Three 的 camera sync adapter 由对应 Driver 暴露，把 camera state 应用到底层 renderer camera。

Camera 通常需要 tick、world/entity、input action、TCA action 和 renderer sync，因此应该随 GameRuntime 通过 `createCameraModule(...)` 之类的标准模块 helper 启动。App Host 可以提供 renderer、input、data 等依赖，但不应该长期直接拥有 gameplay camera controller。

## 分层

```txt
CameraState
→ CameraController
→ CameraRig
→ Renderer Camera Adapter
→ Phaser Camera / Three.js Camera
```

Gameplay 和 UI 只知道 CameraController，不知道具体渲染器。

## CameraState

2D：

```ts
export type CameraState2D = {
  mode: CameraMode;
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  viewport: { width: number; height: number };
  minZoom: number;
  maxZoom: number;
  bounds?: { x: number; y: number; width: number; height: number };
  targetEntity?: string | number;
};
```

3D：

```ts
export type CameraState3D = {
  mode: CameraMode;
  position: { x: number; y: number; z: number };
  target?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  fov?: number;
  zoom?: number;
  near?: number;
  far?: number;
  targetEntity?: string | number;
};
```

## CameraController

```ts
export type CameraController = {
  getState(): CameraState2D | CameraState3D;
  setState(state: Partial<CameraState2D | CameraState3D>): void;

  pan(dx: number, dy: number): void;
  zoom(delta: number, anchor?: { x: number; y: number }): void;
  follow(entity: string | number, options?: FollowOptions): void;
  stopFollow(): void;

  shake(config: CameraShakeConfig): void;
  flash(config: CameraFlashConfig): void;
  moveTo(target: CameraMoveTarget, options?: CameraMoveOptions): Promise<void>;

  worldToScreen(point: PointLike): PointLike;
  screenToWorld(point: PointLike): PointLike;
};
```

`zoom(delta, anchor)` 的 `anchor` 表示 camera viewport 内的 screen coordinate，不是浏览器窗口、DOM page 或底层 renderer 原始事件坐标。Input adapter / app bridge 必须先把 pointer 位置归一化到 renderer viewport 坐标，再交给 CameraController。这样滚轮缩放才能以用户实际操作点作为缩放原点，并保持该 screen point 对应的 world point 稳定。

Camera Core 的 2D 坐标转换以 CameraState 为唯一来源：

- `worldToScreen(state, point)`：world coordinate → camera viewport coordinate。
- `screenToWorld(state, point)`：camera viewport coordinate → world coordinate。
- `clientToViewportPoint(point, rect, viewport)`：browser client coordinate → camera viewport coordinate。
- `viewportToClientPoint(point, rect, viewport)`：camera viewport coordinate → browser client coordinate。

这些方法必须考虑 `zoom`、`rotation` 和 viewport 尺寸。业务层、UI overlay、picking 和 renderer adapter 应复用同一套转换，避免 renderer 已应用的 display camera 与 UI/输入仍使用 target camera 造成错位。

## CameraRig

CameraRig 是可复用镜头行为。

候选 rig：

- FreePanRig
- FollowEntityRig
- GridMapRig
- EditorRig
- CinematicRig
- OrbitRig

网格地图或房间制游戏默认适合 `GridMapRig`：

- WASD / 拖拽移动。
- 滚轮缩放。
- 限制在地图 bounds 内。
- 可 follow hero。
- 可被事件临时 shake。

CameraRig 可能注册 system 或监听 EventBus，因此 rig 生命周期跟随 GameRuntime dispose，而不是 App Host dispose。

Follow rig 可以把 `targetEntity` 存在 CameraState 中，但 Camera Core 不解析 entity 位置，也不直接依赖 World。具体 target resolver 由标准 camera module、game module 或 app profile 注入，在 tick 中把 entity / actor / scene object 解析成 world coordinate，再更新 CameraController。这样 camera 能复用 ECS 性能和玩法上下文，同时保持核心模块不绑定任何具体 World adapter 或业务组件。

## 与 Input 的关系

Camera 不直接监听 DOM 或 Phaser input。

```txt
game-scoped input action: camera.pan_up
→ CameraController.pan(0, -speed)

game-scoped input action: camera.zoom_in
→ CameraController.zoom(+1)
```

Camera action 应由 Input 系统做 scope/context 过滤。常规游戏镜头控制只在 `game` scope 下生效；编辑器镜头、DevTools 镜头预览或 UI 快捷键可以定义自己的 action/context/scope 组合。

标准 camera module 应接收已经归一化的 action source，例如 `input.action` EventBus fact。Input 模块先完成 scope/context 过滤，camera module 再把语义 action 映射成 `CameraController.pan/zoom/follow` 等操作。安装时注册订阅，dispose 时清理订阅；renderer camera adapter 同步通过 profile/app 注入的 sync hook 完成。

CameraController 表示目标镜头状态；表现层镜头可以选择每 tick 向目标状态平滑插值，并可维护 `display state` 表达 shake、screen flash 或短暂 impulse。目标状态用于 gameplay、save、follow target 和可恢复的镜头位置；display state 用于 renderer sync 和屏幕坐标转换，不应写入 Save checkpoint。

滚轮缩放带 anchor 时，平滑插值也必须保持 anchor 对应的 world point 稳定。也就是说，display camera 在 zoom 从当前值过渡到目标值的每一帧，都应围绕同一个 viewport anchor 计算中心点，而不是简单分别插值 `x/y/zoom`，否则用户会看到缩放从角落或错误位置发生。

## 与 TCA/Cue 的关系

TCA action 可以发起镜头表现，但不依赖具体渲染器。

```json
{
  "type": "camera.shake",
  "args": {
    "duration": 0.25,
    "intensity": 0.6
  }
}
```

## Renderer Camera Adapter

Renderer adapter 负责把 camera state 应用到底层渲染器：

```ts
export type RendererCameraAdapter = {
  applyCameraState(state: CameraState2D | CameraState3D): void;
  worldToScreen(point: PointLike): PointLike;
  screenToWorld(point: PointLike): PointLike;
};
```

Phaser Driver 的 camera adapter 映射到 `Scene.cameras.main`，Three Driver 的 camera adapter 映射到 `PerspectiveCamera` / `OrthographicCamera` 和 controls。

Adapter 映射必须尊重底层渲染器自己的 camera 语义，但不能改变 GameKits 的公共坐标模型。以 Phaser 为例，GameKits 的 `CameraState2D.x/y` 表示 viewport 中心对应的 world point；Driver 应先应用 native zoom，再通过 Phaser 的 center operation 把同一个 world point 放到 native viewport 中心。不要把 Camera Core 推导的 world-view top-left 直接当作 Phaser raw `scrollX/scrollY`：Phaser 的 scroll property 还受 native camera viewport 和 zoom 语义影响，在 backing-store pixel ratio 不为 1 时会产生稳定偏移。Legacy runtime 没有 center operation 时才使用经过该 runtime 语义验证的 scroll fallback。

Renderer camera adapter 本身是 bridge，不拥有 gameplay camera state。它可以由 camera module 调用，也可以由 editor/devtools module 调用。

## 最佳实践

### 模块集成

- Camera 是游戏会话能力，优先通过标准 GameModule helper 启动；不要把 camera controller 默认做成 App Host standard service。
- Camera Core 不依赖 World、Renderer、Input、Phaser、Three 或 DOM。Follow target、input action 和 renderer sync 都通过 helper/profile 注入。
- Web container 尺寸变化由 platform/app composition 同步给 renderer 与 Camera Core；Camera Core 不直接观察 DOM。集成规则见 [Platform 模块](./platform.md#模块集成)。
- Camera module 集成负责订阅已经归一化的 input action、解析 follow target、推进 smoothing，并调用 renderer camera adapter sync hook；renderer adapter 只应用传入状态。
- Fixed-step physics target 应通过 Physics module 提供的 transient interpolation store 解析 display position，使 follow camera 与 RenderObject 使用同一采样时刻；Camera Core 不依赖 Physics，也不拥有该 store。
- Follow/lookahead/shake 这类依赖游戏语境的行为可以由具体游戏模块组合 CameraController 完成；公共 helper 只提供可复用装配，不应假设所有游戏都有同一套镜头行为。
- 测试应覆盖 pan、zoom with anchor、screen/world/client/viewport 转换、bounds、follow resolver、smoothing、renderer adapter sync 和 dispose cleanup。

### 模块使用

- 所有坐标转换必须复用 Camera Core 方法。UI overlay、picking、renderer adapter 和 input bridge 不应各写一套转换公式。
- Zoom anchor 必须是 renderer viewport 坐标。滚轮缩放和平滑插值都要保持 anchor 对应的 world point 稳定，避免看起来从右下角或错误点缩放。
- Controller 表示目标状态，display camera 可以平滑追赶目标状态或叠加 shake；平滑和 shake 属于 camera module/rig，不属于 renderer adapter。
- Camera target 的表现插值不能写回 World，也不能替代 multiplayer authority snapshot/prediction；它只消除 simulation cadence 与 render cadence 之间的阶梯移动。
- Save 默认保存可恢复的目标镜头或用户配置，不保存 transient display state、shake impulse、UI panel open state 或 DevTools state。
- Camera action 只响应正确 input scope。游戏镜头、编辑器镜头、DevTools preview 镜头应有不同 context/scope。
