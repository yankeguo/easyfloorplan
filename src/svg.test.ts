import assert from "node:assert/strict";
import { test } from "bun:test";
import { createSample } from "./model.ts";
import { exportPlanSvg } from "./svg.ts";

test("svg export includes bay dimensions, a legend, and no reference-point names", () => {
  const svg = exportPlanSvg(createSample());
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<svg /);
  assert.match(svg, /图例/);
  assert.match(svg, /飘窗/);
  assert.match(svg, /推拉门/);
  assert.match(svg, /门洞 800 mm/);
  assert.match(svg, /3900 mm/);
  assert.match(svg, /3300 mm/);
  assert.match(svg, /2700 mm/);
  assert.match(svg, /9900 mm/);
  assert.match(svg, /7800 mm/);
  assert.match(svg, /厨房/);
  assert.doesNotMatch(svg, />A</);
  assert.doesNotMatch(svg, />B</);
  assert.doesNotMatch(svg, />C</);
});
