import {
  DOOR_JAMB_SPAN,
  DOOR_JAMB_THICKNESS,
  DOOR_WIDTH,
  WALL_THICKNESS,
  WINDOW_FRAME,
  cellInnerRect,
  doorGeometry,
  doorSpanMeters,
  formatMm,
  labelAnchor,
} from "./geometry.ts";
import { exportLayout } from "./export-layout.ts";
import { labelForSpace, positionsOf, runsOf, spacesOf } from "./model.ts";
import type { Direction, Door, PlanState, Run } from "./types.ts";

const PAPER = "#f3efe6";
const INK = "#241f1b";
const MUTED = "#8a8178";
const SPACE_FILLS = ["#e3eee7", "#f4eadc", "#e3ebf4", "#f6e4de", "#ece6f4", "#e5f0ea"];

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

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function exportPlanSvg(state: PlanState): string {
  const frame = exportLayout(state);
  const { x: xPos, y: yPos } = positionsOf(state);
  const { ppm } = frame;
  const sx = (x: number) => frame.view.ox + x * ppm;
  const sy = (y: number) => frame.view.oy - y * ppm;
  const parts: string[] = [];
  let clipId = 0;

  const rect = (x: number, y: number, width: number, height: number, attrs: string) => {
    if (width <= 0 || height <= 0) return;
    parts.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" ${attrs}/>`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, attrs: string) => {
    parts.push(`<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" ${attrs}/>`);
  };
  const band = (dir: Direction, cross: number, start: number, end: number, thickness: number) => {
    const from = Math.min(start, end);
    const length = Math.abs(end - start);
    const half = thickness / 2;
    if (dir === "h") return { x: sx(from), y: sy(cross + half), w: length * ppm, h: thickness * ppm };
    return { x: sx(cross - half), y: sy(from + length), w: thickness * ppm, h: length * ppm };
  };

  parts.push(`<rect width="${frame.width}" height="${frame.height}" fill="${PAPER}"/>`);

  const spaces = spacesOf(state);
  spaces.forEach((space, index) => {
    const fill = SPACE_FILLS[index % SPACE_FILLS.length] ?? SPACE_FILLS[0];
    for (const cell of space.cells) {
      const inner = cellInnerRect(cell.c, cell.r, xPos, yPos, state.hEdges, state.vEdges);
      rect(sx(inner.x0), sy(inner.y1), (inner.x1 - inner.x0) * ppm, (inner.y1 - inner.y0) * ppm, `fill="${fill}"`);
    }
  });

  for (const key of state.bayCells) {
    const [column, row] = key.split(",").map(Number);
    if (!Number.isInteger(column) || !Number.isInteger(row)) continue;
    if (column < 0 || row < 0 || column + 1 >= xPos.length || row + 1 >= yPos.length) continue;
    const inner = cellInnerRect(column, row, xPos, yPos, state.hEdges, state.vEdges);
    if (inner.x1 - inner.x0 < 1 || inner.y1 - inner.y0 < 1) continue;
    const id = `bay-${clipId}`;
    clipId += 1;
    const x = sx(inner.x0);
    const y = sy(inner.y1);
    const w = (inner.x1 - inner.x0) * ppm;
    const h = (inner.y1 - inner.y0) * ppm;
    parts.push(`<clipPath id="${id}"><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"/></clipPath>`);
    parts.push(`<g clip-path="url(#${id})" fill="none" stroke="rgba(90,72,48,0.62)" stroke-width="1">`);
    const spacing = 260;
    const start = Math.floor((inner.x0 + inner.y0) / spacing) * spacing;
    const end = inner.x1 + inner.y1;
    for (let sum = start; sum <= end + 1e-6; sum += spacing) {
      const hits: { x: number; y: number }[] = [];
      const push = (wx: number, wy: number) => {
        if (wx < inner.x0 - 1e-6 || wx > inner.x1 + 1e-6 || wy < inner.y0 - 1e-6 || wy > inner.y1 + 1e-6) return;
        const point = { x: sx(Math.min(inner.x1, Math.max(inner.x0, wx))), y: sy(Math.min(inner.y1, Math.max(inner.y0, wy))) };
        if (hits.some((hit) => Math.hypot(hit.x - point.x, hit.y - point.y) < 0.5)) return;
        hits.push(point);
      };
      push(sum - inner.y0, inner.y0);
      push(sum - inner.y1, inner.y1);
      push(inner.x0, sum - inner.x0);
      push(inner.x1, sum - inner.x1);
      if (hits.length >= 2) line(hits[0].x, hits[0].y, hits[1].x, hits[1].y, `clip-path="url(#${id})"`);
    }
    parts.push(`</g>`);
  }

  const half = WALL_THICKNESS / 2;
  for (const run of runsOf(state)) {
    const positions = run.dir === "h" ? xPos : yPos;
    const cross = run.dir === "h" ? yPos[run.line] ?? 0 : xPos[run.line] ?? 0;
    for (const piece of wallPieces(run, state, positions)) {
      if (piece.kind !== "solid") continue;
      const box = band(run.dir, cross, piece.from, piece.to, WALL_THICKNESS);
      rect(box.x, box.y, box.w, box.h, `fill="${INK}"`);
    }
  }

  for (let xi = 0; xi < xPos.length; xi += 1) {
    for (let yi = 0; yi < yPos.length; yi += 1) {
      const horizontal = [`h:${yi}:${xi - 1}`, `h:${yi}:${xi}`].filter((key) => state.hEdges.has(key));
      const vertical = [`v:${xi}:${yi - 1}`, `v:${xi}:${yi}`].filter((key) => state.vEdges.has(key));
      if (horizontal.length === 0 || vertical.length === 0) continue;
      if ([...horizontal, ...vertical].every((key) => state.windowEdges.has(key) || state.slidingEdges.has(key))) continue;
      if (nearDoor(state.doors, "h", yi, xPos[xi] ?? 0, xPos) || nearDoor(state.doors, "v", xi, yPos[yi] ?? 0, yPos)) continue;
      rect(sx((xPos[xi] ?? 0) - half), sy((yPos[yi] ?? 0) + half), WALL_THICKNESS * ppm, WALL_THICKNESS * ppm, `fill="${INK}"`);
    }
  }

  for (const run of runsOf(state)) {
    const positions = run.dir === "h" ? xPos : yPos;
    const cross = run.dir === "h" ? yPos[run.line] ?? 0 : xPos[run.line] ?? 0;
    for (const piece of wallPieces(run, state, positions)) {
      if (piece.kind === "window") {
        drawWindow(piece.from, piece.to);
      } else if (piece.kind === "slide") {
        drawSlide(piece.from, piece.to);
      }
    }

    function drawWindow(start: number, end: number): void {
      const from = Math.min(start, end);
      const length = Math.abs(end - start);
      const frame = Math.min(WINDOW_FRAME, length / 4, WALL_THICKNESS / 4);
      const box = band(run.dir, cross, from, from + length, WALL_THICKNESS);
      rect(box.x, box.y, box.w, box.h, `fill="${INK}"`);
      if (run.dir === "h") {
        rect(
          sx(from + frame),
          sy(cross + half - frame),
          (length - frame * 2) * ppm,
          (WALL_THICKNESS - frame * 2) * ppm,
          `fill="${PAPER}"`,
        );
      } else {
        rect(
          sx(cross - half + frame),
          sy(from + length - frame),
          (WALL_THICKNESS - frame * 2) * ppm,
          (length - frame * 2) * ppm,
          `fill="${PAPER}"`,
        );
      }
    }

    function drawSlide(start: number, end: number): void {
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      const mid = (from + to) / 2;
      const box = band(run.dir, cross, from, to, WALL_THICKNESS);
      rect(box.x, box.y, box.w, box.h, `fill="${PAPER}"`);
      if (run.dir === "h") {
        rect(sx(from), sy(cross), (mid - from) * ppm, half * ppm, `fill="${INK}"`);
        rect(sx(mid), sy(cross + half), (to - mid) * ppm, half * ppm, `fill="${INK}"`);
        line(sx(mid), sy(cross - half), sx(mid), sy(cross + half), `stroke="${INK}" stroke-width="1"`);
        line(sx(from), sy(cross), sx(to), sy(cross), `stroke="${INK}" stroke-width="1"`);
      } else {
        rect(sx(cross - half), sy(mid), half * ppm, (mid - from) * ppm, `fill="${INK}"`);
        rect(sx(cross), sy(to), half * ppm, (to - mid) * ppm, `fill="${INK}"`);
        line(sx(cross - half), sy(mid), sx(cross + half), sy(mid), `stroke="${INK}" stroke-width="1"`);
        line(sx(cross), sy(from), sx(cross), sy(to), `stroke="${INK}" stroke-width="1"`);
      }
      parts.push(
        `<rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}" fill="none" stroke="${INK}" stroke-width="1.25"/>`,
      );
    }
  }

  for (const door of state.doors) drawDoor(door);

  function drawDoor(door: Door): void {
    const geometry = doorGeometry(door, xPos, yPos);
    const along = DOOR_JAMB_THICKNESS;
    const across = DOOR_JAMB_SPAN;
    if (door.dir === "h") rect(sx(geometry.start), sy(geometry.cross + half), DOOR_WIDTH * ppm, WALL_THICKNESS * ppm, `fill="${PAPER}"`);
    else rect(sx(geometry.cross - half), sy(geometry.start + DOOR_WIDTH), WALL_THICKNESS * ppm, DOOR_WIDTH * ppm, `fill="${PAPER}"`);
    for (const meter of [geometry.start, geometry.end]) {
      if (door.dir === "h") {
        rect(sx(meter - along / 2), sy(geometry.cross + across / 2), along * ppm, across * ppm, `fill="${INK}"`);
      } else {
        rect(sx(geometry.cross - across / 2), sy(meter + along / 2), across * ppm, along * ppm, `fill="${INK}"`);
      }
    }
  }

  for (const space of spaces) {
    const label = labelForSpace(state, space);
    if (!label) continue;
    const anchor = labelAnchor(space, xPos, yPos);
    parts.push(
      `<text x="${num(sx(anchor.x))}" y="${num(sy(anchor.y))}" text-anchor="middle" dominant-baseline="middle" font-size="15" font-weight="600" fill="${INK}">${esc(label.text)}</text>`,
    );
  }

  drawDimensions();
  drawLegend();

  function drawDimensions(): void {
    const planBottom = sy(yPos[0] ?? 0);
    const planRight = sx(xPos[xPos.length - 1] ?? 0);
    const rowY = planBottom + 28;
    const totalY = planBottom + 52;
    const rowX = planRight + 30;
    const totalX = planRight + 56;
    const stroke = `stroke="${MUTED}" stroke-width="1" fill="none"`;

    const hChain = (chainY: number, from: number, to: number, label: string) => {
      const a = sx(from);
      const b = sx(to);
      line(a, planBottom + 8, a, chainY + 5, stroke);
      line(b, planBottom + 8, b, chainY + 5, stroke);
      line(a, chainY, b, chainY, stroke);
      line(a, chainY - 4, a, chainY + 4, stroke);
      line(b, chainY - 4, b, chainY + 4, stroke);
      if (Math.abs(b - a) >= 36) chip(label, (a + b) / 2, chainY, 0);
    };
    const vChain = (chainX: number, from: number, to: number, label: string) => {
      const a = sy(from);
      const b = sy(to);
      line(planRight + 8, a, chainX + 5, a, stroke);
      line(planRight + 8, b, chainX + 5, b, stroke);
      line(chainX, a, chainX, b, stroke);
      line(chainX - 4, a, chainX + 4, a, stroke);
      line(chainX - 4, b, chainX + 4, b, stroke);
      if (Math.abs(b - a) >= 36) chip(label, chainX, (a + b) / 2, -90);
    };
    for (let index = 0; index < xPos.length - 1; index += 1) {
      hChain(rowY, xPos[index] ?? 0, xPos[index + 1] ?? 0, `${formatMm((xPos[index + 1] ?? 0) - (xPos[index] ?? 0))} mm`);
    }
    for (let index = 0; index < yPos.length - 1; index += 1) {
      vChain(rowX, yPos[index] ?? 0, yPos[index + 1] ?? 0, `${formatMm((yPos[index + 1] ?? 0) - (yPos[index] ?? 0))} mm`);
    }
    if (xPos.length > 2) hChain(totalY, xPos[0] ?? 0, xPos[xPos.length - 1] ?? 0, `${formatMm(xPos[xPos.length - 1] ?? 0)} mm`);
    if (yPos.length > 2) vChain(totalX, yPos[0] ?? 0, yPos[yPos.length - 1] ?? 0, `${formatMm(yPos[yPos.length - 1] ?? 0)} mm`);
  }

  function chip(text: string, x: number, y: number, angle: number): void {
    const width = text.length * 7 + 10;
    const transform = angle === 0 ? "" : ` transform="rotate(${angle} ${num(x)} ${num(y)})"`;
    rect(x - width / 2, y - 8, width, 16, `fill="${PAPER}"${transform}`);
    parts.push(
      `<text x="${num(x)}" y="${num(y)}"${transform} text-anchor="middle" dominant-baseline="middle" font-size="12" fill="#4d453e">${esc(text)}</text>`,
    );
  }

  function drawLegend(): void {
    const x = 18;
    let y = 28;
    parts.push(`<text x="${x}" y="${y}" font-size="13" font-weight="600" fill="${INK}">图例</text>`);
    y += 24;
    const item = (label: string, draw: (left: number, top: number) => void) => {
      draw(x, y - 6);
      parts.push(`<text x="${x + 42}" y="${y}" dominant-baseline="middle" font-size="12" fill="${INK}">${esc(label)}</text>`);
      y += 24;
    };
    item("墙", (left, top) => rect(left, top, 30, 12, `fill="${INK}"`));
    item("窗", (left, top) => {
      rect(left, top, 30, 12, `fill="${INK}"`);
      rect(left + 3, top + 3, 24, 6, `fill="${PAPER}"`);
    });
    item("推拉门", (left, top) => {
      rect(left, top, 30, 12, `fill="${PAPER}"`);
      rect(left, top + 6, 15, 6, `fill="${INK}"`);
      rect(left + 15, top, 15, 6, `fill="${INK}"`);
      parts.push(`<rect x="${left + 0.5}" y="${top + 0.5}" width="29" height="11" fill="none" stroke="${INK}" stroke-width="1"/>`);
      line(left + 15, top, left + 15, top + 12, `stroke="${INK}" stroke-width="1"`);
      line(left, top + 6, left + 30, top + 6, `stroke="${INK}" stroke-width="1"`);
    });
    item("门洞", (left, top) => {
      rect(left, top + 5, 7, 2, `fill="${INK}"`);
      rect(left + 23, top + 5, 7, 2, `fill="${INK}"`);
      rect(left + 6, top + 3, 3, 6, `fill="${INK}"`);
      rect(left + 21, top + 3, 3, 6, `fill="${INK}"`);
    });
    item("飘窗", (left, top) => {
      const id = `legend-bay-${clipId}`;
      clipId += 1;
      parts.push(`<clipPath id="${id}"><rect x="${left}" y="${top}" width="30" height="12"/></clipPath>`);
      rect(left, top, 30, 12, `fill="#e3eee7"`);
      parts.push(`<g clip-path="url(#${id})" stroke="rgba(90,72,48,0.7)" stroke-width="1">`);
      for (let offset = -12; offset <= 30; offset += 6) {
        line(left + offset, top + 12, left + offset + 12, top, "");
      }
      parts.push(`</g>`);
    });
    y += 4;
    parts.push(`<text x="${x}" y="${y}" font-size="11" fill="${MUTED}">墙厚 120 mm</text>`);
    y += 16;
    parts.push(`<text x="${x}" y="${y}" font-size="11" fill="${MUTED}">门洞 800 mm</text>`);
    y += 28;
    drawScale(x + 8, y);
  }

  function drawScale(x: number, y: number): void {
    const choices = [500, 1000, 2000, 5000, 10000, 20000];
    let length = choices[0] ?? 500;
    for (const choice of choices) {
      if (choice * ppm <= 150) length = choice;
    }
    const width = length * ppm;
    if (width < 24) return;
    rect(x - 8, y - 22, width + 16, 36, `fill="rgba(247,244,238,0.92)"`);
    const stroke = `stroke="${INK}" stroke-width="1.5"`;
    line(x, y, x + width, y, stroke);
    line(x, y - 5, x, y + 5, stroke);
    line(x + width, y - 5, x + width, y + 5, stroke);
    parts.push(
      `<text x="${num(x + width / 2)}" y="${num(y - 8)}" text-anchor="middle" font-size="11" fill="${INK}">${formatMm(length)} mm</text>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}">
<style>text{font-family:"Avenir Next","PingFang SC","Hiragino Sans GB","Noto Sans SC",sans-serif}</style>
${parts.join("\n")}
</svg>
`;
}

function nearDoor(doors: readonly Door[], dir: Direction, line: number, meter: number, positions: readonly number[]): boolean {
  const reach = WALL_THICKNESS / 2;
  for (const door of doors) {
    if (door.dir !== dir || door.line !== line) continue;
    const [start, end] = doorSpanMeters(door, positions);
    if (meter > start - reach - 0.1 && meter < end + reach + 0.1) return true;
  }
  return false;
}
