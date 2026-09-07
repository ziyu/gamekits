# Knockout Arena 多人 Authority、复制与预测

## 目标

Knockout Arena 使用 server-authoritative 60 Hz Physics simulation、20 Hz authority frame 和完整 Physics prediction island，
在高延迟、jitter、loss、duplicate、snapshot gap、成员变化与重连下保持输入即时、接触因果一致、结果唯一且状态有界。

应用只声明 typed snapshot/input、member/content policy、gameplay command mapping 和 presentation writer。Ack/history/replay、
reconcile、baseline、generation reset、effect settlement 与 dispose 使用标准 Multiplayer/App Host/Physics 组合。

Authority 与 Client 使用同一 island/command/auxiliary 协议，但保留策略不同：服务器采用 `historyMode: "initial-only"`，只持有
当前 generation 的 reset baseline并释放已消费 command；客户端采用默认完整 rollback history。20 Hz frame cadence 由标准
authority loop 的 `snapshotIntervalTicks` 管理，manual broadcast 只用于 initial sync、late join或显式resync。Arena 不在 app tick
外另写 snapshot modulo、checkpoint ring 或 replay loop。

## Authority Ownership

Authority 唯一拥有：

- match/stage phase、participant、qualification/elimination、ranking/winner。
- item claim/owner/state/generation、GAS/Combat result、instability/stagger、impact ledger/KO credit。
- AI runtime/decision/path。
- Physics arena solver 与 authoritative body/member state。
- input validation、continuous control consumption、sequence ack 和 snapshot projection。

Client 可以预测：

- 自己的 CharacterControlIntent、motor/Physics body 与 camera/presentation。
- Authority 最近确认 control 下的 remote actor/AI Physics command，以保持接触 replay。
- 明确声明的 pickup/throw/item spawn 和可撤销空间反馈。

Client 不能预测为最终事实：qualification、elimination、winner、item owner、hit/GAS effect、KO/assist、item respawn 或 AI goal。

## Session、Binding 与 Participant

- Room session、transport peer、player identity、participant 和 actor member 使用不同稳定 id。
- Client 在 authority binding `bound` 前只显示 loading/等待同步或离线练习，不把本地 simulation 当联网 gameplay。
- Peer/player/participant mapping 由 authority snapshot 声明；UI 不从 join order 临时推断 slot。
- Binding/session/reconnect 改变创建新 input epoch，清除旧 inbox、pending send、snapshot playback 和 prediction domain。
- Late join 绑定 spectator/next-match，只安装公开 stage baseline，不获得当前 active participant command 权限。

## 输入协议

### Continuous Fixed-Step Input

每个 60 Hz input frame 包含：

- move/facing、jump held/edge、dive edge。
- aim/charge/use held 等连续 action state。
- input sequence、client prediction tick 和必要 action counters。

Managed replication 使用 bounded redundant bundle：每包携带当前 frame 与有限未 ack frame。Authority inbox 按
peer + binding generation + sequence 去重、排序，每 tick至多消费一个连续 frame；gap 使用声明的 hold-last/neutral policy。

Snapshot ack 只表示 authority 已实际模拟的最高连续 sequence，不能把“服务器收到包”误报为已确认 gameplay。

### Discrete Action

Ready/start/rematch、pickup/use/throw/drop edge 等需要明确结果的 action 携带 command id/correlation、input sequence、item
instance/generation 和可验证 target hint。Authority 仍重新 target/validate；duplicate command 返回同一 result，不重复执行。

Reliable action lane 和 continuous bundle 可以共用 provider ordered transport，但语义、容量与 ack 分开。Provider 支持 datagram
时只改变 lane 映射，不改变 GameKits sequence/inbox contract。

## Authority Frame

```ts
type ArenaSnapshot = {
  schemaVersion: string;
  match: ArenaPublicMatchState;
  participants: ArenaParticipantProjection[];
  stageResults: ArenaPublicStageResult[];
  items: ArenaItemProjection[];
  itemActions: ArenaPublicItemAction[];
  combat: {
    actors: ArenaPublicCombatState[];
    hits: ArenaPublicCombatHit[];
  };
  frame: MultiplayerPhysicsArenaFrame;
  playerIdsByPeerId: Record<string, string>;
  inputAcksByPeerId: Record<string, number>;
  actorControlsByMemberId: Record<string, ArenaActorControl>;
  eliminatedMemberIds: string[];
  serverTime: number;
};
```

`MultiplayerPhysicsArenaFrame` 声明 island id、stage/match generation、tick、membership revision、definition version 与完整动态
member state。App schema 承载 match/item/action/ack；Physics Core 不解析这些业务字段。

Projection 验证有限数字、唯一 id、member/item/effect 上限、definition/schema compatibility 和 payload bytes。未知或超预算
frame 被拒绝并诊断，不能部分读取后继续 replay。

`items` 公开 definition、instance generation、authority state、owner/source/execution、revision、deadline 和可选 Physics member
id；`itemActions` 公开 command 的 `windup/confirmed/rejected` 结果。两者分别有 32/64 的硬上限，客户端不得从 frame member
缺失自行推断 owner，也不得把本地 predicted action 伪装成 confirmed result。

`combat.actors` 公开 authority instability、stagger deadline 与 last hit tick；`combat.hits` 公开稳定 hit ticket、source/target、
item generation、impulse 和命中后的 instability，两者各有 64 条硬上限。它们是表现、KO feed 与 fault-matrix settlement 的
只读事实，不进入客户端 gameplay 回写。原始 Physics contact 只进入 authority gameplay resolver，不进入 App snapshot，也不能
自行生成命中、属性、KO 或受击表现；客户端只能根据稳定 `combat.hits` 确认预测的 item-hit。

`match.membershipRevision` 必须与 Physics frame 一致。Stage result 只追加 authority settlement，late join/reconnect 读取同一份
participant/result projection 恢复当前语义状态，不从客户端缓存重建晋级或 winner。

`match.stageStartedAtTick` 属于 authority host/match 时间轴；`match.physicsStageStartedAtTick` 是当前 Physics island generation 内的
stage 起点。Hazard sampler 在 authority 和 prediction 两端都使用 physics tick + physics start tick，不能把 host authority tick 与
新建 island 的局部 tick 混用。Stage transition 必须在同一个 action 中记录新的 Physics 起点并复制给客户端；否则机关会在
authority 或 prediction 一端冻结在 phase 0。

Authority frame 对 kinematic body 的 pose 已经是该 tick 完成后的状态。标准 prediction island reconcile 使用 Physics Scene 的
显式 authority-correction/teleport 语义立即安装该 pose；普通 hazard patch 仍是 next-step target。应用和 Renderer 不再为旋转杆、
活塞、墙或移动平台手写 authority transform 旁路，详见 [`ADR 0055`](../../adr/0055-kinematic-target-and-authority-correction.md)。

每条客户端 continuous input 与离散 item action 都携带 `authorityEpoch = frame generation + participant revision`。Server 在进入
gameplay owner 前同时核对 peer binding、participant status 和 epoch；disconnect/reconnect、stage reset 或 membership churn 前发送但
延迟到达的 command 必须被拒绝，不能因同一个 peer id 恢复连接而重新生效。Input sequence 仍用于同一 epoch 内的连续 ack/redundant
bundle 去重，epoch 不替代 sequence；schema/version negotiation 必须阻止不发送 epoch 的旧客户端进入当前 authority。

## Prediction Island Membership

完整因果集合包括：

- 当前 active participant actor。
- released/active item 与会碰撞的 dynamic prop。
- sweeper/platform/piston/wall/tile 等 kinematic/dynamic hazard。
- 其他能在 replay horizon 内通过链式碰撞改变上述对象的 body。

Static course layout 由 versioned environment 重建。Carried item 没有 solver body；纯装饰、远景、UI、Audio 和 particle 不进入
island。客户端不能按 viewport、距离或自己的 overlap 启发式删 member。

Member spawn/despawn 使用 stable tick/sequence/generation。Membership revision 改变安装完整 baseline并清理旧 revision 的
command/history；不能在成员不完整时继续 replay。

## Character Motor 与 Auxiliary Replay

复杂 motor 的 grounded/coyote/jump-buffer/dive/recovery/stagger state 不是 Physics solver state，但会影响下一 tick command。
标准 Arena prediction domain 将这类 contributor 与 Physics checkpoint 同 tick capture/restore/replay/reset：

- Physics body/collider/solver 只由 island contributor 捕获一次。
- Motor contributor 只捕获 per-member motor state和有界 timers。
- Contributor 声明 max bytes/history/work，并共享 generation/member lifecycle。
- `arena.item-carry` 是无业务缓存的 stateless contributor；每 tick command 显式携带 speed/jump modifier，因此 replay 不读取
  snapshot callback 外的可变 owner 缓存。
- Reconcile 先恢复 authority tick 的 Physics + motor baseline，再按 input history 重演。
- 淘汰/member removal、stage generation、hard correction 和 dispose 原子清理两类 state。

应用不能在 snapshot callback 中私自维护第二个 motor history/restore loop。

## 全 Actor 控制回放

Authority snapshot 发布所有 active actor 在该 authority tick 实际消费的 continuous control。Client replay：

1. 从 snapshot 克隆 authority-confirmed remote/player/bot controls。
2. 以本地仍未 ack 的最新 input 覆盖 local actor。
3. 按 stable member id 顺序通过同一 Character Controller 生成 command。
4. 追加 deterministic hazard 与 item command。
5. 推进完整 island 并收集 speculative contact/effect。

只回放本地 actor、把 remote actor 当自由刚体会让 authority 每 tick motor 与客户端 contact trajectory 分叉，因此禁止。

## Item Prediction

- Pickup anticipation 可以本地预测 item despawn/hand attachment，但 authority claim 决定 owner。Reject 恢复 authority member，
  cancel reach/carry effect。
- Throw 使用 correlation + item instance/generation 匹配 predicted spawn 与 authority member；owner/client 运行相同 Physics
  definition/initial impulse。
- Remote carried item 只表现 attachment；released item 是 island member，不是 renderer-only projectile。
- Hit、instability、stagger、KO 与 respawn authority-only。Client 可 anticipate impact cue/Physics response，但必须接受
  confirm/correct/cancel，不能本地累计 score/effect。
- Item generation change 使旧 contact/fuse/finish/result stale；duplicate snapshot/action 不重复生成 member。

客户端不维护私有 item replay loop。离散 action 在 authority wire lane 发送的同时，用同一个 command/execution correlation 调用
标准 Arena descriptor 的 `registerPredictedMember(...)`；spawn command、history、match、reject 与 ghost cleanup 仍由完整 island
owner 负责。`resolveAuthoritySpawn`/`resolveMemberDefinition` 读取已验证的 `items`/`itemActions` app projection，因为通用 Physics
authority projection 会有意清洗 body `userData`。Action/hit 的 anticipation 进入统一 effect journal，loss、duplicate、gap 或
generation reset 只能改变 confirm/cancel 时机，不能产生第二次消费、命中或 cue。

## Stage、淘汰与 Reset

- Elimination 在 authority 同 tick提交 participant state 与 actor despawn，递增 membership revision。
- 淘汰 actor 不 teleport 到 spawn，也不继续接收 input/motor command。
- Stage transition 使用新 generation、definition version 和 qualified member set，清除旧 command/history/effect/item lifecycle。
- New match 使用新 match id/seed/input/action authority epoch，恢复完整 participant baseline；rematch 不能复用旧 stage generation。
- Playback `shouldReset`、prediction domain reset 与 effect journal reset使用同一 stage/match identity，不能各自猜测。

## Snapshot Playback 与 Presentation

- Remote authority-only facts使用有界 snapshot buffer/temporal presentation；预测 island body 使用 predicted state writer。
- 最终 renderer/world shadow writer 每 frame 只写一次，不能先写 authority state 再被 prediction 或 interpolation 覆盖。
- Presented camera/animation/audio/UI 读取统一 frame；平滑 transform不回写 solver或 motor。
- Late join 安装当前 authority baseline和 semantic phase，从当前 tick表现；不从 stage/item/action起点重播。

## Speculative Effect Journal

稳定 effect identity：

- jump/dive：member + input sequence + action instance。
- contact：generation + predicted tick + collider pair + kind。
- pickup/use/throw：participant + item instance/generation + command/correlation。
- impact/stagger/KO：authority hit/elimination ticket；只有可预测部分 anticipation。

Replay/duplicate只创建一次 anticipation；ack/snapshot confirm，authority分叉 replace/correct，reject/reset/expire/dispose cancel。
Audio/Camera/Renderer/UI consumer不自行去重。

## 故障与降级

- History missing、replay budget、membership mismatch、generation/definition drift → 安装完整 hard-correction baseline。
- Backend 缺 full-scene deterministic checkpoint → 整个 Arena domain authority-only，不伪装 partial replay。
- Unknown member definition/item generation/schema → 拒绝 frame并等待 compatible baseline。
- Input gap超过预算 → authority按声明 policy推进并 ack实际模拟结果；客户端 prediction lead有硬上限。
- Snapshot gap在 history内恢复；超出 history明确 hard correct。不能无限扩大 history等待网络。
- Payload/member/command/trace/effect容量超限产生 diagnostic并执行声明的拒绝/降级，不能静默丢关键 member。

## Fault Matrix

稳定网络 profile：

| One-way latency | Jitter | Input loss | Snapshot condition       | 必须保持                                   |
| --------------- | ------ | ---------- | ------------------------ | ------------------------------------------ |
| 0 ms            | 0 ms   | 0%         | normal                   | confirmed为主，无持续 hard correction      |
| 50 ms           | 20 ms  | 0%         | normal                   | bounded replay，pickup/throw一次提交       |
| 100 ms          | 30 ms  | 2%         | 3-frame gap              | 不穿已知 blocker，不重复 jump/hit/item cue |
| 150 ms          | 50 ms  | 5%         | 8-frame gap + duplicate  | history内收敛；超预算明确 baseline         |
| 任意            | 任意   | 任意       | stage/revision/reconnect | 丢弃旧 input/member/item/effect generation |

Fault simulator只改变delivery，不创建第二套authority或prediction clock。测试同时观察authority consumed sequence与client
observed ack。

## 容量与诊断

具体性能数值以 [`quality-and-acceptance.md`](./quality-and-acceptance.md) 为唯一来源。协议层必须对 member、input bundle、
queued command、snapshot bytes、history ticks/bytes、checkpoint bytes、single replay work、effect、item facts 和 playback buffer
设置硬上限。

Telemetry 至少显示：binding/session/input epoch、authority/client tick、ack/lead、RTT/jitter/loss、generation/revision/member、
snapshot bytes/age、checkpoint/history/replay、correction/hard correction、item predicted lifecycle、effect settlement、rejected
input/frame/command 和 dispose retained state。Dispose 诊断必须可证明 participant、Physics history/command、input、effect、ranking、
result 与 cached snapshot 均已释放。正式 HUD不显示这些底层指标。
