import {
  DOOR_JAMB_SPAN,
  DOOR_JAMB_THICKNESS,
  DOOR_WIDTH,
  WALL_THICKNESS,
  cellInnerRect,
  doorGeometry,
  doorSpanMeters,
  formatMm,
  labelAnchor,
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

interface WallPiece {
  from: number;
  to: number;
  kind: "solid" | "window" | "slide";
}

function wallPieces(run: Run, state: PlanState, positions: readonly number[]): WallPiece[] {
  const raw: WallPiece[] = [];
  for (let index = run.start; index < run.end; index += 1) {
    const from = positions[index];
    const to = positions[index + 1];
    if (from == null || to == null) continue;
    const key = `${run.dir}:${run.line}:${index}`;
    const kind: WallPiece["kind"] = state.slidingEdges.has(key)
      ? "slide"
      : state.windowEdges.has(key)
        ? "window"
        : "solid";
    const cuts = state.doors
      .filter((door) => door.dir === run.dir && door.line === run.line)
      .map((door) => doorSpanMeters(door, positions))
      .filter(([cutFrom, cutTo]) => cutTo > from + 1e-6 && cutFrom < to - 1e-6)
      .map(([cutFrom, cutTo]): [number, number] => [Math.max(cutFrom, from), Math.min(cutTo, to)])
      .sort((a, b) => a[0] - b[0]);
    let cursor = from;
    for (const [cutFrom, cutTo] of cuts) {
      if (cutFrom > cursor + 1e-6) raw.push({ from: cursor, to: cutFrom, kind });
      cursor = Math.max(cursor, cutTo);
    }
    if (to > cursor + 1e-6) raw.push({ from: cursor, to, kind });
  }
  const merged: WallPiece[] = [];
  for (const piece of raw) {
    const previous = merged[merged.length - 1];
    if (previous && previous.kind === piece.kind && Math.abs(previous.to - piece.from) <= 1e-6) {
      previous.to = piece.to;
    } else {
      merged.push({ ...piece });
    }
  }
  return merged;
}

function strokeBand(
  ctx: CanvasRenderingContext2D,
  view: View,
  dir: Direction,
  cross: number,
  start: number,
  end: number,
  thickness: number,
  color: string,
): void {
  const half = thickness / 2;
  const from = Math.min(start, end);
  const length = Math.abs(end - start);
  if (length <= 0) return;
  const corners =
    dir === "h"
      ? [
          worldToScreen(from, cross - half, view),
          worldToScreen(from + length, cross - half, view),
          worldToScreen(from + length, cross + half, view),
          worldToScreen(from, cross + half, view),
        ]
      : [
          worldToScreen(cross - half, from, view),
          worldToScreen(cross + half, from, view),
          worldToScreen(cross + half, from + length, view),
          worldToScreen(cross - half, from + length, view),
        ];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.25, view.ppm * 10);
  ctx.lineJoin = "miter";
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (const point of corners.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawSlide(
  ctx: CanvasRenderingContext2D,
  view: View,
  dir: Direction,
  cross: number,
  start: number,
  end: number,
  selected: boolean,
): void {
  const half = WALL_THICKNESS / 2;
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const mid = (from + to) / 2;
  const color = selected ? TEAL : INK;
  fillBand(ctx, view, dir, cross, from, to, WALL_THICKNESS, PAPER, 0.4);
  if (dir === "h") {
    fillWorldRect(ctx, view, from, cross - half, mid - from, half, color, 0);
    fillWorldRect(ctx, view, mid, cross, to - mid, half, color, 0);
  } else {
    fillWorldRect(ctx, view, cross - half, from, half, mid - from, color, 0);
    fillWorldRect(ctx, view, cross, mid, half, to - mid, color, 0);
  }
  strokeBand(ctx, view, dir, cross, from, to, WALL_THICKNESS, color);
  const across =
    dir === "h"
      ? [worldToScreen(mid, cross - half, view), worldToScreen(mid, cross + half, view)]
      : [worldToScreen(cross - half, mid, view), worldToScreen(cross + half, mid, view)];
  const along =
    dir === "h"
      ? [worldToScreen(from, cross, view), worldToScreen(to, cross, view)]
      : [worldToScreen(cross, from, view), worldToScreen(cross, to, view)];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.25, view.ppm * 10);
  ctx.beginPath();
  ctx.moveTo(across[0].x, across[0].y);
  ctx.lineTo(across[1].x, across[1].y);
  ctx.moveTo(along[0].x, along[0].y);
  ctx.lineTo(along[1].x, along[1].y);
  ctx.stroke();
  ctx.restore();
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
      const horizontal = [`h:${yi}:${xi - 1}`, `h:${yi}:${xi}`].filter((key) => state.hEdges.has(key));
      const vertical = [`v:${xi}:${yi - 1}`, `v:${xi}:${yi}`].filter((key) => state.vEdges.has(key));
      if (horizontal.length === 0 || vertical.length === 0) continue;
      if ([...horizontal, ...vertical].every((key) => state.windowEdges.has(key) || state.slidingEdges.has(key))) continue;
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

function drawBayFloors(
  ctx: CanvasRenderingContext2D,
  view: View,
  state: PlanState,
  xPos: readonly number[],
  yPos: readonly number[],
): void {
  for (const key of state.bayCells) {
    const [column, row] = key.split(",").map(Number);
    if (!Number.isInteger(column) || !Number.isInteger(row)) continue;
    if (column < 0 || row < 0 || column + 1 >= xPos.length || row + 1 >= yPos.length) continue;
    const rect = cellInnerRect(column, row, xPos, yPos, state.hEdges, state.vEdges);
    if (rect.x1 - rect.x0 < 1 || rect.y1 - rect.y0 < 1) continue;
    hatchRect(ctx, view, rect.x0, rect.y0, rect.x1, rect.y1);
  }
}

function hatchRect(
  ctx: CanvasRenderingContext2D,
  view: View,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const spacing = 260;
  const corners = [
    worldToScreen(x0, y1, view),
    worldToScreen(x1, y1, view),
    worldToScreen(x1, y0, view),
    worldToScreen(x0, y0, view),
  ];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (const point of corners.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = "rgba(90, 72, 48, 0.62)";
  ctx.lineWidth = 1;
  const start = Math.floor((x0 + y0) / spacing) * spacing;
  const end = x1 + y1;
  for (let sum = start; sum <= end + 1e-6; sum += spacing) {
    const hits: { x: number; y: number }[] = [];
    const push = (x: number, y: number) => {
      if (x < x0 - 1e-6 || x > x1 + 1e-6 || y < y0 - 1e-6 || y > y1 + 1e-6) return;
      const point = worldToScreen(
        Math.min(x1, Math.max(x0, x)),
        Math.min(y1, Math.max(y0, y)),
        view,
      );
      if (hits.some((hit) => Math.hypot(hit.x - point.x, hit.y - point.y) < 0.5)) return;
      hits.push(point);
    };
    push(sum - y0, y0);
    push(sum - y1, y1);
    push(x0, sum - x0);
    push(x1, sum - x1);
    if (hits.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(hits[0].x, hits[0].y);
    ctx.lineTo(hits[1].x, hits[1].y);
    ctx.stroke();
  }
  ctx.restore();
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
    fillWorldRect(ctx, view, geometry.start, geometry.cross - half, DOOR_WIDTH, WALL_THICKNESS, PAPER, 0.6);
  } else {
    fillWorldRect(ctx, view, geometry.cross - half, geometry.start, WALL_THICKNESS, DOOR_WIDTH, PAPER, 0.6);
  }
  const color = selected ? TEAL : INK;
  const along = DOOR_JAMB_THICKNESS;
  const across = DOOR_JAMB_SPAN;
  for (const meter of [geometry.start, geometry.end]) {
    if (door.dir === "h") {
      fillWorldRect(ctx, view, meter - along / 2, geometry.cross - across / 2, along, across, color, 0);
    } else {
      fillWorldRect(ctx, view, geometry.cross - across / 2, meter - along / 2, across, along, color, 0);
    }
  }
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

function drawExportLegend(ctx: CanvasRenderingContext2D, ppm: number): void {
  const x = 18;
  let y = 28;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = INK;
  ctx.font = `600 13px ${SANS}`;
  ctx.fillText("图例", x, y);
  y += 24;

  const swatch = (draw: (left: number, top: number) => void, label: string) => {
    draw(x, y - 6);
    ctx.font = `12px ${SANS}`;
    ctx.fillStyle = INK;
    ctx.fillText(label, x + 42, y);
    y += 24;
  };
  swatch((left, top) => {
    ctx.fillStyle = INK;
    ctx.fillRect(left, top, 30, 12);
  }, "墙");
  swatch((left, top) => {
    ctx.fillStyle = PAPER;
    ctx.fillRect(left, top, 30, 12);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.25;
    ctx.strokeRect(left + 0.5, top + 0.5, 29, 11);
  }, "窗");
  swatch((left, top) => {
    ctx.fillStyle = PAPER;
    ctx.fillRect(left, top, 30, 12);
    ctx.fillStyle = INK;
    ctx.fillRect(left, top + 6, 15, 6);
    ctx.fillRect(left + 15, top, 15, 6);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, 29, 11);
    ctx.beginPath();
    ctx.moveTo(left + 15, top);
    ctx.lineTo(left + 15, top + 12);
    ctx.moveTo(left, top + 6);
    ctx.lineTo(left + 30, top + 6);
    ctx.stroke();
  }, "推拉门");
  swatch((left, top) => {
    ctx.fillStyle = INK;
    ctx.fillRect(left, top + 5, 7, 2);
    ctx.fillRect(left + 23, top + 5, 7, 2);
    ctx.fillRect(left + 6, top + 3, 3, 6);
    ctx.fillRect(left + 21, top + 3, 3, 6);
  }, "门洞");
  swatch((left, top) => {
    ctx.save();
    ctx.fillStyle = "#e3eee7";
    ctx.fillRect(left, top, 30, 12);
    ctx.beginPath();
    ctx.rect(left, top, 30, 12);
    ctx.clip();
    ctx.strokeStyle = "rgba(90, 72, 48, 0.7)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let offset = -12; offset <= 30; offset += 6) {
      ctx.moveTo(left + offset, top + 12);
      ctx.lineTo(left + offset + 12, top);
    }
    ctx.stroke();
    ctx.restore();
  }, "飘窗");

  y += 4;
  ctx.font = `11px ${SANS}`;
  ctx.fillStyle = MUTED;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("墙厚 120 mm", x, y);
  y += 16;
  ctx.fillText("门洞 800 mm", x, y);
  y += 28;
  drawScaleBar(ctx, x + 8, y, ppm);
  ctx.restore();
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

  drawBayFloors(ctx, view, state, xPos, yPos);

  if (!scene.exporting) drawReferenceLines(ctx, view, xPos, yPos);

  for (const run of runsOf(state)) {
    if (runKey(run) !== selectedWall) continue;
    const positions = run.dir === "h" ? xPos : yPos;
    const cross = run.dir === "h" ? yPos[run.line] : xPos[run.line];
    for (const piece of wallPieces(run, state, positions)) {
      if (piece.kind !== "solid") continue;
      fillBand(ctx, view, run.dir, cross, piece.from, piece.to, WALL_THICKNESS + 80, TEAL, 0);
    }
  }

  for (const run of runsOf(state)) {
    const positions = run.dir === "h" ? xPos : yPos;
    const cross = run.dir === "h" ? yPos[run.line] : xPos[run.line];
    for (const piece of wallPieces(run, state, positions)) {
      if (piece.kind !== "solid") continue;
      fillBand(ctx, view, run.dir, cross, piece.from, piece.to, WALL_THICKNESS, INK, 0.45);
    }
  }
  drawJoints(ctx, view, state, xPos, yPos, INK);
  for (const run of runsOf(state)) {
    const positions = run.dir === "h" ? xPos : yPos;
    const cross = run.dir === "h" ? yPos[run.line] : xPos[run.line];
    const selected = runKey(run) === selectedWall;
    for (const piece of wallPieces(run, state, positions)) {
      if (piece.kind === "window") {
        fillBand(ctx, view, run.dir, cross, piece.from, piece.to, WALL_THICKNESS, PAPER, 0.4);
        strokeBand(ctx, view, run.dir, cross, piece.from, piece.to, WALL_THICKNESS, selected ? TEAL : INK);
      } else if (piece.kind === "slide") {
        drawSlide(ctx, view, run.dir, cross, piece.from, piece.to, selected);
      }
    }
  }

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

  if (!scene.exporting) {
    drawPreview(ctx, view, scene.preview, xPos, yPos);
    drawPoints(ctx, view, xPos, yPos, scene);
  }
  drawDimensions(ctx, view, xPos, yPos);
  if (scene.exporting) drawExportLegend(ctx, view.ppm);
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

function doorPointerDistance(
  px: number,
  py: number,
  door: Door,
  xPos: readonly number[],
  yPos: readonly number[],
  view: View,
): number {
  const geometry = doorGeometry(door, xPos, yPos);
  const capHalf = DOOR_JAMB_SPAN / 2;
  const rect =
    door.dir === "h"
      ? screenRect(geometry.start, geometry.cross - capHalf, geometry.end, geometry.cross + capHalf, view)
      : screenRect(geometry.cross - capHalf, geometry.start, geometry.cross + capHalf, geometry.end, view);
  if (
    px >= rect.x - 6 &&
    px <= rect.x + rect.w + 6 &&
    py >= rect.y - 6 &&
    py <= rect.y + rect.h + 6
  ) {
    return 0;
  }
  return Infinity;
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
  return {
    world,
    point,
    door,
    wall,
    space,
    cell: column >= 0 && row >= 0 ? { c: column, r: row } : null,
  };
}
