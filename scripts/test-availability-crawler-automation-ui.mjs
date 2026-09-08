import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const moduleURL = pathToFileURL(resolve(process.cwd(), "src/lib/availability-crawler-automation.ts")).href;
const {
  buildAvailabilityCrawlerAutomationUpdate,
  describeAvailabilityCrawlerAutomation,
} = await import(moduleURL);

const paused = describeAvailabilityCrawlerAutomation({
  automation_enabled: false,
  auto_publish_enabled: true,
  market: "NJ",
  schedule_label: "Daily at 4:00 AM",
  schedule_timezone: "America/New_York",
});

assert.equal(paused.modeLabel, "Manual");
assert.equal(paused.title, "Automatic crawling is paused");
assert.equal(paused.manualControlsAvailable, true);
assert.match(paused.body, /Run crawl/);
assert.match(paused.body, /publish manually/);

const automatic = describeAvailabilityCrawlerAutomation({
  automation_enabled: true,
  auto_publish_enabled: true,
  market: "NJ",
  schedule_label: "Daily at 4:00 AM",
  schedule_timezone: "America/New_York",
});

assert.equal(automatic.modeLabel, "Automatic");
assert.equal(automatic.title, "Automatic crawling is active");
assert.match(automatic.body, /NJ/);
assert.match(automatic.body, /publishes automatically/);

const reviewFirst = describeAvailabilityCrawlerAutomation({
  automation_enabled: true,
  auto_publish_enabled: false,
  market: "ALL",
  schedule_label: "Daily at 4:00 AM",
  schedule_timezone: "America/New_York",
});

assert.match(reviewFirst.body, /waits for manual review and publish/);

assert.deepEqual(
  buildAvailabilityCrawlerAutomationUpdate({ automationEnabled: false }),
  {
    p_automation_enabled: false,
    p_auto_publish_enabled: false,
  },
);

assert.deepEqual(
  buildAvailabilityCrawlerAutomationUpdate({ autoPublishEnabled: true }),
  {
    p_automation_enabled: null,
    p_auto_publish_enabled: true,
  },
);

console.log("availability crawler automation UI helper tests passed");
