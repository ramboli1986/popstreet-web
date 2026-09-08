import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const moduleURL = pathToFileURL(resolve(process.cwd(), "src/lib/availability-crawler-manual-workflow.ts")).href;
const {
  availabilityCrawlerManualSteps,
  canPublishAvailabilityCrawlerReview,
  describeAvailabilityCrawlerReview,
} = await import(moduleURL);

const runningSteps = availabilityCrawlerManualSteps({
  activeRun: { id: "run-1", status: "running" },
  preview: null,
  published: false,
});
assert.deepEqual(runningSteps.map((step) => step.state), ["active", "waiting", "waiting"]);

const blockedReview = {
  dry_run: true,
  eligible: false,
  failed_count: 3,
  gate_failures: ["success_ratio_below_minimum"],
  market: "NJ",
  run_id: "run-1",
  source_count: 20,
  success_ratio: 0.7,
  preview_fingerprint: "review-version-1",
  complete_source_count: 14,
  confirmed_empty_source_count: 0,
  partial_source_count: 4,
  unknown_source_count: 2,
};
assert.equal(canPublishAvailabilityCrawlerReview(blockedReview, "run-1", "NJ"), false);
assert.match(describeAvailabilityCrawlerReview(blockedReview).title, /Review required/);
assert.match(describeAvailabilityCrawlerReview(blockedReview).body, /70%/);

const readyReview = {
  ...blockedReview,
  eligible: true,
  failed_count: 0,
  gate_failures: [],
  success_ratio: 1,
};
assert.equal(canPublishAvailabilityCrawlerReview(readyReview, "run-1", "NJ"), true);
assert.equal(canPublishAvailabilityCrawlerReview(readyReview, "another-run", "NJ"), false);
assert.equal(canPublishAvailabilityCrawlerReview(readyReview, "run-1", "NY"), false);
assert.match(describeAvailabilityCrawlerReview(readyReview).title, /Ready to publish/);

const readySteps = availabilityCrawlerManualSteps({
  activeRun: null,
  preview: readyReview,
  published: false,
});
assert.deepEqual(readySteps.map((step) => step.state), ["complete", "complete", "active"]);

console.log("availability crawler manual workflow helper tests passed");
