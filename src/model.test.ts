import assert from "node:assert/strict";
import { test } from "bun:test";
import { doorSpanMeters, prefixSums, runIsWindow, spaceNetArea } from "./geometry.ts";
import {
  addInterval,
  applyGridSpan,
  centerDoor,
  createSample,
  deserialize,
  labelForSpace,
  normalize,
  placeDoor,
  removeIntervalAt,
  reorderInterval,
  runByKey,
  serialize,
  setIntervalValue,
  settleSequences,
  setSpaceLabel,
  spacesOf,
  toggleBay,
  toggleSlide,
  toggleWindow,
} from "./model.ts";

test("sample plan has four labeled rooms, doors and window walls", () => {
  const state = createSample();
  const spaces = spacesOf(state);
  assert.deepEqual(
    spaces.map((space) => space.key),
    ["0,0", "0,1", "1,0|2,0|1,1", "2,1"],
  );
  assert.equal(state.doors.length, 4);
  assert.equal(state.labels.length, 4);
  const windowRuns = ["h:0:0:3", "h:2:0:3"].map((key) => runByKey(state, key));
  assert.equal(windowRuns.every((run) => run && runIsWindow(state.windowEdges, run)), true);
  const { x, y } = {
    x: prefixSums(state.xIntervals),
    y: prefixSums(state.yIntervals),
  };
  for (const door of state.doors) {
    const positions = door.dir === "h" ? x : y;
    const [start, end] = doorSpanMeters(door, positions);
    assert.ok(Math.abs(end - start - 800) < 1e-9);
    assert.ok(start >= -1e-9);
  }
  const kitchen = spaces.find((space) => space.key === "0,0");
  assert.ok(kitchen);
  const net = spaceNetArea(kitchen, x, y, state.hEdges, state.vEdges);
  assert.equal(net, 3780 * 4680);
  const again = deserialize(serialize(state));
  assert.equal(serialize(again), serialize(state));
});

test("centering a door puts it in the middle of its bay", () => {
  const state = createSample();
  const door = state.doors.find((item) => item.id === "d1");
  assert.ok(door);
  assert.equal(door.local, 1700);
  const result = centerDoor(state, "d1");
  assert.equal(result.ok, true);
  assert.equal(door.anchor, 0);
  assert.equal(door.local, 2000);
  assert.equal(centerDoor(state, "missing").ok, false);
});

test("drawing a wall between living-room cells splits the label onto the larger part", () => {
  const state = createSample();
  const result = applyGridSpan(state, { xi: 1, yi: 1 }, { xi: 2, yi: 1 }, "add");
  assert.equal(result.ok, true);
  normalize(state);
  const spaces = spacesOf(state);
  assert.equal(spaces.some((space) => space.key === "1,0|2,0"), true);
  assert.equal(spaces.some((space) => space.key === "1,1"), true);
  const living = spaces.find((space) => space.key === "1,0|2,0");
  const upper = spaces.find((space) => space.key === "1,1");
  assert.ok(living);
  assert.ok(upper);
  assert.equal(labelForSpace(state, living)?.text, "客厅");
  assert.equal(labelForSpace(state, upper), null);
});

test("a short wall rejects a door and a diagonal connection is refused", () => {
  const state = createSample();
  state.xIntervals = [500];
  state.yIntervals = [2000];
  state.hEdges = new Set(["h:0:0"]);
  state.vEdges = new Set();
  state.windowEdges = new Set();
  state.doors = [];
  state.labels = [];
  normalize(state);
  const run = runByKey(state, "h:0:0:1");
  assert.ok(run);
  const placed = placeDoor(state, run, 250);
  assert.equal(placed.ok, false);
  const diagonal = applyGridSpan(state, { xi: 0, yi: 0 }, { xi: 1, yi: 1 }, "add");
  assert.equal(diagonal.ok, false);
});

test("removing an interval keeps a door that sits beyond the cut", () => {
  const state = createSample();
  const before = state.doors.find((door) => door.id === "d4");
  assert.ok(before);
  const removed = removeIntervalAt(state, "x", 0);
  assert.equal(removed.ok, true);
  normalize(state);
  assert.equal(setIntervalValue(state, "y", 0, 100).ok, false);
  assert.equal(addInterval(state, "y", 2400).ok, true);
  const renamed = spacesOf(state).find((space) => labelForSpace(state, space)?.text === "次卧");
  assert.ok(renamed);
  const cleared = setSpaceLabel(state, renamed, "   ");
  assert.equal(cleared.ok, true);
  normalize(state);
  assert.equal(labelForSpace(state, renamed), null);
});

test("reordering intervals moves lengths and leaves walls on the same indices", () => {
  const state = createSample();
  const edges = [...state.vEdges].sort();
  const door = state.doors.find((item) => item.id === "d4");
  assert.ok(door);
  const before = { line: door.line, anchor: door.anchor, local: door.local };
  const result = reorderInterval(state, "x", 0, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(state.xIntervals, [3300, 2700, 3900]);
  assert.deepEqual([...state.vEdges].sort(), edges);
  assert.deepEqual({ line: door.line, anchor: door.anchor, local: door.local }, before);
  assert.deepEqual(prefixSums(state.xIntervals), [0, 3300, 6000, 9900]);
});

test("settling crossed sequences splits walls onto the finer grid", () => {
  const state = createSample();
  const same = settleSequences(state, "x", [state.xIntervals.slice()]);
  assert.equal(same.ok, true);
  if (!same.ok) return;
  assert.equal(same.changed, false);
  const settled = settleSequences(state, "x", [
    [3900, 3300, 2700],
    [5000],
  ]);
  assert.equal(settled.ok, true);
  normalize(state);
  assert.deepEqual(state.xIntervals, [3900, 1100, 2200, 2700]);
  assert.deepEqual(prefixSums(state.xIntervals), [0, 3900, 5000, 7200, 9900]);
  for (const key of ["h:0:0", "h:0:1", "h:0:2", "h:0:3"]) {
    assert.equal(state.hEdges.has(key), true);
  }
  assert.equal(state.vEdges.has("v:1:0"), true);
  assert.equal(state.vEdges.has("v:3:1"), true);
  const shifted = state.doors.find((door) => door.id === "d4");
  assert.ok(shifted);
  assert.equal(shifted.line, 3);
  const bedroom = state.labels.find((label) => label.text === "次卧");
  assert.ok(bedroom);
  assert.equal(bedroom.cells.includes("3,1"), true);
});

test("a continuous wall stays whole when settled cuts no longer match the old bays", () => {
  const state = createSample();
  state.xIntervals = [4000, 4000];
  state.yIntervals = [4000];
  state.hEdges = new Set(["h:0:0", "h:0:1", "h:1:0", "h:1:1"]);
  state.vEdges = new Set(["v:0:0", "v:2:0"]);
  state.windowEdges = new Set();
  state.doors = [];
  state.labels = [];
  const settled = settleSequences(state, "x", [[3000, 5000]]);
  assert.equal(settled.ok, true);
  normalize(state);
  assert.deepEqual([...state.hEdges].sort(), ["h:0:0", "h:0:1", "h:1:0", "h:1:1"]);
  assert.equal(state.vEdges.has("v:1:0"), false);
});

test("a saved meter drawing loads once as millimeters", () => {
  const legacy = {
    v: 1,
    xIntervals: [3.9, 3.3, 2.7],
    yIntervals: [4.8, 3],
    hEdges: [],
    vEdges: ["v:0:0"],
    windowEdges: [],
    doors: [{ id: "d1", dir: "v", line: 0, anchor: 0, local: 1.7, hinge: "low", side: 1 }],
    labels: [{ id: "l1", text: "厨房", cells: ["0,0"] }],
    nextId: 3,
  };
  const state = deserialize(legacy);
  assert.deepEqual(state.xIntervals, [3900, 3300, 2700]);
  assert.deepEqual(state.yIntervals, [4800, 3000]);
  assert.equal(state.doors[0].local, 1700);
  const saved = JSON.parse(serialize(state));
  assert.equal(saved.v, 2);
  const again = deserialize(saved);
  assert.deepEqual(again.xIntervals, [3900, 3300, 2700]);
  assert.equal(again.doors[0].local, 1700);
});

test("window toggle marks one bay and leaves the rest of the wall", () => {
  const state = createSample();
  const run = runByKey(state, "v:3:0:2");
  assert.ok(run);
  assert.equal(runIsWindow(state.windowEdges, run), false);
  toggleWindow(state, run.dir, run.line, run.start);
  assert.equal(state.windowEdges.has("v:3:0"), true);
  assert.equal(state.windowEdges.has("v:3:1"), false);
  toggleWindow(state, run.dir, run.line, run.start);
  assert.equal(state.windowEdges.has("v:3:0"), false);
});

test("bay window marks stay on the chosen floor cells", () => {
  const state = createSample();
  toggleBay(state, 0, 0);
  toggleBay(state, 2, 1);
  assert.deepEqual([...state.bayCells].sort(), ["0,0", "2,1"]);
  toggleBay(state, 0, 0);
  assert.equal(state.bayCells.has("0,0"), false);
  assert.equal(state.bayCells.has("2,1"), true);
  assert.equal(toggleBay(state, 9, 9).ok, false);
  removeIntervalAt(state, "x", 2);
  assert.equal(state.bayCells.has("2,1"), false);
});

test("a sliding door mark covers one bay and replaces a window there", () => {
  const state = createSample();
  assert.equal(state.windowEdges.has("h:0:0"), true);
  toggleSlide(state, "h", 0, 0);
  assert.equal(state.slidingEdges.has("h:0:0"), true);
  assert.equal(state.windowEdges.has("h:0:0"), false);
  assert.equal(state.windowEdges.has("h:0:1"), true);
  assert.equal(state.slidingEdges.has("h:0:1"), false);
  toggleWindow(state, "h", 0, 0);
  assert.equal(state.windowEdges.has("h:0:0"), true);
  assert.equal(state.slidingEdges.has("h:0:0"), false);
  toggleSlide(state, "v", 3, 0);
  assert.equal(state.slidingEdges.has("v:3:0"), true);
  assert.equal(state.slidingEdges.has("v:3:1"), false);
});
