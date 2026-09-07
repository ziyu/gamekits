# Outpost Siege Player Experience Rebuild

Status: Active — Slice 3 movement/Dash/camera baseline is complete; Slice 4 character assets and Animator is in progress.

## Prediction Capability Gate

2026-07-28 对 Rifle 穿墙后延迟爆炸的问题做了系统性复核。此前的 render-only predicted → authority
handoff 只修复了两件事：输入后首帧能看到弹体，以及 authority spawn 到达时显示对象不向后跳。它没有在
client 运行与 authority 相同的 projectile sweep/collision/lifecycle，因此不能被视为 projectile prediction，
也不能作为 Slice 2 的最终验收结果。

对 Unity Netcode for Entities、Photon Fusion、Unreal Networked Physics、Valve Source、Colyseus 与 Rapier 的
官方资料复核后，长期方案记录为
[ADR 0047](../adr/0047-selective-network-prediction-and-projectile-strategies.md)：按对象选择
lag-compensated hitscan、kinematic data buffer、predicted entity + prediction island 或 authority-only，而不是
默认全场 rollback，也不是继续修 render handoff。

Outpost Rifle 当前选择 `kinematic-data-buffer`。进入下一轮实现前，GameKits 必须先具备并验证：

- Combat projectile strategy 与有界 fire/finish spatial record；
- owner 使用同一 definition、fixed tick、layout 和 Physics sweep 的 provisional simulation；
- authority confirm/correct/reject 与 remote authority-timeline reconstruction；
- Multiplayer prediction identity/generation/reset/overflow lifecycle；
- 对应 conformance 与真实 prediction benchmark。

在这些底层能力获得确认并实现前，不继续向 Outpost weapon handler 增加本地 raycast、wall clamp 或新的
handoff 特判。现有 handoff 代码只能作为待替换的历史实现，不进入完成定义。

2026-07-28 底层 `kinematic-data-buffer` 路径已按 ADR 0047 实现，并在 Sandbox 新增 Multiplayer Projectile
Lab：三个真实 Memory Multiplayer peer、owner/authority 独立 Physics scene、可调 RTT、remote timeline 与
layout divergence fault injection。2026-07-29 已完成人工正常路径、layout divergence 和 generation reset 验收，
实现和验证证据记录在已关闭的
[`kinematic-projectile-prediction.md`](kinematic-projectile-prediction.md)。

2026-08-01 Outpost Rifle 已消费该底层能力并移除历史 render-only handoff：authority 从真实 Combat
projectile spawn/despawn fact 生成最多128条 fire/finish record，保留 session generation、definition version、
60 Hz fire/finish tick、空间终点、normal 与 subject；Colyseus Schema 升级为 `outpost.field-state.v8`，在现有
Room state 中复制 records，不增加第二条 snapshot 或验证通道。Owner client 按最近 authority timeline 启动同一
definition、arena layout 与 Rapier sweep，并以 correlation + generation 对齐 GAS 生成的 authority projectile id；
player network generation 进入 record identity，避免同 session 重连后 shot sequence 归零造成冲突。Projectile
renderer 直接从 record 生成，不再要求20 Hz entity snapshot 中必须看见弹体；remote record 按统一100ms
delayed authority timeline 重建，已完成且早于该 presentation tick 的 record 不重新播放移动弹体，改由 bounded
tracer/impact cue 表达。Owner record 与 provisional sweep 原位收敛。拒绝与超时取消对应
prediction chain。现有四客户端 Room
测试已覆盖 reliable Rifle press/release、authority fire/finish、Schema 观察客户端收到同一 record，以及 active
projectile 在继续 leader-leave 流程前收敛为零；authority、client feedback 和 browser tests 分别覆盖真实 hit
subject、已知 arena blocker 停止与 prediction→authority reconstruction。场景 material refs 同时收口到共享
arena Physics scene config，authority、preview、movement prediction 与 projectile prediction 不再各自丢弃材质定义。
同日曾把 projectile 表现重叠误归因于 spawn tracer，并移除 tracer 与 impact 的正常反馈；后续逐帧诊断证明
根因是预测时间线被旧 snapshot 向后重锚、绝对 `fireTick` 把 GAS preparing/authority 排队误判为 correction，
以及 prediction→authority 交接时销毁旧 renderer object 再创建新 object。现已恢复线状 tracer 与原 impact
反馈，禁止使用 projectile 贴图伪造 muzzle；owner prediction 使用单调时间线，按相同射击年龄比较 trajectory，
合理 fire tick offset 不触发 correction，真正分叉在同一个 correlation render identity 上有界收敛。
后续真实逐帧复验发现 terminal hit cue 可能比 finish record 早一个20 Hz快照，导致 impact 与仍存活的预测弹
短暂重叠；client feedback 现按 projectile correlation 在 terminal cue 到达时立即取消 owner prediction、隐藏
remote record render，并以128条、2秒硬上限保存终止抑制状态，finish record 到达前不允许弹体重新出现。

2026-08-02 再次双端对比确认 owner 与 observer 仍不是同一呈现：owner 在 match 后永久沿本地提前 tick 采样，
observer 沿 authority tick 采样；remote 还会把已经 finish 的近期 record 从起点延迟重播。Owner projectile 同时
使用额外 fill tint，而 remote 使用原 render definition，所以时间线和外观均分叉。该问题也暴露 Outpost 在
app 层重复实现了 generation/match/expiry、单调时钟、shot-relative compare 和 correction lifecycle。

本轮按 Core-first 修正：Multiplayer Core 新增 `createMultiplayerAuthorityTimeline(...)`，Outpost 实际复用既有
`createMultiplayerPredictedSpawnRegistry(...)`；Combat Core 扩展 shot-relative reconciliation，并新增
`createStandardCombatKinematicProjectilePresentationTransition(...)` 通过 Multiplayer Core 通用 time-aligned
transition 统一 provisional finish、authority handoff 和有界
correction。Outpost 只保留共享 arena/actor Physics proxy、内容定义和 renderer 写入。Owner/observer 现在使用
相同 generation + correlation visual id、同一未染色 projectile definition；owner 使用 local shot age，observer
使用 remote authority presentation time。两端位置不要求逐帧相等，但 match 后 owner 改由 authority record提供
空间事实时不能回到较晚 commit 的过期弹龄。Observer 使用同一 record 与 trajectory，只在声明的 presentation
delay 上观看；这不是第二条 projectile simulation。
Observer 为覆盖20 Hz snapshot之间完成的短命弹体使用统一100ms remote delay；该 delay 只改变观看时刻，仍采样
同一 authority record，不恢复按每条 record 首次到达重新计时的旧实现。

2026-08-02 进一步诊断确认 Combat transition 只在 reconcile 比较中使用 shot-relative timeline，实际 authority
sample 仍按绝对 tick 求值；随后把正常 fire-tick offset 作为位置差在100–260ms内衰减，直接导致接管阶段减速。
底层现对 matched authority record 使用 `authorityTick + (authorityFireTick - predictedFireTick)`，保持与 owner
相同 shot age；绝对模式保持原语义，真实空间分叉仍有界修正。Combat 测试锁定不同 fire tick、相同 trajectory
接管时 correction 为0且位移保持原速度；Outpost client feedback 集成测试锁定接管后300ms位移仍为
`760 × 0.3`。

同日修复 Reload 期间偶发的 owner-only Rifle 弹体：本地表现层曾把空弹匣时收到的 fire edge 保留到 reload
commit，并允许 held input 在 `reloading` phase 自行触发 cadence；authority 会消费空仓 edge，且只允许有剩余
弹药时由新的 edge 中断 reload，因此不会生成对应权威射击。现在本地预表现镜像这两个约束：空仓立即丢弃
edge，reload 期间只接受新的 edge，不把 held 状态解释为新射击。回归测试分别覆盖空仓 reload commit 不冒出
本地弹体、held input 不重复射击，以及非空 reload 的新 edge 仍可按 authority 语义中断。

## Current Increment

2026-08-09 已进入 Slice 4 的首个可见增量：

- 玩家角色不再把单张 `frames: [0]` 图片伪装成所有动作。新的可审查 authoring pose strip保留现有装甲、武器与朝上基准，资产构建脚本按固定 source grid生成13帧、每帧128×128的透明WebP spritesheet；idle、run、fire、reload、dash、hit和death拥有独立帧序列。所有直立姿势在构建阶段归一到共享68×110不透明包围盒和中心锚点，不再因逐帧 `trim + fit` 造成移动/静止尺度跳变；hit倾斜与death横躺保留动作所需轮廓。方向目前继续复用既有连续 facing rotation，离散direction sheet仍未关闭。
- 玩家与敌人的 Animator graph已拆开。玩家graph新增Dash state，直接读取同一 replicated/predicted `dashRemainingMs`；Rifle与Reload按 `abilityId + preparing/committed/active/recovering` 映射到独立clip，不再落入无条件通用 `attack`。敌人继续使用独立通用attack映射，不受玩家clip变化影响。
- 内容测试锁定authoring/runtime格式、13帧sheet尺寸、manifest帧号、玩家graph参数与ability-specific phase mapping；浏览器多人测试直接锁定同一个玩家controller从Dash graph state切换到Reload gameplay phase。
- 正式Outpost入口已用两个真实浏览器客户端复验资源加载、射击、Reload和Dash；Dash扣除25 stamina并进入1.5秒cooldown，Phaser/Animator无运行错误。
- Shock Field Tactical已进入第二个可见增量：authoring strip新增一个紧凑施法姿势，步枪侧收且胸前青色能量脉冲与Rifle/Reload轮廓明确分离；runtime sheet扩为14帧，`ability.outpost.shock_field`的preparing/committed/active/recovering全部映射到独立`tactical-*` clip，并由同一个玩家controller消费复制phase。后续仍需补downed/revive、visual socket、local anticipation与late-join/generation-reset的动作恢复，并完成全部动作的可辨识性gate。

2026-08-07 已进入 Slice 3 的实现与自动验证：

- `outpost.movement-profile` 现在独立数据化最大速度、加减速、Dash速度/时长/碰撞缩短阈值，以及镜头lookahead/impulse参数；Ranger通过DataRef组合该profile，不再把`moveSpeed`散落在authority、preview和client prediction。
- `gameplay/player/movement-policy.ts` 成为authority、local preview与`createPhysicsBodyPredictionTransition(...)`共享的input-to-velocity状态转移；移动向量归一化、aim/facing分离、加减速、无输入Dash fallback和碰墙速度投影终止均只定义一次。
- Dash velocity override已从`authority-combat.ts`/`CombatState.dashesByPlayerId`移除。Reliable player action先经过GAS cost/cooldown和action arbitration，接受后才启动player movement state并取消允许中断的Reload；普通locomotion在Dash剩余时间内不能覆盖速度，结束时统一移除`state.dashing`。
- Input与Schema加入单调`dashSequence`、剩余时间和方向。Client使用Multiplayer Core新增的`requestInputSample()`在下一次replication update提前采样Dash edge，但仍复用同一个Physics predictor、sequence、ack、两帧lead窗口和reconciliation；authority只在可靠action接受/拒绝后确认Dash序号，continuous input不能提前伪造确认。Dash movement基线使用`outpost.field-state.v9`，本轮为拒绝 cue 增加动作身份后升级为`outpost.field-state.v10`。
- Client camera从同一个local presented player state读取position/facing/Dash mode，按profile应用aim lookahead、指数响应和快速衰减的有界Dash impulse；没有建立camera专用transform或第二条预测时钟。
- Dash rejection现在与acceptance一样确认单调`dashSequence`，避免persistent continuous input在每次reconcile后重放同一次已拒绝Dash；Rifle rejection不再错误推进Dash序号。Dash消耗25 stamina，authority按movement profile恢复并复制最终值；主HUD新增常驻体力条、Dash消耗/锁定状态、icon内authority cooldown倒计时和单行`LOW STAMINA`拒绝提示，`action-rejected` cue携带动作身份以避免把其他cost拒绝误报成Dash。
- 自动验证已覆盖Core提前采样仍受原prediction cadence/lead约束、共享移动加减速/斜向归一化、Dash方向fallback/碰撞缩短/拒绝序号、authority Dash movement snapshot、四客户端Room链路、provider Schema round-trip与现有Rifle/Reload回归。Client anticipation只对最新复制GAS状态和本地cooldown gate均允许的Dash启动，已知cooldown/cost拒绝不再先位移再回滚。正式Outpost入口的双客户端浏览器复验确认：施法端同帧进入Dash与镜头响应，观察端收敛到同一authority位置，能力不重放且无回弹/双影；两端无运行错误。不同render cadence由time-based prediction测试覆盖，碰墙与拒绝路径由共享policy和browser integration测试覆盖，Slice 3基线据此关闭。

2026-07-27 已完成 Rifle 纵切的第一段权威闭环：

- `main.tsx` 不再把 Rifle click直接发送为 reliable combat action；`fireHeld` 与单调 `fireSequence` 随 managed input进入 authority，短 click不会因采样间隔丢失，Reload/Dash/Tactical/Deploy统一进入 reliable `player-action` envelope与玩家 action boundary。
- 新增独立 authority weapon runtime，拥有 24/144 弹药、120ms cadence、shot sequence、空仓自动换弹与 `R` 手动换弹 edge去重。
- Reload 使用 `ability.outpost.rifle_reload` 的 prepare/commit/recover execution；弹药只在 GAS commit 后转移。
- Reliable action codec不再接受 Rifle，避免绕过 weapon cadence/ammo直接调用 Combat。
- Colyseus Schema 升级到 `outpost.field-state.v7`，除 weapon phase、ammo、reload timing、shot sequence、最近接受射击的 correlation、当前 reload request/correlation与最近有界反馈外，复制 authority combat cue watermark与最近64条 cue。
- 客户端 HUD显示弹匣/备弹、reload进度与拒绝原因；现有 Animator phase、Rifle spatial SFX、projectile presentation继续消费同一 execution，local shot sequence触发有界 camera recoil。
- Reliable 离散动作已统一进入 `gameplay/player/action-runtime.ts`：Reload占用 full-action channel，Shock/Deploy冲突时稳定拒绝；新的 Rifle edge或已被 authority 接受的 Dash可在 commit前取消 Reload，commit后遵守 GAS `afterCommit: deny`，被 cooldown拒绝的 Dash不会误取消 Reload。
- Reload request/cancel/reject在 authority、Colyseus和 HUD中保留同一 correlation；HUD只在有界时间窗展示最近反馈，历史不会增长为无界日志。
- 新增 `presentation/player/client-player-presentation.ts` 作为 app-owned `PlayerPresentationFrame` 起点：本地 Rifle edge/held cadence只预演表现，不创建 gameplay projectile、damage或 ammo commit；authority按相同 shot correlation确认或拒绝。
- 本地 cue history固定为32条、pending anticipation最多8条、authority timeout为1秒；拒绝/超时会取消相关 cue及其依赖预测链。客户端立即播放 muzzle pulse、Rifle SFX和 camera recoil，authority确认不重复播放，rejection只播放轻量 deny pulse。
- Slice 5审计确认 Combat Core 的 `projectile_despawned` 缺少销毁前空间事实，app不能可靠生成 world impact。该缺口已按 [ADR 0046](../adr/0046-bounded-combat-projectile-lifecycle-facts.md) 补足：spawn/despawn改为有界公共 fact，despawn携带 final transform/velocity及可选 target/blocker impact，原始 query、candidate、payload、metadata和 hit memory不进入 EventBus。
- 2026-07-28 完成 authority result cue基础闭环：Outpost从真实 Combat projectile lifecycle、hit result和 action rejection生成 `projectile-spawned/miss/world-impact/shield-hit/health-hit/kill-confirmed/action-rejected`，保留64条单调 sequence ring；client首次 active snapshot只建立基线，增量 cue去重消费并记录 dropped/reset diagnostics，本地历史64条，world effect并发上限48且按 duration/dispose回收。连续 projectile transform仍沿用 snapshot，不复制进 cue。
- 2026-07-28 完成 Rifle 正式反馈资源和消费链：`PlayerPresentationFrame` 保留当前 world aim，authority shield/health/kill cue携带 source→target单位方向；独立 `client-combat-feedback` 消费同一 presentation frame/correlation，提供跟随瞄准的准星、local anticipation与remote authority tracer、miss/world/shield/health/kill impact、命中/击杀/拒绝准星反馈和本地受击方向。表现对象硬上限48，连同准星最多49个，pending local anticipation仍为8；dispose清空仍处于生命周期内的 renderer object和所属音频 owner。
- Feedback authoring source使用可审查 SVG，内容构建确定性生成透明 lossless WebP；真实 Phaser浏览器曾发现直接加载 SVG 产物会显示实心方块，现已通过 SVG → raster buffer → WebP管线修正，并由内容测试锁定文件头和尺寸。
- 真实双客户端诊断发现 movement/aim/rifle edge共用20Hz fixed-step FIFO时，客户端8帧 prediction lead会稳定形成7帧未确认输入，使本地 muzzle anticipation领先权威 projectile约350ms。先把 client lead从8收紧到2、authority per-source backlog从32收紧到4，将相同自动化路径的权威 ammo确认从约525ms降到277ms，但该方案仍容忍 fixed-step等待，不作为最终手感契约。
- Rifle 已拆为即时边沿与持续状态两条 lane：press/release/cancel 通过既有 bounded reliable action 直接进入
  authority player weapon，movement/aim/fireHeld 继续走 managed fixed-step prediction；weapon 用 32-bit 单调
  `fireSequence` 合并两者，旧输入不能重复首发或在 release 后恢复 held。Room-owned 真实 Colyseus adapter
  四客户端测试已锁定 valid Rifle press/release 分别进入 action FIFO、authority 同 tick 将 `shotSequence`
  推进到 1 并扣除一发，release 后没有额外射击。这部分仍是有效的输入/authority 基线。
- **Invalidated on 2026-07-28:** 本地以 760 world units/s 移动 render object，再以
  `correlationId + projectileId` 让 authority object 继承当前显示位置的方案，只验证了即时出现、对象回收和不
  倒退。它没有预测 collision/finish result，会让弹体穿过墙后等待 authority despawn，因此已被 ADR 0047
  否定为最终方案；相关 memory Renderer handoff 测试和性能数字只保留为历史 presentation 证据，不计入
  projectile prediction gate。

验证证据：Rapier authority integration 覆盖 reliable Rifle 边沿即时首发、旧 fixed-input replay 去重、release
后旧 held 不恢复、短 click、24 发持续射击、自动换弹、GAS commit、动作取消/拒绝和冲突；Room authority
覆盖 bounded reliable Rifle press/release、payload validation、reload correlation 和四客户端真实 adapter 路径；
Schema 与 client presentation 测试覆盖 cue round-trip、水位、去重、断档/reset、即时 muzzle/SFX、效果硬上限
与 dispose。Combat lifecycle 基准在事件开启时通过原有 300 projectile × 20 轮预算，客户端满载 cue/
presentation 基准也未发现无界留存。这些证据仍验证 authority、cue 与 presentation 基线，但**不验证本地
projectile collision prediction**；原 handoff 的速度、不回退和 16 条并发预算已从 Slice 2 完成证据中撤销。

尚未关闭 Slice 1/2/4/5：Gamepad物理设备验收、真实多帧角色动画、reduced-motion/低特效策略和更细的材质命中差异仍需后续增量。Rifle 的 authority cue stream/watermark、准星/tracer/impact/hit/kill/rejection/damage direction、正式 effect definition/资源及v7真实双客户端复制已经形成可用基线；`PlayerPresentationFrame` 仍需继续合并 Dash、Tactical、Build 和 Interaction action channel。

Gamepad 底层依赖已按 [ADR 0045](../adr/0045-web-gamepad-input-source-and-polling.md) 实现：Input Core、Web adapter、App Host polling lifecycle 和 Outpost semantic binding 已接通，未在 React/Phaser gameplay 中增加本地轮询。确定性测试与无手柄 Chromium 启动链已通过；物理手柄浏览器验收仍记录在 [`web-gamepad-input-source.md`](web-gamepad-input-source.md)，不再阻塞非实机玩家切片。

## Goal

把 Outpost 玩家从“可移动并触发四个占位动作”重做为一条完整、可调、可复制、可表现的角色竖切。长期玩家合同见 [`../apps/outpost-siege/player-experience.md`](../apps/outpost-siege/player-experience.md)；本文件只记录现状审计、拆分顺序、验证和关闭证据。

本工作流不通过继续扩大 `authority-combat.ts`、`client-shadow-runtime.ts`、`client-presentation-module.ts` 或 `main.tsx` 完成。先建立玩家域边界，再按可独立验收的体验切片迁移。

## Baseline Audit

| 领域              | 当前实现                                                      | 与长期目标的差距                                                                              | 归属                                       |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Input             | WASD、鼠标 aim、单次 click fire、Space/Q/E                    | 无 held fire、reload、interact、ping、build selection、Gamepad；入口直接 switch ability       | Outpost control + Input source             |
| Player definition | actor、weapon、body、render object、move speed                | 无 loadout、movement profile、Animator binding、interaction/presentation profile              | Outpost content/domain                     |
| Movement          | 每 tick直接把 input 映射到目标速度                            | 无 acceleration/deceleration、action arbitration；Dash 可能被普通 movement 覆盖               | Outpost movement + Physics transition      |
| Weapon            | weapon 只有射速、damage、projectile 参数                      | 无 magazine/reserve/reload/shot sequence/heat；射击由 click action触发                        | Outpost weapon runtime                     |
| Ability           | 四值 `OutpostCombatAbility` + `main.tsx` switch               | Dash/部署仍是 app-local即时路径；没有 action channel、稳定 rejection 投影                     | Outpost player ability orchestration + GAS |
| Combat            | Rifle/Shock 已进入 GAS + Combat delivery                      | 缺 ammo/reload、完整 target policy、down/revive、玩家 action conflict                         | Outpost policy/state                       |
| Replication       | transform + 最近 active execution + attributes/cooldown       | 无 weapon/reload/action channel、rejection、cue stream/watermark、interaction                 | Outpost Schema/projection                  |
| Animator          | speed/dead 两参数，所有 phase 映射到 `attack`                 | asset animation全是 `frames: [0]`；无方向、layer、reload/dash/hit reaction                    | Outpost assets/binding/presentation        |
| Feedback          | phase tint/scale，rifle/enemy telegraph 合成音                | 无 muzzle/impact/hit confirm/crosshair/telegraph/camera shake/damage direction；hit SFX未消费 | Outpost cue presentation                   |
| HUD               | health/shield、四个 cooldown/resource 文本                    | 无 ammo/reload、phase progress、rejection reason、interaction/world UI                        | Outpost view model/UI                      |
| Tests             | authority结果、复制、Animator/Audio memory contract、移动预测 | 缺真实资源、held fire、浏览器动作手感、两客户端 cue 和 Gamepad E2E                            | Outpost quality                            |

本轮审计发现的框架缺口是 Input Core 虽声明 `gamepad` device，但 Web/Phaser 运行链没有 Gamepad source/polling adapter。该缺口已通过 Input Core polling/value/device identity、`@gamekits/input-dom` Web adapter 和 App Host source polling 补足。Camera shake、Animator ability-specific phase mapping、Phaser particle、Audio SFX/spatial、Combat/GAS Cue 与 Multiplayer managed prediction 已存在；没有新证据前不扩张对应 Core。

该缺口没有由 Outpost 局部绕过。Player Slice 1 的 Gamepad 子项已经通过 Core/Web/App Host 自动门禁，真实物理设备验收继续由独立工作流保留。

## Target Execution Chain

```txt
raw device input
  -> Input Core action + scope
  -> Outpost control frame / discrete action
  -> Multiplayer managed input/action queues
  -> authority player action arbitration
  -> movement / weapon / GAS execution request
  -> Physics + Combat + GAS result
  -> authority player projection + bounded cue stream
  -> client presentation frame
  -> Animator / VFX / Audio / Camera / world UI / HUD
```

每一层都有单一输入和输出合同。UI、native renderer callback 和 network callback 不直接写 gameplay state。

## Implementation Slices

### Slice 1: Player Domain And Control

- 建立 `content/player`、`domain/player`、`gameplay/player`、`realtime/player` 和 `presentation/player` 边界。
- 扩展 player/loadout/movement/weapon definition，Shared Supply 从玩家 actor resource 投影中移出。
- 把 `main.tsx` 的 ability switch迁入玩家 semantic action mapping。
- 连续控制加入 `fireHeld`，离散 action加入 reload/dash/tactical/deploy/interact/ping。
- 为 Web/Phaser补 Gamepad source，并覆盖 scope、dead zone、设备切换和 cancelled state。

Gate：同一 control/action log 能在 local authority 与 Room authority产生等价玩家 semantic snapshot；focus/reset 后所有 transient held state清零。

### Slice 2: Rifle Vertical Slice

- 增加 magazine/reserve/reload execution/shot sequence/next shot time。
- Held fire按 authority cadence提交 GAS rifle execution，不按 click次数射击。
- Reload使用完整 prepare/commit/recover/cancel；ammo commit与 cooldown遵守 authority phase。
- Projection加入 weapon state、action rejection 和 shot cue sequence。
- 本地 muzzle/recoil anticipation 与 authority commit/reject 使用 correlation 收敛。
- Rifle 使用 kinematic fire/finish record；owner 按同一 Physics sweep 预测 provisional spatial result，remote
  按 authority timeline 重建。

Gate：单人和两客户端覆盖持续射击、空仓、自动/手动换弹、commit前后取消、网络 burst、拒绝和 cue去重；
本地首帧出现弹体，静态 blocker 前零穿透，authority confirm/correct/reject 只收敛一次，generation/reset/
history overflow 和 dispose 有界，并通过真实 owner sweep、record churn 与 remote reconstruction benchmark。

### Slice 3: Movement, Dash And Camera

- 使用数据化 movement profile实现 acceleration/deceleration、strafe/facing分离和受控 modifier。
- Authority与 prediction复用同一 Physics transition。
- Dash进入 player action arbitration与 GAS execution；普通 movement不得覆盖 active dash。
- 添加 collision-shortened dash、单次 correction recover、lookahead和有界 camera impulse。

Gate：持续移动不产生系统性 correction；Dash撞墙、斜向、无输入 fallback、cooldown/rejection和不同刷新率均收敛。

### Slice 4: Character Assets And Animator

- 制作并审核玩家 direction/pose sheet，生成真实 spritesheet/atlas与 manifest。
- 建立 locomotion、upper action、reaction和status layer；ability id + phase映射到独立 clip。
- 加入 run、fire、reload、dash、tactical、hit、downed/revive/death与 visual socket。
- Local anticipation、remote phase recovery、late join和generation reset共用同一 controller。

Gate：浏览器中可肉眼区分所有动作；locomotion参数变化不 reset clip；单帧 fixture只保留在底层契约测试。

### Slice 5: Combat Feedback

- 建立 app-owned bounded cue projection、watermark和 client cue consumer。
- 实现 crosshair、muzzle/tracer、world impact、shield/health hit、kill confirm和damage direction。
- 实现 telegraph形状/进度、rejection feedback、camera impulse和真实 SFX variation/concurrency。
- 所有表现读取同一 presentation frame/correlation，不读取 raw Schema猜测结果。

Gate：miss/world/shield/health/kill/rejected六种结果可辨认；late join/reconnect不重播旧 one-shot；低特效设置仍保留关键信息。

### Slice 6: Tactical, Build And Interaction

- Shock Field完成 targeting、preparing telegraph、commit、area result和recover。
- Build加入 selection、preview、socket/range/obstacle reason、reservation和confirm/cancel。
- Interaction统一 repair/revive/objective候选、优先级、channel和中断原因。

Gate：所有 action都经 semantic intent → GAS/Combat/authority policy，不新增入口 id switch或 renderer特判。

### Slice 7: Downed, Revive And Cooperative State

- 增加 downed/incapacitated/revive protection与受限移动/输入。
- 两客户端覆盖 revive channel、取消、重连、全员失能和 HUD/world提示。
- 结果与统计只读取 authority stable summary。

Gate：完整玩家失败/恢复流程可在 headless和浏览器重放，动画或音频失败不改变结果。

### Slice 8: Closure

- 拆除迁移完成后的旧 input booleans、ability enum switch、共享大文件职责和占位表现。
- 跑真实浏览器双客户端、键鼠/手柄、横竖 viewport、reduced motion与长时 reconnect。
- 建立玩家 authority/client/presentation benchmark与 retained-state预算。
- 迁移稳定结论、关闭本文档并记录最终提交。

## Review Gates

每个 Slice 必须同时满足：

- 行为契约测试，不只断言 private map/counter。
- 至少一条真实 Rapier authority链路。
- 涉及复制时至少两客户端验证。
- 涉及表现时使用真实 Phaser/browser验收，不只使用 memory adapter。
- 新增状态有 hard limit、reset、disconnect和dispose策略。
- GitNexus impact/detect-changes只覆盖预期玩家流程；触及 Core公共 API时单独评审并补 ADR/模块文档。

## First Working Target

第一条实现竖切是 Rifle：`held fire → weapon cadence/ammo → GAS execution → Combat projectile → hit result → replicated cue → Animator/VFX/Audio/Camera/HUD`。它能同时验证操作、角色状态、技能、战斗、复制和动效，是判断玩家架构是否成立的最小完整体验；在这条竖切通过前不增加新武器或新角色。
