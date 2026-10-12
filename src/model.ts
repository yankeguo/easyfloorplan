import {
  DOOR_WIDTH,
  MAX_INTERVAL,
  MAX_INTERVALS,
  MAX_SEQUENCES,
  MAX_SETTLED,
  MIN_INTERVAL,
  addSpan,
  anchorFromMeter,
  computeRuns,
  computeSpaces,
  edgeKey,
  findRunContainingEdge,
  fitDoor,
  gridSpan,
  mergeSequences,
  meterIndex,
  normalizeDoors,
  prefixSums,
  rebindLabels,
  remapDoors,
  remapEdgeSet,
  remapLabelCells,
  removeSpan,
  roundMm,
} from "./geometry.ts";
import type { ActionResult, Axis, Door, GridPoint, Label, PlanState, Run, Space } from "./types.ts";

export function emptyState(): PlanState {
  return {
    xIntervals: [4200, 3600],
    yIntervals: [3600, 3000],
    hEdges: new Set(),
    vEdges: new Set(),
    windowEdges: new Set(),
    doors: [],
    labels: [],
    nextId: 1,
  };
}

export function positionsOf(state: PlanState): { x: number[]; y: number[] } {
  return {
    x: prefixSums(state.xIntervals),
    y: prefixSums(state.yIntervals),
  };
}

export function spacesOf(state: PlanState): Space[] {
  return computeSpaces(
    state.xIntervals.length,
    state.yIntervals.length,
    state.hEdges,
    state.vEdges,
  );
}

export function runsOf(state: PlanState): Run[] {
  return [...computeRuns(state.hEdges, "h"), ...computeRuns(state.vEdges, "v")];
}

export function normalize(state: PlanState): PlanState {
  if (state.xIntervals.length < 1) state.xIntervals = [3000];
  if (state.yIntervals.length < 1) state.yIntervals = [3000];
  state.xIntervals = state.xIntervals.map((value) => roundMm(value));
  state.yIntervals = state.yIntervals.map((value) => roundMm(value));
  state.doors = state.doors.map((door) => ({ ...door, local: roundMm(door.local) }));
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

export function createSample(): PlanState {
  const state = emptyState();
  state.xIntervals = [3900, 3300, 2700];
  state.yIntervals = [4800, 3000];
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
    { id: "d1", dir: "v", line: 1, anchor: 0, local: 1700, hinge: "low", side: 1 },
    { id: "d2", dir: "v", line: 1, anchor: 1, local: 900, hinge: "low", side: 1 },
    { id: "d3", dir: "h", line: 1, anchor: 0, local: 1300, hinge: "low", side: -1 },
    { id: "d4", dir: "v", line: 2, anchor: 1, local: 1000, hinge: "low", side: -1 },
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

export function serialize(state: PlanState): string {
  return JSON.stringify({
    v: 2,
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

function lengthsFromSave(values: unknown, legacy: boolean): number[] {
  return (Array.isArray(values) ? values : []).map((value) => {
    const number = Number(value);
    return legacy ? Math.round(number * 1000) : number;
  });
}

export function deserialize(raw: string | SavedPlan): PlanState {
  const data = typeof raw === "string" ? (JSON.parse(raw) as SavedPlan) : raw;
  const legacy = !(Number(data.v) >= 2);
  const state = emptyState();
  state.xIntervals = lengthsFromSave(data.xIntervals, legacy);
  state.yIntervals = lengthsFromSave(data.yIntervals, legacy);
  state.hEdges = new Set(data.hEdges || []);
  state.vEdges = new Set(data.vEdges || []);
  state.windowEdges = new Set(data.windowEdges || []);
  state.doors = (data.doors || []).map((door) => ({
    ...door,
    local: legacy ? Math.round(Number(door.local) * 1000) : Number(door.local),
  })) as Door[];
  state.labels = (data.labels || []).map((label) => ({
    ...label,
    cells: [...label.cells],
  }));
  state.nextId = data.nextId || 1;
  return normalize(state);
}

interface SavedDoor {
  id: string;
  dir: string;
  line: number;
  anchor: number;
  local: number;
  hinge: string;
  side: number;
}

interface SavedPlan {
  v?: number;
  xIntervals?: unknown;
  yIntervals?: unknown;
  hEdges?: string[];
  vEdges?: string[];
  windowEdges?: string[];
  doors?: SavedDoor[];
  labels?: Label[];
  nextId?: number;
}

function intervalList(state: PlanState, axis: Axis): number[] {
  return axis === "x" ? state.xIntervals : state.yIntervals;
}

function parseInterval(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) return null;
  const rounded = roundMm(number);
  if (rounded < MIN_INTERVAL || rounded > MAX_INTERVAL) return null;
  return rounded;
}

export function setIntervalValue(state: PlanState, axis: Axis, index: number, value: unknown): ActionResult {
  const list = intervalList(state, axis);
  if (index < 0 || index >= list.length) return { ok: false, message: "找不到这段间隔" };
  const next = parseInterval(value);
  if (next == null) {
    return {
      ok: false,
      message: `间隔需要在 ${MIN_INTERVAL} mm 到 ${MAX_INTERVAL} mm 之间`,
    };
  }
  if (list[index] === next) return { ok: true, changed: false };
  list[index] = next;
  return { ok: true, changed: true };
}

export function addInterval(state: PlanState, axis: Axis, value: unknown = 3000): ActionResult {
  const list = intervalList(state, axis);
  if (list.length >= MAX_INTERVALS) {
    return { ok: false, message: `最多 ${MAX_INTERVALS} 段间隔` };
  }
  const next = parseInterval(value);
  if (next == null) {
    return {
      ok: false,
      message: `间隔需要在 ${MIN_INTERVAL} mm 到 ${MAX_INTERVAL} mm 之间`,
    };
  }
  list.push(next);
  return { ok: true };
}

export function reorderInterval(state: PlanState, axis: Axis, from: number, to: number): ActionResult {
  const list = intervalList(state, axis);
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return { ok: false, message: "找不到这段间隔" };
  }
  if (from === to) return { ok: true, changed: false };
  const [value] = list.splice(from, 1);
  if (value === undefined) return { ok: false, message: "找不到这段间隔" };
  list.splice(to, 0, value);
  return { ok: true, changed: true };
}

export function settleSequences(state: PlanState, axis: Axis, sequences: unknown): ActionResult {
  if (!Array.isArray(sequences) || sequences.length < 1 || sequences.length > MAX_SEQUENCES) {
    return { ok: false, message: `序列数量需要在 1 到 ${MAX_SEQUENCES} 之间` };
  }
  const cleaned: number[][] = [];
  for (const sequence of sequences) {
    if (!Array.isArray(sequence) || sequence.length < 1 || sequence.length > MAX_INTERVALS) {
      return { ok: false, message: `每条序列需要 1 到 ${MAX_INTERVALS} 段间隔` };
    }
    const values: number[] = [];
    for (const value of sequence) {
      const next = parseInterval(value);
      if (next == null) {
        return {
          ok: false,
          message: `间隔需要在 ${MIN_INTERVAL} mm 到 ${MAX_INTERVAL} mm 之间`,
        };
      }
      values.push(next);
    }
    cleaned.push(values);
  }
  const intervals = mergeSequences(cleaned);
  if (intervals.length > MAX_SETTLED) {
    return { ok: false, message: `交叉后有 ${intervals.length} 段，超过 ${MAX_SETTLED} 段` };
  }
  const list = intervalList(state, axis);
  if (list.length === intervals.length && intervals.every((value, index) => value === list[index])) {
    return { ok: true, changed: false, intervals };
  }
  const oldX = prefixSums(state.xIntervals);
  const oldY = prefixSums(state.yIntervals);
  list.splice(0, list.length, ...intervals);
  const { x: newX, y: newY } = positionsOf(state);
  state.hEdges = retargetEdges(state.hEdges, oldX, oldY, newX, newY);
  state.vEdges = retargetEdges(state.vEdges, oldX, oldY, newX, newY);
  state.windowEdges = retargetEdges(state.windowEdges, oldX, oldY, newX, newY);
  state.doors = retargetDoors(state.doors, oldX, oldY, newX, newY);
  state.labels = retargetLabelCells(state.labels, oldX, oldY, newX, newY);
  return { ok: true, changed: true, intervals };
}

function retargetEdges(
  edges: ReadonlySet<string>,
  oldX: readonly number[],
  oldY: readonly number[],
  newX: readonly number[],
  newY: readonly number[],
): Set<string> {
  const next = new Set<string>();
  for (const dir of ["h", "v"] as const) {
    const oldAlong = dir === "h" ? oldX : oldY;
    const oldCross = dir === "h" ? oldY : oldX;
    const newAlong = dir === "h" ? newX : newY;
    const newCross = dir === "h" ? newY : newX;
    for (const run of computeRuns(edges, dir)) {
      if (run.line < 0 || run.line >= oldCross.length) continue;
      const newLine = meterIndex(newCross, oldCross[run.line]);
      if (newLine < 0) continue;
      const start = oldAlong[run.start];
      const end = oldAlong[run.end];
      for (let index = 0; index < newAlong.length - 1; index += 1) {
        const mid = (newAlong[index] + newAlong[index + 1]) / 2;
        if (mid > start + 1e-6 && mid < end - 1e-6) next.add(edgeKey(dir, newLine, index));
      }
    }
  }
  return next;
}

function retargetDoors(
  doors: readonly Door[],
  oldX: readonly number[],
  oldY: readonly number[],
  newX: readonly number[],
  newY: readonly number[],
): Door[] {
  const next: Door[] = [];
  for (const door of doors) {
    const oldAlong = door.dir === "h" ? oldX : oldY;
    const oldCross = door.dir === "h" ? oldY : oldX;
    const newAlong = door.dir === "h" ? newX : newY;
    const newCross = door.dir === "h" ? newY : newX;
    if (door.line < 0 || door.line >= oldCross.length) continue;
    const newLine = meterIndex(newCross, oldCross[door.line]);
    if (newLine < 0) continue;
    const meter = oldAlong[door.anchor] + door.local;
    if (meter < -1e-6 || meter > newAlong[newAlong.length - 1] + 1e-6) continue;
    next.push({ ...door, line: newLine, ...anchorFromMeter(newAlong, meter) });
  }
  return next;
}

function retargetLabelCells(
  labels: readonly Label[],
  oldX: readonly number[],
  oldY: readonly number[],
  newX: readonly number[],
  newY: readonly number[],
): Label[] {
  const next: Label[] = [];
  for (const label of labels) {
    const cells = new Set<string>();
    for (const key of label.cells) {
      const [column, row] = key.split(",").map(Number);
      if (column < 0 || row < 0 || column + 1 >= oldX.length || row + 1 >= oldY.length) continue;
      const x0 = oldX[column];
      const x1 = oldX[column + 1];
      const y0 = oldY[row];
      const y1 = oldY[row + 1];
      for (let nextColumn = 0; nextColumn < newX.length - 1; nextColumn += 1) {
        const midX = (newX[nextColumn] + newX[nextColumn + 1]) / 2;
        if (midX <= x0 + 1e-6 || midX >= x1 - 1e-6) continue;
        for (let nextRow = 0; nextRow < newY.length - 1; nextRow += 1) {
          const midY = (newY[nextRow] + newY[nextRow + 1]) / 2;
          if (midY <= y0 + 1e-6 || midY >= y1 - 1e-6) continue;
          cells.add(`${nextColumn},${nextRow}`);
        }
      }
    }
    if (cells.size > 0) next.push({ ...label, cells: [...cells] });
  }
  return next;
}

export function removeIntervalAt(state: PlanState, axis: Axis, index: number): ActionResult {
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

export function applyGridSpan(
  state: PlanState,
  from: GridPoint,
  to: GridPoint,
  mode: "add" | "erase",
): ActionResult {
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

export function clearDrawing(state: PlanState): void {
  state.hEdges = new Set();
  state.vEdges = new Set();
  state.windowEdges = new Set();
  state.doors = [];
  state.labels = [];
}

function edgesFor(state: PlanState, dir: Run["dir"]): Set<string> {
  return dir === "h" ? state.hEdges : state.vEdges;
}

function axisPositions(state: PlanState, dir: Run["dir"]): number[] {
  const positions = positionsOf(state);
  return dir === "h" ? positions.x : positions.y;
}

export function toggleWindow(state: PlanState, dir: Run["dir"], line: number, index: number): ActionResult {
  const key = edgeKey(dir, line, index);
  if (!edgesFor(state, dir).has(key)) return { ok: false, message: "这里没有墙" };
  const turningOn = !state.windowEdges.has(key);
  if (turningOn) state.windowEdges.add(key);
  else state.windowEdges.delete(key);
  return { ok: true, on: turningOn };
}

function defaultDoorSide(state: PlanState, run: Run): 1 | -1 {
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

export function placeDoor(state: PlanState, run: Run, centerMeter: number): ActionResult {
  const positions = axisPositions(state, run.dir);
  const runStart = positions[run.start];
  const runEnd = positions[run.end];
  if (runEnd - runStart < DOOR_WIDTH - 1e-6) {
    return { ok: false, message: `这面墙不到 ${DOOR_WIDTH} mm，放不下一扇门` };
  }
  const requested = Math.min(
    Math.max(centerMeter - DOOR_WIDTH / 2, runStart),
    runEnd - DOOR_WIDTH,
  );
  const draft: Door = {
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
  if (Math.abs(fittedStart - requested) > 250) {
    return { ok: false, message: "这里与已有的门太近" };
  }
  state.nextId += 1;
  state.doors.push(fitted);
  return { ok: true, id: fitted.id };
}

export function moveDoor(state: PlanState, id: string, startMeter: number): ActionResult {
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

export function deleteDoor(state: PlanState, id: string): ActionResult {
  const before = state.doors.length;
  state.doors = state.doors.filter((door) => door.id !== id);
  return { ok: state.doors.length !== before };
}

export function deleteRun(state: PlanState, run: Run): ActionResult {
  removeSpan(edgesFor(state, run.dir), run.dir, run.line, run.start, run.end);
  removeSpan(state.windowEdges, run.dir, run.line, run.start, run.end);
  return { ok: true };
}

export function setSpaceLabel(state: PlanState, space: Space, text: string): ActionResult {
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

export function labelForSpace(state: PlanState, space: Space): Label | null {
  const keys = new Set(space.cells.map((cell) => `${cell.c},${cell.r}`));
  return state.labels.find((label) => label.cells.some((cell) => keys.has(cell))) || null;
}

export function runByKey(state: PlanState, key: string): Run | null {
  return runsOf(state).find((run) => `${run.dir}:${run.line}:${run.start}:${run.end}` === key) || null;
}

export function runContaining(state: PlanState, dir: Run["dir"], line: number, edgeIndex: number): Run | null {
  return findRunContainingEdge(edgesFor(state, dir), dir, line, edgeIndex);
}
