# ADR 0050：确定性多人网络条件模拟器

## 背景

GameKits 的 managed prediction、冗余 fixed-step input、authority inbox、snapshot playback 和 Physics Arena 回滚已经有
各自的单元与集成测试，但应用若要验证 latency、jitter、loss 和 duplicate，仍容易在 app 内包一层 `setTimeout`、随机
丢包或自建消息队列。这样的模拟器通常拥有自己的隐式时钟、不可复现随机数、无界 pending delivery，并且不同 Demo
会得到不同的 ordered-channel 语义。

Provider adapter 的真实网络测试仍然必要，但它不适合作为逐提交的确定性回归：公网/loopback 调度会引入噪声，故障
注入也可能依赖某个 SDK。Multiplayer Core 需要一个只改变 delivery、可包裹任意 backend、可手动推进且有硬容量的测试
协议，以便同一输入在 CI、本地 benchmark 和 Demo fault matrix 中得到相同结果。

## 决策

`@gamekits/multiplayer-core` 提供 `createMultiplayerNetworkConditionSimulator(...)`。它接收任意
`MultiplayerBackendAdapter`，返回包装后的 backend、手动 `advance(deltaMs)` / `flush()` 控制器、只读 diagnostics 和
`dispose()`。

Profile 只声明 delivery 条件：

- one-way latency 与对称 jitter；
- loss 与 duplicate 百分比；
- 固定 seed；
- pending delivery 硬容量；
- 按 direction 与 message envelope 选择受影响消息的 predicate。

模拟器遵守以下约束：

1. create/join/leave/close 等 session lifecycle 立即委托给底层 backend；模拟器不建立第二套 room、presence 或
   authority 状态机。
2. 只有被 `affects(...)` 选中的 outgoing/incoming message delivery 进入模拟队列；未选消息保持原 backend 行为。
3. 时间只由调用方显式推进，不读取 wall clock，不使用 `setTimeout`，seeded PRNG 使 drop/duplicate/jitter 可复现。
4. reliable ordered channel 中未被丢弃的 delivery 保持发送顺序；故障注入可以丢弃或复制消息，但不能用 jitter 偷偷
   重排 ordered lane。
5. pending delivery 有硬上限；capacity drop、scheduled/delivered/drop/duplicate、delivery error、峰值队列和活动连接
   全部进入 diagnostics。
6. connection close 会取消属于该连接的 pending delivery；runtime 先正常 dispose，最后再 dispose simulator，验收
   retained delivery 和活动连接归零。

该 API 是 provider-neutral 的测试/开发设施，不是生产流量整形器、RTT 估算器、拥塞控制、可靠传输实现或第二个
prediction clock。真实 backend 的 reconnect、provider ordering 与 wire behavior 仍由 adapter 集成测试覆盖。

## 故障矩阵规则

需要逐 step prediction 的应用至少覆盖基线、延迟+jitter、低丢包和高延迟+丢包+duplicate 四档。测试必须分别观察：

- authority 实际连续消费的 sequence；
- client 真正收到的 snapshot ack；
- redundant frame duplicate/gap-fill；
- prediction lead、queue capacity、delivery error 和 generation reset；
- 恢复窗口结束后的 ack lag，而不是把 authority 内部水位当成客户端已确认。

Fault matrix 使用虚拟时间推进 authority fixed tick；停止发新 input 后继续推进有限 recovery window，使已调度消息和
authority inbox 得到消费。`flush()` 只排空 delivery 队列，不代替 authority gameplay tick。

## 备选方案

### 每个 Demo 自建网络 preset

拒绝。它会重复 queue、seed、ordered lane 和 cleanup 语义，正是统一 prediction protocol 要消除的手工层。

### 只依赖真实 loopback / 公网测试

拒绝作为确定性回归。真实网络测试保留用于 adapter/e2e，但无法稳定复现指定 drop、duplicate 和 jitter 序列。

### 把故障逻辑写入 Memory backend

拒绝。故障条件是可组合测试 policy，不是 Memory backend 的固有语义；独立 wrapper 才能复用到 Colyseus 测试桥或
其他 backend。

## 后果

- Multiplayer Core 多一个有界、可测试的公共开发设施，但不增加生产 backend 语义。
- Demo 和新游戏可以共享同一 fault profile 与 diagnostics，不再维护 app-local delay/loss wrapper。
- Deterministic simulator 不能证明真实 provider 在公网下的完整行为；发布前仍需 provider-native 集成、双客户端和
  soak 验收。
- Arena fault matrix 可以直接验证 redundant bundle、hold-last gap fill、ack 与 rollback 的组合，而不是分别证明各个
  helper 存在。
