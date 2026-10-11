import {
  DOOR_WIDTH,
  WALL_THICKNESS,
  cellInnerRect,
  doorGeometry,
  doorSpanMeters,
  formatMm,
  labelAnchor,
  runIsWindow,
  runKey,
  xAxisName,
  yAxisName,
} from "./geometry.ts";
import type { Direction, Door, HitDoor, HitPoint, HitWall, PlanState, Preview, Run, Scene, Space, View } from "./types.ts";
import { labelForSpace, positionsOf, runsOf, spacesOf } from "./model.ts";
import { screenToWorld, worldToScreen } from "./view.ts";

const PAPER = "#f3efe6";
const INK = "#241f1b";
const TEAL = "#0f6e6b";
const WINDOW = "#1d4e89";
const MUTED = "#8a8178";
const SANS = '"Avenir Next", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif';
const SPACE_FILLS = ["#e3eee7", "#f4eadc", "#e3ebf4", "#f6e4de", "#ece6f4", "#e5f0ea"];

function fillWorldRect(
  ctx: CanvasRenderingContext2D,
  view: View,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  bleedPx = 0,
): void {
  const bleed = bleedPx / view.ppm;
  const left = x - bleed;
  const bottom = y - bleed;
  const worldWidth = width + bleed * 2;
  const worldHeight = height + bleed * 2;
  const origin = worldToScreen(left, bottom + worldHeight, view);
  ctx.fillStyle = color;
  ctx.fillRect(origin.x, origin.y, worldWidth * view.ppm, worldHeight * view.ppm);
}

function fillBand(
  ctx: CanvasRenderingContext2D,
  view: View,
  dir: Direction,
  cross: number,
  start: number,
  end: number,
  thickness: number,
  color: string,
  bleedPx = 0.4,
): void {
  const half = thickness / 2;
  const from = Math.min(start, end);
  const length = Math.abs(end - start);
  if (length <= 0) return;
  if (dir === "h") fillWorldRect(ctx, view, from, cross - half, length, thickness, color, bleedPx);
  else fillWorldRect(ctx, view, cross - half, from, thickness, length, color, bleedPx);
}

function solidPieces(run: Run, doors: readonly Door[], positions: readonly number[]): [number, number][] {
  const start = positions[run.start];
  const end = positions[run.end];
  const cuts = doors
    .filter((door) => door.dir === run.dir && door.line === run.line)
    .map((door) => doorSpanMeters(door, positions))
    .filter(([from, to]) => to > start + 1e-6 && from < end - 1e-6)
    .map(([from, to]) => [Math.max(from, start), Math.min(to, end)])
    .sort((a, b) => a[0] - b[0]);
  const pieces: [number, number][] = [];
  let cursor = start;
  for (const [from, to] of cuts) {
    if (from > cursor + 1e-6) pieces.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (end > cursor + 1e-6) pieces.push([cursor, end]);
  return pieces;
}

function exteriorSide(run: Run, columns: number, rows: number): 1 | -1 {
  if (run.dir === "h") {
    if (run.line === 0) return 1;
    if (run.line === rows) return -1;
    return 1;
  }
  if (run.line === 0) return 1;
  if (run.line === columns) return -1;
  return 1;
}

function chipText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  angle = 0,
  color = "#4d453e",
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `12px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(text).width + 10;
  ctx.fillStyle = PAPER;
  ctx.fillRect(-width / 2, -8, width, 16);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0.5);
  ctx.restore();
}

function drawDimensions(ctx: CanvasRenderingContext2D, view: View, xPos: readonly number[], yPos: readonly number[]): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = MUTED;
  ctx.fillStyle = MUTED;
  ctx.font = `12px ${SANS}`;
  const planBottom = worldToScreen(0, yPos[0], view).y;
  const planRight = worldToScreen(xPos[xPos.length - 1], 0, view).x;
  const rowY = planBottom + 28;
  const totalY = planBottom + 52;
  const rowX = planRight + 30;
  const totalX = planRight + 56;

  function hChain(y: number, from: number, to: number, label: string): void {
    const a = worldToScreen(from, 0, view).x;
    const b = worldToScreen(to, 0, view).x;
    ctx.beginPath();
    ctx.moveTo(a, planBottom + 8);
    ctx.lineTo(a, y + 5);
    ctx.moveTo(b, planBottom + 8);
    ctx.lineTo(b, y + 5);
    ctx.moveTo(a, y);
    ctx.lineTo(b, y);
    ctx.moveTo(a, y - 4);
    ctx.lineTo(a, y + 4);
    ctx.moveTo(b, y - 4);
    ctx.lineTo(b, y + 4);
    ctx.stroke();
    if (Math.abs(b - a) >= 36) chipText(ctx, label, (a + b) / 2, y);
  }

  function vChain(x: number, from: number, to: number, label: string): void {
    const a = worldToScreen(0, from, view).y;
    const b = worldToScreen(0, to, view).y;
    ctx.beginPath();
    ctx.moveTo(planRight + 8, a);
    ctx.lineTo(x + 5, a);
    ctx.moveTo(planRight + 8, b);
    ctx.lineTo(x + 5, b);
    ctx.moveTo(x, a);
    ctx.lineTo(x, b);
    ctx.moveTo(x - 4, a);
    ctx.lineTo(x + 4, a);
    ctx.moveTo(x - 4, b);
    ctx.lineTo(x + 4, b);
    ctx.stroke();
    if (Math.abs(b - a) >= 36) chipText(ctx, label, x, (a + b) / 2, -Math.PI / 2);
  }

  for (let index = 0; index < xPos.length - 1; index += 1) {
    hChain(rowY, xPos[index], xPos[index + 1], `${formatMm(xPos[index + 1] - xPos[index])} mm`);
  }
  for (let index = 0; index < yPos.length - 1; index += 1) {
    vChain(rowX, yPos[index], yPos[index + 1], `${formatMm(yPos[index + 1] - yPos[index])} mm`);
  }
  if (xPos.length > 2) hChain(totalY, xPos[0], xPos[xPos.length - 1], `${formatMm(xPos[xPos.length - 1])} mm`);
  if (yPos.length > 2) vChain(totalX, yPos[0], yPos[yPos.length - 1], `${formatMm(yPos[yPos.length - 1])} mm`);
  ctx.restore();
}

function drawReferenceLines(ctx: CanvasRenderingContext2D, view: View, xPos: readonly number[], yPos: readonly number[]): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(120, 106, 92, 0.55)";
  ctx.setLineDash([4, 5]);
  const extend = 16;
  for (let index = 0; index < xPos.length; index += 1) {
    const top = worldToScreen(xPos[index], yPos[yPos.length - 1], view);
    const bottom = worldToScreen(xPos[index], yPos[0], view);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y - extend);
    ctx.lineTo(bottom.x, bottom.y + extend);
    ctx.stroke();
  }
  for (let index = 0; index < yPos.length; index += 1) {
    const left = worldToScreen(xPos[0], yPos[index], view);
    const right = worldToScreen(xPos[xPos.length - 1], yPos[index], view);
    ctx.beginPath();
    ctx.moveTo(left.x - extend, left.y);
    ctx.lineTo(right.x + extend, right.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = `600 11px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let lastBubble = -Infinity;
  for (let index = 0; index < xPos.length; index += 1) {
    const top = worldToScreen(xPos[index], yPos[yPos.length - 1], view);
    if (top.x - lastBubble < 22 && index !== xPos.length - 1) continue;
    drawBubble(ctx, top.x, top.y - 34, xAxisName(index));
    lastBubble = top.x;
  }
  lastBubble = Infinity;
  for (let index = 0; index < yPos.length; index += 1) {
    const left = worldToScreen(xPos[0], yPos[index], view);
    if (lastBubble - left.y < 22 && index !== yPos.length - 1) continue;
    drawBubble(ctx, left.x - 34, left.y, yAxisName(index));
    lastBubble = left.y;
  }
  ctx.restore();
}

function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fillStyle = "#f7f4ee";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#8d847a";
  ctx.stroke();
  ctx.fillStyle = "#3f3832";
  ctx.fillText(text, x, y + 0.5);
}

function drawJoints(
  ctx: CanvasRenderingContext2D,
  view: View,
  state: PlanState,
  xPos: readonly number[],
  yPos: readonly number[],
  color: string,
  extra = 0,
): void {
  const half = (WALL_THICKNESS + extra) / 2;
  for (let xi = 0; xi < xPos.length; xi += 1) {
    for (let yi = 0; yi < yPos.length; yi += 1) {
      const horizontal =
        state.hEdges.has(`h:${yi}:${xi - 1}`) || state.hEdges.has(`h:${yi}:${xi}`);
      const vertical =
        state.vEdges.has(`v:${xi}:${yi - 1}`) || state.vEdges.has(`v:${xi}:${yi}`);
      if (!horizontal || !vertical) continue;
      if (
        nearDoor(state.doors, "h", yi, xPos[xi], xPos) ||
        nearDoor(state.doors, "v", xi, yPos[yi], yPos)
      ) {
        continue;
      }
      fillWorldRect(
        ctx,
        view,
        xPos[xi] - half,
        yPos[yi] - half,
        WALL_THICKNESS + extra,
        WALL_THICKNESS + extra,
        color,
        0.6,
      );
    }
  }
}

function nearDoor(
  doors: readonly Door[],
  dir: Direction,
  line: number,
  meter: number,
  positions: readonly number[],
): boolean {
  const reach = WALL_THICKNESS / 2;
  for (const door of doors) {
    if (door.dir !== dir || door.line !== line) continue;
    const [start, end] = doorSpanMeters(door, positions);
    if (meter > start - reach - 0.1 && meter < end + reach + 0.1) return true;
  }
  return false;
}

function drawWindows(
  ctx: CanvasRenderingContext2D,
  view: View,
  state: PlanState,
  xPos: readonly number[],
  yPos: readonly number[],
): void {
  const columns = state.xIntervals.length;
  const rows = state.yIntervals.length;
  for (const run of runsOf(state)) {
    if (!runIsWindow(state.windowEdges, run)) continue;
    const positions = run.dir === "h" ? xPos : yPos;
    const cross = run.dir === "h" ? yPos[run.line] : xPos[run.line];
    const pieces = solidPieces(run, state.doors, positions);
    let best = null;
    for (const piece of pieces) {
      if (!best || piece[1] - piece[0] > best[1] - best[0]) best = piece;
    }
    if (!best) continue;
    const length = best[1] - best[0];
    const symbol = Math.min(1600, length - 240);
    const mid = (best[0] + best[1]) / 2;
    if (symbol >= 360) {
      const from = mid - symbol / 2;
      const to = mid + symbol / 2;
      fillBand(ctx, view, run.dir, cross, from, to, 50, "#f7f4ee", 0);
      ctx.save();
      ctx.strokeStyle = WINDOW;
      ctx.lineWidth = Math.max(1, view.ppm * 12);
      const inset = Math.min(60, symbol * 0.08);
      for (const offset of [-18, 18]) {
        const p0 =
          run.dir === "h"
            ? worldToScreen(from + inset, cross + offset, view)
            : worldToScreen(cross + offset, from + inset, view);
        const p1 =
          run.dir === "h"
            ? worldToScreen(to - inset, cross + offset, view)
            : worldToScreen(cross + offset, to - inset, view);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      ctx.restore();
    }
    const side = exteriorSide(run, columns, rows);
    const offset = WALL_THICKNESS / 2 + 280;
    const point =
      run.dir === "h"
        ? worldToScreen(mid, cross + side * offset, view)
        : worldToScreen(cross + side * offset, mid, view);
    chipText(ctx, "窗", point.x, point.y, 0, WINDOW);
  }
}

function drawDoorSymbol(
  ctx: CanvasRenderingContext2D,
  view: View,
  door: Door,
  xPos: readonly number[],
  yPos: readonly number[],
  selected: boolean,
): void {
  const geometry = doorGeometry(door, xPos, yPos);
  const half = WALL_THICKNESS / 2;
  if (door.dir === "h") {
    fillWorldRect(ctx, view, geometry.start, geometry.cross - half, DOOR_WIDTH, WALL_THICKNESS, PAPER, 0);
  } else {
    fillWorldRect(ctx, view, geometry.cross - half, geometry.start, WALL_THICKNESS, DOOR_WIDTH, PAPER, 0);
  }
  const hinge = worldToScreen(geometry.hinge.x, geometry.hinge.y, view);
  const leaf = worldToScreen(geometry.leaf.x, geometry.leaf.y, view);
  const closed = worldToScreen(geometry.closed.x, geometry.closed.y, view);
  ctx.save();
  ctx.strokeStyle = selected ? TEAL : INK;
  ctx.lineWidth = selected ? 1.8 : 1.25;
  ctx.beginPath();
  ctx.moveTo(hinge.x, hinge.y);
  ctx.lineTo(leaf.x, leaf.y);
  ctx.stroke();
  const startAngle = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
  const endAngle = Math.atan2(leaf.y - hinge.y, leaf.x - hinge.x);
  let delta = endAngle - startAngle;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  ctx.beginPath();
  ctx.arc(hinge.x, hinge.y, DOOR_WIDTH * view.ppm, startAngle, endAngle, delta < 0);
  ctx.stroke();
  ctx.restore();
}

function drawLabels(
  ctx: CanvasRenderingContext2D,
  view: View,
  state: PlanState,
  spaces: readonly Space[],
  xPos: readonly number[],
  yPos: readonly number[],
): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const space of spaces) {
    const label = labelForSpace(state, space);
    if (!label) continue;
    const anchor = labelAnchor(space, xPos, yPos);
    const point = worldToScreen(anchor.x, anchor.y, view);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of space.cells) {
      const top = worldToScreen(xPos[cell.c], yPos[cell.r + 1], view);
      const bottom = worldToScreen(xPos[cell.c + 1], yPos[cell.r], view);
      minX = Math.min(minX, top.x, bottom.x);
      maxX = Math.max(maxX, top.x, bottom.x);
      minY = Math.min(minY, top.y, bottom.y);
      maxY = Math.max(maxY, top.y, bottom.y);
    }
    if (maxX - minX < 28 || maxY - minY < 16) continue;
    ctx.font = `600 15px ${SANS}`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(243, 239, 230, 0.92)";
    ctx.strokeText(label.text, point.x, point.y);
    ctx.fillStyle = INK;
    ctx.fillText(label.text, point.x, point.y);
  }
  ctx.restore();
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  view: View,
  xPos: readonly number[],
  yPos: readonly number[],
  scene: Scene,
): void {
  const { tool, anchor, hoverPoint } = scene;
  const active = tool === "wall" || tool === "erase";
  for (let xi = 0; xi < xPos.length; xi += 1) {
    for (let yi = 0; yi < yPos.length; yi += 1) {
      const point = worldToScreen(xPos[xi], yPos[yi], view);
      const isAnchor = anchor && anchor.xi === xi && anchor.yi === yi;
      const isHover = hoverPoint && hoverPoint.xi === xi && hoverPoint.yi === yi;
      const aligned =
        active && anchor && (anchor.xi === xi || anchor.yi === yi) && !isAnchor;
      const radius = isAnchor ? 6 : isHover && active ? 5 : aligned ? 4 : active ? 3.2 : 2.3;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 1.6, 0, Math.PI * 2);
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isAnchor || isHover ? TEAL : aligned ? TEAL : "#9a9188";
      ctx.fill();
    }
  }
}

function drawPreview(
  ctx: CanvasRenderingContext2D,
  view: View,
  preview: Preview | null,
  xPos: readonly number[],
  yPos: readonly number[],
): void {
  if (!preview) return;
  const positions = preview.dir === "h" ? xPos : yPos;
  const cross = preview.dir === "h" ? yPos[preview.line] : xPos[preview.line];
  const color = preview.mode === "erase" ? "rgba(176, 58, 42, 0.45)" : "rgba(15, 110, 107, 0.55)";
  fillBand(
    ctx,
    view,
    preview.dir,
    cross,
    positions[preview.start],
    positions[preview.end],
    WALL_THICKNESS,
    color,
    0,
  );
  const mid = (positions[preview.start] + positions[preview.end]) / 2;
  const point =
    preview.dir === "h" ? worldToScreen(mid, cross, view) : worldToScreen(cross, mid, view);
  const length = positions[preview.end] - positions[preview.start];
  chipText(ctx, `${formatMm(length)} mm`, point.x, point.y - 16);
}

function drawScaleBar(ctx: CanvasRenderingContext2D, x: number, y: number, ppm: number): void {
  const choices = [500, 1000, 2000, 5000, 10000, 20000];
  let length = choices[0];
  for (const choice of choices) {
    if (choice * ppm <= 150) length = choice;
  }
  const width = length * ppm;
  if (width < 24) return;
  ctx.save();
  ctx.fillStyle = "rgba(247, 244, 238, 0.92)";
  ctx.fillRect(x - 8, y - 22, width + 16, 36);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y + 5);
  ctx.moveTo(x + width, y - 5);
  ctx.lineTo(x + width, y + 5);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = `12px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${formatMm(length)} mm`, x + width / 2, y - 6);
  ctx.restore();
}

export function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, scene: Scene): void {
  const { state, view } = scene;
  const { x: xPos, y: yPos } = positionsOf(state);
  const spaces = spacesOf(state);
  const selectedWall = scene.selection?.type === "wall" ? scene.selection.key : null;
  const selectedDoor = scene.selection?.type === "door" ? scene.selection.id : null;
  const selectedSpace = scene.selection?.type === "space" ? scene.selection.key : null;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  spaces.forEach((space, index) => {
    for (const cell of space.cells) {
      const rect = cellInnerRect(cell.c, cell.r, xPos, yPos, state.hEdges, state.vEdges);
      fillWorldRect(
        ctx,
        view,
        rect.x0,
        rect.y0,
        rect.x1 - rect.x0,
        rect.y1 - rect.y0,
        SPACE_FILLS[index % SPACE_FILLS.length],
        0,
      );
    }
  });
  if (selectedSpace) {
    const space = spaces.find((item) => item.key === selectedSpace);
    if (space) {
      for (const cell of space.cells) {
        const rect = cellInnerRect(cell.c, cell.r, xPos, yPos, state.hEdges, state.vEdges);
        fillWorldRect(
          ctx,
          view,
          rect.x0,
          rect.y0,
          rect.x1 - rect.x0,
          rect.y1 - rect.y0,
          "rgba(15, 110, 107, 0.18)",
          0,
        );
      }
    }
  }

  drawReferenceLines(ctx, view, xPos, yPos);

  for (const run of runsOf(state)) {
    if (runKey(run) !== selectedWall) continue;
    const positions = run.dir === "h" ? xPos : yPos;
    const cross = run.dir === "h" ? yPos[run.line] : xPos[run.line];
    for (const [start, end] of solidPieces(run, state.doors, positions)) {
      fillBand(ctx, view, run.dir, cross, start, end, WALL_THICKNESS + 80, TEAL, 0);
    }
  }

  for (const run of runsOf(state)) {
    const positions = run.dir === "h" ? xPos : yPos;
    const cross = run.dir === "h" ? yPos[run.line] : xPos[run.line];
    for (const [start, end] of solidPieces(run, state.doors, positions)) {
      fillBand(ctx, view, run.dir, cross, start, end, WALL_THICKNESS, INK, 0.45);
    }
  }
  drawJoints(ctx, view, state, xPos, yPos, INK);
  drawWindows(ctx, view, state, xPos, yPos);

  for (const door of state.doors) {
    drawDoorSymbol(ctx, view, door, xPos, yPos, door.id === selectedDoor);
  }

  if (state.hEdges.size + state.vEdges.size === 0) {
    const center = worldToScreen(xPos[xPos.length - 1] / 2, yPos[yPos.length - 1] / 2, view);
    ctx.save();
    ctx.fillStyle = MUTED;
    ctx.font = `14px ${SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("用「画墙」连接交叉点", center.x, center.y);
    ctx.restore();
  }

  drawLabels(ctx, view, state, spaces, xPos, yPos);

  if (scene.hoverRun && runKey(scene.hoverRun) !== selectedWall && scene.tool !== "wall" && scene.tool !== "erase") {
    const run = scene.hoverRun;
    const positions = run.dir === "h" ? xPos : yPos;
    const cross = run.dir === "h" ? yPos[run.line] : xPos[run.line];
    const start = worldToScreen(
      run.dir === "h" ? positions[run.start] : cross,
      run.dir === "h" ? cross : positions[run.start],
      view,
    );
    const end = worldToScreen(
      run.dir === "h" ? positions[run.end] : cross,
      run.dir === "h" ? cross : positions[run.end],
      view,
    );
    ctx.save();
    ctx.strokeStyle = TEAL;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
  }

  drawPreview(ctx, view, scene.preview, xPos, yPos);
  drawPoints(ctx, view, xPos, yPos, scene);
  drawDimensions(ctx, view, xPos, yPos);
  if (scene.exporting) drawScaleBar(ctx, 28, height - 36, view.ppm);
}

function projectSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { dist: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length));
  const x = ax + dx * t;
  const y = ay + dy * t;
  return { dist: Math.hypot(px - x, py - y), t };
}

function screenRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  view: View,
): { x: number; y: number; w: number; h: number } {
  const p0 = worldToScreen(x0, y0, view);
  const p1 = worldToScreen(x1, y1, view);
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  return { x, y, w: Math.abs(p1.x - p0.x), h: Math.abs(p1.y - p0.y) };
}

function angleOnShortArc(angle: number, start: number, end: number): boolean {
  let delta = end - start;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  while (delta > Math.PI) delta -= Math.PI * 2;
  let current = angle - start;
  while (current <= -Math.PI) current += Math.PI * 2;
  while (current > Math.PI) current -= Math.PI * 2;
  if (delta >= 0) return current >= -1e-3 && current <= delta + 1e-3;
  return current <= 1e-3 && current >= delta - 1e-3;
}

function doorPointerDistance(
  px: number,
  py: number,
  door: Door,
  xPos: readonly number[],
  yPos: readonly number[],
  view: View,
): number {
  const geometry = doorGeometry(door, xPos, yPos);
  const half = WALL_THICKNESS / 2;
  const rect =
    door.dir === "h"
      ? screenRect(geometry.start, geometry.cross - half, geometry.end, geometry.cross + half, view)
      : screenRect(geometry.cross - half, geometry.start, geometry.cross + half, geometry.end, view);
  if (
    px >= rect.x - 6 &&
    px <= rect.x + rect.w + 6 &&
    py >= rect.y - 6 &&
    py <= rect.y + rect.h + 6
  ) {
    return 0;
  }
  const hinge = worldToScreen(geometry.hinge.x, geometry.hinge.y, view);
  const leaf = worldToScreen(geometry.leaf.x, geometry.leaf.y, view);
  const closed = worldToScreen(geometry.closed.x, geometry.closed.y, view);
  const leafDistance = projectSegment(px, py, hinge.x, hinge.y, leaf.x, leaf.y).dist;
  const radius = DOOR_WIDTH * view.ppm;
  const radial = Math.hypot(px - hinge.x, py - hinge.y);
  const angle = Math.atan2(py - hinge.y, px - hinge.x);
  const start = Math.atan2(closed.y - hinge.y, closed.x - hinge.x);
  const end = Math.atan2(leaf.y - hinge.y, leaf.x - hinge.x);
  const arcDistance = angleOnShortArc(angle, start, end) ? Math.abs(radial - radius) : Infinity;
  return Math.min(leafDistance, arcDistance);
}

export function hitTest(px: number, py: number, state: PlanState, view: View) {
  const world = screenToWorld(px, py, view);
  const { x: xPos, y: yPos } = positionsOf(state);
  let point: HitPoint | null = null;
  let pointDistance = 16;
  for (let xi = 0; xi < xPos.length; xi += 1) {
    for (let yi = 0; yi < yPos.length; yi += 1) {
      const screen = worldToScreen(xPos[xi], yPos[yi], view);
      const distance = Math.hypot(screen.x - px, screen.y - py);
      if (distance < pointDistance) {
        pointDistance = distance;
        point = { xi, yi, dist: distance };
      }
    }
  }

  let door: HitDoor | null = null;
  for (const item of state.doors) {
    const distance = doorPointerDistance(px, py, item, xPos, yPos, view);
    if (distance <= 8 && (!door || distance < door.dist)) door = { door: item, dist: distance };
  }

  let wall: HitWall | null = null;
  for (const run of runsOf(state)) {
    const positions = run.dir === "h" ? xPos : yPos;
    const cross = run.dir === "h" ? yPos[run.line] : xPos[run.line];
    const start = positions[run.start];
    const end = positions[run.end];
    const p0 =
      run.dir === "h" ? worldToScreen(start, cross, view) : worldToScreen(cross, start, view);
    const p1 = run.dir === "h" ? worldToScreen(end, cross, view) : worldToScreen(cross, end, view);
    const projection = projectSegment(px, py, p0.x, p0.y, p1.x, p1.y);
    const limit = Math.max(10, (WALL_THICKNESS * view.ppm) / 2 + 6);
    if (projection.dist > limit) continue;
    if (wall && projection.dist >= wall.dist) continue;
    wall = {
      run,
      dist: projection.dist,
      meter: start + (end - start) * projection.t,
    };
  }

  let space: Space | null = null;
  let column = -1;
  let row = -1;
  for (let index = 0; index < xPos.length - 1; index += 1) {
    if (world.x >= xPos[index] && world.x < xPos[index + 1]) column = index;
  }
  for (let index = 0; index < yPos.length - 1; index += 1) {
    if (world.y >= yPos[index] && world.y < yPos[index + 1]) row = index;
  }
  if (column >= 0 && row >= 0) {
    space =
      spacesOf(state).find((item) => item.cells.some((cell) => cell.c === column && cell.r === row)) ||
      null;
  }
  return { world, point, door, wall, space };
}
