import type { AppHost } from "@gamekits/app-host";
import type { DataRegistry } from "@gamekits/data";
import type { SandboxRuntime, SandboxSnapshot } from "../game";
import { formatNumber, upper } from "./format";
import type { SandboxUiHandles, SandboxWorkbenchState } from "./types";

export function renderInspector(
  handles: SandboxUiHandles,
  sandbox: SandboxRuntime,
  state: SandboxWorkbenchState
): void {
  const selectionCleared = state.selectionCleared === true;
  const snapshot = sandbox.snapshot({
    selectedActorId: selectionCleared ? undefined : state.selectedActorId,
    selectedEntityId: selectionCleared ? undefined : state.selectedEntityId,
    defaultSelection: !selectionCleared
  });
  const selectedActorId = selectionCleared
    ? undefined
    : (snapshot.selected?.actorId ?? snapshot.gasActors[0]?.actor.actorId);
  if (!selectionCleared && !state.selectedActorId && !state.selectedEntityId && selectedActorId) {
    state.selectedActorId = selectedActorId;
  }

  const selectedEntity = selectionCleared
    ? undefined
    : snapshot.entities.find((entity) => entity.id === snapshot.selected?.entityId);
  handles.selectedActor.textContent =
    selectedActorId === undefined ? "none" : (selectedEntity?.label ?? selectedActorId);
  setActiveTabs(handles, state);

  if (state.activeInspectorTab === "runtime") {
    handles.inspectorBody.replaceChildren(renderRuntimeTab(snapshot));
    return;
  }
  if (state.activeInspectorTab === "content") {
    handles.inspectorBody.replaceChildren(renderContentTab(snapshot, handles.latestDataRegistry));
    return;
  }
  if (state.activeInspectorTab === "rules") {
    handles.inspectorBody.replaceChildren(renderRulesTab(snapshot));
    return;
  }
  if (state.activeInspectorTab === "host") {
    handles.inspectorBody.replaceChildren(renderHostTab(handles.latestHost, state));
    return;
  }

  handles.inspectorBody.replaceChildren(renderActorTab(snapshot, state, selectedActorId));
}

function renderActorTab(
  snapshot: SandboxSnapshot,
  state: SandboxWorkbenchState,
  selectedActorId: string | undefined
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const selectedActor = snapshot.gasActors.find((actor) => actor.actor.actorId === selectedActorId);
  const selectedEntity = state.selectionCleared
    ? undefined
    : (snapshot.entities.find((entity) => entity.id === snapshot.selected?.entityId) ??
      snapshot.entities.find((entity) => entity.actorId === selectedActorId));
  const sceneObjects = snapshot.entities.filter((entity) => entity.role && entity.role !== "road");

  fragment.append(
    createSection(
      "Camp Objects",
      createSummaryList(
        sceneObjects.map((entity) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "entity-row";
          button.classList.toggle("is-selected", entity.id === selectedEntity?.id);
          button.dataset.selectEntity = String(entity.id);
          if (entity.actorId) {
            button.dataset.selectActor = entity.actorId;
          }

          button.append(
            createTextElement("code", entity.label ?? entity.objectId ?? String(entity.id)),
            createTextElement("strong", entity.role ?? "object"),
            createTextElement(
              "span",
              `${renderEntityStorage(entity)}${entity.building ? ` · p${entity.building.priority} · ${entity.building.zone}` : ""}`
            )
          );
          return createListItem(button);
        })
      )
    ),
    createSection(
      "GAS Actors",
      createActorButtons(
        snapshot.gasActors.map((actor) => {
          const button = document.createElement("button");
          button.type = "button";
          button.classList.toggle("is-selected", actor.actor.actorId === selectedActorId);
          button.dataset.selectActor = actor.actor.actorId;
          if (actor.actor.entityId !== undefined) {
            button.dataset.selectEntity = String(actor.actor.entityId);
          }
          button.append(
            createTextElement("span", formatActorName(actor.actor.actorId)),
            createTextElement("strong", `${formatNumber(actor.attributes.current.health ?? 0)} hp`)
          );
          return button;
        })
      )
    ),
    createSection(
      "Entity Link",
      createKvList([
        ["Object", selectedEntity?.label ?? selectedEntity?.objectId ?? "unbound"],
        ["Role", selectedEntity?.role ?? "unknown"],
        ["Entity", String(selectedEntity?.id ?? "unbound")],
        ["Render", selectedEntity?.renderObjectId ?? "pending"],
        [
          "Position",
          `${formatNumber(selectedEntity?.x ?? 0)}, ${formatNumber(selectedEntity?.y ?? 0)}`
        ],
        [
          "Velocity",
          `${formatNumber(selectedEntity?.vx ?? 0)}, ${formatNumber(selectedEntity?.vy ?? 0)}`
        ],
        ["Storage", renderEntityStorage(selectedEntity)],
        ["Building", renderBuildingState(selectedEntity)],
        ["Task", renderWorkState(selectedEntity)]
      ]),
      createInspectorActions(selectedEntity, state)
    ),
    createSection(
      "GAS State",
      createKvList([
        ...Object.entries(selectedActor?.attributes.current ?? {}).map(
          ([key, value]) => [key, formatNumber(value)] as const
        ),
        ["Tags", selectedActor?.tags.values.join(", ") || "none"],
        [
          "Effects",
          selectedActor?.effects.active.map((effect) => effect.effectId).join(", ") || "none"
        ]
      ])
    )
  );

  return fragment;
}

function renderRuntimeTab(snapshot: SandboxSnapshot): HTMLElement {
  return createSection(
    "Module Flow",
    createSummaryList(
      snapshot.moduleSummary.map((module) =>
        createListItem(
          createTextElement("code", module.id),
          createTextElement("strong", module.status),
          createTextElement("span", module.detail)
        )
      )
    )
  );
}

function renderContentTab(
  snapshot: SandboxSnapshot,
  registry: DataRegistry | undefined
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const documents = registry?.snapshot().documents.slice(0, 10) ?? [];
  fragment.append(
    createSection(
      "Content Graph",
      createKvList([
        ["Packs", snapshot.contentSummary.packs],
        ["Types", snapshot.contentSummary.types],
        ["Documents", snapshot.contentSummary.documents],
        ["References", snapshot.contentSummary.references],
        ["Assets loaded", snapshot.contentSummary.assetsLoaded],
        ["Assets failed", snapshot.contentSummary.assetsFailed]
      ])
    ),
    createSection(
      "Recent Data",
      createSummaryList(
        documents.map((document) =>
          createListItem(
            createTextElement("code", `${document.type}:${document.id}`),
            createTextElement("span", document.tags.join(" · ") || "untagged")
          )
        )
      )
    )
  );
  return fragment;
}

function renderRulesTab(snapshot: SandboxSnapshot): HTMLElement {
  return createSection(
    "TCA Rules",
    createKvList([
      ["Rules", snapshot.tcaRuleCount],
      ["TCA traces", snapshot.tcaTraces.length],
      ["GAS traces", snapshot.gasTraces.length]
    ]),
    createSummaryList(
      snapshot.tcaTraces
        .slice()
        .reverse()
        .slice(0, 8)
        .map((trace) =>
          createListItem(
            createTextElement("code", trace.ruleId),
            createTextElement("strong", upper(trace.status)),
            createTextElement("span", `${trace.eventType} · ${trace.actions.length} actions`)
          )
        )
    )
  );
}

function renderHostTab(host: AppHost | undefined, state: SandboxWorkbenchState): DocumentFragment {
  const snapshot = host?.snapshot();
  const devtools = host?.services.devtools?.snapshot();
  const fragment = document.createDocumentFragment();
  fragment.append(
    createSection(
      "App Host",
      createKvList([
        ["Phase", snapshot?.phase ?? "pending"],
        ["Services", snapshot?.services.length ?? 0],
        ["Diagnostics", snapshot?.diagnostics.length ?? 0]
      ]),
      createSummaryList(
        (snapshot?.services ?? []).map((service) =>
          createListItem(
            createTextElement("code", service.id),
            createTextElement("strong", service.phase),
            createTextElement("span", `deps ${service.dependencies.length}`)
          )
        )
      )
    ),
    createSection(
      "Local Save",
      createKvList([
        ["Slot", "tiny-camp.local"],
        ["Status", state.saveStatus ?? "ready"]
      ]),
      createSaveActions()
    ),
    createSection(
      "DevTools",
      createKvList([
        ["Sources", devtools?.dataSources.length ?? 0],
        ["Panels", devtools?.panels.length ?? 0],
        ["Traces", devtools?.traces.length ?? 0],
        ["Diagnostics", devtools?.diagnostics.length ?? 0],
        ["Profiler", devtools?.profiler.length ?? 0]
      ]),
      createSummaryList(
        (devtools?.dataSources ?? []).map((source) =>
          createListItem(
            createTextElement("code", source.id),
            createTextElement("strong", source.kind),
            createTextElement("span", source.label)
          )
        )
      )
    )
  );
  return fragment;
}

function createSection(title: string, ...children: Node[]): HTMLElement {
  const section = document.createElement("section");
  section.className = "inspector-section";
  const heading = document.createElement("h2");
  heading.textContent = title;
  section.append(heading, ...children);
  return section;
}

function createSummaryList(items: Node[]): HTMLOListElement {
  const list = document.createElement("ol");
  list.className = "summary-list";
  list.append(...items);
  return list;
}

function createActorButtons(buttons: HTMLButtonElement[]): HTMLElement {
  const container = document.createElement("div");
  container.className = "actor-buttons";
  container.append(...buttons);
  return container;
}

function createListItem(...children: Node[]): HTMLLIElement {
  const item = document.createElement("li");
  item.append(...children);
  return item;
}

function createKvList(rows: ReadonlyArray<readonly [string, string | number]>): HTMLElement {
  const list = document.createElement("dl");
  list.className = "kv";
  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.append(createTextElement("dt", label), createTextElement("dd", String(value)));
    list.append(row);
  }
  return list;
}

function createInspectorActions(
  selectedEntity: SandboxSnapshot["entities"][number] | undefined,
  state: SandboxWorkbenchState
): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "inspector-actions";
  if (selectedEntity) {
    const follow = document.createElement("button");
    follow.type = "button";
    follow.dataset.cameraFollow = String(selectedEntity.id);
    follow.classList.toggle("is-selected", state.followedEntityId === selectedEntity.id);
    follow.textContent = "Follow Camera";
    actions.append(follow);
  }

  const stopFollow = document.createElement("button");
  stopFollow.type = "button";
  stopFollow.dataset.cameraStopFollow = "";
  stopFollow.textContent = "Free Camera";
  actions.append(stopFollow);
  return actions;
}

function createSaveActions(): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "inspector-actions";

  const save = document.createElement("button");
  save.type = "button";
  save.dataset.saveAction = "save";
  save.textContent = "Save Local";

  const load = document.createElement("button");
  load.type = "button";
  load.dataset.saveAction = "load";
  load.textContent = "Load Local";

  actions.append(save, load);
  return actions;
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  text: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

function renderEntityStorage(entity: SandboxSnapshot["entities"][number] | undefined): string {
  if (!entity || entity.resource === undefined || entity.capacity === undefined) {
    return "no storage";
  }

  const materials =
    entity.materials && entity.materials > 0 ? ` · ${formatNumber(entity.materials)} mat` : "";
  return `${formatNumber(entity.resource)} / ${formatNumber(entity.capacity)} res${materials}`;
}

function renderBuildingState(entity: SandboxSnapshot["entities"][number] | undefined): string {
  if (!entity?.building) {
    return "none";
  }

  return `${entity.building.zone} · health ${formatNumber(entity.building.health)} · heat ${formatNumber(entity.building.heat)} · mode ${entity.building.mode}`;
}

function renderWorkState(entity: SandboxSnapshot["entities"][number] | undefined): string {
  if (!entity?.task) {
    return "none";
  }

  return `${entity.task}/${entity.taskStatus ?? "idle"} → ${entity.targetObjectId ?? "none"} · route ${formatNumber((entity.routeProgress ?? 0) * 100)}% · battery ${formatNumber(entity.battery ?? 0)} · fatigue ${formatNumber(entity.fatigue ?? 0)}`;
}

function formatActorName(actorId: string): string {
  return actorId.replace("gas.actor.sandbox.", "");
}

function setActiveTabs(handles: SandboxUiHandles, state: SandboxWorkbenchState): void {
  for (const tab of handles.inspectorTabs) {
    tab.classList.toggle("is-active", tab.dataset.inspectorTab === state.activeInspectorTab);
  }
}
