import {
  MAX_INTERVAL,
  MIN_INTERVAL,
  formatMeters,
  gridSpan,
  labelAnchor,
  runIsWindow,
  runKey,
  spaceNetArea,
  xAxisName,
  yAxisName,
} from "./geometry.js";
import {
  addInterval,
  applyGridSpan,
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
  runByKey,
  runContaining,
  serialize,
  setIntervalValue,
  setSpaceLabel,
  spacesOf,
  toggleWindow,
  updateDoor,
} from "./model.js";
import { drawScene, hitTest } from "./render.js";
import { fitView, worldToScreen, zoomAt } from "./view.js";

const HINTS = {
  select: "点选墙、门或空间。拖动空白处平移，滚轮缩放，双击空间可改标签。",
  wall: "依次点击同一条参考线上的两个交叉点。按住空格可平移。",
  erase: "依次点击两个交叉点，去掉它们之间的墙。",
  door: "在墙面上点击，放下一扇 1 米宽的门。拖动可改位置。",
  window: "点击一面墙，标记这面墙上有窗。再点一次取消。",
  label: "点击一个空间，为它填写名称。",
};

const TOOL_KEYS = { v: "select", w: "wall", e: "erase", d: "door", n: "window", l: "label" };
const STORAGE_KEY = "easyfloorplan.v1";

const canvas = document.getElementById("plan");
const sidebar = document.getElementById("sidebar");
const editor = document.getElementById("label-editor");
const hint = document.getElementById("hint");
const status = document.getElementById("status");

const app = {
  state: loadState(),
  view: { ox: 0, oy: 0, ppm: 40 },
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
  lastHit: null,
  cssWidth: 1,
  cssHeight: 1,
  dpr: 1,
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

document.getElementById("toolbar").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tool]");
  if (button) setTool(button.dataset.tool);
});

document.getElementById("undo").addEventListener("click", undo);
document.getElementById("redo").addEventListener("click", redo);
document.getElementById("fit").addEventListener("click", () => {
  app.viewCustom = false;
  fit();
  draw();
  renderStatus(app.lastHit);
});
document.getElementById("export").addEventListener("click", exportPng);
document.getElementById("sample").addEventListener("click", loadSample);
document.getElementById("clear").addEventListener("click", clearPlan);

sidebar.addEventListener("click", onSidebarClick);
sidebar.addEventListener("change", onSidebarChange);
sidebar.addEventListener("focusin", (event) => {
  if (event.target.matches("[data-axis]")) app.intervalSnapshot = serialize(app.state);
});
sidebar.addEventListener("focusout", (event) => {
  if (!event.target.matches("[data-axis]")) return;
  app.intervalSnapshot = null;
  const axis = event.target.dataset.axis;
  const index = Number(event.target.dataset.index);
  const list = axis === "x" ? app.state.xIntervals : app.state.yIntervals;
  event.target.classList.remove("invalid");
  if (list[index] != null) event.target.value = formatMeters(list[index]);
});
sidebar.addEventListener("input", onIntervalInput);
sidebar.addEventListener(
  "wheel",
  (event) => {
    if (event.target.matches('input[type="number"]')) event.target.blur();
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

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSample();
    return deserialize(raw);
  } catch {
    return createSample();
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(app.state));
  } catch {
    // The drawing still works for this session when storage is blocked.
  }
}

function typing(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function measure() {
  const rect = canvas.getBoundingClientRect();
  app.cssWidth = Math.max(1, rect.width);
  app.cssHeight = Math.max(1, rect.height);
  app.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(app.cssWidth * app.dpr));
  canvas.height = Math.max(1, Math.round(app.cssHeight * app.dpr));
}

function fit() {
  if (app.cssWidth < 40 || app.cssHeight < 40) return;
  const { x, y } = positionsOf(app.state);
  app.view = fitView(app.cssWidth, app.cssHeight, x[x.length - 1], y[y.length - 1]);
}

function scene() {
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

function draw() {
  const context = canvas.getContext("2d");
  context.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
  drawScene(context, app.cssWidth, app.cssHeight, scene());
}

function localPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function mutate(mutator) {
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

function reconcile(selection) {
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

function refresh({ intervals = false, refit = false } = {}) {
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

function updateChrome() {
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.tool === app.tool));
  });
  document.getElementById("undo").disabled = app.undo.length === 0;
  document.getElementById("redo").disabled = app.redo.length === 0;
  hint.textContent = HINTS[app.tool];
}

function setTool(tool) {
  if (app.editor) commitEditor();
  app.tool = tool;
  app.pendingLabel = null;
  app.anchor = null;
  app.anchorGesture = null;
  app.preview = null;
  updateChrome();
  draw();
}

function undo() {
  if (app.editor) cancelEditor();
  if (app.undo.length === 0) return;
  app.redo.push(serialize(app.state));
  app.state = deserialize(app.undo.pop());
  app.selection = null;
  app.pendingLabel = null;
  app.anchor = null;
  app.preview = null;
  persist();
  refresh({ intervals: true });
}

function redo() {
  if (app.editor) commitEditor();
  if (app.redo.length === 0) return;
  app.undo.push(serialize(app.state));
  app.state = deserialize(app.redo.pop());
  app.selection = null;
  app.pendingLabel = null;
  app.anchor = null;
  app.preview = null;
  persist();
  refresh({ intervals: true });
}

function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2600);
}

function renderIntervals() {
  document.getElementById("panel-x").innerHTML = intervalMarkup("x");
  document.getElementById("panel-y").innerHTML = intervalMarkup("y");
}

function intervalMarkup(axis) {
  const list = axis === "x" ? app.state.xIntervals : app.state.yIntervals;
  const title = axis === "x" ? "横向间隔" : "纵向间隔";
  const help =
    axis === "x"
      ? "从左到右每一段的宽度，用来生成竖向参考线。"
      : "从下到上每一段的进深，用来生成横向参考线。";
  const rows = list
    .map(
      (value, index) => `
        <div class="interval-row">
          <label>
            <span>${index + 1}</span>
            <input data-axis="${axis}" data-index="${index}" type="number" min="${MIN_INTERVAL}" max="${MAX_INTERVAL}" step="0.1" value="${formatMeters(value)}" inputmode="decimal" aria-label="${title} ${index + 1}" />
          </label>
          <em>m</em>
          <button type="button" data-action="remove-interval" data-axis="${axis}" data-index="${index}" ${list.length <= 1 ? "disabled" : ""} aria-label="删除第 ${index + 1} 段">×</button>
        </div>`,
    )
    .join("");
  return `<h2>${title}</h2><p>${help}</p>${rows}<button type="button" class="add" data-action="add-interval" data-axis="${axis}">添加一段</button>`;
}

function renderReadout() {
  const { x, y } = positionsOf(app.state);
  const items = (positions, name) =>
    positions
      .map(
        (meter, index) =>
          `<li><b>${name(index)}</b><span>${formatMeters(meter)} m</span></li>`,
      )
      .join("");
  document.getElementById("readout").innerHTML = `
    <div>
      <h2>竖向参考线</h2>
      <ol>${items(x, xAxisName)}</ol>
      <p class="total">总宽 ${formatMeters(x[x.length - 1])} m</p>
    </div>
    <div>
      <h2>横向参考线</h2>
      <ol>${items(y, yAxisName)}</ol>
      <p class="total">总深 ${formatMeters(y[y.length - 1])} m</p>
    </div>`;
}

function renderSelection() {
  const mount = document.getElementById("selection");
  const selection = app.selection;
  if (!selection) {
    mount.innerHTML =
      '<div class="selection-empty"><p>未选中墙、门或空间。</p><p>墙厚 12 cm，门洞 1 m。</p></div>';
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
    const windowOn = runIsWindow(app.state.windowEdges, run);
    mount.innerHTML = `
      <div class="selection">
        <h3>${title} 上的墙</h3>
        <p>长度 ${formatMeters(length)} m · 门 ${doorCount} 扇</p>
        ${length < 1 ? "<p>这面墙不到 1 米，不能开门。</p>" : ""}
        <label class="check"><input type="checkbox" data-action="toggle-window" ${windowOn ? "checked" : ""} />这面墙有窗</label>
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
        <p>宽度 1 m，距墙起点 <span data-door-pos>${doorOffsetText(door)}</span></p>
        <div class="row">
          <button type="button" data-action="flip-hinge">换合页边</button>
          <button type="button" data-action="flip-side">换开启侧</button>
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
  const area = spaceNetArea(space, x, y, app.state.hEdges, app.state.vEdges);
  const label = labelForSpace(app.state, space);
  mount.innerHTML = `
    <div class="selection">
      <h3 data-label-text>${label ? escapeHtml(label.text) : "未命名"}</h3>
      <p>净面积 ${area.toFixed(2)} ㎡，按墙内皮计算。</p>
      <div class="row">
        <button type="button" data-action="edit-label">编辑标签</button>
        ${label ? '<button type="button" data-action="clear-label">清除标签</button>' : ""}
      </div>
    </div>`;
}

function doorOffsetText(door) {
  const positions = door.dir === "h" ? positionsOf(app.state).x : positionsOf(app.state).y;
  const run = runContaining(app.state, door.dir, door.line, door.anchor);
  const start = positions[door.anchor] + door.local;
  const origin = run ? positions[run.start] : 0;
  return `${formatMeters(Math.max(0, start - origin))} m`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function onSidebarClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.tagName === "INPUT") return;
  const action = button.dataset.action;
  if (action === "add-interval") {
    const axis = button.dataset.axis;
    const list = axis === "x" ? app.state.xIntervals : app.state.yIntervals;
    const result = mutate(() => addInterval(app.state, axis, list[list.length - 1] || 3));
    app.anchor = null;
    if (result.ok) refresh({ intervals: true, refit: true });
    return;
  }
  if (action === "remove-interval") {
    const result = mutate(() =>
      removeIntervalAt(app.state, button.dataset.axis, Number(button.dataset.index)),
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
  if (action === "flip-hinge" || action === "flip-side") {
    const door = app.state.doors.find((item) => item.id === app.selection?.id);
    if (!door) return;
    if (action === "flip-hinge") {
      mutate(() => updateDoor(app.state, door.id, { hinge: door.hinge === "high" ? "low" : "high" }));
    } else {
      mutate(() => updateDoor(app.state, door.id, { side: door.side > 0 ? -1 : 1 }));
    }
    refresh();
    return;
  }
  if (action === "edit-label" || action === "clear-label") {
    const space = spacesOf(app.state).find((item) => item.key === app.selection?.key);
    if (!space) return;
    if (action === "edit-label") openEditor(space);
    else {
      mutate(() => setSpaceLabel(app.state, space, ""));
      refresh();
    }
  }
}

function onSidebarChange(event) {
  if (event.target.dataset.action !== "toggle-window") return;
  const run = runByKey(app.state, app.selection?.key);
  if (!run) return;
  mutate(() => toggleWindow(app.state, run));
  refresh();
}

function onIntervalInput(event) {
  const input = event.target;
  if (!input.matches("[data-axis]")) return;
  const axis = input.dataset.axis;
  const index = Number(input.dataset.index);
  const list = axis === "x" ? app.state.xIntervals : app.state.yIntervals;
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < MIN_INTERVAL || value > MAX_INTERVAL) {
    input.classList.add("invalid");
    return;
  }
  input.classList.remove("invalid");
  const rounded = Math.round(value * 1000) / 1000;
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

function onPointerDown(event) {
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

  if (app.tool === "window" && hit.wall) {
    const key = runKey(hit.wall.run);
    mutate(() => toggleWindow(app.state, hit.wall.run));
    app.selection = { type: "wall", key };
    refresh();
    return;
  }

  if (app.tool === "door") {
    if (hit.door && hit.door.dist <= 8) {
      app.selection = { type: "door", id: hit.door.door.id };
      beginDoorDrag(event, hit.door.door, hit.world);
      refresh();
      return;
    }
    if (hit.wall) {
      const result = mutate(() => placeDoor(app.state, hit.wall.run, hit.wall.meter));
      if (result.ok) app.selection = { type: "door", id: result.id };
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

function onPointerMove(event) {
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
    const door = app.state.doors.find((item) => item.id === app.drag.id);
    if (door) {
      const along = door.dir === "h" ? hit.world.x : hit.world.y;
      moveDoor(app.state, door.id, along - app.drag.grab);
      const node = document.querySelector("[data-door-pos]");
      if (node) node.textContent = doorOffsetText(door);
      draw();
    }
    renderStatus(hit);
    return;
  }

  if ((app.tool === "wall" || app.tool === "erase") && app.anchor && hit.point) {
    const span = gridSpan(app.anchor, hit.point);
    app.preview = span.ok ? { ...span, mode: app.tool } : null;
  } else {
    app.preview = null;
  }
  updateCursor(hit);
  renderStatus(hit);
  draw();
}

function onPointerUp(event) {
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

function onDoubleClick(event) {
  if (app.tool !== "select") return;
  const point = localPoint(event);
  const hit = hitTest(point.x, point.y, app.state, app.view);
  if (hit.space && !hit.wall && !(hit.door && hit.door.dist <= 8)) openEditor(hit.space);
}

function onWheel(event) {
  event.preventDefault();
  const point = localPoint(event);
  const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  app.view = zoomAt(app.view, point.x, point.y, Math.exp(-delta * 0.0015));
  app.viewCustom = true;
  if (app.editor) positionEditor(app.editor.space);
  draw();
  renderStatus(app.lastHit);
}

function beginPan(event, point) {
  canvas.setPointerCapture(event.pointerId);
  app.drag = { type: "pan", pointerId: event.pointerId, x: point.x, y: point.y, moved: true };
  app.viewCustom = true;
}

function beginDoorDrag(event, door, world) {
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

function finishSpan(from, to) {
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

function deleteSelection() {
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

function openEditor(space) {
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

function positionEditor(space) {
  const { x, y } = positionsOf(app.state);
  const anchor = labelAnchor(space, x, y);
  const point = worldToScreen(anchor.x, anchor.y, app.view);
  editor.style.left = `${point.x}px`;
  editor.style.top = `${point.y}px`;
}

function commitEditor() {
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

function cancelEditor() {
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

function onKeyDown(event) {
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

function updateCursor(hit) {
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
  if (app.tool === "door" || app.tool === "window") {
    canvas.style.cursor = hit.wall || hit.door ? "pointer" : "default";
    return;
  }
  canvas.style.cursor = hit.door || hit.wall ? "pointer" : "grab";
}

function renderStatus(hit) {
  const fitted = fitView(
    app.cssWidth,
    app.cssHeight,
    positionsOf(app.state).x.at(-1),
    positionsOf(app.state).y.at(-1),
  );
  const zoom = Math.round((app.view.ppm / fitted.ppm) * 100);
  let message = `墙 12 cm · 门 1 m · ${zoom}%`;
  if (hit?.world) {
    message = `X ${formatMeters(hit.world.x)} m · Y ${formatMeters(hit.world.y)} m · ${message}`;
  }
  if (app.anchor && app.hoverPoint && !app.preview && (app.tool === "wall" || app.tool === "erase")) {
    message = `不在同一条参考线上 · ${message}`;
  }
  status.textContent = message;
}

function loadSample() {
  if (!window.confirm("载入示例会替换当前户型。可以用撤销恢复。")) return;
  const previous = serialize(app.state);
  app.state = createSample();
  app.undo.push(previous);
  app.redo = [];
  app.selection = null;
  app.anchor = null;
  app.preview = null;
  app.viewCustom = false;
  persist();
  refresh({ intervals: true, refit: true });
}

function clearPlan() {
  const empty =
    app.state.hEdges.size + app.state.vEdges.size + app.state.doors.length + app.state.labels.length === 0;
  if (empty) return;
  if (!window.confirm("清空墙体、门、窗和标签？间隔会保留，可以用撤销恢复。")) return;
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

function exportPng() {
  const { x, y } = positionsOf(app.state);
  const worldWidth = x[x.length - 1];
  const worldHeight = y[y.length - 1];
  const longEdge = Math.max(worldWidth, worldHeight, 0.1);
  const ppm = Math.min(90, 3400 / longEdge);
  const pad = 120;
  const width = Math.ceil(worldWidth * ppm + pad * 2);
  const height = Math.ceil(worldHeight * ppm + pad * 2);
  const output = document.createElement("canvas");
  const dpr = 2;
  output.width = width * dpr;
  output.height = height * dpr;
  const context = output.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScene(context, width, height, {
    state: app.state,
    view: { ox: pad, oy: pad + worldHeight * ppm, ppm },
    tool: "select",
    anchor: null,
    hoverPoint: null,
    hoverRun: null,
    preview: null,
    selection: null,
    exporting: true,
  });
  const link = document.createElement("a");
  link.href = output.toDataURL("image/png");
  link.download = "户型图.png";
  link.click();
}
