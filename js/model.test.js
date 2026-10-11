import assert from "node:assert/strict";
import test from "node:test";
import { doorSpanMeters, prefixSums, runIsWindow, spaceNetArea } from "./geometry.js";
import {
  addInterval,
  applyGridSpan,
  createSample,
  deserialize,
  labelForSpace,
  normalize,
  placeDoor,
  removeIntervalAt,
  runByKey,
  serialize,
  setIntervalValue,
  setSpaceLabel,
  spacesOf,
  toggleWindow,
} from "./model.js";

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
    assert.ok(Math.abs(end - start - 1) < 1e-9);
    assert.ok(start >= -1e-9);
  }
  const kitchen = spaces.find((space) => space.key === "0,0");
  const net = spaceNetArea(kitchen, x, y, state.hEdges, state.vEdges);
  assert.ok(Math.abs(net - 3.78 * 4.68) < 1e-6);
  const again = deserialize(serialize(state));
  assert.equal(serialize(again), serialize(state));
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
  assert.equal(labelForSpace(state, living)?.text, "客厅");
  assert.equal(labelForSpace(state, upper), null);
});

test("a short wall rejects a door and a diagonal connection is refused", () => {
  const state = createSample();
  state.xIntervals = [0.5];
  state.yIntervals = [2];
  state.hEdges = new Set(["h:0:0"]);
  state.vEdges = new Set();
  state.windowEdges = new Set();
  state.doors = [];
  state.labels = [];
  normalize(state);
  const run = runByKey(state, "h:0:0:1");
  const placed = placeDoor(state, run, 0.25);
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
  assert.equal(setIntervalValue(state, "y", 0, 0.1).ok, false);
  assert.equal(addInterval(state, "y", 2.4).ok, true);
  const renamed = spacesOf(state).find((space) => labelForSpace(state, space)?.text === "次卧");
  assert.ok(renamed);
  const cleared = setSpaceLabel(state, renamed, "   ");
  assert.equal(cleared.ok, true);
  normalize(state);
  assert.equal(labelForSpace(state, renamed), null);
});

test("window toggle covers the whole straight wall", () => {
  const state = createSample();
  const run = runByKey(state, "v:3:0:2");
  assert.equal(runIsWindow(state.windowEdges, run), false);
  toggleWindow(state, run);
  assert.equal(runIsWindow(state.windowEdges, run), true);
  toggleWindow(state, run);
  assert.equal(runIsWindow(state.windowEdges, run), false);
});
