import type { DevToolsRuntime } from "@gamekits/devtools";
import { DevToolsOverlay } from "@gamekits/devtools-ui";
import { GameKitsUiShell, UiFocusBridge } from "@gamekits/react-ui";
import type { UiRuntime } from "@gamekits/ui-core";
import { createRef, memo, type CSSProperties, type RefObject } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import type { AiLabController } from "./runtime";
import { AI_LAB_STRESS_MAX_OPTIONS } from "./stress-test";
import type {
  AiLabActivity,
  AiLabAnimalView,
  AiLabBehaviorLogExport,
  AiLabBehaviorPhase,
  AiLabObstacleView,
  AiLabResourceVariant,
  AiLabResourceView,
  AiLabSnapshot,
  AiLabSpecies
} from "./types";

export type AiLabUi = {
  bind(controller: AiLabController): void;
  update(snapshot: AiLabSnapshot): void;
  mountDevTools(runtime: DevToolsRuntime): void;
  dispose(): void;
};

export function renderAiLabUi(rootElement: HTMLElement, uiRuntime: UiRuntime): AiLabUi {
  const reactRoot = createRoot(rootElement);
  const shellRef = createRef<HTMLElement>();
  const stageRef = createRef<HTMLDivElement>();
  const devtoolsRef = createRef<HTMLDivElement>();
  let controller: AiLabController | undefined;
  let snapshot: AiLabSnapshot | undefined;
  let devtoolsRoot: ReactRoot | undefined;

  const invoke = (action: (value: AiLabController) => void): void => {
    if (!controller) {
      return;
    }
    action(controller);
    snapshot = controller.snapshot();
    render();
  };

  const render = (): void => {
    reactRoot.render(
      <AiLabView
        uiRuntime={uiRuntime}
        shellRef={shellRef}
        stageRef={stageRef}
        devtoolsRef={devtoolsRef}
        snapshot={snapshot}
        invoke={invoke}
      />
    );
  };

  flushSync(render);
  if (!devtoolsRef.current) {
    throw new Error("AI Lab UI did not create its DevTools mount target");
  }

  return {
    bind(nextController) {
      controller = nextController;
      snapshot = nextController.snapshot();
      render();
    },
    update(nextSnapshot) {
      snapshot = nextSnapshot;
      render();
    },
    mountDevTools(runtime) {
      devtoolsRoot ??= createRoot(devtoolsRef.current!);
      devtoolsRoot.render(<DevToolsOverlay runtime={runtime} uiRuntime={uiRuntime} />);
    },
    dispose() {
      devtoolsRoot?.unmount();
      reactRoot.unmount();
    }
  };
}

function AiLabView({
  uiRuntime,
  shellRef,
  stageRef,
  devtoolsRef,
  snapshot,
  invoke
}: {
  uiRuntime: UiRuntime;
  shellRef: RefObject<HTMLElement>;
  stageRef: RefObject<HTMLDivElement>;
  devtoolsRef: RefObject<HTMLDivElement>;
  snapshot: AiLabSnapshot | undefined;
  invoke(action: (controller: AiLabController) => void): void;
}) {
  const ready = snapshot?.running ?? false;
  const selected = snapshot?.selected;
  const stressRunning =
    snapshot?.stress.status === "warming" || snapshot?.stress.status === "sampling";

  return (
    <GameKitsUiShell runtime={uiRuntime} className="ai-lab-ui" density="compact" theme="ai-lab">
      <UiFocusBridge runtime={uiRuntime} gameViewportRef={stageRef} uiRootRef={shellRef} />
      <section className="ai-lab" ref={shellRef}>
        <header className="ai-lab__header">
          <div className="ai-lab__title-lockup">
            <span>GAMEKITS · AI ECOSYSTEM LAB</span>
            <h1>林间一日</h1>
            <p>每只小动物都在自己决定：先吃饭、喝水、休息，还是继续探索。</p>
          </div>

          <div className="ai-lab__day-clock" aria-label="林地时间">
            <div className="ai-lab__sun-dial">
              <i style={{ "--day-progress": snapshot?.dayProgress ?? 0 } as CSSProperties} />
            </div>
            <span>
              第 {snapshot?.day ?? 1} 天 · {snapshot?.periodLabel ?? "清晨"}
            </span>
            <strong>{formatClock(snapshot?.dayProgress ?? 0)}</strong>
          </div>

          <div className="ai-lab__summary-strip">
            <SummaryMetric label="居民" value={`${snapshot?.population ?? 0} 只`} />
            <SummaryMetric label="食物" value={`${Math.round(snapshot?.foodRemaining ?? 0)} 份`} />
            <SummaryMetric
              label="整体状态"
              value={`${Math.round((snapshot?.wellbeing ?? 0) * 100)}%`}
            />
          </div>

          <div className="ai-lab__world-controls" data-ui-panel="sandbox.ai-lab.controls">
            <button
              type="button"
              disabled={!ready}
              onClick={() => invoke((value) => value.scatterFood())}
            >
              <span aria-hidden="true">●●</span> 撒些食物
            </button>
            <button
              type="button"
              disabled={!ready}
              onClick={() => invoke((value) => value.makeRain())}
            >
              <span aria-hidden="true">☂</span> 下一场雨
            </button>
            <button
              type="button"
              disabled={!ready}
              onClick={() => invoke((value) => value.togglePaused())}
            >
              {snapshot?.paused ? "继续" : "暂停"}
            </button>
            {snapshot?.paused ? (
              <button
                type="button"
                disabled={!ready}
                onClick={() => invoke((value) => value.step())}
              >
                单步
              </button>
            ) : null}
            <div className="ai-lab__speed-control" aria-label="观察速度">
              {[0.5, 1, 2].map((speed) => (
                <button
                  type="button"
                  key={speed}
                  disabled={!ready}
                  data-active={snapshot?.timeScale === speed}
                  onClick={() => invoke((value) => value.setTimeScale(speed))}
                >
                  {speed}×
                </button>
              ))}
            </div>
          </div>
        </header>

        <main className="ai-lab__workspace">
          <section className="ai-lab__map-card" data-ui-panel="sandbox.ai-lab.stage">
            <div className="ai-lab__map-heading">
              <div>
                <span>苔湾林地 · 实时观察</span>
                <strong>{snapshot?.paused ? "时间暂停" : "生态正在自行运转"}</strong>
              </div>
              <div className="ai-lab__scene-tools">
                <p>点击动物观察；点击倒木，直接改变它们的路线。</p>
                <div aria-label="林地现场干预">
                  <button
                    type="button"
                    disabled={!ready}
                    data-active={snapshot?.forestAlert}
                    onClick={() => invoke((value) => value.toggleForestAlert())}
                  >
                    <span aria-hidden="true">♢</span>
                    {snapshot?.forestAlert ? "解除警戒" : "敲响警铃"}
                  </button>
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => invoke((value) => value.stressBudgets())}
                  >
                    <span aria-hidden="true">⌁</span> 惊起鸟群
                  </button>
                  <button
                    type="button"
                    disabled={!ready || stressRunning}
                    onClick={() => invoke((value) => value.saveCheckpoint())}
                  >
                    <span aria-hidden="true">❧</span> 留下叶印
                  </button>
                  <button
                    type="button"
                    disabled={
                      !ready ||
                      stressRunning ||
                      snapshot?.capabilities.checkpoint.capturedAt === undefined
                    }
                    onClick={() => invoke((value) => value.restoreCheckpoint())}
                  >
                    <span aria-hidden="true">↶</span> 回到叶印
                  </button>
                </div>
              </div>
            </div>

            {snapshot ? (
              <StressTestPanel
                snapshot={snapshot}
                invoke={invoke}
                ready={ready}
                running={stressRunning}
              />
            ) : null}

            <div
              className="ai-lab__habitat"
              ref={stageRef}
              tabIndex={0}
              aria-label="小动物生存地图"
              data-period={periodKey(snapshot?.dayProgress ?? 0)}
              data-alert={snapshot?.forestAlert ?? false}
              data-route-surge={snapshot?.routeSurgeActive ?? false}
              data-rewinding={snapshot?.rewindActive ?? false}
            >
              <Terrain />
              {snapshot ? <SceneEffects snapshot={snapshot} /> : null}
              <RouteLayer
                animals={snapshot?.animals ?? []}
                selectedId={snapshot?.selectedId}
                showAll={(snapshot?.forestAlert ?? false) || (snapshot?.routeSurgeActive ?? false)}
              />

              {(snapshot?.resources ?? []).map((resource) => (
                <ResourceNode key={resource.id} resource={resource} />
              ))}

              {(snapshot?.obstacles ?? []).map((obstacle) => (
                <ObstacleNode
                  key={obstacle.id}
                  obstacle={obstacle}
                  onToggle={() => invoke((value) => value.toggleProbeBarrier(obstacle.id))}
                />
              ))}

              {(snapshot?.animals ?? []).map((animal) => (
                <AnimalNode
                  key={animal.id}
                  animal={animal}
                  selected={animal.id === snapshot?.selectedId}
                  replanning={snapshot?.routeSurgeActive ?? false}
                  onSelect={() => invoke((value) => value.selectAnimal(animal.id))}
                />
              ))}

              <div className="ai-lab__map-legend" aria-label="地图图例">
                <span>
                  <i data-kind="food" /> 食物
                </span>
                <span>
                  <i data-kind="water" /> 水源
                </span>
                <span>
                  <i data-kind="shelter" /> 休息处
                </span>
              </div>
              <div className="ai-lab__map-caption">
                <span>风向 / 西南</span>
                <span>水量 {Math.round(snapshot?.waterRemaining ?? 0)}</span>
              </div>
            </div>

            <div className="ai-lab__notice" aria-live="polite">
              <i aria-hidden="true" />
              <span>{snapshot?.notice ?? "正在等待林地苏醒……"}</span>
            </div>
          </section>

          <aside className="ai-lab__observer" data-ui-panel="sandbox.ai-lab.telemetry">
            {selected ? (
              <>
                <SelectedAnimalHeader
                  animal={selected}
                  onExport={() =>
                    invoke((value) => {
                      const log = value.exportSelectedBehaviorLog();
                      if (log) {
                        downloadBehaviorLog(log);
                      }
                    })
                  }
                />
                <section className="ai-lab__explanation">
                  <span>它现在在想什么？</span>
                  <p>{decisionExplanation(selected, snapshot)}</p>
                </section>

                <section className="ai-lab__needs">
                  <SectionTitle eyebrow="生存状态" title="今天过得怎么样" />
                  <NeedMeter label="饥饿" value={selected.hunger} dangerHigh tone="berry" />
                  <NeedMeter label="口渴" value={selected.thirst} dangerHigh tone="water" />
                  <NeedMeter label="体力" value={selected.energy} tone="sun" />
                  <NeedMeter label="健康" value={selected.health} tone="leaf" />
                </section>

                <section className="ai-lab__choices">
                  <SectionTitle eyebrow="当前选择" title="此刻哪件事最重要" />
                  <div className="ai-lab__choice-list">
                    {(snapshot?.goals ?? []).map((goal) => (
                      <div
                        key={goal.goalId}
                        data-active={goal.role === selected.activity}
                        data-eligible={goal.eligible}
                      >
                        <ActivityMark activity={goal.role} />
                        <span>{goal.label}</span>
                        <i>
                          <b style={{ width: `${Math.round(goal.score * 100)}%` }} />
                        </i>
                        <strong>{Math.round(goal.score * 100)}</strong>
                      </div>
                    ))}
                  </div>
                </section>

                <details className="ai-lab__ai-details">
                  <summary>查看 AI 判断细节</summary>
                  <dl>
                    <div>
                      <dt>Goal</dt>
                      <dd>{selected.goalId ?? "尚未选择"}</dd>
                    </div>
                    <div>
                      <dt>Task</dt>
                      <dd>{snapshot?.selectedAgent?.task?.taskId ?? "尚未启动"}</dd>
                    </div>
                    <div>
                      <dt>Memory</dt>
                      <dd>{snapshot?.memory.length ?? 0} 条环境事实</dd>
                    </div>
                    <div>
                      <dt>Scheduler</dt>
                      <dd>
                        {selected.schedulerClassId ?? "—"} ·{" "}
                        {snapshot?.selectedAgent?.delayedDecisions ?? 0} 次延后
                      </dd>
                    </div>
                    <div>
                      <dt>Route</dt>
                      <dd>
                        {selected.routeMode === "detour"
                          ? "Grid route · 绕开动态障碍"
                          : selected.routeMode === "direct"
                            ? "Grid route · 当前最短路"
                            : selected.routeMode === "planning"
                              ? "等待寻路预算"
                              : "尚未移动"}
                      </dd>
                    </div>
                  </dl>
                  <div className="ai-lab__fact-cloud">
                    {(snapshot?.memory ?? []).slice(0, 7).map((fact) => (
                      <span key={`${fact.key}:${fact.subjectId ?? "self"}`}>
                        {friendlyFact(fact.key)} <b>{formatFact(fact.value)}</b>
                      </span>
                    ))}
                  </div>
                </details>
              </>
            ) : (
              <div className="ai-lab__observer-empty">点一只小动物开始观察。</div>
            )}

            <section className="ai-lab__journal">
              <SectionTitle eyebrow="林地小记" title="刚刚发生的事" />
              <ol>
                {(snapshot?.events ?? []).map((event) => (
                  <li key={event.sequence} data-tone={event.tone}>
                    <time>{formatEventTime(event.timestamp)}</time>
                    <span>{event.message}</span>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </main>
      </section>
      <div className="devtools-overlay-root" ref={devtoolsRef} />
    </GameKitsUiShell>
  );
}

function StressTestPanel({
  snapshot,
  invoke,
  ready,
  running
}: {
  snapshot: AiLabSnapshot;
  invoke(action: (controller: AiLabController) => void): void;
  ready: boolean;
  running: boolean;
}) {
  const stress = snapshot.stress;
  const primaryValue = running
    ? `${stress.testingAnimals.toLocaleString()} 只`
    : stress.status === "complete" || stress.status === "stopped"
      ? `${stress.stableAnimals.toLocaleString()} 只`
      : "尚未测试";
  const resultLabel = running ? "当前档位" : "稳定上限";

  return (
    <section
      className="ai-lab__stress-panel"
      data-status={stress.status}
      aria-label="AI 容量压力测试"
    >
      <div className="ai-lab__stress-copy">
        <span>AI CAPACITY</span>
        <strong>真实动物自动探顶</strong>
        <p>逐级倍增完整运行链；按 30 FPS / 28ms 模拟预算探顶，地图固定抽样表现。</p>
      </div>
      <label>
        <span>测试上限</span>
        <select
          aria-label="压力测试上限"
          value={stress.configuredMaxAnimals}
          disabled={!ready || running}
          onChange={(event) =>
            invoke((value) => value.setStressMaxAnimals(Number(event.currentTarget.value)))
          }
        >
          {AI_LAB_STRESS_MAX_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value.toLocaleString()} 只
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={!ready}
        data-running={running}
        onClick={() =>
          invoke((value) => (running ? value.stopStressTest() : value.startStressTest()))
        }
      >
        {running ? "停止并恢复" : "开始自动探顶"}
      </button>
      <div className="ai-lab__stress-metrics">
        <span>
          {resultLabel}
          <b>{primaryValue}</b>
        </span>
        <span>
          平均 FPS<b>{formatMetric(stress.averageFps, 0)}</b>
        </span>
        <span>
          模拟 p95<b>{formatMetric(stress.p95SimulationMs, 1, "ms")}</b>
        </span>
        <span>
          调度延后<b>{formatMetric(stress.delayedDecisionsPerSecond, 0, "/s")}</b>
        </span>
        <span>
          冷启动<b>{formatMetric(stress.coldStartMs, 0, "ms")}</b>
        </span>
      </div>
      <div className="ai-lab__stress-progress" aria-label="压力测试进度">
        <i style={{ width: `${Math.round(stress.phaseProgress * 100)}%` }} />
      </div>
      <small>
        {stressStatusLabel(stress)} · 实际 {stress.activeAnimals.toLocaleString()} 只 / 表现抽样{" "}
        {stress.renderedAnimals} 只
      </small>
    </section>
  );
}

function Terrain() {
  return (
    <div className="ai-lab__terrain" aria-hidden="true">
      <i className="ai-lab__terrain-glade" />
      <i className="ai-lab__terrain-pond ai-lab__terrain-pond--west" />
      <i className="ai-lab__terrain-pond ai-lab__terrain-pond--east" />
      <i className="ai-lab__terrain-path ai-lab__terrain-path--one" />
      <i className="ai-lab__terrain-path ai-lab__terrain-path--two" />
      <div className="ai-lab__tree-line ai-lab__tree-line--north">♠ ♠ ♠ ♠ ♠ ♠ ♠</div>
      <div className="ai-lab__tree-line ai-lab__tree-line--south">♠ ♠ ♠ ♠ ♠</div>
      <span className="ai-lab__place-name ai-lab__place-name--meadow">蒲草坡</span>
      <span className="ai-lab__place-name ai-lab__place-name--pond">浅水湾</span>
      <span className="ai-lab__place-name ai-lab__place-name--grove">蘑菇林</span>
    </div>
  );
}

function SceneEffects({ snapshot }: { snapshot: AiLabSnapshot }) {
  return (
    <div className="ai-lab__scene-effects" aria-hidden="true">
      {snapshot.forestAlert ? (
        <div className="ai-lab__alarm-signal">
          <i />
          <i />
          <strong>警</strong>
        </div>
      ) : null}
      {snapshot.routeSurgeActive ? (
        <div className="ai-lab__flock-surge">
          <span>⌁</span>
          <span>⌁</span>
          <span>⌁</span>
          <b>路线重算中</b>
        </div>
      ) : null}
      {snapshot.checkpointEchoes.map((echo) => (
        <i
          className="ai-lab__checkpoint-echo"
          key={echo.animalId}
          style={{ left: `${echo.x}%`, top: `${echo.y}%` }}
        />
      ))}
      {snapshot.rewindActive ? <div className="ai-lab__rewind-wave" /> : null}
    </div>
  );
}

function RouteLayer({
  animals,
  selectedId,
  showAll
}: {
  animals: AiLabAnimalView[];
  selectedId: string | undefined;
  showAll: boolean;
}) {
  const visible = animals.filter(
    (animal) =>
      (showAll || animal.id === selectedId) &&
      (animal.routePoints.length >= 2 ||
        (animal.targetX !== undefined && animal.targetY !== undefined))
  );
  if (visible.length === 0) {
    return null;
  }
  return (
    <svg
      className="ai-lab__target-path"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {visible.map((animal) => {
        const routePoints =
          animal.routePoints.length >= 2
            ? [{ x: animal.x, y: animal.y }, ...animal.routePoints]
            : [
                { x: animal.x, y: animal.y },
                { x: animal.targetX ?? animal.x, y: animal.targetY ?? animal.y }
              ];
        const target = routePoints.at(-1)!;
        return (
          <g key={animal.id} data-mode={animal.routeMode ?? "planning"}>
            <polyline points={routePoints.map((point) => `${point.x},${point.y}`).join(" ")} />
            <circle cx={target.x} cy={target.y} r="1.1" />
          </g>
        );
      })}
    </svg>
  );
}

type AnimalNodeProps = {
  animal: AiLabAnimalView;
  selected: boolean;
  replanning: boolean;
  onSelect(): void;
};

const AnimalNode = memo(function AnimalNode({
  animal,
  selected,
  replanning,
  onSelect
}: AnimalNodeProps) {
  const critical = animalIsCritical(animal);
  return (
    <button
      type="button"
      className="ai-lab__animal"
      style={
        {
          "--animal-x": `${animal.x}cqw`,
          "--animal-y": `${animal.y}%`
        } as CSSProperties
      }
      data-species={animal.species}
      data-activity={animal.activity}
      data-phase={animal.behaviorPhase}
      data-selected={selected}
      data-scheduler={animal.schedulerClassId}
      data-replanning={replanning}
      data-critical={critical}
      data-facing={animal.velocityX < -0.05 ? "left" : "right"}
      onClick={onSelect}
      aria-label={`${animal.name}，${behaviorStatusLabel(animal.activity, animal.behaviorPhase)}`}
    >
      <span className="ai-lab__animal-shadow" aria-hidden="true" />
      <AnimalGlyph species={animal.species} />
      <span className="ai-lab__animal-name">{animal.name}</span>
      <span className="ai-lab__activity-bubble" data-phase={animal.behaviorPhase}>
        <ActivityMark activity={animal.activity} />
        <b>{replanning ? "重算" : activityBubbleLabel(animal.activity, animal.behaviorPhase)}</b>
        <i style={{ width: `${Math.round(animal.behaviorProgress * 100)}%` }} aria-hidden="true" />
      </span>
    </button>
  );
}, sameAnimalNodeProps);

function sameAnimalNodeProps(previous: AnimalNodeProps, next: AnimalNodeProps): boolean {
  const left = previous.animal;
  const right = next.animal;
  return (
    previous.selected === next.selected &&
    previous.replanning === next.replanning &&
    left.id === right.id &&
    left.name === right.name &&
    left.species === right.species &&
    left.x === right.x &&
    left.y === right.y &&
    left.velocityX < -0.05 === right.velocityX < -0.05 &&
    left.activity === right.activity &&
    left.behaviorPhase === right.behaviorPhase &&
    Math.round(left.behaviorProgress * 100) === Math.round(right.behaviorProgress * 100) &&
    left.schedulerClassId === right.schedulerClassId &&
    animalIsCritical(left) === animalIsCritical(right)
  );
}

function animalIsCritical(animal: AiLabAnimalView): boolean {
  return animal.health < 0.4 || animal.hunger > 0.88 || animal.thirst > 0.88;
}

function ResourceNode({ resource }: { resource: AiLabResourceView }) {
  const ratio = resource.amount / Math.max(1, resource.capacity);
  return (
    <div
      className="ai-lab__resource"
      style={{ left: `${resource.x}%`, top: `${resource.y}%`, "--stock": ratio } as CSSProperties}
      data-kind={resource.kind}
      data-variant={resource.variant}
      data-low={resource.kind !== "shelter" && ratio < 0.24}
      title={`${resourceLabel(resource.variant)}：${Math.round(ratio * 100)}%`}
    >
      <ResourceGlyph variant={resource.variant} />
      <span>{resourceLabel(resource.variant)}</span>
      {resource.kind !== "shelter" ? (
        <i>
          <b />
        </i>
      ) : null}
    </div>
  );
}

function ObstacleNode({ obstacle, onToggle }: { obstacle: AiLabObstacleView; onToggle(): void }) {
  return (
    <button
      type="button"
      className="ai-lab__obstacle"
      style={
        {
          left: `${obstacle.x}%`,
          top: `${obstacle.y}%`,
          width: `${obstacle.width}%`,
          height: `${obstacle.height}%`
        } as CSSProperties
      }
      data-kind={obstacle.kind}
      data-enabled={obstacle.enabled}
      title={`${obstacle.label} · Physics collider ${obstacle.enabled ? "enabled" : "disabled"}`}
      aria-label={`${obstacle.enabled ? "移开" : "放回"}${obstacle.label}`}
      onClick={onToggle}
    >
      <i aria-hidden="true" />
      <span>
        {obstacle.label} · {obstacle.enabled ? "点击移开" : "点击放回"}
      </span>
    </button>
  );
}

function SelectedAnimalHeader({ animal, onExport }: { animal: AiLabAnimalView; onExport(): void }) {
  const phase = animal.behaviorPhase;
  const progress = animal.behaviorProgress;
  return (
    <header className="ai-lab__selected-header" data-activity={animal.activity}>
      <div className="ai-lab__portrait">
        <AnimalGlyph species={animal.species} />
      </div>
      <div>
        <span>{speciesLabel(animal.species)} · 林地居民</span>
        <h2>{animal.name}</h2>
        <strong>
          <ActivityMark activity={animal.activity} /> {behaviorStatusLabel(animal.activity, phase)}
        </strong>
        <div className="ai-lab__behavior-progress" data-phase={phase}>
          <span>
            {behaviorPhaseLabel(phase)} <b>{Math.round(progress * 100)}%</b>
          </span>
          <i>
            <b style={{ width: `${Math.round(progress * 100)}%` }} />
          </i>
        </div>
        <button type="button" className="ai-lab__export-log" onClick={onExport}>
          <span aria-hidden="true">⇩</span> 导出近 10 秒行为日志
        </button>
      </div>
    </header>
  );
}

function NeedMeter({
  label,
  value,
  tone,
  dangerHigh = false
}: {
  label: string;
  value: number;
  tone: "berry" | "water" | "sun" | "leaf";
  dangerHigh?: boolean | undefined;
}) {
  const displayValue = dangerHigh ? 1 - value : value;
  return (
    <div className="ai-lab__need-meter" data-tone={tone} data-warning={displayValue < 0.25}>
      <span>{label}</span>
      <i>
        <b style={{ width: `${Math.round(displayValue * 100)}%` }} />
      </i>
      <strong>{Math.round(displayValue * 100)}%</strong>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="ai-lab__section-title">
      <span>{eyebrow}</span>
      <h3>{title}</h3>
    </header>
  );
}

function ActivityMark({ activity }: { activity: AiLabActivity }) {
  const symbol =
    activity === "hide"
      ? "!"
      : activity === "forage"
        ? "✦"
        : activity === "drink"
          ? "◒"
          : activity === "rest"
            ? "☾"
            : activity === "wander"
              ? "↝"
              : "·";
  return (
    <b className="ai-lab__activity-mark" data-activity={activity} aria-hidden="true">
      {symbol}
    </b>
  );
}

const AnimalGlyph = memo(function AnimalGlyph({ species }: { species: AiLabSpecies }) {
  if (species === "rabbit") {
    return (
      <svg className="ai-lab__animal-glyph" viewBox="0 0 64 64" aria-hidden="true">
        <ellipse
          className="fur-light"
          cx="26"
          cy="14"
          rx="6"
          ry="15"
          transform="rotate(-10 26 14)"
        />
        <ellipse
          className="fur-light"
          cx="39"
          cy="14"
          rx="6"
          ry="15"
          transform="rotate(10 39 14)"
        />
        <ellipse className="fur" cx="31" cy="43" rx="20" ry="14" />
        <circle className="fur-light" cx="38" cy="29" r="15" />
        <circle className="eye" cx="44" cy="27" r="2.2" />
        <circle className="nose" cx="52" cy="33" r="2" />
        <circle className="tail" cx="12" cy="39" r="7" />
      </svg>
    );
  }
  if (species === "squirrel") {
    return (
      <svg className="ai-lab__animal-glyph" viewBox="0 0 64 64" aria-hidden="true">
        <path
          className="tail"
          d="M18 46C2 44 4 20 19 17c11-2 18 10 10 18-5 5-11 0-7-5 3-4-2-7-6-4-8 7-3 15 2 20Z"
        />
        <ellipse className="fur" cx="37" cy="43" rx="16" ry="13" />
        <circle className="fur-light" cx="43" cy="29" r="13" />
        <path className="fur" d="m36 19 2-10 8 9m4 1 7-8-1 12" />
        <circle className="eye" cx="48" cy="27" r="2" />
        <circle className="nose" cx="57" cy="33" r="2" />
      </svg>
    );
  }
  if (species === "hedgehog") {
    return (
      <svg className="ai-lab__animal-glyph" viewBox="0 0 64 64" aria-hidden="true">
        <path
          className="spines"
          d="m8 44 5-8-3-7 9-2 1-9 8 4 6-8 5 9 9-3-1 9 9 4-7 7 5 8-13 3H17Z"
        />
        <path className="fur-light" d="M28 29c10-8 25-2 29 11-7 9-19 13-33 7-2-7-1-13 4-18Z" />
        <circle className="eye" cx="46" cy="36" r="2" />
        <circle className="nose" cx="59" cy="43" r="2.3" />
      </svg>
    );
  }
  return (
    <svg className="ai-lab__animal-glyph" viewBox="0 0 64 64" aria-hidden="true">
      <path className="tail-line" d="M18 45C3 52 3 37 13 38" />
      <ellipse className="fur" cx="34" cy="43" rx="18" ry="12" />
      <circle className="fur-light" cx="45" cy="32" r="13" />
      <circle className="ear" cx="38" cy="21" r="7" />
      <circle className="ear" cx="49" cy="20" r="7" />
      <circle className="eye" cx="49" cy="31" r="2" />
      <circle className="nose" cx="58" cy="36" r="2" />
    </svg>
  );
});

function ResourceGlyph({ variant }: { variant: AiLabResourceVariant }) {
  if (variant === "berries")
    return (
      <span className="resource-glyph resource-glyph--berries">
        ●●●
        <i />
      </span>
    );
  if (variant === "clover") return <span className="resource-glyph resource-glyph--clover">♣</span>;
  if (variant === "seeds") return <span className="resource-glyph resource-glyph--seeds">•••</span>;
  if (variant === "mushrooms")
    return <span className="resource-glyph resource-glyph--mushrooms">♠♠</span>;
  if (variant === "pond" || variant === "spring")
    return <span className="resource-glyph resource-glyph--water">◒</span>;
  return <span className="resource-glyph resource-glyph--shelter">⌒</span>;
}

function decisionExplanation(animal: AiLabAnimalView, snapshot: AiLabSnapshot | undefined): string {
  const phase = animal.behaviorPhase;
  const target = animal.targetId
    ? snapshot?.resources.find((resource) => resource.id === animal.targetId)
    : undefined;
  const destination = target ? resourceLabel(target.variant) : "附近的空地";
  if (animal.activity === "hide") {
    if (phase === "interact") {
      return `${animal.name}已经藏进${destination}。只要共享警戒仍然存在，它就会留在这里等待，不会立刻结束行为。`;
    }
    if (phase === "settle") {
      return `警戒已经解除，${animal.name}正在确认周围安全。完成收尾后，它才会重新评估饥饿、口渴和体力。`;
    }
    return `${animal.name}收到了林地共享警戒，安全目标现在压过其他需求。它正在分阶段赶往${destination}。`;
  }
  if (phase === "orient") {
    return `${animal.name}没有立刻出发。它正在确认需求、目标位置和行进方向，然后才会开始行动。`;
  }
  if (phase === "route") {
    return `${animal.name}正在通过 Navigation request / poll / sample 生命周期规划路线，拿到 route 后才会继续移动。`;
  }
  if (phase === "prepare") {
    return `${animal.name}已经抵达${destination}，正在停稳并确认周围安全，准备进入真正的执行阶段。`;
  }
  if (phase === "interact") {
    if (animal.activity === "forage") {
      return `${animal.name}正在${destination}慢慢进食。饥饿值会随进食过程逐步下降，不会一次恢复。`;
    }
    if (animal.activity === "drink") {
      return `${animal.name}正在${destination}连续饮水。它会喝够一段时间，再判断口渴是否已经缓解。`;
    }
    return `${animal.name}已经在${destination}安顿下来，体力会随着休息过程逐步恢复。`;
  }
  if (phase === "settle") {
    return `${animal.name}已经满足了这次需求，但会先停下来收尾，之后才结束任务并重新做决定。`;
  }
  if (phase === "observe") {
    return `${animal.name}走完了这段探索路线，正在原地观察刚到达的区域，随后才会完成这次游荡。`;
  }
  if (animal.activity === "forage") {
    return `${animal.name}的饱腹度只剩 ${Math.round((1 - animal.hunger) * 100)}%，所以它把找食物排在最前面，正朝${destination}赶去。`;
  }
  if (animal.activity === "drink") {
    return `${animal.name}现在最缺水。它记得${destination}的位置，正在沿最直接的方向过去。`;
  }
  if (animal.activity === "rest") {
    return `${animal.name}的体力降到了 ${Math.round(animal.energy * 100)}%，它会先抵达${destination}，再安全地停下来休息。`;
  }
  if (animal.activity === "wander") {
    return `${animal.name}目前不太饿，也不太渴，体力还够，于是选择在林地里随便逛逛。`;
  }
  return `${animal.name}正在观察环境，下一次感知采样后就会选定新的行动。`;
}

function activityLabel(activity: AiLabActivity): string {
  if (activity === "hide") return "正在寻找藏身处";
  if (activity === "forage") return "正在找食物";
  if (activity === "drink") return "正在找水";
  if (activity === "rest") return "正在找地方休息";
  if (activity === "wander") return "正在四处探索";
  return "正在观察四周";
}

function behaviorPhaseLabel(phase: AiLabBehaviorPhase): string {
  if (phase === "orient") return "确认方向";
  if (phase === "route") return "规划路线";
  if (phase === "travel" || phase === "explore") return "移动途中";
  if (phase === "prepare") return "到达准备";
  if (phase === "interact") return "持续执行";
  if (phase === "settle") return "行动收尾";
  if (phase === "observe") return "停留观察";
  return "等待决策";
}

function behaviorStatusLabel(activity: AiLabActivity, phase: AiLabBehaviorPhase): string {
  if (phase === "orient") return "正在确认方向";
  if (phase === "route") return "正在规划路线";
  if (phase === "prepare") return "已经抵达，正在准备";
  if (phase === "interact") {
    if (activity === "forage") return "正在慢慢进食";
    if (activity === "drink") return "正在持续饮水";
    if (activity === "rest") return "正在安静休息";
    if (activity === "hide") return "已经藏好，等待安全";
  }
  if (phase === "settle") return "正在结束这次行动";
  if (phase === "observe") return "正在观察新地点";
  return activityLabel(activity);
}

function activityBubbleLabel(activity: AiLabActivity, phase: AiLabBehaviorPhase): string {
  if (phase === "orient") return "想想";
  if (phase === "route") return "寻路";
  if (phase === "prepare") return "确认";
  if (phase === "settle") return "收尾";
  if (phase === "observe" || phase === "waiting") return "观察";
  if (phase === "interact") {
    if (activity === "forage") return "进食";
    if (activity === "drink") return "喝水";
    if (activity === "rest") return "休息";
    if (activity === "hide") return "躲好";
  }
  if (activity === "hide") return "躲藏";
  if (activity === "forage") return "觅食";
  if (activity === "drink") return "找水";
  if (activity === "rest") return "找窝";
  return "探索";
}

function downloadBehaviorLog(log: AiLabBehaviorLogExport): void {
  const contents = `${JSON.stringify(log, null, 2)}\n`;
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ai-lab-${log.animal.id}-${Math.round(log.window.end)}ms.json`;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function speciesLabel(species: AiLabSpecies): string {
  if (species === "rabbit") return "野兔";
  if (species === "squirrel") return "松鼠";
  if (species === "hedgehog") return "刺猬";
  return "田鼠";
}

function resourceLabel(variant: AiLabResourceVariant): string {
  if (variant === "berries") return "莓果丛";
  if (variant === "clover") return "三叶草地";
  if (variant === "seeds") return "种子坡";
  if (variant === "mushrooms") return "蘑菇圈";
  if (variant === "pond") return "浅水塘";
  if (variant === "spring") return "林间泉";
  if (variant === "burrow") return "旧地洞";
  return "空心木";
}

function friendlyFact(key: string): string {
  if (key === "need.hunger") return "饥饿";
  if (key === "need.thirst") return "口渴";
  if (key === "need.fatigue") return "疲劳";
  if (key === "survival.health") return "健康";
  if (key.includes("food")) return "附近食物";
  if (key.includes("water")) return "附近水源";
  if (key.includes("shelter")) return "附近休息处";
  if (key === "shared.forest-alert") return "共享警戒";
  if (key === "physics.route-clear") return "物理视线";
  return key;
}

function formatFact(value: unknown): string {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : String(value ?? "—");
}

function formatClock(progress: number): string {
  const totalMinutes = Math.floor(progress * 24 * 60);
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatEventTime(timestamp: number): string {
  const progress = (timestamp % 60_000) / 60_000;
  return formatClock(progress);
}

function formatMetric(value: number, digits: number, suffix = ""): string {
  return value <= 0 ? "—" : `${value.toFixed(digits)}${suffix}`;
}

function stressStatusLabel(stress: AiLabSnapshot["stress"]): string {
  if (stress.status === "warming") {
    return `${stress.testingAnimals.toLocaleString()} 只预热中 · Navigation pending ${stress.pendingNavigationRequests}`;
  }
  if (stress.status === "sampling") {
    return `${stress.testingAnimals.toLocaleString()} 只稳态采样 · 冷启动 ${stress.coldStartMs.toFixed(0)}ms · ${stress.sampleFrames} 帧`;
  }
  if (stress.status === "complete") {
    if (stress.reachedConfiguredLimit) {
      return `已稳定达到所选上限 ${stress.stableAnimals.toLocaleString()} 只`;
    }
    return `${stress.lastTestedAnimals.toLocaleString()} 只未通过 · ${stress.failureReason ?? "实时预算不足"}`;
  }
  if (stress.status === "stopped") {
    return `已停止 · 保留结果 ${stress.stableAnimals.toLocaleString()} 只`;
  }
  return "选择上限后自动逐级测试";
}

function periodKey(progress: number): "dawn" | "day" | "dusk" | "night" {
  if (progress < 0.2) return "dawn";
  if (progress < 0.72) return "day";
  if (progress < 0.9) return "dusk";
  return "night";
}
