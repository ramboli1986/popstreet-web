import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = resolve(repoRoot, "src/lib/availability-crawler-worker.ts");

async function loadHelper() {
  assert.ok(existsSync(helperPath), "availability crawler worker helper should exist");
  return import(pathToFileURL(helperPath).href);
}

test("worker launch options use service role for long-running Supabase writes", async () => {
  const { buildAvailabilityCrawlerWorkerLaunch } = await loadHelper();

  const launch = buildAvailabilityCrawlerWorkerLaunch({
    repoRoot: "/tmp/PopStreet",
    runId: "4a1d13e7-3d0f-43df-8dc0-02ccd11914e2",
    serviceRoleKey: "service-role-key",
    supabaseUrl: "https://example.supabase.co",
  });

  assert.equal(launch.command, "python3");
  assert.equal(launch.cwd, "/tmp/PopStreet");
  assert.ok(launch.args.includes("/tmp/PopStreet/scripts/availability_crawler.py"));
  assert.ok(launch.args.includes("--run-id"));
  assert.ok(launch.args.includes("4a1d13e7-3d0f-43df-8dc0-02ccd11914e2"));
  assert.deepEqual(readWorkerArg(launch.args, "--batch-size"), "25");
  assert.deepEqual(readWorkerArg(launch.args, "--concurrency"), "12");
  assert.deepEqual(readWorkerArg(launch.args, "--timeout"), "12");
  assert.ok(launch.logPath.endsWith("/tmp/availability-crawler-worker-4a1d13e7-3d0f-43df-8dc0-02ccd11914e2.log"));
  assert.equal(launch.env.SUPABASE_URL, "https://example.supabase.co");
  assert.equal(launch.env.SUPABASE_ANON_KEY, undefined);
  assert.equal(launch.env.SUPABASE_AUTH_TOKEN, undefined);
  assert.equal(launch.env.SUPABASE_SERVICE_ROLE_KEY, "service-role-key");
  assert.equal(launch.env.AVAILABILITY_BROWSER_FALLBACK, undefined);
});

test("worker launch rejects expiring admin session auth fallback", async () => {
  const { buildAvailabilityCrawlerWorkerLaunch } = await loadHelper();

  assert.throws(
    () =>
      buildAvailabilityCrawlerWorkerLaunch({
        repoRoot: "/tmp/PopStreet",
        runId: "4a1d13e7-3d0f-43df-8dc0-02ccd11914e2",
        supabaseUrl: "https://example.supabase.co",
      }),
    /SUPABASE_SERVICE_ROLE_KEY/
  );
});

test("worker launch can explicitly enable rendered browser fallback", async () => {
  const { buildAvailabilityCrawlerWorkerLaunch } = await loadHelper();

  const launch = buildAvailabilityCrawlerWorkerLaunch({
    browserFallback: true,
    repoRoot: "/tmp/PopStreet",
    runId: "4a1d13e7-3d0f-43df-8dc0-02ccd11914e2",
    serviceRoleKey: "service-role-key",
    supabaseUrl: "https://example.supabase.co",
  });

  assert.equal(launch.env.AVAILABILITY_BROWSER_FALLBACK, "1");
});

function readWorkerArg(args, flag) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `${flag} should be present`);
  return args[index + 1];
}
