import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = resolve(repoRoot, "src/lib/admin-session.ts");
const adminAppPath = resolve(repoRoot, "src/components/admin-app.tsx");

async function loadHelper() {
  assert.ok(existsSync(helperPath), "admin session helper should exist");
  return import(pathToFileURL(helperPath).href);
}

test("admin session timeout helper rejects stalled startup work", async () => {
  const { withTimeout } = await loadHelper();

  await assert.rejects(
    withTimeout(new Promise(() => undefined), 10, "profile timed out"),
    /profile timed out/
  );
});

test("admin startup wraps profile restore in a timeout", () => {
  const source = readFileSync(adminAppPath, "utf8");

  assert.match(
    source,
    /await\s+withTimeout\(\s*loadProfile\(data\.session\),\s*5000,/,
    "AdminApp should not wait forever while restoring account_profiles"
  );
});
