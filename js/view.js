import { clamp } from "./geometry.js";

export function worldToScreen(x, y, view) {
  return {
    x: view.ox + x * view.ppm,
    y: view.oy - y * view.ppm,
  };
}

export function screenToWorld(x, y, view) {
  return {
    x: (x - view.ox) / view.ppm,
    y: (view.oy - y) / view.ppm,
  };
}

export function zoomAt(view, sx, sy, factor, minPpm = 8, maxPpm = 420) {
  const ppm = clamp(view.ppm * factor, minPpm, maxPpm);
  const scale = ppm / view.ppm;
  return {
    ox: sx - (sx - view.ox) * scale,
    oy: sy + (view.oy - sy) * scale,
    ppm,
  };
}

export function fitView(width, height, worldWidth, worldHeight) {
  const safeWidth = Math.max(worldWidth, 0.1);
  const safeHeight = Math.max(worldHeight, 0.1);
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
