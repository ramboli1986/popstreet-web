import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = resolve(repoRoot, "src/lib/unit-description-labels.ts");

async function loadHelper() {
  assert.ok(existsSync(helperPath), "unit description label helper should exist");
  return import(pathToFileURL(helperPath).href);
}

test("unit description label options include core unit traits and exclude building amenities", async () => {
  const { unitDescriptionLabelOptions } = await loadHelper();
  const values = unitDescriptionLabelOptions.map((option) => option.value);

  assert.ok(values.includes("High Floor"));
  assert.ok(values.includes("Corner Unit"));
  assert.ok(values.includes("South Facing"));
  assert.ok(values.includes("River View"));
  assert.ok(!values.includes("In-unit Laundry"));
});

test("normalizes selected labels while preserving custom labels", async () => {
  const { normalizeUnitDescriptionLabels } = await loadHelper();

  assert.deepEqual(
    normalizeUnitDescriptionLabels([" high floor ", "High Floor", "south-facing", "Custom View", ""]),
    ["High Floor", "South Facing", "Custom View"]
  );
});

test("does not promote laundry amenities into fixed unit labels", async () => {
  const { normalizeUnitDescriptionLabels } = await loadHelper();

  assert.deepEqual(normalizeUnitDescriptionLabels(["washer dryer"]), ["washer dryer"]);
});

test("toggleUnitDescriptionLabel adds and removes by canonical value", async () => {
  const { toggleUnitDescriptionLabel } = await loadHelper();

  assert.deepEqual(toggleUnitDescriptionLabel(["high floor"], "High Floor"), []);
  assert.deepEqual(toggleUnitDescriptionLabel(["River View"], "South Facing"), ["River View", "South Facing"]);
});
