import { positionsOf } from "./model.ts";
import type { PlanState, View } from "./types.ts";

export const EXPORT_PAD_LEFT = 200;
export const EXPORT_PAD_TOP = 32;
export const EXPORT_PAD_RIGHT = 116;
export const EXPORT_PAD_BOTTOM = 112;

export function exportLayout(state: PlanState): {
  width: number;
  height: number;
  view: View;
  ppm: number;
  worldWidth: number;
  worldHeight: number;
} {
  const { x, y } = positionsOf(state);
  const worldWidth = Math.max(x[x.length - 1] ?? 0, 0);
  const worldHeight = Math.max(y[y.length - 1] ?? 0, 0);
  const longEdge = Math.max(worldWidth, worldHeight, 100);
  const ppm = Math.min(0.09, 3400 / longEdge);
  return {
    width: Math.ceil(worldWidth * ppm + EXPORT_PAD_LEFT + EXPORT_PAD_RIGHT),
    height: Math.ceil(worldHeight * ppm + EXPORT_PAD_TOP + EXPORT_PAD_BOTTOM),
    ppm,
    worldWidth,
    worldHeight,
    view: { ox: EXPORT_PAD_LEFT, oy: EXPORT_PAD_TOP + worldHeight * ppm, ppm },
  };
}
