import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = resolve(repoRoot, "src/lib/building-description-labels.ts");

async function loadHelper() {
  assert.ok(existsSync(helperPath), "building description label helper should exist");
  return import(pathToFileURL(helperPath).href);
}

test("building description label options only include building type and location feel", async () => {
  const { buildingDescriptionLabelGroups, buildingDescriptionLabelOptions } = await loadHelper();
  const groupTitles = buildingDescriptionLabelGroups.map((group) => group.title);
  const values = buildingDescriptionLabelOptions.map((option) => option.value);

  assert.deepEqual(groupTitles, ["Building Type", "Transit / Location Feel"]);
  assert.ok(values.includes("High Rise"));
  assert.ok(values.includes("Low Rise"));
  assert.ok(values.includes("New Development"));
  assert.ok(values.includes("Near Subway"));
  assert.ok(values.includes("Waterfront"));
  assert.ok(!values.includes("Gym"));
  assert.ok(!values.includes("Doorman"));
  assert.ok(!values.includes("In-unit Laundry"));
  assert.ok(!values.includes("Pet Friendly"));
});

test("normalizes building label aliases while preserving custom labels", async () => {
  const { normalizeBuildingDescriptionLabels } = await loadHelper();

  assert.deepEqual(
    normalizeBuildingDescriptionLabels([" high-rise ", "new building", "near path", "Glenwood Management", ""]),
    ["High Rise", "New Development", "Near PATH", "Glenwood Management"]
  );
});

test("toggleBuildingDescriptionLabel adds and removes by canonical value", async () => {
  const { toggleBuildingDescriptionLabel } = await loadHelper();

  assert.deepEqual(toggleBuildingDescriptionLabel(["high rise"], "High Rise"), []);
  assert.deepEqual(toggleBuildingDescriptionLabel(["Waterfront"], "Quiet Street"), ["Waterfront", "Quiet Street"]);
});
