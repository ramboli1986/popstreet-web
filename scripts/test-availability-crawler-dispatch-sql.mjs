import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, test } from "node:test";

// Isolated real PostgreSQL, never SUPABASE_URL or the developer's existing database.
const root = mkdtempSync(resolve(tmpdir(), "crawler-dispatch-pg-"));
const port = 55489;
const dbArgs = ["-h", root, "-p", String(port), "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"];
const sql = (text) => execFileSync("psql", dbArgs, { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
execFileSync("initdb", ["-D", resolve(root, "db"), "-A", "trust", "--no-locale"], { stdio: "ignore" });
execFileSync("pg_ctl", ["-D", resolve(root, "db"), "-l", resolve(root, "server.log"), "-o", `-k ${root} -p ${port} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore" });
after(() => {
  execFileSync("pg_ctl", ["-D", resolve(root, "db"), "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
  rmSync(root, { recursive: true, force: true });
});
sql(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role',true) $$;
  create function public.can_manage_inventory() returns boolean language sql as $$ select false $$;
  create table public.availability_crawl_runs (id uuid primary key, status text, metadata jsonb default '{}', updated_at timestamptz default now());
  create table public.availability_crawl_run_items (id uuid primary key default gen_random_uuid(), run_id uuid references public.availability_crawl_runs, status text, started_at timestamptz, heartbeat_at timestamptz, lease_expires_at timestamptz, attempt_id uuid);
`);
const migration = resolve("../PopStreet/supabase/migrations/20260908000400_availability_dispatch_reservation.sql");
if (existsSync(migration)) sql(readFileSync(migration, "utf8"));
const run = "11111111-1111-4111-8111-111111111111";
const first = "22222222-2222-4222-8222-222222222222";
const second = "33333333-3333-4333-8333-333333333333";
const service = "set request.jwt.claim.role = 'service_role';";
const reserve = (id = first) => `select public.availability_crawler_reserve_dispatch('${run}','${id}','cloud_run','projects/test/locations/us-east1/jobs/crawler');`;
const reset = (status = "queued", items = "('queued',null)") => {
  sql(`truncate public.availability_crawl_runs cascade; insert into public.availability_crawl_runs(id,status) values ('${run}','${status}');
    insert into public.availability_crawl_run_items(run_id,status,lease_expires_at) select '${run}', s, l::timestamptz from (values ${items}) t(s,l);`);
};
const result = (query) => JSON.parse(sql(service + query));

test("migration defines the atomic server-only dispatch API", () => {
  assert.notEqual(sql("select to_regprocedure('public.availability_crawler_reserve_dispatch(uuid,uuid,text,text)') is not null"), "f");
});

test("two concurrent reservations have exactly one owner", async () => {
  reset();
  const call = (id) => new Promise((resolvePromise, reject) => {
    const child = spawn("psql", dbArgs);
    let output = "", error = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("close", (code) => code ? reject(new Error(error)) : resolvePromise(JSON.parse(output.trim())));
    child.stdin.end(service + reserve(id));
  });
  const results = await Promise.all([call(first), call(second)]);
  assert.equal(results.filter((item) => item.acquired).length, 1);
  assert.equal(results[0].dispatch_id, results[1].dispatch_id);
});

test("completed/reset/missing runs and fresh running leases refuse reservation", () => {
  for (const status of ["succeeded", "partial", "failed", "cancelled"]) {
    reset(status);
    assert.throws(() => result(reserve()), /run_not_active/);
  }
  reset("running", "('running', (now()+interval '5 minutes')::text)");
  assert.throws(() => result(reserve()), /worker_still_active/);
  sql("truncate public.availability_crawl_runs cascade");
  assert.throws(() => result(reserve()), /run_not_found/);
});

test("only stale running work can be reserved without queued items", () => {
  reset("running", "('running', (now()-interval '5 minutes')::text)");
  assert.equal(result(reserve()).acquired, true);
  reset("running", "('running', (now()-interval '5 minutes')::text),('running', (now()+interval '5 minutes')::text)");
  assert.throws(() => result(reserve()), /worker_still_active/);
});

test("uncertain reservations never expire into a second launch and ownership is fenced", () => {
  reset();
  result(reserve());
  result(`select public.availability_crawler_record_dispatch('${run}','${first}','uncertain',null,null);`);
  assert.equal(result(reserve(second)).dispatch_id, first);
  assert.equal(result(reserve(second)).acquired, false);
  assert.throws(() => result(`select public.availability_crawler_record_dispatch('${run}','${second}','launched',null,'wrong');`), /dispatch_not_owned/);
});

test("terminal confirmation is required before a new reservation and old acknowledgments fail", () => {
  reset("running", "('running', (now()-interval '5 minutes')::text)");
  result(reserve());
  result(`select public.availability_crawler_record_dispatch('${run}','${first}','launched','operation','execution');`);
  assert.equal(result(reserve(second)).acquired, false);
  result(`select public.availability_crawler_finish_dispatch('${run}','${first}','execution');`);
  assert.equal(result(reserve(second)).acquired, true);
  assert.throws(() => result(`select public.availability_crawler_record_dispatch('${run}','${first}','uncertain',null,null);`), /dispatch_not_owned/);
});

test("reset between reservation and launch acknowledgment rejects the old owner", () => {
  reset();
  result(reserve());
  sql(`update public.availability_crawl_runs set status='cancelled' where id='${run}'`);
  assert.throws(() => result(`select public.availability_crawler_record_dispatch('${run}','${first}','launched','operation','execution');`), /run_not_active/);
});

test("abandoned reserved-only ownership can expire but old owner cannot launch", () => {
  reset();
  result(reserve());
  assert.equal(result(reserve(second)).acquired, false);
  sql("update public.availability_crawler_dispatches set reserved_at = now() - interval '10 minutes'");
  assert.equal(result(reserve(second)).acquired, true);
  assert.throws(() => result(`select public.availability_crawler_record_dispatch('${run}','${first}','launching',null,null);`), /dispatch_not_owned/);
  result(`select public.availability_crawler_record_dispatch('${run}','${second}','launching',null,null);`);
  sql("update public.availability_crawler_dispatches set reserved_at = now() - interval '10 minutes'");
  assert.equal(result(reserve(first)).acquired, false);
});

test("only definitive rejection of an unconfirmed launch releases reservation", () => {
  reset();
  result(reserve());
  result(`select public.availability_crawler_record_dispatch('${run}','${first}','launching',null,null);`);
  for (const status of [408, 429, 500, 503]) {
    assert.throws(() => result(`select public.availability_crawler_reject_dispatch('${run}','${first}',${status});`), /not_definitive_rejection/);
  }
  result(`select public.availability_crawler_reject_dispatch('${run}','${first}',403);`);
  assert.equal(result(reserve(second)).acquired, true);
});

test("browser database roles cannot forge execution state or reserve workers", () => {
  for (const signature of ["availability_crawler_reserve_dispatch(uuid,uuid,text,text)", "availability_crawler_record_dispatch(uuid,uuid,text,text,text)", "availability_crawler_finish_dispatch(uuid,uuid,text)", "availability_crawler_reject_dispatch(uuid,uuid,integer)"]) {
    for (const role of ["anon", "authenticated"]) {
      assert.equal(sql(`select has_function_privilege('${role}','public.${signature}','execute')`), "f");
    }
    assert.equal(sql(`select has_function_privilege('service_role','public.${signature}','execute')`), "t");
  }
});
