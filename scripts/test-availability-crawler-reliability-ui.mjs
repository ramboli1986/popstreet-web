import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as progress from "../src/lib/availability-crawler-progress.ts";
import * as workflow from "../src/lib/availability-crawler-manual-workflow.ts";

test("stale-running-only run is resumable but mixed live leases are not", () => {
  const input = { activeRun: { status: "running" }, isEnqueueing: false, queuedItemCount: 0, runnableCount: 1, runningItemCount: 2, staleRunningItemCount: 2 };
  assert.equal(progress.canTriggerCrawlerRun(input), true);
  assert.equal(progress.canTriggerCrawlerRun({ ...input, staleRunningItemCount: 1 }), false);
  assert.equal(progress.canTriggerCrawlerRun({ ...input, isEnqueueing: true }), false);
});

test("staleness uses leases, then heartbeat; old start time cannot override a live lease", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  assert.equal(progress.countStaleRunningItems([
    { status: "running", started_at: "2026-09-08T10:00:00Z", lease_expires_at: "2026-09-08T12:01:00Z" },
    { status: "running", started_at: "2026-09-08T10:00:00Z", heartbeat_at: "2026-09-08T11:59:50Z" },
    { status: "running", lease_expires_at: "2026-09-08T11:59:00Z" },
  ], now), 1);
});

test("quality does not infer completeness or empty inventory from execution success", () => {
  assert.equal(typeof progress.describeCrawlerSnapshotQuality, "function");
  const describe = progress.describeCrawlerSnapshotQuality;
  assert.equal(describe({ status: "succeeded" }).label, "Unverified");
  assert.equal(describe({ status: "unavailable" }).label, "Unverified");
  assert.equal(describe({ status: "succeeded", snapshot_status: "partial", committed_at: "today" }).label, "Partial snapshot");
  assert.equal(describe({ status: "succeeded", snapshot_status: "complete", committed_at: "today" }).label, "Complete snapshot");
  assert.equal(describe({ status: "unavailable", snapshot_status: "confirmed_empty", committed_at: "today" }).label, "Confirmed empty");
  assert.equal(describe({ status: "failed", snapshot_status: "complete" }).label, "Unverified");
});

test("publish requires a versioned preview and never accepts legacy status-only approval", () => {
  const review = { dry_run: true, eligible: true, run_id: "run", market: "NJ", source_count: 2, success_ratio: 1, gate_failures: [], failed_count: 0 };
  assert.equal(workflow.canPublishAvailabilityCrawlerReview(review, "run", "NJ"), false);
  assert.equal(workflow.canPublishAvailabilityCrawlerReview({ ...review, preview_fingerprint: "version" }, "run", "NJ"), true);
  assert.doesNotMatch(workflow.describeAvailabilityCrawlerReview(review).body, /completed reliably/);
});

test("launch confirmation remains pending across 202 responses", async () => {
  assert.equal(typeof workflow.confirmAvailabilityCrawlerLaunch, "function");
  let calls = 0, confirmed = false, release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const work = workflow.confirmAvailabilityCrawlerLaunch(async () => {
    calls++;
    if (calls === 1) return Response.json({ pending: true, started: false }, { status: 202 });
    await barrier;
    return Response.json({ pending: false, started: true, execution: "worker" });
  }, { pause: async () => undefined }).then(() => { confirmed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(confirmed, false);
  release();
  await work;
  assert.equal(confirmed, true);
});

test("dashboard polling projects compact quality fields without validation evidence or source HTML", () => {
  const source = readFileSync(new URL("../src/components/availability-crawler-dashboard.tsx", import.meta.url), "utf8");
  const projection = source.match(/\.from\("availability_crawl_run_items"\)\s*\.select\(\s*"([^"]+)"/)[1];
  assert.match(projection, /snapshot_status/);
  assert.match(projection, /committed_at/);
  assert.match(projection, /lease_expires_at/);
  assert.doesNotMatch(projection, /\bvalidation\b|source_html|evidence|requests|\*/);
});

test("nonfailed partial and unknown snapshots count as review buildings, deduping sources", () => {
  const sources = [
    { building_id: "a", source_id: "a1" }, { building_id: "a", source_id: "a2" },
    { building_id: "b", source_id: "b1" }, { building_id: "c", source_id: "c1" },
  ].map((source) => ({ ...source, provider_status: "validated_units_found", crawl_enabled: true, availability_url: "https://example.invalid", parser_strategy: "official_units_api" }));
  const groups = progress.groupAvailabilityCrawlerSourcesByBuilding(sources);
  const items = new Map([
    ["a1", { status: "succeeded", snapshot_status: "partial", committed_at: "today" }],
    ["a2", { status: "succeeded", snapshot_status: "unknown", committed_at: "today" }],
    ["b1", { status: "succeeded", snapshot_status: "unknown", committed_at: "today" }],
    ["c1", { status: "succeeded", snapshot_status: "complete", committed_at: "today" }],
  ]);
  assert.equal(progress.summarizeAvailabilityCrawlerBuildingGroups(groups, items).attention, 2);
  assert.deepEqual(groups.filter((group) => progress.doesAvailabilityCrawlerBuildingGroupNeedAttention(group, items)).map((group) => group.building_id), ["a", "b"]);
  items.set("b1", { status: "running", snapshot_status: "unknown" });
  assert.equal(progress.summarizeAvailabilityCrawlerBuildingGroups(groups, items).attention, 1);
});
