import assert from "node:assert/strict";
import test from "node:test";
import {
  DOOR_WIDTH,
  addSpan,
  anchorFromMeter,
  computeRuns,
  computeSpaces,
  doorGeometry,
  doorSpanMeters,
  fitDoor,
  gridSpan,
  normalizeDoors,
  mergeSequences,
  prefixSums,
  rebindLabels,
  remapDoors,
  remapEdgeSet,
  remapLabelCells,
  spanCovered,
  yAxisName,
} from "./geometry.js";
import { cellInnerRect, spaceNetArea } from "./geometry.js";
import { fitView, worldToScreen, zoomAt } from "./view.js";

test("prefix sums and axis names", () => {
  assert.deepEqual(prefixSums([3600, 3000, 2400]), [0, 3600, 6600, 9000]);
  assert.deepEqual(mergeSequences([[3900, 3300, 2700], [6000, 3900]]), [3900, 2100, 1200, 2700]);
  assert.deepEqual(mergeSequences([[4000, 4000], [3000, 3000, 3000]]), [3000, 1000, 2000, 2000, 1000]);
  assert.equal(yAxisName(0), "A");
  assert.equal(yAxisName(25), "Z");
  assert.equal(yAxisName(26), "AA");
});

test("grid span only accepts the same reference line", () => {
  assert.equal(gridSpan({ xi: 1, yi: 2 }, { xi: 1, yi: 2 }).ok, false);
  assert.equal(gridSpan({ xi: 0, yi: 0 }, { xi: 2, yi: 1 }).reason, "diagonal");
  assert.deepEqual(gridSpan({ xi: 2, yi: 1 }, { xi: 0, yi: 1 }), {
    ok: true,
    dir: "h",
    line: 1,
    start: 0,
    end: 2,
  });
});

test("collinear edges merge into one wall and a gap splits them", () => {
  const edges = new Set();
  addSpan(edges, "h", 0, 0, 2);
  addSpan(edges, "h", 0, 2, 4);
  assert.deepEqual(computeRuns(edges, "h"), [{ dir: "h", line: 0, start: 0, end: 4 }]);
  edges.delete("h:0:2");
  assert.deepEqual(computeRuns(edges, "h"), [
    { dir: "h", line: 0, start: 0, end: 2 },
    { dir: "h", line: 0, start: 3, end: 4 },
  ]);
});

test("span coverage follows wall edges", () => {
  const edges = new Set(["h:0:0", "h:0:1"]);
  const positions = [0, 2000, 5000];
  assert.equal(spanCovered("h", 0, 500, 1500, edges, positions), true);
  assert.equal(spanCovered("h", 0, 1500, 2500, edges, positions), true);
  edges.delete("h:0:1");
  assert.equal(spanCovered("h", 0, 1500, 2500, edges, positions), false);
  assert.equal(spanCovered("h", 0, 200, 1200, edges, positions), true);
});

test("a door stays on its bay when that bay shrinks", () => {
  const edges = new Set(["h:0:0", "h:0:1"]);
  const door = { id: "d", dir: "h", line: 0, anchor: 0, local: 2500, hinge: "low", side: 1 };
  const fitted = fitDoor(door, edges, [0, 2000, 5000], []);
  assert.ok(fitted);
  const [start, end] = doorSpanMeters(fitted, [0, 2000, 5000]);
  assert.ok(start >= -1e-9);
  assert.ok(end <= 5000 + 1e-9);
  assert.ok(Math.abs(end - start - DOOR_WIDTH) < 1e-9);
  assert.equal(fitDoor(door, edges, [0, 400], []), null);
});

test("doors may touch but may not overlap", () => {
  const edges = new Set(["v:1:0"]);
  const positions = [0, 4000];
  const first = fitDoor(
    { id: "a", dir: "v", line: 1, anchor: 0, local: 0, hinge: "low", side: 1 },
    edges,
    positions,
    [],
  );
  const second = fitDoor(
    { id: "b", dir: "v", line: 1, anchor: 0, local: 1000, hinge: "low", side: 1 },
    edges,
    positions,
    [first],
  );
  assert.equal(positions[second.anchor] + second.local, 1000);
  const blocked = fitDoor(
    { id: "c", dir: "v", line: 1, anchor: 0, local: 400, hinge: "low", side: 1 },
    edges,
    positions,
    [first],
  );
  const blockedStart = positions[blocked.anchor] + blocked.local;
  assert.ok(blockedStart >= 990);
  assert.ok(blockedStart < 1200);
});

test("door leaf is 1000 mm long and opens to the chosen side", () => {
  const horizontal = doorGeometry(
    { dir: "h", line: 0, anchor: 0, local: 500, hinge: "low", side: 1 },
    [0, 4000],
    [0, 3000],
  );
  assert.ok(Math.abs(horizontal.hinge.x - 500) < 1e-9);
  assert.equal(horizontal.hinge.y, 0);
  assert.ok(Math.abs(horizontal.leaf.x - 500) < 1e-9);
  assert.ok(Math.abs(horizontal.leaf.y - 1000) < 1e-9);
  assert.ok(Math.abs(horizontal.closed.x - 1500) < 1e-9);

  const vertical = doorGeometry(
    { dir: "v", line: 1, anchor: 0, local: 0, hinge: "high", side: -1 },
    [0, 4000],
    [0, 3000],
  );
  assert.deepEqual(vertical.hinge, { x: 4000, y: 1000 });
  assert.deepEqual(vertical.leaf, { x: 3000, y: 1000 });
  assert.deepEqual(vertical.closed, { x: 4000, y: 0 });
});

test("normalize is stable", () => {
  const edges = new Set(["h:0:0", "h:0:1"]);
  const xPos = [0, 3000, 6500];
  const doors = [
    { id: "d", dir: "h", line: 0, anchor: 0, local: 400, hinge: "high", side: -1 },
  ];
  const once = normalizeDoors(doors, edges, new Set(), xPos, [0, 1000]);
  const twice = normalizeDoors(once, edges, new Set(), xPos, [0, 1000]);
  assert.deepEqual(twice, once);
});

test("removing a bay remaps walls, doors and labels", () => {
  const hEdges = new Set(["h:0:0", "h:0:1", "h:0:2"]);
  const vEdges = new Set(["v:2:0", "v:3:0"]);
  const oldPositions = prefixSums([3000, 4000, 5000]);
  const nextH = remapEdgeSet(hEdges, "x", 1);
  const nextV = remapEdgeSet(vEdges, "x", 1);
  assert.deepEqual([...nextH].sort(), ["h:0:0", "h:0:1"]);
  assert.deepEqual([...nextV].sort(), ["v:2:0"]);
  const newPositions = prefixSums([3000, 5000]);
  const doors = remapDoors(
    [
      { id: "keep", dir: "h", line: 0, anchor: 2, local: 1500, hinge: "low", side: 1 },
      { id: "drop", dir: "h", line: 0, anchor: 1, local: 1000, hinge: "low", side: 1 },
      { id: "line", dir: "v", line: 3, anchor: 0, local: 200, hinge: "low", side: 1 },
      { id: "gone", dir: "v", line: 2, anchor: 0, local: 200, hinge: "low", side: 1 },
    ],
    "x",
    1,
    oldPositions,
    newPositions,
  );
  const byId = Object.fromEntries(doors.map((door) => [door.id, door]));
  assert.equal(byId.drop, undefined);
  assert.equal(byId.gone, undefined);
  assert.equal(byId.line.line, 2);
  assert.equal(newPositions[byId.keep.anchor] + byId.keep.local, 4500);
  const labels = remapLabelCells(
    [{ id: "l", text: "厅", cells: ["0,0", "1,0", "2,1"] }],
    "x",
    1,
  );
  assert.deepEqual(labels[0].cells, ["0,0", "1,1"]);
});

test("anchor lands on the bay that contains the meter", () => {
  const positions = [0, 3000, 6000, 10000];
  assert.deepEqual(anchorFromMeter(positions, 3000), { anchor: 1, local: 0 });
  assert.deepEqual(anchorFromMeter(positions, 2500), { anchor: 0, local: 2500 });
  assert.deepEqual(anchorFromMeter(positions, 10000), { anchor: 2, local: 4000 });
});

test("zoom keeps the cursor point fixed", () => {
  const view = { ox: 100, oy: 200, ppm: 10 };
  const zoomed = zoomAt(view, 150, 80, 2, 1, 1000);
  assert.equal(zoomed.ppm, 20);
  assert.equal(worldToScreen(5, 12, zoomed).x, 150);
  assert.equal(worldToScreen(5, 12, zoomed).y, 80);
});

test("fit view places the plan inside the padding", () => {
  const view = fitView(800, 600, 10000, 8000);
  const top = worldToScreen(0, 8000, view);
  const bottom = worldToScreen(10000, 0, view);
  assert.ok(top.y >= 72 - 0.01);
  assert.ok(bottom.y <= 600 - 96 + 0.01);
  assert.ok(worldToScreen(0, 0, view).x >= 96 - 0.01);
});

test("room cells stay split by a wall even when the wall has a door", () => {
  const hEdges = new Set();
  const vEdges = new Set();
  addSpan(hEdges, "h", 0, 0, 2);
  addSpan(hEdges, "h", 1, 0, 2);
  addSpan(vEdges, "v", 0, 0, 1);
  addSpan(vEdges, "v", 2, 0, 1);
  addSpan(vEdges, "v", 1, 0, 1);
  const spaces = computeSpaces(2, 1, hEdges, vEdges);
  assert.equal(spaces.length, 2);
  const xPos = [0, 3000, 6000];
  const yPos = [0, 4000];
  const kitchen = spaces.find((space) => space.key === "0,0");
  const rect = cellInnerRect(0, 0, xPos, yPos, hEdges, vEdges);
  assert.equal(spaceNetArea(kitchen, xPos, yPos, hEdges, vEdges), (3000 - 120) * (4000 - 120));
  assert.ok(rect.x1 - rect.x0 < 3000);
});

test("a label follows the space with the larger overlap", () => {
  const labels = [{ id: "l", text: "客厅", cells: ["0,0", "1,0", "1,1"] }];
  const spaces = [
    { cells: [{ c: 0, r: 0 }, { c: 1, r: 0 }], key: "0,0|1,0" },
    { cells: [{ c: 1, r: 1 }], key: "1,1" },
  ];
  const rebound = rebindLabels(labels, spaces);
  assert.equal(rebound.length, 1);
  assert.equal(rebound[0].text, "客厅");
  assert.deepEqual(rebound[0].cells.sort(), ["0,0", "1,0"]);
});
