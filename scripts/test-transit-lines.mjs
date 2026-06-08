import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = resolve(repoRoot, "src/lib/transit-lines.ts");

async function loadHelper() {
  assert.ok(existsSync(helperPath), "transit line helper should exist");
  return import(pathToFileURL(helperPath).href);
}

test("normalizes subway and PATH lines with stable ordering", async () => {
  const { normalizeTransitLines } = await loadHelper();

  assert.deepEqual(normalizeTransitLines([" path ", "A", "1", "a", "7", "unknown", ""]), ["1", "7", "A", "PATH"]);
});

test("toggleTransitLine adds and removes canonical values", async () => {
  const { toggleTransitLine } = await loadHelper();

  assert.deepEqual(toggleTransitLine(["path", "A"], "PATH"), ["A"]);
  assert.deepEqual(toggleTransitLine(["A"], "1"), ["1", "A"]);
});
