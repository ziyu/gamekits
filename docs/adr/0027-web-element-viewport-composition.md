# ADR 0027: Web Element Viewport Composition

Status: Accepted on 2026-07-14.

## Context

Web game viewport 可以随窗口、嵌入容器、DevTools dock 和设备方向变化。CSS 可以改变 canvas 的显示尺寸，但不会同步改变 Driver 的 logical viewport 或 Camera Core 的 viewport；如果三者继续使用不同尺寸，camera center、pointer conversion、zoom anchor 和 overlay 会出现稳定偏移。

DOM 尺寸观察属于 Web 平台集成问题，而 renderer resize、camera state 和 gameplay follow 分别已有对应 core 协议。把 `ResizeObserver` 放进 Camera Core 或 Phaser Driver 会让稳定核心协议反向拥有 DOM 和具体宿主生命周期。

## Decision

`@gamekits/platform-web` 提供通用 element viewport 测量与监听 helper：

- 尺寸使用 logical CSS pixels，并归一化为正整数。
- hidden/unmounted element 可以使用调用方提供的 fallback；没有 fallback 时保持最小有效尺寸。
- observer 首次发布当前尺寸，之后只发布发生变化的宽高，并返回显式 cleanup。
- `ResizeObserver` 只负责低频平台事件，不进入 GameRuntime tick 或逐帧 renderer/camera system。

应用组合层负责消费这个平台信号，并在同一次回调中更新 Renderer Core `resize(width, height)` 与 Camera Core `viewport`。Driver 继续只实现 renderer/input/camera/asset runtime slice；Camera Core 继续只拥有 logical camera state 和坐标转换。

## Consequences

Positive consequences：

- 竖屏、横屏、嵌入式 viewport 和 dock resize 使用同一条可复用接线，不需要游戏特有偏移。
- renderer、camera、pointer 和 zoom anchor 共享同一 logical viewport。
- observer 可以注入测试替身，尺寸去重和 cleanup 不依赖真实浏览器测试。

Costs and constraints：

- Web app/profile 必须在 renderer container 挂载后完成初始测量，并在 dispose 时释放 observer。
- 同时使用 Camera Core 和 renderer 的 app 必须同步更新两者；只改 CSS 或只调用其中一个 resize 仍然是错误集成。
- resize 可能增加 backing-store 重建和 fill-rate 成本，profile 仍需限制 pixel ratio，并避免从逐帧逻辑反复写入相同尺寸。

## Rejected Alternatives

### Use CSS scaling only

Rejected because canvas 显示尺寸、Driver logical viewport 和 Camera Core viewport 会分离，无法保证 center、picking 和 zoom anchor 一致。

### Let Camera Core observe DOM

Rejected because Camera Core 是 renderer/platform-neutral 的游戏会话能力，不应依赖 DOM 或拥有宿主 cleanup。

### Let each Driver own browser resize observation

Rejected because同一个 Driver 可以运行在不同 container 和 app lifecycle 下，且 camera state 不归 Driver 所有；自动观察会隐藏跨协议同步并重复宿主逻辑。
