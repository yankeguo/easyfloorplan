export type Axis = "x" | "y";
export type Direction = "h" | "v";
export type Tool = "select" | "wall" | "erase" | "door" | "window" | "slide" | "label";
export type Hinge = "low" | "high";
export type Side = 1 | -1;

export interface Door {
  id: string;
  dir: Direction;
  line: number;
  anchor: number;
  local: number;
  hinge: Hinge;
  side: Side;
}

export interface Label {
  id: string;
  text: string;
  cells: string[];
}

export interface PlanState {
  xIntervals: number[];
  yIntervals: number[];
  hEdges: Set<string>;
  vEdges: Set<string>;
  windowEdges: Set<string>;
  slidingEdges: Set<string>;
  doors: Door[];
  labels: Label[];
  nextId: number;
}

export interface Run {
  dir: Direction;
  line: number;
  start: number;
  end: number;
}

export interface GridPoint {
  xi: number;
  yi: number;
}

export interface GridSpan {
  ok: true;
  dir: Direction;
  line: number;
  start: number;
  end: number;
}

export type GridSpanResult = GridSpan | { ok: false; reason: "same" | "diagonal" };

export interface Cell {
  c: number;
  r: number;
}

export interface Space {
  cells: Cell[];
  key: string;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface DoorGeometry {
  start: number;
  end: number;
  cross: number;
}

export interface View {
  ox: number;
  oy: number;
  ppm: number;
}

export interface ActionOk {
  ok: true;
  changed?: boolean;
  message?: string;
  intervals?: number[];
  id?: string;
  span?: GridSpan;
  on?: boolean;
}

export interface ActionErr {
  ok: false;
  message?: string;
}

export type ActionResult = ActionOk | ActionErr;

export type Selection =
  | { type: "wall"; key: string }
  | { type: "door"; id: string }
  | { type: "space"; key: string };

export interface Preview {
  dir: Direction;
  line: number;
  start: number;
  end: number;
  mode: "add" | "erase" | "wall";
}

export interface HitPoint extends GridPoint {
  dist: number;
}

export interface HitWall {
  run: Run;
  dist: number;
  meter: number;
}

export interface HitDoor {
  door: Door;
  dist: number;
}

export interface Hit {
  world: Point;
  point: HitPoint | null;
  door: HitDoor | null;
  wall: HitWall | null;
  space: Space | null;
}

export interface Scene {
  state: PlanState;
  view: View;
  tool: Tool;
  anchor: GridPoint | null;
  hoverPoint: GridPoint | null;
  hoverRun: Run | null;
  preview: Preview | null;
  selection: Selection | null;
  exporting: boolean;
}
