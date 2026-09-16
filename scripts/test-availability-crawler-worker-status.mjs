import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { summarizeCrawlRunItems } from "../src/lib/availability-crawler-progress.ts";
import { crawlerMessages } from "../src/lib/availability-crawler-messages.ts";
import { crawlerWorkerStatusMessage } from "../src/lib/availability-crawler-worker-status.ts";

const require = createRequire(import.meta.url);
const runId = "69f39d1d-93c6-45da-bd35-5436c693afa8";
const job = "projects/test/locations/us-east1/jobs/availability-crawler";
const execution = `${job}/executions/availability-crawler-l9zrd`;
const dispatch = { run_id: runId, dispatch_id: "dispatch-1", mode: "cloud_run", job_name: job, state: "launched", execution_name: execution, operation_name: null };
const items = [
  ...Array.from({ length: 146 }, () => ({ status: "queued" })),
  ...Array.from({ length: 2 }, () => ({ status: "running", lease_expires_at: "2026-09-15T17:10:00Z" })),
  ...Array.from({ length: 8 }, (_, i) => ({ status: "succeeded", observations_created: i === 0 ? 23 : 10 })),
  ...["no_units_found", "unsupported", "failed"].flatMap((status) => [{ status }, { status }]),
];

// Real route and helpers, with only database, Cloud and identity providers stubbed.
function harness(options = {}) {
  const calls = [], reads = [];
  let credentialCalls = 0, dispatchReads = 0;
  const client = {
    rpc: async (name) => {
      calls.push(name);
      assert.equal(name, "can_manage_inventory", "Status must never mutate the database");
      return { data: options.allowed !== false, error: null };
    },
    from(table) {
      reads.push(table);
      const query = {
        select() { return query; }, eq(key, value) { assert.equal(value, runId); return query; },
        order() { return query; },
        async maybeSingle() {
          if (options.dbError) return { data: null, error: { message: "read unavailable" } };
          if (table === "availability_crawl_runs") return { data: options.missing ? null : { id: runId, status: "running", observation_count: 67 }, error: null };
          assert.equal(table, "availability_crawler_dispatches");
          dispatchReads++;
          return { data: options.changeDispatch && dispatchReads > 1 ? { ...dispatch, dispatch_id: "new-owner" } : (options.dispatch === undefined ? dispatch : options.dispatch), error: null };
        },
        async range(from, to) {
          assert.equal(table, "availability_crawl_run_items");
          if (options.itemsError) return { data: null, error: { message: "item read unavailable" } };
          return { data: (options.items ?? items).slice(from, to + 1), error: null };
        },
      };
      return query;
    },
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    assert.ok(existsSync(path), "Read-only worker-status route must exist");
    const loaded = { exports: {} };
    cache.set(path, loaded.exports);
    runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, {
      module: loaded, exports: loaded.exports,
      require(name) {
        if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
        if (name === "@supabase/supabase-js") return { createClient: () => client };
        if (name === "google-auth-library") return { GoogleAuth: class { async getAccessToken() { credentialCalls++; if (options.credentialsError) throw new Error("no credentials"); return "token"; } } };
        if (name.startsWith("@/")) return load(resolve("src", name.slice(2) + ".ts"));
        if (name.startsWith(".")) return load(resolve(dirname(path), name.endsWith(".ts") ? name : name + ".ts"));
        return require(name);
      },
      process: { env: { NODE_ENV: "test", SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" } },
      async fetch(url, init) {
        calls.push(String(url));
        assert.notEqual(init?.method, "POST", "Status must never launch an execution");
        assert.equal(init?.cache, "no-store");
        if (options.cloudError) throw new Error("read timeout");
        if (options.cloudStatus) return Response.json({}, { status: options.cloudStatus });
        const cloud = options.cloud ?? { name: execution, completionTime: "2026-09-15T17:11:00Z", conditions: [{ type: "Completed", state: "CONDITION_FAILED" }], failedCount: 1 };
        return Response.json(String(url).includes("/executions?") ? { executions: options.executions ?? [] } : cloud);
      },
      Request, Response, URL, AbortSignal, Error, Date, console,
    }, { filename: path });
    return loaded.exports;
  }
  const route = load(resolve("src/app/api/availability-crawler/worker-status/route.ts"));
  return {
    invoke: () => route.GET(new Request(`http://localhost/api/availability-crawler/worker-status?runId=${options.runId ?? runId}`, { headers: options.noAuth ? {} : { authorization: "Bearer admin" } })),
    calls, reads, get credentialCalls() { return credentialCalls; },
  };
}

test("live outage counts come from 162 items, not stale run summary", () => {
  const summary = summarizeCrawlRunItems(items);
  assert.equal(summary.total, 162);
  assert.equal(summary.processed, 14);
  assert.equal(summary.active, 148);
  assert.equal(summary.observationsCreated, 93);
});

test("every worker state has truthful Chinese and English copy", () => {
  for (const state of ["failed", "succeeded_unfinished", "succeeded", "running", "unknown"]) {
    const key = crawlerWorkerStatusMessage(state).replace("crawler.", "");
    assert.ok(crawlerMessages.en[key], `Missing English ${state}`);
    assert.match(crawlerMessages.zh[key] ?? "", /[\u3400-\u9fff]/u);
  }
  assert.match(crawlerMessages.en.workerInterrupted, /interrupted/i);
  assert.match(crawlerMessages.en.workerUnknown, /cannot confirm/i);
  assert.doesNotMatch(crawlerMessages.en.workerUnknown, /has stopped|failed/i);
  assert.equal(crawlerMessages.en.parsedSources, "Parsed sources");
});

test("dashboard checks active run only, wires cleanup and uses item observation counts", () => {
  const source = readFileSync(resolve("src/components/availability-crawler-dashboard.tsx"), "utf8");
  assert.match(source, /if \(!activeRunId \|\| isEnqueueing\) return/);
  assert.match(source, /return pollCrawlerWorkerStatus/);
  assert.match(source, /document.visibilityState === "visible"/);
  assert.match(source, /worker-status\?runId=/);
  assert.match(source, /workerStatus\?\.runId === activeRunId/);
  assert.match(source, /summary.observationsCreated/);
  assert.match(source, /crawler.resumeRun/);
  assert.match(source, /workerState !== "running" \? t\("crawler.claimedTaskNote"\)/);
  assert.doesNotMatch(source, /}, 3000\)/);
});

test("verified failed execution reports interruption without releasing or launching", async () => {
  const h = harness();
  const response = await h.invoke();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const body = await response.json();
  assert.equal(body.runId, runId);
  assert.equal(body.workerState, "failed");
  assert.equal(body.execution, execution);
  assert.equal(body.resumable, true);
  assert.equal(body.counts.observationsCreated, 93);
  assert.equal(body.counts.queued, 146);
  assert.equal(body.counts.running, 2);
  assert.equal(body.counts.staleRunning, 2);
  assert.equal(body.counts.processed, 14);
  assert.equal(h.calls.filter((call) => call === "can_manage_inventory").length, 1);
});

for (const [label, cloud, expected] of [
  ["success with unfinished items", { completionTime: "2026-09-15T17:11:00Z", succeededCount: 1, taskCount: 1 }, "succeeded_unfinished"],
  ["still running despite expired DB leases", { runningCount: 1, startTime: "2026-09-15T17:00:00Z" }, "running"],
  ["failed task while execution is retrying", { failedCount: 1, runningCount: 1 }, "running"],
  ["malformed response", {}, "unknown"],
  ["terminal without outcome", { completionTime: "2026-09-15T17:11:00Z" }, "unknown"],
]) {
  test(label, async () => {
    const body = await (await harness({ cloud: { name: execution, ...cloud } }).invoke()).json();
    assert.equal(body.workerState, expected);
    assert.equal(body.resumable, expected === "succeeded_unfinished");
  });
}

test("successful execution with no remaining items is complete, not resumable", async () => {
  const body = await (await harness({ cloud: { name: execution, completionTime: "today", conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED" }] }, items: [{ status: "succeeded" }] }).invoke()).json();
  assert.equal(body.workerState, "succeeded");
  assert.equal(body.resumable, false);
});

for (const options of [{ cloudStatus: 403 }, { cloudStatus: 404 }, { cloudStatus: 503 }, { cloudError: true }, { credentialsError: true }, { dispatch: null }, { dispatch: { ...dispatch, mode: "local_development" } }, { changeDispatch: true }]) {
  test(`unverified inspection stays unknown ${JSON.stringify(options)}`, async () => {
    const body = await (await harness(options).invoke()).json();
    assert.equal(body.workerState, "unknown");
    assert.equal(body.resumable, false);
  });
}

test("operation-only launch recovers exact identity without writing it back", async () => {
  const owned = { name: execution, completionTime: "today", failedCount: 1, template: { containers: [{ env: [{ name: "AVAILABILITY_CRAWLER_DISPATCH_ID", value: dispatch.dispatch_id }], args: ["worker-loop", "--run-id", runId] }] } };
  for (const matching of [true, false]) {
    const h = harness({ dispatch: { ...dispatch, execution_name: null }, executions: [{ ...owned, template: matching ? owned.template : { containers: [] } }] });
    const body = await (await h.invoke()).json();
    assert.equal(body.workerState, matching ? "failed" : "unknown");
    assert.ok(!h.calls.some((call) => call.includes("/operations/")));
  }
});

test("item counts page beyond database row cap", async () => {
  const body = await (await harness({ items: Array.from({ length: 1103 }, () => ({ status: "queued", observations_created: 1 })) }).invoke()).json();
  assert.equal(body.counts.total, 1103);
  assert.equal(body.counts.observationsCreated, 1103);
});

for (const [options, status] of [[{ noAuth: true }, 401], [{ allowed: false }, 403], [{ runId: "bad" }, 400], [{ missing: true }, 404], [{ dbError: true }, 503], [{ itemsError: true }, 503]]) {
  test(`authorization/read guard ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    assert.equal((await h.invoke()).status, status);
    assert.equal(h.credentialCalls, 0);
    assert.ok(!h.calls.some((call) => call.startsWith("https:")));
  });
}
