import type {
  Physics2dLab,
  Physics2dLabGroupPreset,
  Physics2dLabObject,
  Physics2dLabQueryMode,
  Physics2dLabShape,
  Physics2dLabSnapshot
} from "./physics-2d-lab";

export type Physics2dLabUi = {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  diagnostics: HTMLElement;
  snapshot: HTMLElement;
  shapeButtons: Record<Physics2dLabShape, HTMLButtonElement>;
  queryButtons: Record<Physics2dLabQueryMode, HTMLButtonElement>;
  groupButtons: Record<Physics2dLabGroupPreset, HTMLButtonElement>;
  pauseButton: HTMLButtonElement;
  stepButton: HTMLButtonElement;
  impulseButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  pushDiagnostic(message: string): void;
};

export function renderPhysics2dLabShell(root: HTMLElement): Physics2dLabUi {
  root.className = "physics-2d-lab";

  const shell = element("section", "physics-2d-lab__shell");
  const stage = element("section", "physics-2d-lab__stage");
  const canvas = document.createElement("canvas");
  canvas.className = "physics-2d-lab__canvas";
  canvas.width = 1280;
  canvas.height = 840;
  stage.append(canvas);

  const panel = element("aside", "physics-2d-lab__panel");
  const header = element("header", "physics-2d-lab__header");
  header.append(
    element("p", "physics-2d-lab__eyebrow", "GameKits Physics"),
    element("h1", "physics-2d-lab__title", "Physics 2D Lab")
  );

  const status = element("section", "physics-2d-lab__status");
  const diagnostics = element("ol", "physics-2d-lab__diagnostics");
  const snapshot = element("pre", "physics-2d-lab__snapshot", "{}");
  const shapeButtons: Record<Physics2dLabShape, HTMLButtonElement> = {
    circle: button("Circle"),
    box: button("Box"),
    capsule: button("Capsule")
  };
  const queryButtons: Record<Physics2dLabQueryMode, HTMLButtonElement> = {
    point: button("Point"),
    "overlap-circle": button("Circle"),
    "overlap-box": button("Box")
  };
  const groupButtons: Record<Physics2dLabGroupPreset, HTMLButtonElement> = {
    all: button("All"),
    "actor-only": button("Actor"),
    "sensor-only": button("Sensor")
  };
  const pauseButton = button("Pause");
  const stepButton = button("Step");
  const impulseButton = button("Impulse");
  const resetButton = button("Reset");
  shapeButtons.circle.classList.add("is-active");
  queryButtons["overlap-circle"].classList.add("is-active");
  groupButtons.all.classList.add("is-active");

  const transport = element("div", "physics-2d-lab__transport");
  transport.append(pauseButton, stepButton, impulseButton, resetButton);

  panel.append(
    header,
    status,
    controlGroup("Mover shape", segmented(shapeButtons)),
    controlGroup("Query mode", segmented(queryButtons)),
    controlGroup("Query filter", segmented(groupButtons)),
    transport,
    panelSection("Diagnostics", diagnostics),
    panelSection("Snapshot", snapshot)
  );
  shell.append(stage, panel);
  root.replaceChildren(shell);

  return {
    root,
    canvas,
    status,
    diagnostics,
    snapshot,
    shapeButtons,
    queryButtons,
    groupButtons,
    pauseButton,
    stepButton,
    impulseButton,
    resetButton,
    pushDiagnostic(message) {
      const item = element("li", undefined, message);
      diagnostics.prepend(item);
      while (diagnostics.childElementCount > 9) {
        diagnostics.lastElementChild?.remove();
      }
    }
  };
}

export function bindPhysics2dLabUi(ui: Physics2dLabUi, lab: Physics2dLab): void {
  bindButtons(ui.shapeButtons, (shape) => {
    updatePhysics2dLabUi(ui, lab.setShape(shape));
  });
  bindButtons(ui.queryButtons, (mode) => {
    updatePhysics2dLabUi(ui, lab.setQueryMode(mode));
  });
  bindButtons(ui.groupButtons, (preset) => {
    updatePhysics2dLabUi(ui, lab.setGroupPreset(preset));
  });
  ui.pauseButton.addEventListener("click", () => {
    const paused = ui.pauseButton.dataset.paused !== "true";
    ui.pauseButton.dataset.paused = String(paused);
    ui.pauseButton.textContent = paused ? "Resume" : "Pause";
    updatePhysics2dLabUi(ui, lab.setPaused(paused));
  });
  ui.stepButton.addEventListener("click", () => {
    updatePhysics2dLabUi(ui, lab.singleStep());
  });
  ui.impulseButton.addEventListener("click", () => {
    updatePhysics2dLabUi(ui, lab.applyImpulse());
  });
  ui.resetButton.addEventListener("click", () => {
    ui.pauseButton.dataset.paused = "false";
    ui.pauseButton.textContent = "Pause";
    updatePhysics2dLabUi(ui, lab.reset());
  });
  ui.canvas.addEventListener("pointermove", (event) => {
    const point = screenToWorld(ui.canvas, event.offsetX, event.offsetY);
    updatePhysics2dLabUi(ui, lab.setQueryPoint(point));
  });
}

export function updatePhysics2dLabUi(ui: Physics2dLabUi, snapshot: Physics2dLabSnapshot): void {
  activateButton(ui.shapeButtons, snapshot.shape);
  activateButton(ui.queryButtons, snapshot.queryMode);
  activateButton(ui.groupButtons, snapshot.groupPreset);
  ui.status.replaceChildren(
    statusTile("Backend", snapshot.scene.backend),
    statusTile("Bodies", String(snapshot.scene.bodyCount)),
    statusTile("Colliders", String(snapshot.scene.colliderCount)),
    statusTile("Contacts", String(snapshot.scene.activeContactCount)),
    statusTile("Query", String(snapshot.queryHits.length)),
    statusTile("Step", String(snapshot.stepCount))
  );
  ui.snapshot.textContent = JSON.stringify(
    {
      paused: snapshot.paused,
      shape: snapshot.shape,
      queryMode: snapshot.queryMode,
      groupPreset: snapshot.groupPreset,
      queryPoint: snapshot.queryPoint,
      contacts: snapshot.contacts.map((contact) => ({
        type: `${contact.kind}.${contact.phase}`,
        colliderA: contact.colliderA,
        colliderB: contact.colliderB
      })),
      queryHits: snapshot.queryHits.map((hit) => hit.colliderId),
      native: snapshot.nativeSummary
    },
    null,
    2
  );
}

export function drawPhysics2dLab(canvas: HTMLCanvasElement, snapshot: Physics2dLabSnapshot): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(640, Math.round(rect.width || canvas.width));
  const height = Math.max(420, Math.round(rect.height || canvas.height));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height);
  for (const object of snapshot.objects) {
    drawObject(
      ctx,
      width,
      height,
      object,
      snapshot.queryHits.some((hit) => hit.colliderId === object.colliderId)
    );
  }
  drawQuery(ctx, width, height, snapshot);
  drawContactLabels(ctx, width, height, snapshot);
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  ctx.fillStyle = "#101411";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(217, 234, 214, 0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  object: Physics2dLabObject,
  highlighted: boolean
): void {
  const position = worldToScreen(width, height, object.position.x, object.position.y);
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.rotate(-(object.rotation ?? 0));
  ctx.lineWidth = highlighted ? 4 : 2;
  ctx.strokeStyle = highlighted ? "#ffe06d" : colorForRole(object.role);
  ctx.fillStyle = fillForRole(object.role, object.sensor, highlighted);

  if (object.shape.type === "circle") {
    ctx.beginPath();
    ctx.arc(0, 0, object.shape.radius * scale(width), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (object.shape.type === "capsule") {
    drawCapsule(ctx, object.shape.radius * scale(width), object.shape.height * scale(width));
  } else if (object.shape.type === "box") {
    const w = object.shape.width * scale(width);
    const h = object.shape.height * scale(width);
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function drawCapsule(ctx: CanvasRenderingContext2D, radius: number, height: number): void {
  const half = Math.max(0, height / 2);
  ctx.beginPath();
  ctx.moveTo(-radius, -half);
  ctx.lineTo(-radius, half);
  ctx.arc(0, half, radius, Math.PI, 0, true);
  ctx.lineTo(radius, -half);
  ctx.arc(0, -half, radius, 0, Math.PI, true);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawQuery(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: Physics2dLabSnapshot
): void {
  const position = worldToScreen(width, height, snapshot.queryPoint.x, snapshot.queryPoint.y);
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.strokeStyle = "#f6d05f";
  ctx.fillStyle = "rgba(246, 208, 95, 0.12)";
  ctx.lineWidth = 2;
  if (snapshot.queryMode === "point") {
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.stroke();
  } else if (snapshot.queryMode === "overlap-box") {
    const w = 1.3 * scale(width);
    const h = 0.9 * scale(width);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, 0.72 * scale(width), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawContactLabels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  snapshot: Physics2dLabSnapshot
): void {
  ctx.save();
  ctx.fillStyle = "#f2f5ea";
  ctx.font = "700 14px Avenir Next Condensed, Arial Narrow, sans-serif";
  snapshot.recentContacts.slice(0, 4).forEach((contact, index) => {
    ctx.fillText(
      `${contact.kind}.${contact.phase} ${contact.colliderA} / ${contact.colliderB}`,
      18,
      height - 20 - index * 22
    );
  });
  ctx.restore();
}

function screenToWorld(canvas: HTMLCanvasElement, x: number, y: number) {
  const width = canvas.width;
  const height = canvas.height;
  return {
    x: (x - width / 2) / scale(width),
    y: (height * 0.54 - y) / scale(width)
  };
}

function worldToScreen(width: number, height: number, x: number, y: number) {
  const s = scale(width);
  return {
    x: width / 2 + x * s,
    y: height * 0.54 - y * s
  };
}

function scale(width: number): number {
  return Math.max(46, Math.min(84, width / 15));
}

function colorForRole(role: Physics2dLabObject["role"]): string {
  if (role === "mover") {
    return "#89d685";
  }
  if (role === "trigger") {
    return "#e1bc58";
  }
  if (role === "paddle") {
    return "#79b8ff";
  }
  if (role === "obstacle") {
    return "#ec8f70";
  }
  return "#aab7ad";
}

function fillForRole(
  role: Physics2dLabObject["role"],
  sensor: boolean,
  highlighted: boolean
): string {
  if (highlighted) {
    return "rgba(255, 224, 109, 0.34)";
  }
  if (sensor) {
    return "rgba(225, 188, 88, 0.18)";
  }
  if (role === "mover") {
    return "rgba(137, 214, 133, 0.32)";
  }
  if (role === "paddle") {
    return "rgba(121, 184, 255, 0.28)";
  }
  if (role === "obstacle") {
    return "rgba(236, 143, 112, 0.26)";
  }
  return "rgba(170, 183, 173, 0.22)";
}

function bindButtons<T extends string>(
  buttons: Record<T, HTMLButtonElement>,
  handler: (value: T) => void
): void {
  for (const [value, target] of Object.entries(buttons) as Array<[T, HTMLButtonElement]>) {
    target.addEventListener("click", () => handler(value));
  }
}

function activateButton<T extends string>(buttons: Record<T, HTMLButtonElement>, active: T): void {
  for (const [value, target] of Object.entries(buttons) as Array<[T, HTMLButtonElement]>) {
    target.classList.toggle("is-active", value === active);
  }
}

function panelSection(title: string, content: HTMLElement): HTMLElement {
  const section = element("section", "physics-2d-lab__section");
  section.append(element("h2", undefined, title), content);
  return section;
}

function controlGroup(title: string, content: HTMLElement): HTMLElement {
  const group = element("section", "physics-2d-lab__control-group");
  group.append(element("h2", undefined, title), content);
  return group;
}

function segmented<T extends string>(buttons: Record<T, HTMLButtonElement>): HTMLElement {
  const row = element("div", "physics-2d-lab__segmented");
  row.append(...(Object.values(buttons) as HTMLButtonElement[]));
  return row;
}

function statusTile(label: string, value: string): HTMLElement {
  const tile = element("div", "physics-2d-lab__status-tile");
  tile.append(element("span", undefined, label), element("strong", undefined, value));
  return tile;
}

function button(label: string): HTMLButtonElement {
  const target = document.createElement("button");
  target.type = "button";
  target.textContent = label;
  return target;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string | undefined,
  text?: string | undefined
): HTMLElementTagNameMap[K] {
  const target = document.createElement(tag);
  if (className) {
    target.className = className;
  }
  if (text !== undefined) {
    target.textContent = text;
  }
  return target;
}
