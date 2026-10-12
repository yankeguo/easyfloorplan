import {
  DOOR_WIDTH,
  MAX_INTERVAL,
  MAX_INTERVALS,
  MAX_SEQUENCES,
  MIN_INTERVAL,
  formatMm,
  gridSpan,
  roundMm,
  labelAnchor,
  mergeSequences,
  runKey,
  spaceNetArea,
  xAxisName,
  yAxisName,
} from "./geometry.ts";
import {
  addInterval,
  applyGridSpan,
  centerDoor,
  clearDrawing,
  createSample,
  deleteDoor,
  deleteRun,
  deserialize,
  labelForSpace,
  moveDoor,
  normalize,
  placeDoor,
  positionsOf,
  removeIntervalAt,
  reorderInterval,
  runByKey,
  runContaining,
  serialize,
  setIntervalValue,
  splitInterval,
  setSpaceLabel,
  settleSequences,
  spacesOf,
  toggleBay,
  toggleSlide,
  toggleWindow,
} from "./model.ts";
import { exportLayout } from "./export-layout.ts";
import { drawScene, hitTest } from "./render.ts";
import { exportPlanSvg } from "./svg.ts";
import type {
  ActionResult,
  Axis,
  Door,
  GridPoint,
  Hit,
  PlanState,
  Point,
  Preview,
  Run,
  Scene,
  Selection,
  Space,
  Tool,
  View,
} from "./types.ts";
import { fitView, worldToScreen, zoomAt } from "./view.ts";

function required<T extends Element>(id: string, kind: abstract new (...args: never[]) => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof kind)) throw new Error(`缺少 #${id}`);
  return node;
}

function isTool(value: string | undefined): value is Tool {
  return (
    value === "select" ||
    value === "wall" ||
    value === "erase" ||
    value === "door" ||
    value === "window" ||
    value === "slide" ||
    value === "bay" ||
    value === "label"
  );
}

function isAxis(value: string | undefined): value is Axis {
  return value === "x" || value === "y";
}

function closestButton(target: EventTarget | null, selector: string): HTMLButtonElement | null {
  if (!(target instanceof Element)) return null;
  const node = target.closest(selector);
  return node instanceof HTMLButtonElement ? node : null;
}

function closestAction(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const node = target.closest("[data-action]");
  return node instanceof HTMLElement ? node : null;
}

const HINTS = {
  select: "点选墙、门或空间。拖动空白处平移，滚轮缩放，双击空间可改标签。",
  wall: "依次点击同一条参考线上的两个交叉点。按住空格可平移。",
  erase: "依次点击两个交叉点，去掉它们之间的墙。",
  door: "在墙面上点击，留出 800 mm 宽的门洞。拖动可改位置，双击可在当前这段墙上居中。",
  window: "点击相邻两条参考线之间的一段墙，只把这一段标成窗。再点一次取消。",
  slide: "点击相邻两条参考线之间的一段墙，只把这一段标成推拉门。再点一次取消。",
  bay: "点击一块地板，把它标成飘窗。可以标多块，再点一次取消。",
  label: "点击一个空间，为它填写名称。",
};

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  w: "wall",
  e: "erase",
  d: "door",
  n: "window",
  s: "slide",
  b: "bay",
  l: "label",
};
const STORAGE_KEY = "easyfloorplan.v1";

const canvas = required("plan", HTMLCanvasElement);
const sidebar = required("sidebar", HTMLElement);
const editor = required("label-editor", HTMLInputElement);
const hint = required("hint", HTMLElement);
const status = required("status", HTMLElement);
const sequenceDialog = required("sequence-dialog", HTMLDialogElement);
const splitDialog = required("split-dialog", HTMLDialogElement);
const splitForm = required("split-form", HTMLFormElement);
const splitHelp = required("split-help", HTMLElement);
const splitValue = required("split-value", HTMLInputElement);
const splitPreview = required("split-preview", HTMLElement);
let splitTarget: { axis: Axis; index: number } | null = null;
const sequenceForm = required("sequence-form", HTMLFormElement);
const sequenceEditor = required("sequence-editor", HTMLElement);
const sequencePreview = required("sequence-preview", HTMLElement);
const toastNode = required("toast", HTMLElement);
const undoButton = required("undo", HTMLButtonElement);
const redoButton = required("redo", HTMLButtonElement);

interface SequenceDraft {
  axis: Axis;
  sequences: string[][];
}

interface IntervalDrag {
  pointerId: number;
  from: number;
  axis: string;
  seq: string;
  row: HTMLElement;
}

type PointerDrag = {
  type: "maybe-pan" | "pan";
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
  clear?: boolean;
};

type DoorDrag = {
  type: "door";
  pointerId: number;
  id: string;
  grab: number;
  snapshot: string;
};

interface App {
  state: PlanState;
  view: View;
  viewCustom: boolean;
  tool: Tool;
  selection: Selection | null;
  anchor: GridPoint | null;
  anchorGesture: number | null;
  hoverPoint: GridPoint | null;
  hoverRun: Run | null;
  preview: Preview | null;
  drag: PointerDrag | DoorDrag | null;
  editor: { space: Space; snapshot: string } | null;
  editorFocusToken: object | null;
  pendingLabel: Space | null;
  undo: string[];
  redo: string[];
  intervalSnapshot: string | null;
  sequenceDraft: SequenceDraft | null;
  lastHit: Hit | null;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  spaceDown: boolean;
}

const app: App = {
  state: loadState(),
  view: { ox: 0, oy: 0, ppm: 0.04 },
  viewCustom: false,
  tool: "select",
  selection: null,
  anchor: null,
  anchorGesture: null,
  hoverPoint: null,
  hoverRun: null,
  preview: null,
  drag: null,
  editor: null,
  editorFocusToken: null,
  pendingLabel: null,
  undo: [],
  redo: [],
  intervalSnapshot: null,
  sequenceDraft: null,
  lastHit: null,
  cssWidth: 1,
  cssHeight: 1,
  dpr: 1,
  spaceDown: false,
};

document.getElementById("boot")?.remove();

const resizeObserver = new ResizeObserver(() => {
  measure();
  if (!app.viewCustom) fit();
  draw();
  if (app.editor) positionEditor(app.editor.space);
});
resizeObserver.observe(canvas);

measure();
fit();
renderIntervals();
refresh();

required("toolbar", HTMLElement).addEventListener("click", (event) => {
  const button = closestButton(event.target, "[data-tool]");
  if (!button || !isTool(button.dataset.tool)) return;
  setTool(button.dataset.tool);
});

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
required("fit", HTMLButtonElement).addEventListener("click", () => {
  app.viewCustom = false;
  fit();
  draw();
  renderStatus(app.lastHit);
});
required("save-json", HTMLButtonElement).addEventListener("click", saveJson);
required("load-json-button", HTMLButtonElement).addEventListener("click", () => {
  required("load-json", HTMLInputElement).click();
});
required("load-json", HTMLInputElement).addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  input.value = "";
  if (file) void loadJson(file);
});
required("export-png", HTMLButtonElement).addEventListener("click", exportPng);
required("export-svg", HTMLButtonElement).addEventListener("click", exportSvg);
required("clear", HTMLButtonElement).addEventListener("click", clearPlan);

sidebar.addEventListener("click", onSidebarClick);
required("selection", HTMLElement).addEventListener("click", onSidebarClick);
required("selection", HTMLElement).addEventListener("change", onSidebarChange);
sidebar.addEventListener("focusin", (event) => {
  const input = event.target;
  if (input instanceof HTMLInputElement && input.matches("[data-axis]")) {
    app.intervalSnapshot = serialize(app.state);
  }
});
sidebar.addEventListener("focusout", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches("[data-axis]")) return;
  app.intervalSnapshot = null;
  const axis = input.dataset.axis;
  if (!isAxis(axis)) return;
  const index = Number(input.dataset.index);
  const list = axis === "x" ? app.state.xIntervals : app.state.yIntervals;
  input.classList.remove("invalid");
  const current = list[index];
  if (current != null) input.value = formatMm(current);
});
sidebar.addEventListener("input", onIntervalInput);
document.addEventListener("pointerdown", onIntervalDragStart);
document.addEventListener("pointermove", onIntervalDragMove);
document.addEventListener("pointerup", onIntervalDragEnd);
document.addEventListener("pointercancel", onIntervalDragEnd);
sequenceForm.addEventListener("submit", onSequenceSubmit);
sequenceForm.addEventListener("click", onSequenceClick);
sequenceForm.addEventListener("input", onSequenceInput);
required("sequence-cancel", HTMLButtonElement).addEventListener("click", () => {
  app.sequenceDraft = null;
  sequenceDialog.close();
});
splitForm.addEventListener("submit", onSplitSubmit);
splitForm.addEventListener("input", updateSplitPreview);
required("split-cancel", HTMLButtonElement).addEventListener("click", () => {
  splitTarget = null;
  splitDialog.close();
});
sidebar.addEventListener(
  "wheel",
  (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.matches('input[type="number"]')) input.blur();
  },
  { passive: true },
);

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);
canvas.addEventListener("dblclick", onDoubleClick);
canvas.addEventListener("wheel", onWheel, { passive: false });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

editor.addEventListener("input", () => {
  if (!app.editor) return;
  setSpaceLabel(app.state, app.editor.space, editor.value);
  draw();
  const node = document.querySelector("[data-label-text]");
  if (node) node.textContent = editor.value.trim() || "未命名";
});
editor.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    commitEditor();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelEditor();
  }
});
editor.addEventListener("blur", () => {
  if (!app.editor) return;
  if (app.editorFocusToken) {
    const token = app.editorFocusToken;
    setTimeout(() => {
      if (app.editor && app.editorFocusToken === token) editor.focus();
    }, 0);
    return;
  }
  commitEditor();
});

window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", (event) => {
  if (event.code === "Space") app.spaceDown = false;
});
window.addEventListener("blur", () => {
  app.spaceDown = false;
});

function loadState(): PlanState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSample();
    return deserialize(raw);
  } catch {
    return createSample();
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(app.state));
  } catch {
    // The drawing still works for this session when storage is blocked.
  }
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function measure(): void {
  const rect = canvas.getBoundingClientRect();
  app.cssWidth = Math.max(1, rect.width);
  app.cssHeight = Math.max(1, rect.height);
  app.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(app.cssWidth * app.dpr));
  canvas.height = Math.max(1, Math.round(app.cssHeight * app.dpr));
}

function fit(): void {
  if (app.cssWidth < 40 || app.cssHeight < 40) return;
  const { x, y } = positionsOf(app.state);
  app.view = fitView(app.cssWidth, app.cssHeight, x[x.length - 1], y[y.length - 1]);
}

function scene(): Scene {
  return {
    state: app.state,
    view: app.view,
    tool: app.tool,
    anchor: app.anchor,
    hoverPoint: app.hoverPoint,
    hoverRun: app.hoverRun,
    preview: app.preview,
    selection: app.selection,
    exporting: false,
  };
}

function draw(): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
  drawScene(context, app.cssWidth, app.cssHeight, scene());
}

function localPoint(event: PointerEvent | MouseEvent | WheelEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function mutate(mutator: (state: PlanState) => ActionResult | void): ActionResult {
  const previous = serialize(app.state);
  const result = mutator(app.state) ?? { ok: true };
  if (result.ok !== false) normalize(app.state);
  const next = serialize(app.state);
  if (next !== previous) {
    app.undo.push(previous);
    app.redo = [];
    if (app.undo.length > 100) app.undo.shift();
    persist();
  }
  if (result.ok === false && result.message) toast(result.message);
  return result;
}

function reconcile(selection: Selection | null): Selection | null {
  if (!selection) return null;
  if (selection.type === "wall") return runByKey(app.state, selection.key) ? selection : null;
  if (selection.type === "door") {
    return app.state.doors.some((door) => door.id === selection.id) ? selection : null;
  }
  if (selection.type === "space") {
    return spacesOf(app.state).some((space) => space.key === selection.key) ? selection : null;
  }
  return null;
}

function refresh({ intervals = false, refit = false }: { intervals?: boolean; refit?: boolean } = {}): void {
  app.selection = reconcile(app.selection);
  if (refit) app.viewCustom = false;
  if (!app.viewCustom) fit();
  if (intervals) renderIntervals();
  renderReadout();
  renderSelection();
  updateChrome();
  draw();
  renderStatus(app.lastHit);
}

function updateChrome(): void {
  document.querySelectorAll("[data-tool]").forEach((button) => {
    if (!(button instanceof HTMLElement)) return;
    button.setAttribute("aria-pressed", String(button.dataset.tool === app.tool));
  });
  undoButton.disabled = app.undo.length === 0;
  redoButton.disabled = app.redo.length === 0;
  hint.textContent = HINTS[app.tool];
}

function setTool(tool: Tool): void {
  if (app.editor) commitEditor();
  app.tool = tool;
  app.pendingLabel = null;
  app.anchor = null;
  app.anchorGesture = null;
  app.preview = null;
  updateChrome();
  draw();
}

function undo(): void {
  if (app.editor) cancelEditor();
  const previous = app.undo.pop();
  if (previous === undefined) return;
  app.redo.push(serialize(app.state));
  app.state = deserialize(previous);
  app.selection = null;
  app.pendingLabel = null;
  app.anchor = null;
  app.preview = null;
  persist();
  refresh({ intervals: true });
}

function redo(): void {
  if (app.editor) commitEditor();
  const next = app.redo.pop();
  if (next === undefined) return;
  app.undo.push(serialize(app.state));
  app.state = deserialize(next);
  app.selection = null;
  app.pendingLabel = null;
  app.anchor = null;
  app.preview = null;
  persist();
  refresh({ intervals: true });
}

let toastTimer = 0;

function toast(message: string): void {
  toastNode.textContent = message;
  toastNode.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastNode.classList.remove("show"), 2600);
}

function renderIntervals(): void {
  required("panel-x", HTMLElement).innerHTML = intervalMarkup("x");
  required("panel-y", HTMLElement).innerHTML = intervalMarkup("y");
}

function openSplitDialog(axis: Axis, index: number): void {
  const list = axis === "x" ? app.state.xIntervals : app.state.yIntervals;
  const total = list[index];
  if (total == null) return;
  if (list.length >= MAX_INTERVALS) {
    toast(`最多 ${MAX_INTERVALS} 段间隔`);
    return;
  }
  if (total < MIN_INTERVAL * 2) {
    toast(`这段不到 ${MIN_INTERVAL * 2} mm，拆不开`);
    return;
  }
  splitTarget = { axis, index };
  const direction = axis === "x" ? "从左端" : "从下端";
  splitHelp.textContent = `这段共 ${formatMm(total)} mm。第一段${direction}量起，剩下的作为第二段。墙上的门、窗和飘窗会跟着分到两段里。`;
  const half = Math.min(total - MIN_INTERVAL, Math.max(MIN_INTERVAL, Math.round(total / 2)));
  splitValue.value = String(half);
  splitValue.max = String(total - MIN_INTERVAL);
  updateSplitPreview();
  splitDialog.showModal();
  splitValue.focus();
  splitValue.select();
}

function updateSplitPreview(): void {
  if (!splitTarget) return;
  const list = splitTarget.axis === "x" ? app.state.xIntervals : app.state.yIntervals;
  const total = list[splitTarget.index] ?? 0;
  const first = roundMm(Number(splitValue.value));
  const second = total - first;
  const valid =
    Number.isFinite(first) &&
    first >= MIN_INTERVAL &&
    second >= MIN_INTERVAL &&
    first <= MAX_INTERVAL &&
    second <= MAX_INTERVAL;
  splitValue.classList.toggle("invalid", !valid);
  splitPreview.textContent = valid
    ? `拆成 ${formatMm(first)} mm 和 ${formatMm(second)} mm。`
    : `两段都需要在 ${MIN_INTERVAL} mm 到 ${MAX_INTERVAL} mm 之间。`;
}

function onSplitSubmit(event: SubmitEvent): void {
  event.preventDefault();
  if (!splitTarget) return;
  const target = splitTarget;
  const result = mutate(() => splitInterval(app.state, target.axis, target.index, splitValue.value));
  if (!result.ok) return;
  splitTarget = null;
  splitDialog.close();
  app.selection = null;
  app.anchor = null;
  refresh({ intervals: true, refit: true });
}

function intervalMarkup(axis: Axis): string {
  const list = axis === "x" ? app.state.xIntervals : app.state.yIntervals;
  const title = axis === "x" ? "横向间隔" : "纵向间隔";
  const help =
    axis === "x"
      ? "从左到右每一段的宽度，生成竖向参考线。拖动把手只调换长度。"
      : "从下到上每一段的进深，生成横向参考线。拖动把手只调换长度。";
  const rows = list
    .map(
      (value, index) => `
        <div class="interval-row" data-axis="${axis}" data-index="${index}">
          <button type="button" class="drag" data-action="drag-interval" aria-label="拖动重排第 ${index + 1} 段" ${list.length <= 1 ? "disabled" : ""}>⋮⋮</button>
          <label>
            <span>${index + 1}</span>
            <input data-axis="${axis}" data-index="${index}" type="number" min="${MIN_INTERVAL}" max="${MAX_INTERVAL}" step="1" value="${formatMm(value)}" inputmode="numeric" aria-label="${title} ${index + 1}" />
          </label>
          <em>mm</em>
          <button type="button" class="split" data-action="split-interval" data-axis="${axis}" data-index="${index}" ${list.length >= MAX_INTERVALS || value < MIN_INTERVAL * 2 ? "disabled" : ""} aria-label="拆分第 ${index + 1} 段">拆分</button>
          <button type="button" class="remove" data-action="remove-interval" data-axis="${axis}" data-index="${index}" ${list.length <= 1 ? "disabled" : ""} aria-label="删除第 ${index + 1} 段">×</button>
        </div>`,
    )
    .join("");
  return `<h2>${title}</h2><p>${help}</p>${rows}<div class="interval-actions"><button type="button" class="add" data-action="add-interval" data-axis="${axis}">添加一段</button><button type="button" class="add" data-action="open-sequences" data-axis="${axis}">多序列切分</button></div>`;
}

function renderReadout(): void {
  const { x, y } = positionsOf(app.state);
  const items = (positions: number[], name: (index: number) => string) =>
    positions
      .map(
        (meter, index) =>
          `<li><b>${name(index)}</b><span>${formatMm(meter)} mm</span></li>`,
      )
      .join("");
  required("readout", HTMLElement).innerHTML = `
    <div>
      <h2>竖向参考线</h2>
      <ol>${items(x, xAxisName)}</ol>
      <p class="total">总宽 ${formatMm(x[x.length - 1])} mm</p>
    </div>
    <div>
      <h2>横向参考线</h2>
      <ol>${items(y, yAxisName)}</ol>
      <p class="total">总深 ${formatMm(y[y.length - 1])} mm</p>
    </div>`;
}

function renderSelection(): void {
  const mount = required("selection", HTMLElement);
  const selection = app.selection;
  if (!selection) {
    mount.innerHTML =
      '<div class="selection-empty"><h3>选中</h3><p>点选墙、门或空间后，在这里编辑。</p></div>';
    return;
  }
  if (selection.type === "wall") {
    const run = runByKey(app.state, selection.key);
    if (!run) {
      mount.innerHTML = "";
      return;
    }
    const { x, y } = positionsOf(app.state);
    const positions = run.dir === "h" ? x : y;
    const length = positions[run.end] - positions[run.start];
    const doorCount = app.state.doors.filter(
      (door) => door.dir === run.dir && door.line === run.line && door.anchor >= run.start && door.anchor < run.end,
    ).length;
    const title = run.dir === "h" ? `横向参考线 ${yAxisName(run.line)}` : `竖向参考线 ${xAxisName(run.line)}`;
    const segmentChecks: string[] = [];
    for (let index = run.start; index < run.end; index += 1) {
      const key = `${run.dir}:${run.line}:${index}`;
      const windowOn = app.state.windowEdges.has(key);
      const slideOn = app.state.slidingEdges.has(key);
      const prefix = run.end - run.start === 1 ? "这面墙" : `第 ${index - run.start + 1} 段`;
      segmentChecks.push(
        `<label class="check"><input type="checkbox" data-action="toggle-window" data-index="${index}" ${windowOn ? "checked" : ""} />${prefix}有窗</label>`,
        `<label class="check"><input type="checkbox" data-action="toggle-slide" data-index="${index}" ${slideOn ? "checked" : ""} />${prefix}是推拉门</label>`,
      );
    }
    mount.innerHTML = `
      <div class="selection">
        <h3>${title} 上的墙</h3>
        <p>长度 ${formatMm(length)} mm · 门 ${doorCount} 扇</p>
        ${length < DOOR_WIDTH ? `<p>这面墙不到 ${DOOR_WIDTH} mm，不能开门。</p>` : ""}
        ${segmentChecks.join("")}
        <div class="row"><button type="button" data-action="delete-wall">删除这面墙</button></div>
      </div>`;
    return;
  }
  if (selection.type === "door") {
    const door = app.state.doors.find((item) => item.id === selection.id);
    if (!door) {
      mount.innerHTML = "";
      return;
    }
    mount.innerHTML = `
      <div class="selection">
        <h3>门洞</h3>
        <p>宽度 ${DOOR_WIDTH} mm，距墙起点 <span data-door-pos>${doorOffsetText(door)}</span></p>
        <div class="row">
          <button type="button" data-action="delete-door">删除门</button>
        </div>
      </div>`;
    return;
  }
  const space = spacesOf(app.state).find((item) => item.key === selection.key);
  if (!space) {
    mount.innerHTML = "";
    return;
  }
  const { x, y } = positionsOf(app.state);
  const area = spaceNetArea(space, x, y, app.state.hEdges, app.state.vEdges) / 1_000_000;
  const label = labelForSpace(app.state, space);
  const bayChecks = space.cells.map((cell, index) => {
    const on = app.state.bayCells.has(`${cell.c},${cell.r}`);
    const name = space.cells.length === 1 ? "这块地板是飘窗" : `第 ${index + 1} 块地板是飘窗`;
    return `<label class="check"><input type="checkbox" data-action="toggle-bay" data-column="${cell.c}" data-row="${cell.r}" ${on ? "checked" : ""} />${name}</label>`;
  });
  mount.innerHTML = `
    <div class="selection">
      <h3 data-label-text>${label ? escapeHtml(label.text) : "未命名"}</h3>
      <p>净面积 ${area.toFixed(2)} ㎡，按墙内皮计算。</p>
      ${bayChecks.join("")}
      <div class="row">
        <button type="button" data-action="edit-label">编辑标签</button>
        ${label ? '<button type="button" data-action="clear-label">清除标签</button>' : ""}
      </div>
    </div>`;
}

function doorOffsetText(door: Door): string {
  const positions = door.dir === "h" ? positionsOf(app.state).x : positionsOf(app.state).y;
  const run = runContaining(app.state, door.dir, door.line, door.anchor);
  const start = positions[door.anchor] + door.local;
  const origin = run ? positions[run.start] : 0;
  return `${formatMm(Math.max(0, start - origin))} mm`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function onSidebarClick(event: MouseEvent): void {
  const button = closestAction(event.target);
  if (!button || button.tagName === "INPUT") return;
  const action = button.dataset.action;
  if (action === "add-interval") {
    const axis = button.dataset.axis;
    if (!isAxis(axis)) return;
    const list = axis === "x" ? app.state.xIntervals : app.state.yIntervals;
    const result = mutate(() => addInterval(app.state, axis, list[list.length - 1] || 3000));
    app.anchor = null;
    if (result.ok) refresh({ intervals: true, refit: true });
    return;
  }
  if (action === "drag-interval") return;
  if (action === "open-sequences") {
    if (!isAxis(button.dataset.axis)) return;
    openSequenceDialog(button.dataset.axis);
    return;
  }
  if (action === "split-interval") {
    const axis = button.dataset.axis;
    if (!isAxis(axis)) return;
    openSplitDialog(axis, Number(button.dataset.index));
    return;
  }
  if (action === "remove-interval") {
    const axis = button.dataset.axis;
    if (!isAxis(axis)) return;
    const result = mutate(() =>
      removeIntervalAt(app.state, axis, Number(button.dataset.index)),
    );
    app.selection = null;
    app.anchor = null;
    if (result.ok) refresh({ intervals: true, refit: true });
    else if (result.message) toast(result.message);
    return;
  }
  if (action === "delete-wall" || action === "delete-door") {
    deleteSelection();
    return;
  }
  if (action === "edit-label" || action === "clear-label") {
    const selection = app.selection;
    if (selection?.type !== "space") return;
    const space = spacesOf(app.state).find((item) => item.key === selection.key);
    if (!space) return;
    if (action === "edit-label") openEditor(space);
    else {
      mutate(() => setSpaceLabel(app.state, space, ""));
      refresh();
    }
  }
}

function onSidebarChange(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.dataset.action === "toggle-bay") {
    const column = Number(input.dataset.column);
    const row = Number(input.dataset.row);
    if (!Number.isInteger(column) || !Number.isInteger(row)) return;
    mutate(() => toggleBay(app.state, column, row));
    refresh();
    return;
  }
  const action = input.dataset.action;
  if (action !== "toggle-window" && action !== "toggle-slide") return;
  const selection = app.selection;
  if (selection?.type !== "wall") return;
  const run = runByKey(app.state, selection.key);
  if (!run) return;
  const index = Number(input.dataset.index);
  if (!Number.isInteger(index) || index < run.start || index >= run.end) return;
  if (action === "toggle-window") mutate(() => toggleWindow(app.state, run.dir, run.line, index));
  else mutate(() => toggleSlide(app.state, run.dir, run.line, index));
  refresh();
}

let intervalDrag: IntervalDrag | null = null;

function onIntervalDragStart(event: PointerEvent): void {
  const handle = closestButton(event.target, "[data-action='drag-interval']");
  if (!handle || handle.disabled || event.button !== 0) return;
  const row = handle.closest(".interval-row");
  if (!(row instanceof HTMLElement)) return;
  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  intervalDrag = {
    pointerId: event.pointerId,
    from: Number(row.dataset.index),
    axis: row.dataset.axis || "",
    seq: row.dataset.seq ?? "",
    row,
  };
  row.classList.add("is-dragging");
}

function onIntervalDragMove(event: PointerEvent): void {
  if (!intervalDrag || event.pointerId !== intervalDrag.pointerId) return;
  const target = intervalRowAt(event.clientX, event.clientY);
  for (const row of intervalDragRows()) row.classList.toggle("is-drop", row === target);
}

function onIntervalDragEnd(event: PointerEvent): void {
  if (!intervalDrag || event.pointerId !== intervalDrag.pointerId) return;
  const target = intervalRowAt(event.clientX, event.clientY);
  const drag = intervalDrag;
  clearIntervalDrag();
  if (!target) return;
  const to = Number(target.dataset.index);
  if (to === drag.from) return;
  if (drag.seq === "") {
    if (!isAxis(drag.axis)) return;
    const axis = drag.axis;
    const result = mutate(() => reorderInterval(app.state, axis, drag.from, to));
    app.anchor = null;
    if (result.ok) refresh({ intervals: true });
    return;
  }
  syncSequenceDraft();
  const list = app.sequenceDraft?.sequences[Number(drag.seq)];
  if (!list) return;
  const value = list.splice(drag.from, 1)[0];
  if (value === undefined) return;
  list.splice(to, 0, value);
  renderSequenceDialog();
}

function clearIntervalDrag(): void {
  if (!intervalDrag) return;
  for (const row of intervalDragRows()) row.classList.remove("is-dragging", "is-drop");
  intervalDrag = null;
}

function intervalDragRows(): HTMLElement[] {
  if (!intervalDrag) return [];
  const selector =
    intervalDrag.seq === ""
      ? `#panel-${intervalDrag.axis} .interval-row`
      : `#sequence-editor [data-seq="${intervalDrag.seq}"] .interval-row`;
  return [...document.querySelectorAll(selector)].filter((node): node is HTMLElement => node instanceof HTMLElement);
}

function intervalRowAt(x: number, y: number): HTMLElement | null {
  const hit = document.elementFromPoint(x, y);
  const row = hit?.closest(".interval-row");
  if (!(row instanceof HTMLElement) || !intervalDrag) return null;
  const sameGroup =
    intervalDrag.seq === ""
      ? row.dataset.axis === intervalDrag.axis && row.dataset.seq == null
      : row.dataset.seq === intervalDrag.seq;
  return sameGroup ? row : null;
}

function openSequenceDialog(axis: Axis): void {
  const list = axis === "x" ? app.state.xIntervals : app.state.yIntervals;
  app.sequenceDraft = {
    axis,
    sequences: [list.map((value) => formatMm(value))],
  };
  required("sequence-title", HTMLElement).textContent =
    axis === "x" ? "横向多序列切分" : "纵向多序列切分";
  renderSequenceDialog();
  sequenceDialog.showModal();
}

function renderSequenceDialog(): void {
  const draft = app.sequenceDraft;
  if (!draft) return;
  const canRemoveSequence = draft.sequences.length > 1;
  sequenceEditor.innerHTML = draft.sequences
    .map((sequence, seq) => {
      const rows = sequence
        .map(
          (value, index) => `
          <div class="interval-row" data-seq="${seq}" data-index="${index}">
            <button type="button" class="drag" data-action="drag-interval" aria-label="拖动重排序列 ${seq + 1} 的第 ${index + 1} 段" ${sequence.length <= 1 ? "disabled" : ""}>⋮⋮</button>
            <label>
              <span>${index + 1}</span>
              <input data-seq="${seq}" data-entry="${index}" type="number" min="${MIN_INTERVAL}" max="${MAX_INTERVAL}" step="1" value="${escapeHtml(value)}" inputmode="numeric" aria-label="序列 ${seq + 1} 第 ${index + 1} 段" />
            </label>
            <em>mm</em>
            <button type="button" class="remove" data-action="remove-sequence-entry" data-seq="${seq}" data-index="${index}" ${sequence.length <= 1 && !canRemoveSequence ? "disabled" : ""} aria-label="删除序列 ${seq + 1} 的第 ${index + 1} 段">×</button>
          </div>`,
        )
        .join("");
      return `
        <div class="sequence" data-seq="${seq}">
          <div class="sequence-head">
            <strong>序列 ${seq + 1}</strong>
            <button type="button" data-action="remove-sequence" data-seq="${seq}" ${canRemoveSequence ? "" : "disabled"}>删除序列</button>
          </div>
          ${rows}
          <button type="button" class="add" data-action="add-sequence-entry" data-seq="${seq}" ${sequence.length >= MAX_INTERVALS ? "disabled" : ""}>添加一段</button>
        </div>`;
    })
    .join("");
  const addSequence = document.createElement("button");
  addSequence.type = "button";
  addSequence.className = "add";
  addSequence.dataset.action = "add-sequence";
  addSequence.textContent = "添加序列";
  addSequence.disabled = draft.sequences.length >= MAX_SEQUENCES;
  sequenceEditor.append(addSequence);
  updateSequencePreview();
}

function syncSequenceDraft(): void {
  const draft = app.sequenceDraft;
  if (!draft) return;
  const sequences: string[][] = [];
  for (const card of sequenceEditor.querySelectorAll(".sequence")) {
    const values: string[] = [];
    for (const input of card.querySelectorAll("input[data-entry]")) {
      if (input instanceof HTMLInputElement) values.push(input.value);
    }
    sequences.push(values);
  }
  if (sequences.length > 0) draft.sequences = sequences;
}

function updateSequencePreview(): void {
  const draft = app.sequenceDraft;
  if (!draft) return;
  const sequences: number[][] = [];
  for (const sequence of draft.sequences) {
    const values: number[] = [];
    for (const raw of sequence) {
      const value = roundMm(Number(raw));
      if (!Number.isFinite(value) || value < MIN_INTERVAL || value > MAX_INTERVAL) {
        sequencePreview.textContent = `每一段要在 ${MIN_INTERVAL} mm 到 ${MAX_INTERVAL} mm 之间。`;
        return;
      }
      values.push(value);
    }
    if (values.length === 0) {
      sequencePreview.textContent = "每条序列至少保留一段。";
      return;
    }
    sequences.push(values);
  }
  const intervals = mergeSequences(sequences);
  sequencePreview.textContent = `结算后 ${intervals.map((value) => formatMm(value)).join(" · ")} mm，共 ${intervals.length} 段。`;
}

function onSequenceInput(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches("input[data-entry]")) return;
  syncSequenceDraft();
  updateSequencePreview();
}

function onSequenceClick(event: MouseEvent): void {
  const button = closestAction(event.target);
  if (!button || !app.sequenceDraft) return;
  const action = button.dataset.action;
  if (action === "drag-interval") return;
  syncSequenceDraft();
  const draft = app.sequenceDraft;
  const seq = Number(button.dataset.seq);
  if (action === "add-sequence") {
    if (draft.sequences.length >= MAX_SEQUENCES) return;
    const previous = draft.sequences.at(-1);
    draft.sequences.push([previous?.at(-1) || "3000"]);
  } else if (action === "remove-sequence") {
    if (draft.sequences.length <= 1) return;
    draft.sequences.splice(seq, 1);
  } else if (action === "add-sequence-entry") {
    const sequence = draft.sequences[seq];
    if (!sequence || sequence.length >= MAX_INTERVALS) return;
    sequence.push(sequence.at(-1) || "3000");
  } else if (action === "remove-sequence-entry") {
    const sequence = draft.sequences[seq];
    if (!sequence) return;
    if (sequence.length <= 1) {
      if (draft.sequences.length <= 1) return;
      draft.sequences.splice(seq, 1);
    } else {
      sequence.splice(Number(button.dataset.index), 1);
    }
  } else {
    return;
  }
  renderSequenceDialog();
}

function onSequenceSubmit(event: SubmitEvent): void {
  event.preventDefault();
  if (!app.sequenceDraft) return;
  syncSequenceDraft();
  const draft = app.sequenceDraft;
  const result = mutate(() =>
    settleSequences(
      app.state,
      draft.axis,
      draft.sequences.map((sequence) => sequence.map((value) => Number(value))),
    ),
  );
  if (!result.ok) {
    if (result.message) sequencePreview.textContent = result.message;
    return;
  }
  app.sequenceDraft = null;
  app.anchor = null;
  app.selection = null;
  sequenceDialog.close();
  refresh({ intervals: true, refit: true });
}

function onIntervalInput(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches("[data-axis]")) return;
  const axis = input.dataset.axis;
  if (!isAxis(axis)) return;
  const index = Number(input.dataset.index);
  const list = axis === "x" ? app.state.xIntervals : app.state.yIntervals;
  const rounded = roundMm(Number(input.value));
  if (!Number.isFinite(rounded) || rounded < MIN_INTERVAL || rounded > MAX_INTERVAL) {
    input.classList.add("invalid");
    return;
  }
  input.classList.remove("invalid");
  if (list[index] === rounded) return;
  if (app.intervalSnapshot) {
    app.undo.push(app.intervalSnapshot);
    app.redo = [];
    app.intervalSnapshot = null;
  }
  setIntervalValue(app.state, axis, index, rounded);
  normalize(app.state);
  if (app.undo.at(-1) === serialize(app.state)) app.undo.pop();
  persist();
  app.anchor = null;
  app.preview = null;
  refresh();
}

function onPointerDown(event: PointerEvent): void {
  const point = localPoint(event);
  if (event.button === 1 || event.button === 2 || app.spaceDown || event.altKey) {
    beginPan(event, point);
    return;
  }
  if (event.button !== 0) return;
  const hit = hitTest(point.x, point.y, app.state, app.view);

  if (app.tool === "label" && hit.space) {
    event.preventDefault();
    app.pendingLabel = hit.space;
    return;
  }
  if (app.tool === "bay" && hit.cell) {
    const cell = hit.cell;
    mutate(() => toggleBay(app.state, cell.c, cell.r));
    app.selection = hit.space ? { type: "space", key: hit.space.key } : null;
    refresh();
    return;
  }

  canvas.setPointerCapture(event.pointerId);

  if (app.tool === "wall" || app.tool === "erase") {
    if (!hit.point) return;
    if (!app.anchor) {
      app.anchor = { xi: hit.point.xi, yi: hit.point.yi };
      app.anchorGesture = event.pointerId;
      draw();
      return;
    }
    if (hit.point.xi === app.anchor.xi && hit.point.yi === app.anchor.yi) {
      app.anchor = null;
      app.anchorGesture = null;
      app.preview = null;
      draw();
      return;
    }
    const from = app.anchor;
    app.anchorGesture = null;
    finishSpan(from, hit.point);
    return;
  }

  if ((app.tool === "window" || app.tool === "slide") && hit.wall) {
    const wall = hit.wall;
    const positions = wall.run.dir === "h" ? positionsOf(app.state).x : positionsOf(app.state).y;
    let index = wall.run.start;
    for (let cursor = wall.run.start; cursor < wall.run.end; cursor += 1) {
      if (wall.meter + 1e-6 >= positions[cursor]) index = cursor;
    }
    if (app.tool === "window") mutate(() => toggleWindow(app.state, wall.run.dir, wall.run.line, index));
    else mutate(() => toggleSlide(app.state, wall.run.dir, wall.run.line, index));
    app.selection = { type: "wall", key: runKey(wall.run) };
    refresh();
    return;
  }

  if (app.tool === "door") {
    if (event.detail >= 2 && hit.door && hit.door.dist <= 8) return;
    if (hit.door && hit.door.dist <= 8) {
      app.selection = { type: "door", id: hit.door.door.id };
      beginDoorDrag(event, hit.door.door, hit.world);
      refresh();
      return;
    }
    if (hit.wall) {
      const wall = hit.wall;
      const result = mutate(() => placeDoor(app.state, wall.run, wall.meter));
      if (result.ok && result.id) app.selection = { type: "door", id: result.id };
      refresh();
    }
    return;
  }

  if (app.tool !== "select") return;
  if (hit.door && hit.door.dist <= 8) {
    app.selection = { type: "door", id: hit.door.door.id };
    beginDoorDrag(event, hit.door.door, hit.world);
    refresh();
    return;
  }
  if (hit.wall) {
    app.selection = { type: "wall", key: runKey(hit.wall.run) };
    refresh();
    return;
  }
  if (hit.space) {
    app.selection = { type: "space", key: hit.space.key };
    app.drag = { type: "maybe-pan", pointerId: event.pointerId, x: point.x, y: point.y, moved: false };
    refresh();
    return;
  }
  app.drag = {
    type: "maybe-pan",
    pointerId: event.pointerId,
    x: point.x,
    y: point.y,
    moved: false,
    clear: true,
  };
}

function onPointerMove(event: PointerEvent): void {
  const point = localPoint(event);
  const hit = hitTest(point.x, point.y, app.state, app.view);
  app.lastHit = hit;
  app.hoverPoint = hit.point ? { xi: hit.point.xi, yi: hit.point.yi } : null;
  app.hoverRun = hit.wall ? hit.wall.run : null;

  if (app.drag && (app.drag.type === "pan" || app.drag.type === "maybe-pan")) {
    const distance = Math.hypot(point.x - app.drag.x, point.y - app.drag.y);
    if (app.drag.type === "maybe-pan" && distance > 4) app.drag.type = "pan";
    if (app.drag.type === "pan") {
      app.view.ox += point.x - app.drag.x;
      app.view.oy += point.y - app.drag.y;
      app.drag.x = point.x;
      app.drag.y = point.y;
      app.drag.moved = true;
      app.viewCustom = true;
      if (app.editor) positionEditor(app.editor.space);
    }
    updateCursor(hit);
    renderStatus(hit);
    draw();
    return;
  }

  if (app.drag?.type === "door") {
    const drag = app.drag;
    const door = app.state.doors.find((item) => item.id === drag.id);
    if (door) {
      const along = door.dir === "h" ? hit.world.x : hit.world.y;
      moveDoor(app.state, door.id, along - drag.grab);
      const node = document.querySelector("[data-door-pos]");
      if (node) node.textContent = doorOffsetText(door);
      draw();
    }
    renderStatus(hit);
    return;
  }

  if ((app.tool === "wall" || app.tool === "erase") && app.anchor && hit.point) {
    const span = gridSpan(app.anchor, hit.point);
    app.preview = span.ok
      ? { dir: span.dir, line: span.line, start: span.start, end: span.end, mode: app.tool }
      : null;
  } else {
    app.preview = null;
  }
  updateCursor(hit);
  renderStatus(hit);
  draw();
}

function onPointerUp(event: PointerEvent): void {
  if (app.pendingLabel) {
    const space = app.pendingLabel;
    app.pendingLabel = null;
    setTimeout(() => openEditor(space), 0);
    return;
  }
  const drag = app.drag;
  if (drag?.type === "door" && drag.pointerId === event.pointerId) {
    normalize(app.state);
    const next = serialize(app.state);
    if (next !== drag.snapshot) {
      app.undo.push(drag.snapshot);
      app.redo = [];
      if (app.undo.length > 100) app.undo.shift();
      persist();
    }
    app.drag = null;
    refresh();
    return;
  }
  if (drag && drag.pointerId === event.pointerId) {
    const shouldClear = drag.type === "maybe-pan" && !drag.moved && drag.clear;
    app.drag = null;
    if (shouldClear) {
      app.selection = null;
      refresh();
    }
  }
  if (app.anchorGesture === event.pointerId && app.anchor) {
    const point = localPoint(event);
    const hit = hitTest(point.x, point.y, app.state, app.view);
    const same = hit.point && hit.point.xi === app.anchor.xi && hit.point.yi === app.anchor.yi;
    app.anchorGesture = null;
    if (hit.point && !same) {
      finishSpan(app.anchor, hit.point);
      return;
    }
    draw();
  }
}

function onDoubleClick(event: MouseEvent): void {
  const point = localPoint(event);
  const hit = hitTest(point.x, point.y, app.state, app.view);
  if (app.tool === "door" && hit.door && hit.door.dist <= 8) {
    const id = hit.door.door.id;
    const result = mutate(() => centerDoor(app.state, id));
    if (result.ok) {
      app.selection = { type: "door", id };
      refresh();
    }
    return;
  }
  if (app.tool !== "select") return;
  if (hit.space && !hit.wall && !(hit.door && hit.door.dist <= 8)) openEditor(hit.space);
}

function onWheel(event: WheelEvent): void {
  event.preventDefault();
  const point = localPoint(event);
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  app.view = zoomAt(app.view, point.x, point.y, Math.exp(-delta * 0.0015));
  app.viewCustom = true;
  if (app.editor) positionEditor(app.editor.space);
  draw();
  renderStatus(app.lastHit);
}

function beginPan(event: PointerEvent, point: Point): void {
  canvas.setPointerCapture(event.pointerId);
  app.drag = { type: "pan", pointerId: event.pointerId, x: point.x, y: point.y, moved: true };
  app.viewCustom = true;
}

function beginDoorDrag(event: PointerEvent, door: Door, world: Point): void {
  const positions = door.dir === "h" ? positionsOf(app.state).x : positionsOf(app.state).y;
  const start = positions[door.anchor] + door.local;
  const along = door.dir === "h" ? world.x : world.y;
  app.drag = {
    type: "door",
    pointerId: event.pointerId,
    id: door.id,
    grab: along - start,
    snapshot: serialize(app.state),
  };
}

function finishSpan(from: GridPoint, to: GridPoint): void {
  const mode = app.tool === "erase" ? "erase" : "add";
  const result = mutate(() => applyGridSpan(app.state, from, to, mode));
  app.preview = null;
  if (!result.ok) {
    app.anchor = from;
    draw();
    updateChrome();
    return;
  }
  app.anchor = null;
  if (result.span && mode === "add") {
    const run = runContaining(app.state, result.span.dir, result.span.line, result.span.start);
    app.selection = run ? { type: "wall", key: runKey(run) } : null;
  }
  if (mode === "erase") app.selection = reconcile(app.selection);
  refresh();
}

function deleteSelection(): void {
  const selection = app.selection;
  if (!selection) return;
  if (selection.type === "wall") {
    const run = runByKey(app.state, selection.key);
    if (!run) return;
    mutate(() => deleteRun(app.state, run));
    app.selection = null;
  } else if (selection.type === "door") {
    mutate(() => deleteDoor(app.state, selection.id));
    app.selection = null;
  } else if (selection.type === "space") {
    const space = spacesOf(app.state).find((item) => item.key === selection.key);
    if (!space) return;
    mutate(() => setSpaceLabel(app.state, space, ""));
  }
  refresh();
}

function openEditor(space: Space): void {
  if (app.editor) commitEditor();
  const label = labelForSpace(app.state, space);
  app.editor = { space, snapshot: serialize(app.state) };
  app.selection = { type: "space", key: space.key };
  renderSelection();
  editor.value = label?.text || "";
  editor.classList.add("is-open");
  positionEditor(space);
  const token = {};
  app.editorFocusToken = token;
  const focusEditor = () => {
    if (app.editorFocusToken !== token || !app.editor) return;
    editor.focus();
    editor.select();
  };
  setTimeout(focusEditor, 0);
  requestAnimationFrame(() => {
    focusEditor();
    requestAnimationFrame(focusEditor);
  });
  setTimeout(() => {
    if (app.editorFocusToken === token) app.editorFocusToken = null;
  }, 200);
}

function positionEditor(space: Space): void {
  const { x, y } = positionsOf(app.state);
  const anchor = labelAnchor(space, x, y);
  const point = worldToScreen(anchor.x, anchor.y, app.view);
  editor.style.left = `${point.x}px`;
  editor.style.top = `${point.y}px`;
}

function commitEditor(): void {
  if (!app.editor) return;
  const previous = app.editor.snapshot;
  app.editor = null;
  app.editorFocusToken = null;
  editor.classList.remove("is-open");
  editor.blur();
  normalize(app.state);
  const current = serialize(app.state);
  if (current !== previous) {
    app.undo.push(previous);
    app.redo = [];
    if (app.undo.length > 100) app.undo.shift();
    persist();
  }
  refresh();
}

function cancelEditor(): void {
  if (!app.editor) return;
  const snapshot = app.editor.snapshot;
  app.editor = null;
  app.editorFocusToken = null;
  editor.classList.remove("is-open");
  editor.blur();
  app.state = deserialize(snapshot);
  persist();
  refresh();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.code === "Space" && !typing(event.target)) {
    event.preventDefault();
    app.spaceDown = true;
    return;
  }
  if (typing(event.target)) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (event.key === "Escape") {
    app.pendingLabel = null;
    app.anchor = null;
    app.anchorGesture = null;
    app.preview = null;
    app.selection = null;
    refresh();
    return;
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    deleteSelection();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const tool = TOOL_KEYS[event.key.toLowerCase()];
  if (tool) setTool(tool);
}

function updateCursor(hit: Hit): void {
  if (app.spaceDown || app.drag?.type === "pan") {
    canvas.style.cursor = "grabbing";
    return;
  }
  if (app.tool === "wall" || app.tool === "erase") {
    canvas.style.cursor = hit.point ? "pointer" : "crosshair";
    return;
  }
  if (app.tool === "label") {
    canvas.style.cursor = hit.space ? "text" : "default";
    return;
  }
  if (app.tool === "bay") {
    canvas.style.cursor = hit.cell ? "pointer" : "default";
    return;
  }
  if (app.tool === "door" || app.tool === "window" || app.tool === "slide") {
    canvas.style.cursor = hit.wall || hit.door ? "pointer" : "default";
    return;
  }
  canvas.style.cursor = hit.door || hit.wall ? "pointer" : "grab";
}

function renderStatus(hit: Hit | null): void {
  const positions = positionsOf(app.state);
  const fitted = fitView(
    app.cssWidth,
    app.cssHeight,
    positions.x.at(-1) ?? 0,
    positions.y.at(-1) ?? 0,
  );
  const zoom = Math.round((app.view.ppm / fitted.ppm) * 100);
  let message = `墙 120 mm · 门 800 mm · ${zoom}%`;
  if (hit?.world) {
    message = `X ${formatMm(hit.world.x)} mm · Y ${formatMm(hit.world.y)} mm · ${message}`;
  }
  if (app.anchor && app.hoverPoint && !app.preview && (app.tool === "wall" || app.tool === "erase")) {
    message = `不在同一条参考线上 · ${message}`;
  }
  status.textContent = message;
}

function clearPlan(): void {
  const empty =
    app.state.hEdges.size +
      app.state.vEdges.size +
      app.state.doors.length +
      app.state.labels.length +
      app.state.bayCells.size ===
    0;
  if (empty) return;
  if (!window.confirm("清空墙体、门、窗、推拉门、飘窗和标签？间隔会保留，可以用撤销恢复。")) return;
  if (!window.confirm("再次确认：这些内容会被清掉。确定继续？")) return;
  const previous = serialize(app.state);
  clearDrawing(app.state);
  normalize(app.state);
  app.undo.push(previous);
  app.redo = [];
  app.selection = null;
  app.anchor = null;
  app.preview = null;
  persist();
  refresh();
}

function saveJson(): void {
  const pretty = `${JSON.stringify(JSON.parse(serialize(app.state)), null, 2)}\n`;
  const blob = new Blob([pretty], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  download("户型.json", url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadJson(file: File): Promise<void> {
  if (!window.confirm("载入文件会替换当前户型。可以用撤销恢复。")) return;
  let text = "";
  try {
    text = await file.text();
  } catch {
    toast("读不到这个文件");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    toast("这个文件不是 JSON");
    return;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    toast("这个 JSON 不是户型文件");
    return;
  }
  let next: PlanState;
  try {
    next = deserialize(JSON.stringify(parsed));
  } catch {
    toast("这个 JSON 读不出来");
    return;
  }
  if (app.editor) {
    app.editor = null;
    app.editorFocusToken = null;
    editor.classList.remove("is-open");
    editor.blur();
  }
  const previous = serialize(app.state);
  app.state = next;
  app.undo.push(previous);
  app.redo = [];
  app.selection = null;
  app.anchor = null;
  app.preview = null;
  app.viewCustom = false;
  persist();
  refresh({ intervals: true, refit: true });
  toast("已载入户型");
}

function download(filename: string, href: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
}

function exportScene() {
  const frame = exportLayout(app.state);
  return {
    frame,
    scene: {
      state: app.state,
      view: frame.view,
      tool: "select" as const,
      anchor: null,
      hoverPoint: null,
      hoverRun: null,
      preview: null,
      selection: null,
      exporting: true,
    },
  };
}

function exportPng(): void {
  const { frame, scene } = exportScene();
  const output = document.createElement("canvas");
  const dpr = 2;
  output.width = frame.width * dpr;
  output.height = frame.height * dpr;
  const context = output.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScene(context, frame.width, frame.height, scene);
  download("户型图.png", output.toDataURL("image/png"));
}

function exportSvg(): void {
  const blob = new Blob([exportPlanSvg(app.state)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  download("户型图.svg", url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
