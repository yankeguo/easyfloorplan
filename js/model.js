import {
  DOOR_WIDTH,
  MAX_INTERVAL,
  MAX_INTERVALS,
  MIN_INTERVAL,
  addSpan,
  anchorFromMeter,
  computeRuns,
  computeSpaces,
  findRunContainingEdge,
  fitDoor,
  gridSpan,
  normalizeDoors,
  prefixSums,
  rebindLabels,
  remapDoors,
  remapEdgeSet,
  remapLabelCells,
  removeSpan,
  roundMm,
  runIsWindow,
} from "./geometry.js";

export function emptyState() {
  return {
    xIntervals: [4.2, 3.6],
    yIntervals: [3.6, 3.0],
    hEdges: new Set(),
    vEdges: new Set(),
    windowEdges: new Set(),
    doors: [],
    labels: [],
    nextId: 1,
  };
}

export function positionsOf(state) {
  return {
    x: prefixSums(state.xIntervals),
    y: prefixSums(state.yIntervals),
  };
}

export function spacesOf(state) {
  return computeSpaces(
    state.xIntervals.length,
    state.yIntervals.length,
    state.hEdges,
    state.vEdges,
  );
}

export function runsOf(state) {
  return [...computeRuns(state.hEdges, "h"), ...computeRuns(state.vEdges, "v")];
}

export function normalize(state) {
  if (state.xIntervals.length < 1) state.xIntervals = [3];
  if (state.yIntervals.length < 1) state.yIntervals = [3];
  state.xIntervals = state.xIntervals.map((value) => roundMm(value));
  state.yIntervals = state.yIntervals.map((value) => roundMm(value));
  for (const key of [...state.windowEdges]) {
    const dir = key.slice(0, 1);
    const walls = dir === "h" ? state.hEdges : state.vEdges;
    if (!walls.has(key)) state.windowEdges.delete(key);
  }
  const { x, y } = positionsOf(state);
  state.doors = normalizeDoors(state.doors, state.hEdges, state.vEdges, x, y);
  state.labels = rebindLabels(state.labels, spacesOf(state));
  return state;
}

export function createSample() {
  const state = emptyState();
  state.xIntervals = [3.9, 3.3, 2.7];
  state.yIntervals = [4.8, 3.0];
  addSpan(state.hEdges, "h", 0, 0, 3);
  addSpan(state.hEdges, "h", 2, 0, 3);
  addSpan(state.hEdges, "h", 1, 0, 1);
  addSpan(state.hEdges, "h", 1, 2, 3);
  addSpan(state.vEdges, "v", 0, 0, 2);
  addSpan(state.vEdges, "v", 3, 0, 2);
  addSpan(state.vEdges, "v", 1, 0, 2);
  addSpan(state.vEdges, "v", 2, 1, 2);
  addSpan(state.windowEdges, "h", 0, 0, 3);
  addSpan(state.windowEdges, "h", 2, 0, 3);
  state.doors = [
    { id: "d1", dir: "v", line: 1, anchor: 0, local: 1.7, hinge: "low", side: 1 },
    { id: "d2", dir: "v", line: 1, anchor: 1, local: 0.9, hinge: "low", side: 1 },
    { id: "d3", dir: "h", line: 1, anchor: 0, local: 1.3, hinge: "low", side: -1 },
    { id: "d4", dir: "v", line: 2, anchor: 1, local: 1.0, hinge: "low", side: -1 },
  ];
  state.labels = [
    { id: "l1", text: "厨房", cells: ["0,0"] },
    { id: "l2", text: "卧室", cells: ["0,1"] },
    { id: "l3", text: "客厅", cells: ["1,0", "2,0", "1,1"] },
    { id: "l4", text: "次卧", cells: ["2,1"] },
  ];
  state.nextId = 10;
  return normalize(state);
}

export function serialize(state) {
  return JSON.stringify({
    v: 1,
    xIntervals: state.xIntervals,
    yIntervals: state.yIntervals,
    hEdges: [...state.hEdges].sort(),
    vEdges: [...state.vEdges].sort(),
    windowEdges: [...state.windowEdges].sort(),
    doors: state.doors
      .map((door) => ({ ...door }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    labels: state.labels
      .map((label) => ({ ...label, cells: [...label.cells].sort() }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    nextId: state.nextId,
  });
}

export function deserialize(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const state = emptyState();
  state.xIntervals = data.xIntervals;
  state.yIntervals = data.yIntervals;
  state.hEdges = new Set(data.hEdges || []);
  state.vEdges = new Set(data.vEdges || []);
  state.windowEdges = new Set(data.windowEdges || []);
  state.doors = (data.doors || []).map((door) => ({ ...door }));
  state.labels = (data.labels || []).map((label) => ({
    ...label,
    cells: [...label.cells],
  }));
  state.nextId = data.nextId || 1;
  return normalize(state);
}

function intervalList(state, axis) {
  return axis === "x" ? state.xIntervals : state.yIntervals;
}

function parseInterval(value) {
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) return null;
  const rounded = roundMm(number);
  if (rounded < MIN_INTERVAL || rounded > MAX_INTERVAL) return null;
  return rounded;
}

export function setIntervalValue(state, axis, index, value) {
  const list = intervalList(state, axis);
  if (index < 0 || index >= list.length) return { ok: false, message: "找不到这段间隔" };
  const next = parseInterval(value);
  if (next == null) {
    return {
      ok: false,
      message: `间隔需要在 ${MIN_INTERVAL} m 到 ${MAX_INTERVAL} m 之间`,
    };
  }
  if (list[index] === next) return { ok: true, changed: false };
  list[index] = next;
  return { ok: true, changed: true };
}

export function addInterval(state, axis, value = 3) {
  const list = intervalList(state, axis);
  if (list.length >= MAX_INTERVALS) {
    return { ok: false, message: `最多 ${MAX_INTERVALS} 段间隔` };
  }
  const next = parseInterval(value);
  if (next == null) {
    return {
      ok: false,
      message: `间隔需要在 ${MIN_INTERVAL} m 到 ${MAX_INTERVAL} m 之间`,
    };
  }
  list.push(next);
  return { ok: true };
}

export function removeIntervalAt(state, axis, index) {
  const list = intervalList(state, axis);
  if (list.length <= 1) return { ok: false, message: "至少保留一段间隔" };
  if (index < 0 || index >= list.length) return { ok: false, message: "找不到这段间隔" };
  const oldPositions = prefixSums(list);
  list.splice(index, 1);
  const newPositions = prefixSums(list);
  state.hEdges = remapEdgeSet(state.hEdges, axis, index);
  state.vEdges = remapEdgeSet(state.vEdges, axis, index);
  state.windowEdges = remapEdgeSet(state.windowEdges, axis, index);
  state.doors = remapDoors(state.doors, axis, index, oldPositions, newPositions);
  state.labels = remapLabelCells(state.labels, axis, index);
  return { ok: true };
}

export function applyGridSpan(state, from, to, mode) {
  const span = gridSpan(from, to);
  if (!span.ok) {
    return {
      ok: false,
      message: span.reason === "same" ? "请点另一个交叉点" : "只能沿同一条参考线连接",
    };
  }
  const edges = span.dir === "h" ? state.hEdges : state.vEdges;
  if (mode === "erase") {
    removeSpan(edges, span.dir, span.line, span.start, span.end);
    removeSpan(state.windowEdges, span.dir, span.line, span.start, span.end);
    return { ok: true, span };
  }
  addSpan(edges, span.dir, span.line, span.start, span.end);
  return { ok: true, span };
}

export function clearDrawing(state) {
  state.hEdges = new Set();
  state.vEdges = new Set();
  state.windowEdges = new Set();
  state.doors = [];
  state.labels = [];
}

function edgesFor(state, dir) {
  return dir === "h" ? state.hEdges : state.vEdges;
}

function axisPositions(state, dir) {
  const positions = positionsOf(state);
  return dir === "h" ? positions.x : positions.y;
}

export function toggleWindow(state, run) {
  const turningOn = !runIsWindow(state.windowEdges, run);
  for (let index = run.start; index < run.end; index += 1) {
    const key = `${run.dir}:${run.line}:${index}`;
    if (turningOn) state.windowEdges.add(key);
    else state.windowEdges.delete(key);
  }
  return { ok: true, on: turningOn };
}

function defaultDoorSide(state, run) {
  const columns = state.xIntervals.length;
  const rows = state.yIntervals.length;
  if (run.dir === "h") {
    if (run.line === 0) return -1;
    if (run.line === rows) return 1;
  } else {
    if (run.line === 0) return -1;
    if (run.line === columns) return 1;
  }
  return 1;
}

export function placeDoor(state, run, centerMeter) {
  const positions = axisPositions(state, run.dir);
  const runStart = positions[run.start];
  const runEnd = positions[run.end];
  if (runEnd - runStart < DOOR_WIDTH - 1e-6) {
    return { ok: false, message: "这面墙不到 1 米，放不下一扇门" };
  }
  const requested = Math.min(
    Math.max(centerMeter - DOOR_WIDTH / 2, runStart),
    runEnd - DOOR_WIDTH,
  );
  const draft = {
    id: `d${state.nextId}`,
    dir: run.dir,
    line: run.line,
    hinge: "low",
    side: defaultDoorSide(state, run),
    ...anchorFromMeter(positions, requested),
  };
  const fitted = fitDoor(draft, edgesFor(state, run.dir), positions, state.doors);
  if (!fitted) return { ok: false, message: "这个位置放不下一扇门" };
  const fittedStart = positions[fitted.anchor] + fitted.local;
  if (Math.abs(fittedStart - requested) > 0.25) {
    return { ok: false, message: "这里与已有的门太近" };
  }
  state.nextId += 1;
  state.doors.push(fitted);
  return { ok: true, id: fitted.id };
}

export function moveDoor(state, id, startMeter) {
  const door = state.doors.find((item) => item.id === id);
  if (!door) return { ok: false, message: "找不到这扇门" };
  const positions = axisPositions(state, door.dir);
  const others = state.doors.filter((item) => item.id !== id);
  const draft = { ...door, ...anchorFromMeter(positions, startMeter) };
  const fitted = fitDoor(draft, edgesFor(state, door.dir), positions, others);
  if (!fitted) return { ok: false, message: "门不能移出这面墙" };
  Object.assign(door, fitted);
  return { ok: true };
}

export function updateDoor(state, id, patch) {
  const door = state.doors.find((item) => item.id === id);
  if (!door) return { ok: false, message: "找不到这扇门" };
  if (patch.hinge) door.hinge = patch.hinge === "high" ? "high" : "low";
  if (patch.side) door.side = patch.side < 0 ? -1 : 1;
  return { ok: true };
}

export function deleteDoor(state, id) {
  const before = state.doors.length;
  state.doors = state.doors.filter((door) => door.id !== id);
  return { ok: state.doors.length !== before };
}

export function deleteRun(state, run) {
  removeSpan(edgesFor(state, run.dir), run.dir, run.line, run.start, run.end);
  removeSpan(state.windowEdges, run.dir, run.line, run.start, run.end);
  return { ok: true };
}

export function setSpaceLabel(state, space, text) {
  const cells = space.cells.map((cell) => `${cell.c},${cell.r}`);
  const keys = new Set(cells);
  const trimmed = text.trim();
  const existing = state.labels.find((label) => label.cells.some((cell) => keys.has(cell)));
  if (!trimmed) {
    if (existing) state.labels = state.labels.filter((label) => label !== existing);
    return { ok: true };
  }
  if (existing) {
    existing.text = trimmed;
    existing.cells = cells;
    return { ok: true, id: existing.id };
  }
  const id = `l${state.nextId}`;
  state.nextId += 1;
  state.labels.push({ id, text: trimmed, cells });
  return { ok: true, id };
}

export function labelForSpace(state, space) {
  const keys = new Set(space.cells.map((cell) => `${cell.c},${cell.r}`));
  return state.labels.find((label) => label.cells.some((cell) => keys.has(cell))) || null;
}

export function runByKey(state, key) {
  return runsOf(state).find((run) => `${run.dir}:${run.line}:${run.start}:${run.end}` === key) || null;
}

export function runContaining(state, dir, line, edgeIndex) {
  return findRunContainingEdge(edgesFor(state, dir), dir, line, edgeIndex);
}
