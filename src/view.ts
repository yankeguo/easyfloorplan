import { clamp } from "./geometry.ts";
import type { Point, View } from "./types.ts";

export function worldToScreen(x: number, y: number, view: View): Point {
  return {
    x: view.ox + x * view.ppm,
    y: view.oy - y * view.ppm,
  };
}

export function screenToWorld(x: number, y: number, view: View): Point {
  return {
    x: (x - view.ox) / view.ppm,
    y: (view.oy - y) / view.ppm,
  };
}

export function zoomAt(view: View, sx: number, sy: number, factor: number, minPpm = 0.008, maxPpm = 0.42): View {
  const ppm = clamp(view.ppm * factor, minPpm, maxPpm);
  const scale = ppm / view.ppm;
  return {
    ox: sx - (sx - view.ox) * scale,
    oy: sy + (view.oy - sy) * scale,
    ppm,
  };
}

export function fitView(width: number, height: number, worldWidth: number, worldHeight: number): View {
  const safeWidth = Math.max(worldWidth, 100);
  const safeHeight = Math.max(worldHeight, 100);
  const padLeft = 96;
  const padRight = 84;
  const padTop = 72;
  const padBottom = 96;
  const innerWidth = Math.max(40, width - padLeft - padRight);
  const innerHeight = Math.max(40, height - padTop - padBottom);
  const ppm = Math.min(innerWidth / safeWidth, innerHeight / safeHeight);
  const ox = padLeft + (innerWidth - safeWidth * ppm) / 2;
  const oy = padTop + (innerHeight - safeHeight * ppm) / 2 + safeHeight * ppm;
  return { ox, oy, ppm };
}
