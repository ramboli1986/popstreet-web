import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const runId = "11111111-1111-4111-8111-111111111111";
const operation = "projects/test/locations/us-east1/operations/launch-1";
const execution = "projects/test/locations/us-east1/jobs/crawler/executions/worker-1";

// Execute the real route with only external services replaced. No Cloud jobs or live DB writes.
function harness({ status = "queued", uncertain = false, failConfirm = false, terminal = false, httpStatus = 200, recovery = null, operationOnly = false, existingReservation = null, inspectionStatus = 200, inspectionError = null } = {}) {
  let reservation = existingReservation;
  let launches = 0;
  let launchBody = null;
  const calls = [];
  const reads = [];
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "can_manage_inventory") return { data: true, error: null };
      if (!["queued", "running"].includes(status)) return { data: null, error: { message: "run_not_active" } };
      if (name === "availability_crawler_reserve_dispatch") {
        if (reservation) return { data: { ...reservation, acquired: false }, error: null };
        reservation = { dispatch_id: args.p_dispatch_id, run_id: runId, mode: args.p_mode, job_name: args.p_job_name, state: "reserved", operation_name: null, execution_name: null };
        return { data: { ...reservation, acquired: true }, error: null };
      }
      if (name === "availability_crawler_record_dispatch") {
        if (failConfirm && args.p_state === "launched") return { data: null, error: { message: "database response lost" } };
        if (args.p_dispatch_id !== reservation.dispatch_id) return { data: null, error: { message: "dispatch_not_owned" } };
        reservation = { ...reservation, state: args.p_state, operation_name: args.p_operation_name ?? reservation.operation_name, execution_name: args.p_execution_name ?? reservation.execution_name };
        return { data: reservation, error: null };
      }
      if (name === "availability_crawler_finish_dispatch") {
        if (args.p_dispatch_id !== reservation.dispatch_id) return { data: null, error: { message: "dispatch_not_owned" } };
        reservation = null;
        return { data: { finished: true }, error: null };
      }
      if (name === "availability_crawler_reject_dispatch") {
        reservation = null;
        return { data: { rejected: true }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const fetchMock = async (url, options = {}) => {
    if (options.method === "POST") {
      launches++;
      launchBody = JSON.parse(options.body);
      if (uncertain) throw new Error("connection closed after Cloud acceptance");
      if (httpStatus !== 200) return Response.json({ error: { message: "Cloud permission denied" } }, { status: httpStatus });
      return Response.json({ name: operation, ...(operationOnly ? {} : { metadata: { name: execution } }) });
    }
    reads.push(String(url));
    if (inspectionError) throw new Error(inspectionError);
    if (inspectionStatus !== 200) return Response.json({ error: { message: "Missing run.executions.get permission" } }, { status: inspectionStatus });
    if (String(url).includes("/executions?")) {
      const container = structuredClone(launchBody?.overrides.containerOverrides[0]);
      if (recovery === "wrong-run") container.args = ["worker-loop", "--run-id", "different-run"];
      if (recovery === "wrong-owner") container.env[0].value = "different-owner";
      return Response.json({ executions: recovery ? [{ name: execution, template: { containers: [container] } }] : [] });
    }
    return Response.json({ name: execution, ...(terminal ? { completionTime: "2026-09-08T12:00:00Z" } : {}) });
  };
  const env = { NODE_ENV: "test", SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service", AVAILABILITY_CRAWLER_GCP_PROJECT_ID: "test", AVAILABILITY_CRAWLER_CLOUD_RUN_JOB: "crawler" };
  const cache = new Map();
  const load = (path) => {
    if (cache.has(path)) return cache.get(path);
    const loaded = { exports: {} };
    cache.set(path, loaded.exports);
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    runInNewContext(code, {
      module: loaded, exports: loaded.exports,
      require: (name) => {
        if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
        if (name === "@supabase/supabase-js") return { createClient: () => client };
        if (name === "google-auth-library") return { GoogleAuth: class { async getAccessToken() { return "test-token"; } } };
        if (name.startsWith("@/")) return load(resolve("src", name.slice(2) + ".ts"));
        return require(name);
      },
      process: { env, cwd: () => process.cwd() }, fetch: fetchMock, Request, Response, URL, AbortSignal, Error, setTimeout, clearTimeout, console,
    }, { filename: path });
    return loaded.exports;
  };
  const { POST } = load(resolve("src/app/api/availability-crawler/start-worker/route.ts"));
  return {
    invoke: () => POST(new Request("http://localhost/api/availability-crawler/start-worker", { method: "POST", headers: { authorization: "Bearer admin" }, body: JSON.stringify({ runId }) })),
    get launches() { return launches; },
    get reservation() { return reservation; },
    calls,
    reads,
  };
}

test("duplicate handler invocations launch once and return the existing execution", async () => {
  const h = harness();
  const responses = await Promise.all([h.invoke(), h.invoke()]);
  assert.equal(h.launches, 1);
  assert.ok(responses.every((response) => response.ok));
  const replay = await (await h.invoke()).json();
  assert.equal(replay.execution, execution);
  assert.equal(replay.operation, operation);
  assert.equal(replay.reused, true);
  assert.equal(h.launches, 1);
});

for (const failure of [{ inspectionStatus: 403 }, { inspectionError: "Cloud connection timed out" }]) {
  test(`execution inspection failure is actionable and preserves ownership (${JSON.stringify(failure)})`, async () => {
    const existingReservation = {
      dispatch_id: "22222222-2222-4222-8222-222222222222", run_id: runId,
      mode: "cloud_run", job_name: "projects/test/locations/us-east1/jobs/crawler",
      state: "launched", operation_name: operation, execution_name: execution,
    };
    const h = harness({ ...failure, status: "running", existingReservation });
    const response = await h.invoke();
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.match(body.error, /Could not reconcile existing Cloud execution/);
    assert.match(body.error, failure.inspectionStatus ? /403.*run\.executions\.get/ : /timed out/);
    assert.equal(body.started, undefined);
    assert.equal(h.launches, 0);
    assert.deepEqual(h.reservation, existingReservation);
    assert.ok(!h.calls.some(([name]) => /finish_dispatch|reject_dispatch|record_dispatch/.test(name)));
  });
}

for (const httpStatus of [400, 401, 403, 404, 422]) {
  test(`definitive Cloud ${httpStatus} surfaces its error and releases only that reservation`, async () => {
    const h = harness({ httpStatus });
    const response = await h.invoke();
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Cloud permission denied/);
    assert.equal(h.reservation, null);
    await h.invoke();
    assert.equal(h.launches, 2);
  });
}

for (const httpStatus of [408, 429, 500, 503]) {
  test(`ambiguous Cloud ${httpStatus} retains ownership`, async () => {
    const h = harness({ httpStatus });
    assert.equal((await h.invoke()).status, 202);
    await h.invoke();
    assert.equal(h.launches, 1);
  });
}

test("Cloud acceptance with lost response keeps reservation ownership and never relaunches", async () => {
  const h = harness({ uncertain: true });
  const first = await h.invoke();
  assert.equal(first.status, 202);
  assert.equal((await first.json()).pending, true);
  const owner = h.reservation.dispatch_id;
  await h.invoke();
  assert.equal(h.launches, 1);
  assert.equal(h.reservation.dispatch_id, owner);
});

test("lost Cloud response recovers exact execution by dispatch environment and run", async () => {
  const h = harness({ uncertain: true, recovery: "matching" });
  await h.invoke();
  const response = await (await h.invoke()).json();
  assert.equal(response.execution, execution);
  assert.equal(response.pending, false);
  assert.equal(h.launches, 1);
});

test("operation-only acknowledgment reconciles with job executions and never reads regional operations", async () => {
  const h = harness({ operationOnly: true, recovery: "matching" });
  const initial = await (await h.invoke()).json();
  assert.equal(initial.operation, operation);
  assert.equal(initial.execution, null);
  const confirmed = await (await h.invoke()).json();
  assert.equal(confirmed.execution, execution);
  assert.equal(h.launches, 1);
  assert.ok(h.reads.some((url) => url.includes("/jobs/crawler/executions?")));
  assert.ok(!h.reads.some((url) => url.includes("/operations/")), "Must not rely on regional operations IAM");
});

for (const recovery of ["wrong-run", "wrong-owner"]) {
  test(`recovery refuses an execution with ${recovery}`, async () => {
    const h = harness({ uncertain: true, recovery });
    await h.invoke();
    assert.equal((await h.invoke()).status, 202);
    assert.equal(h.reservation.execution_name, null);
    assert.equal(h.launches, 1);
  });
}

test("Cloud success followed by database confirmation failure never frees the reservation", async () => {
  const h = harness({ failConfirm: true });
  assert.equal((await h.invoke()).status, 202);
  await h.invoke();
  assert.equal(h.launches, 1);
  assert.ok(h.reservation);
});

for (const status of ["succeeded", "partial", "failed", "cancelled"]) {
  test(`${status} run refuses launch before contacting Cloud`, async () => {
    const h = harness({ status });
    assert.equal((await h.invoke()).status, 409);
    assert.equal(h.launches, 0);
  });
}

test("terminal execution allows an atomic re-reservation for stale-running-only recovery", async () => {
  const h = harness({ status: "running", terminal: true });
  await h.invoke();
  const owner = h.reservation.dispatch_id;
  await h.invoke();
  assert.equal(h.launches, 2);
  assert.notEqual(h.reservation.dispatch_id, owner);
  assert.ok(h.calls.some(([name]) => name === "availability_crawler_finish_dispatch"));
});
