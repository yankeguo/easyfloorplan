import type {
  Axis,
  Cell,
  Direction,
  Door,
  DoorGeometry,
  GridPoint,
  GridSpanResult,
  Label,
  Point,
  Rect,
  Run,
  Space,
} from "./types.ts";

export const WALL_THICKNESS = 120;
export const DOOR_WIDTH = 800;
export const MIN_INTERVAL = 300;
export const MAX_INTERVAL = 100000;
export const MAX_INTERVALS = 24;
export const MAX_SEQUENCES = 8;
export const MAX_SETTLED = 48;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundMm(value: number): number {
  return Math.round(value);
}

export function formatMm(value: number): string {
  return String(roundMm(value));
}

export function prefixSums(intervals: readonly number[]): number[] {
  const positions = [0];
  for (const interval of intervals) {
    positions.push(roundMm(positions[positions.length - 1] + interval));
  }
  return positions;
}

export function meterIndex(positions: readonly number[], meter: number): number {
  for (let index = 0; index < positions.length; index += 1) {
    if (Math.abs(positions[index] - meter) <= 1e-6) return index;
  }
  return -1;
}

export function mergeSequences(sequences: readonly (readonly number[])[]): number[] {
  const points = new Set([0]);
  for (const sequence of sequences) {
    let cursor = 0;
    for (const interval of sequence) {
      cursor = roundMm(cursor + interval);
      points.add(cursor);
    }
  }
  const positions = [...points].sort((a, b) => a - b);
  const intervals = [];
  for (let index = 1; index < positions.length; index += 1) {
    const gap = roundMm(positions[index] - positions[index - 1]);
    if (gap > 0) intervals.push(gap);
  }
  return intervals;
}

export function xAxisName(index: number): string {
  return String(index + 1);
}

export function yAxisName(index: number): string {
  let n = index;
  let name = "";
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

export function edgeKey(dir: Direction, line: number, index: number): string {
  return `${dir}:${line}:${index}`;
}

export function parseEdgeKey(key: string): { dir: Direction; line: number; index: number } {
  const [dir, line, index] = key.split(":");
  return { dir: dir === "v" ? "v" : "h", line: Number(line), index: Number(index) };
}

export function addSpan(set: Set<string>, dir: Direction, line: number, start: number, end: number): void {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  for (let index = from; index < to; index += 1) {
    set.add(edgeKey(dir, line, index));
  }
}

export function removeSpan(set: Set<string>, dir: Direction, line: number, start: number, end: number): void {
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  for (let index = from; index < to; index += 1) {
    set.delete(edgeKey(dir, line, index));
  }
}

export function computeRuns(edgeSet: ReadonlySet<string>, dir: Direction): Run[] {
  const grouped = new Map<number, number[]>();
  for (const key of edgeSet) {
    const edge = parseEdgeKey(key);
    if (edge.dir !== dir) continue;
    const bucket = grouped.get(edge.line);
    if (bucket) bucket.push(edge.index);
    else grouped.set(edge.line, [edge.index]);
  }
  const runs = [];
  for (const [line, indices] of grouped) {
    indices.sort((a, b) => a - b);
    let start = indices[0];
    let previous = indices[0];
    for (let cursor = 1; cursor < indices.length; cursor += 1) {
      const index = indices[cursor];
      if (index !== previous + 1) {
        runs.push({ dir, line, start, end: previous + 1 });
        start = index;
      }
      previous = index;
    }
    runs.push({ dir, line, start, end: previous + 1 });
  }
  runs.sort((a, b) => a.line - b.line || a.start - b.start);
  return runs;
}

export function runKey(run: Run): string {
  return `${run.dir}:${run.line}:${run.start}:${run.end}`;
}

export function findRunContainingEdge(
  edgeSet: ReadonlySet<string>,
  dir: Direction,
  line: number,
  edgeIndex: number,
): Run | null {
  return (
    computeRuns(edgeSet, dir).find(
      (run) => run.line === line && edgeIndex >= run.start && edgeIndex < run.end,
    ) || null
  );
}

export function gridSpan(from: GridPoint, to: GridPoint): GridSpanResult {
  if (from.xi === to.xi && from.yi === to.yi) {
    return { ok: false, reason: "same" };
  }
  if (from.yi === to.yi) {
    return {
      ok: true,
      dir: "h",
      line: from.yi,
      start: Math.min(from.xi, to.xi),
      end: Math.max(from.xi, to.xi),
    };
  }
  if (from.xi === to.xi) {
    return {
      ok: true,
      dir: "v",
      line: from.xi,
      start: Math.min(from.yi, to.yi),
      end: Math.max(from.yi, to.yi),
    };
  }
  return { ok: false, reason: "diagonal" };
}

export function computeSpaces(
  cols: number,
  rows: number,
  hEdges: ReadonlySet<string>,
  vEdges: ReadonlySet<string>,
): Space[] {
  const count = cols * rows;
  if (count <= 0) return [];
  const parent = Array.from({ length: count }, (_, index) => index);
  function find(index: number): number {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]] ?? cursor;
      cursor = parent[cursor] ?? cursor;
    }
    return cursor;
  }
  function unite(a: number, b: number): void {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pb] = pa;
  }
  const cellId = (column: number, row: number) => row * cols + column;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      if (column + 1 < cols && !vEdges.has(edgeKey("v", column + 1, row))) {
        unite(cellId(column, row), cellId(column + 1, row));
      }
      if (row + 1 < rows && !hEdges.has(edgeKey("h", row + 1, column))) {
        unite(cellId(column, row), cellId(column, row + 1));
      }
    }
  }
  const groups = new Map<number, Cell[]>();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const root = find(cellId(column, row));
      const cells = groups.get(root);
      if (cells) cells.push({ c: column, r: row });
      else groups.set(root, [{ c: column, r: row }]);
    }
  }
  const spaces = [...groups.values()].map((cells) => {
    cells.sort((a, b) => a.r - b.r || a.c - b.c);
    return {
      cells,
      key: cells.map((cell) => `${cell.c},${cell.r}`).join("|"),
    };
  });
  spaces.sort((a, b) => a.key.localeCompare(b.key, "en"));
  return spaces;
}

export function spaceIsExterior(
  space: Space,
  cols: number,
  rows: number,
  hEdges: ReadonlySet<string>,
  vEdges: ReadonlySet<string>,
): boolean {
  for (const cell of space.cells) {
    if (cell.c === 0 && !vEdges.has(edgeKey("v", 0, cell.r))) return true;
    if (cell.c === cols - 1 && !vEdges.has(edgeKey("v", cols, cell.r))) return true;
    if (cell.r === 0 && !hEdges.has(edgeKey("h", 0, cell.c))) return true;
    if (cell.r === rows - 1 && !hEdges.has(edgeKey("h", rows, cell.c))) return true;
  }
  return false;
}

export function cellInnerRect(
  column: number,
  row: number,
  xPos: readonly number[],
  yPos: readonly number[],
  hEdges: ReadonlySet<string>,
  vEdges: ReadonlySet<string>,
): Rect {
  const inset = WALL_THICKNESS / 2;
  let x0 = xPos[column];
  let x1 = xPos[column + 1];
  let y0 = yPos[row];
  let y1 = yPos[row + 1];
  if (vEdges.has(edgeKey("v", column, row))) x0 += inset;
  if (vEdges.has(edgeKey("v", column + 1, row))) x1 -= inset;
  if (hEdges.has(edgeKey("h", row, column))) y0 += inset;
  if (hEdges.has(edgeKey("h", row + 1, column))) y1 -= inset;
  if (x1 < x0) x1 = x0;
  if (y1 < y0) y1 = y0;
  return { x0, y0, x1, y1 };
}

export function spaceGrossArea(space: Space, xPos: readonly number[], yPos: readonly number[]): number {
  let area = 0;
  for (const cell of space.cells) {
    area += (xPos[cell.c + 1] - xPos[cell.c]) * (yPos[cell.r + 1] - yPos[cell.r]);
  }
  return area;
}

export function spaceNetArea(
  space: Space,
  xPos: readonly number[],
  yPos: readonly number[],
  hEdges: ReadonlySet<string>,
  vEdges: ReadonlySet<string>,
): number {
  let area = 0;
  for (const cell of space.cells) {
    const rect = cellInnerRect(cell.c, cell.r, xPos, yPos, hEdges, vEdges);
    area += Math.max(0, rect.x1 - rect.x0) * Math.max(0, rect.y1 - rect.y0);
  }
  return area;
}

export function labelAnchor(space: Space, xPos: readonly number[], yPos: readonly number[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const cell of space.cells) {
    const x0 = xPos[cell.c];
    const x1 = xPos[cell.c + 1];
    const y0 = yPos[cell.r];
    const y1 = yPos[cell.r + 1];
    const cellArea = (x1 - x0) * (y1 - y0);
    area += cellArea;
    cx += cellArea * ((x0 + x1) / 2);
    cy += cellArea * ((y0 + y1) / 2);
  }
  const centroid = { x: cx / area, y: cy / area };
  const inside = space.cells.some((cell) => {
    return (
      centroid.x >= xPos[cell.c] &&
      centroid.x < xPos[cell.c + 1] &&
      centroid.y >= yPos[cell.r] &&
      centroid.y < yPos[cell.r + 1]
    );
  });
  if (inside) return centroid;
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (const cell of space.cells) {
    const point = {
      x: (xPos[cell.c] + xPos[cell.c + 1]) / 2,
      y: (yPos[cell.r] + yPos[cell.r + 1]) / 2,
    };
    const distance = (point.x - centroid.x) ** 2 + (point.y - centroid.y) ** 2;
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best ?? centroid;
}

export function doorSpanMeters(door: Door, positions: readonly number[]): [number, number] {
  const start = positions[door.anchor] + door.local;
  return [start, start + DOOR_WIDTH];
}

export function doorGeometry(door: Door, xPos: readonly number[], yPos: readonly number[]): DoorGeometry {
  const along = door.dir === "h" ? xPos : yPos;
  const cross = door.dir === "h" ? yPos[door.line] : xPos[door.line];
  const [start, end] = doorSpanMeters(door, along);
  return { start, end, cross };
}

export function anchorFromMeter(positions: readonly number[], meter: number): { anchor: number; local: number } {
  const last = positions.length - 2;
  if (last < 0) return { anchor: 0, local: 0 };
  let anchor = 0;
  for (let index = 0; index <= last; index += 1) {
    if (positions[index] <= meter + 1e-9) anchor = index;
  }
  return { anchor, local: meter - positions[anchor] };
}

function intervalIndex(positions: readonly number[], meter: number): number {
  if (meter < positions[0] - 1e-6) return -1;
  for (let index = 0; index < positions.length - 1; index += 1) {
    if (meter < positions[index + 1] - 1e-9) return index;
  }
  return -1;
}

export function spanCovered(
  dir: Direction,
  line: number,
  start: number,
  end: number,
  edges: ReadonlySet<string>,
  positions: readonly number[],
): boolean {
  if (!(end > start + 1e-6)) return false;
  const epsilon = 1e-6;
  let cursor = start;
  let guard = 0;
  while (cursor < end - epsilon) {
    const index = intervalIndex(positions, cursor);
    if (index < 0) return false;
    if (!edges.has(edgeKey(dir, line, index))) return false;
    const next = positions[index + 1];
    if (!(next > cursor + epsilon)) return false;
    cursor = next;
    guard += 1;
    if (guard > positions.length + 2) return false;
  }
  return true;
}

function subtractGaps(gaps: [number, number][], blockStart: number, blockEnd: number): [number, number][] {
  const next: [number, number][] = [];
  for (const [start, end] of gaps) {
    if (blockEnd <= start || blockStart >= end) {
      next.push([start, end]);
      continue;
    }
    if (blockStart > start) next.push([start, Math.min(blockStart, end)]);
    if (blockEnd < end) next.push([Math.max(blockEnd, start), end]);
  }
  return next.filter(([start, end]) => end - start >= -1e-9);
}

function slideToFree(
  meter: number,
  minStart: number,
  maxStart: number,
  others: readonly Door[],
  door: Door,
  positions: readonly number[],
): number | null {
  let gaps: [number, number][] = [[minStart, maxStart]];
  for (const other of others) {
    if (other.id === door.id || other.dir !== door.dir || other.line !== door.line) continue;
    const otherStart = positions[other.anchor] + other.local;
    gaps = subtractGaps(
      gaps,
      otherStart - DOOR_WIDTH + 0.1,
      otherStart + DOOR_WIDTH - 0.1,
    );
  }
  if (gaps.length === 0) return null;
  for (const [start, end] of gaps) {
    if (meter >= start - 1e-6 && meter <= end + 1e-6) return clamp(meter, start, end);
  }
  let best = null;
  let bestDistance = Infinity;
  for (const [start, end] of gaps) {
    const candidate = clamp(meter, start, end);
    const distance = Math.abs(candidate - meter);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function fitDoor(
  door: Door,
  edges: ReadonlySet<string>,
  positions: readonly number[],
  others: readonly Door[],
): Door | null {
  const bayCount = positions.length - 1;
  if (bayCount <= 0) return null;
  if (door.anchor < 0 || door.anchor >= bayCount) return null;
  if (!edges.has(edgeKey(door.dir, door.line, door.anchor))) return null;
  const run = findRunContainingEdge(edges, door.dir, door.line, door.anchor);
  if (!run) return null;
  const runStart = positions[run.start];
  const runEnd = positions[run.end];
  const maxStart = runEnd - DOOR_WIDTH;
  if (maxStart < runStart - 1e-9) return null;
  const bayLength = positions[door.anchor + 1] - positions[door.anchor];
  let local = Number.isFinite(door.local) ? door.local : 0;
  local = clamp(local, 0, bayLength);
  let meter: number | null = clamp(positions[door.anchor] + local, runStart, maxStart);
  meter = slideToFree(meter, runStart, maxStart, others, door, positions);
  if (meter == null) return null;
  if (!spanCovered(door.dir, door.line, meter, meter + DOOR_WIDTH, edges, positions)) {
    return null;
  }
  const anchored = anchorFromMeter(positions, meter);
  return {
    ...door,
    anchor: anchored.anchor,
    local: anchored.local,
  };
}

export function normalizeDoors(
  doors: readonly Door[],
  hEdges: ReadonlySet<string>,
  vEdges: ReadonlySet<string>,
  xPos: readonly number[],
  yPos: readonly number[],
): Door[] {
  const kept = [];
  for (const door of doors) {
    const positions = door.dir === "h" ? xPos : yPos;
    const edges = door.dir === "h" ? hEdges : vEdges;
    const fitted = fitDoor(door, edges, positions, kept);
    if (fitted) kept.push(fitted);
  }
  return kept;
}

export function runIsWindow(windowEdges: ReadonlySet<string>, run: Run): boolean {
  if (run.end <= run.start) return false;
  for (let index = run.start; index < run.end; index += 1) {
    if (!windowEdges.has(edgeKey(run.dir, run.line, index))) return false;
  }
  return true;
}

export function rebindLabels(labels: readonly Label[], spaces: readonly Space[]): Label[] {
  const pools = labels
    .filter((label) => label.text && label.text.trim())
    .map((label) => ({ ...label, text: label.text.trim(), cells: [...label.cells] }));
  const used = new Set<string>();
  const rebound = [];
  for (const space of spaces) {
    const keys = new Set(space.cells.map((cell) => `${cell.c},${cell.r}`));
    let best = null;
    let bestScore = 0;
    for (const label of pools) {
      if (used.has(label.id)) continue;
      let score = 0;
      for (const cell of label.cells) {
        if (keys.has(cell)) score += 1;
      }
      if (score > bestScore) {
        best = label;
        bestScore = score;
      }
    }
    if (!best) continue;
    used.add(best.id);
    rebound.push({ id: best.id, text: best.text, cells: [...keys] });
  }
  return rebound;
}

function remapEdgeKey(key: string, axis: Axis, index: number): string | null {
  const edge = parseEdgeKey(key);
  if (axis === "x") {
    if (edge.dir === "h") {
      if (edge.index === index) return null;
      if (edge.index > index) return edgeKey(edge.dir, edge.line, edge.index - 1);
      return key;
    }
    if (edge.line === index + 1) return null;
    if (edge.line > index + 1) return edgeKey(edge.dir, edge.line - 1, edge.index);
    return key;
  }
  if (edge.dir === "v") {
    if (edge.index === index) return null;
    if (edge.index > index) return edgeKey(edge.dir, edge.line, edge.index - 1);
    return key;
  }
  if (edge.line === index + 1) return null;
  if (edge.line > index + 1) return edgeKey(edge.dir, edge.line - 1, edge.index);
  return key;
}

export function remapEdgeSet(edgeSet: ReadonlySet<string>, axis: Axis, index: number): Set<string> {
  const next = new Set<string>();
  for (const key of edgeSet) {
    const mapped = remapEdgeKey(key, axis, index);
    if (mapped) next.add(mapped);
  }
  return next;
}

export function remapDoors(
  doors: readonly Door[],
  axis: Axis,
  index: number,
  oldPositions: readonly number[],
  newPositions: readonly number[],
): Door[] {
  const removedStart = oldPositions[index] ?? 0;
  const removedEnd = oldPositions[index + 1];
  const removedLength = removedEnd - removedStart;
  const next: Door[] = [];
  for (const door of doors) {
    const alongAxis = door.dir === "h" ? "x" : "y";
    if (alongAxis !== axis) {
      if (door.line === index + 1) continue;
      if (door.line > index + 1) next.push({ ...door, line: door.line - 1 });
      else next.push({ ...door });
      continue;
    }
    const meter = oldPositions[door.anchor] + door.local;
    const end = meter + DOOR_WIDTH;
    if (end > removedStart + 1e-6 && meter < removedEnd - 1e-6) continue;
    const shifted = meter >= removedEnd - 1e-6 ? meter - removedLength : meter;
    next.push({ ...door, ...anchorFromMeter(newPositions, shifted) });
  }
  return next;
}

export function remapLabelCells(labels: readonly Label[], axis: Axis, index: number): Label[] {
  const next: Label[] = [];
  for (const label of labels) {
    const cells: string[] = [];
    for (const key of label.cells) {
      let [column, row] = key.split(",").map(Number);
      if (axis === "x") {
        if (column === index) continue;
        if (column > index) column -= 1;
      } else {
        if (row === index) continue;
        if (row > index) row -= 1;
      }
      cells.push(`${column},${row}`);
    }
    if (cells.length > 0) next.push({ ...label, cells });
  }
  return next;
}
