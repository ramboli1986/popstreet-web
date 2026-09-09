import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = resolve(repoRoot, "src/lib/availability-crawler-progress.ts");

async function loadHelper() {
  assert.ok(existsSync(helperPath), "availability crawler progress helper should exist");
  return import(pathToFileURL(helperPath).href);
}

test("active crawler run blocks another enqueue", async () => {
  const { canQueueCrawlerRun, canTriggerCrawlerRun } = await loadHelper();

  assert.equal(canQueueCrawlerRun({ activeRun: { status: "queued" }, isEnqueueing: false, runnableCount: 417 }), false);
  assert.equal(canQueueCrawlerRun({ activeRun: { status: "running" }, isEnqueueing: false, runnableCount: 417 }), false);
  assert.equal(canQueueCrawlerRun({ activeRun: { status: "succeeded" }, isEnqueueing: false, runnableCount: 417 }), true);
  assert.equal(canTriggerCrawlerRun({ activeRun: { status: "queued" }, isEnqueueing: false, runnableCount: 417 }), true);
  assert.equal(canTriggerCrawlerRun({ activeRun: { status: "running" }, isEnqueueing: false, runnableCount: 417 }), false);
  assert.equal(
    canTriggerCrawlerRun({ activeRun: { status: "running" }, isEnqueueing: false, queuedItemCount: 409, runnableCount: 417, runningItemCount: 0 }),
    true
  );
  assert.equal(
    canTriggerCrawlerRun({ activeRun: { status: "running" }, isEnqueueing: false, queuedItemCount: 409, runnableCount: 417, runningItemCount: 4 }),
    false
  );
  assert.equal(
    canTriggerCrawlerRun({
      activeRun: { status: "running" },
      isEnqueueing: false,
      queuedItemCount: 409,
      runnableCount: 417,
      runningItemCount: 4,
      staleRunningItemCount: 2,
    }),
    false
  );
  assert.equal(canTriggerCrawlerRun({ activeRun: null, isEnqueueing: false, runnableCount: 417 }), true);
});

test("stale running item count uses the crawler timeout window", async () => {
  const { countStaleRunningItems } = await loadHelper();
  const nowMs = Date.parse("2026-07-31T03:45:00.000Z");

  const staleCount = countStaleRunningItems(
    [
      { status: "running", started_at: "2026-07-31T03:41:00.000Z" },
      { status: "running", started_at: "2026-07-31T03:44:15.000Z" },
      { status: "queued", started_at: "2026-07-31T03:40:00.000Z" },
      { status: "failed", started_at: "2026-07-31T03:40:00.000Z" },
    ],
    nowMs
  );

  assert.equal(staleCount, 1);
});

test("run item progress summarizes queued running and processed states", async () => {
  const { summarizeCrawlRunItems } = await loadHelper();

  const summary = summarizeCrawlRunItems([
    { status: "queued" },
    { status: "running" },
    { status: "succeeded" },
    { status: "no_units_found" },
    { status: "failed" },
    { status: "skipped" },
    { status: "unsupported" },
  ]);

  assert.equal(summary.total, 7);
  assert.equal(summary.queued, 1);
  assert.equal(summary.running, 1);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.noUnits, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.unsupported, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.processed, 5);
  assert.equal(summary.active, 2);
  assert.equal(summary.progressPercentage, 71);
});

test("run item display sorting keeps every building status visible", async () => {
  const { sortCrawlRunItemsForDisplay } = await loadHelper();

  const items = Array.from({ length: 120 }, (_, index) => ({
    id: String(index),
    status: index === 119 ? "running" : "queued",
  }));

  const sorted = sortCrawlRunItemsForDisplay(items);

  assert.equal(sorted.length, 120);
  assert.equal(sorted[0].id, "119");
});

test("run items can be indexed by source id for building rows", async () => {
  const { mapCrawlRunItemsBySourceId } = await loadHelper();

  const indexed = mapCrawlRunItemsBySourceId([
    { id: "item-1", source_id: "source-1", status: "queued" },
    { id: "item-2", source_id: null, status: "running" },
    { id: "item-3", source_id: "source-2", status: "succeeded" },
  ]);

  assert.equal(indexed.size, 2);
  assert.equal(indexed.get("source-1")?.status, "queued");
  assert.equal(indexed.get("source-2")?.status, "succeeded");
  assert.equal(indexed.has(""), false);
});

test("availability source inventory groups rows into distinct buildings", async () => {
  const {
    countDistinctCrawlerSourceBuildings,
    groupAvailabilityCrawlerSourcesByBuilding,
  } = await loadHelper();

  const sources = [
    { building_id: "building-1", source_id: "source-1", building_name: "One", availability_url: "https://one.test/a" },
    { building_id: "building-1", source_id: "source-2", building_name: "One", availability_url: "https://one.test/b" },
    { building_id: "building-2", source_id: "source-3", building_name: "Two", availability_url: "https://two.test/a" },
  ];

  const groups = groupAvailabilityCrawlerSourcesByBuilding(sources);

  assert.equal(countDistinctCrawlerSourceBuildings(sources), 2);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => [group.building_id, group.sourceCount]),
    [
      ["building-1", 2],
      ["building-2", 1],
    ]
  );
});

test("building source groups pick the best crawler source as the primary row", async () => {
  const { groupAvailabilityCrawlerSourcesByBuilding } = await loadHelper();

  const [group] = groupAvailabilityCrawlerSourcesByBuilding([
    {
      availability_url: "https://example.test/floorplans",
      building_id: "building-1",
      building_name: "Example",
      crawl_enabled: false,
      parser_strategy: "official_anchor",
      provider_key: "official_site",
      provider_status: "surface_found_needs_parser",
      requires_browser: true,
      source_id: "source-needs-parser",
    },
    {
      availability_url: "https://example.test/units",
      building_id: "building-1",
      building_name: "Example",
      crawl_enabled: true,
      parser_strategy: "yardi_rentcafe",
      provider_key: "yardi_rentcafe",
      provider_status: "validated_units_found",
      requires_browser: true,
      source_id: "source-validated",
    },
  ]);

  assert.equal(group.sourceCount, 2);
  assert.equal(group.primarySource.source_id, "source-validated");
});

test("crawler inventory summary separates buildings from source records", async () => {
  const { summarizeCrawlerInventory } = await loadHelper();

  const summary = summarizeCrawlerInventory({
    catalogBuildingCount: 741,
    inventoryBuildingCount: 505,
    sourceRecordCount: 1000,
  });

  assert.equal(summary.coverageValue, "505 / 741");
  assert.equal(summary.coverageHelper, "active buildings in crawler inventory");
  assert.equal(summary.sourceRecordValue, "1,000");
  assert.equal(summary.sourceRecordHelper, "availability URLs stored under those building rows");
});

test("crawler dashboard defaults to New Jersey and filters source rows by region", async () => {
  const {
    defaultAvailabilityCrawlerRegionFilter,
    filterAvailabilityCrawlerSourcesByRegion,
    matchesAvailabilityCrawlerRegion,
  } = await loadHelper();

  const sources = [
    { building_id: "nj-1", source_id: "source-nj-1", state: "NJ" },
    { building_id: "ny-1", source_id: "source-ny-1", state: "NY" },
    { building_id: "missing-state", source_id: "source-missing", state: null },
  ];

  assert.equal(defaultAvailabilityCrawlerRegionFilter, "NJ");
  assert.equal(matchesAvailabilityCrawlerRegion(sources[0], "NJ"), true);
  assert.equal(matchesAvailabilityCrawlerRegion(sources[1], "NJ"), false);
  assert.deepEqual(
    filterAvailabilityCrawlerSourcesByRegion(sources, "NJ").map((source) => source.source_id),
    ["source-nj-1"]
  );
  assert.equal(filterAvailabilityCrawlerSourcesByRegion(sources, "all").length, 3);
});

test("crawler region summary counts buildings source rows and runnable sources separately", async () => {
  const {
    summarizeAvailabilityCrawlerRegions,
  } = await loadHelper();

  const sources = [
    {
      availability_url: "https://one.test/availability",
      building_id: "nj-1",
      crawl_enabled: true,
      parser_strategy: "yardi_rentcafe",
      provider_key: "yardi_rentcafe",
      provider_status: "validated_units_found",
      source_id: "source-nj-1",
      state: "NJ",
    },
    {
      availability_url: "https://one.test/floorplans",
      building_id: "nj-1",
      crawl_enabled: false,
      parser_strategy: "unsupported",
      provider_key: "official_site",
      provider_status: "surface_found_needs_parser",
      source_id: "source-nj-2",
      state: "NJ",
    },
    {
      availability_url: "https://two.test/availability",
      building_id: "ny-1",
      crawl_enabled: true,
      parser_strategy: "entrata",
      provider_key: "entrata",
      provider_status: "validated_units_found",
      source_id: "source-ny-1",
      state: "NY",
    },
  ];

  const summary = summarizeAvailabilityCrawlerRegions(sources);

  assert.deepEqual(summary.NJ, {
    buildingCount: 1,
    runnableBuildingCount: 1,
    runnableSourceCount: 1,
    sourceCount: 2,
  });
  assert.deepEqual(summary.NY, {
    buildingCount: 1,
    runnableBuildingCount: 1,
    runnableSourceCount: 1,
    sourceCount: 1,
  });
  assert.deepEqual(summary.all, {
    buildingCount: 2,
    runnableBuildingCount: 2,
    runnableSourceCount: 2,
    sourceCount: 3,
  });
});

test("building-level crawler summary does not count disabled secondary rows as attention", async () => {
  const {
    groupAvailabilityCrawlerSourcesByBuilding,
    summarizeAvailabilityCrawlerBuildingGroups,
  } = await loadHelper();

  const groups = groupAvailabilityCrawlerSourcesByBuilding([
    {
      availability_url: "https://one.test/units",
      building_id: "building-ready",
      crawl_enabled: true,
      latest_error: null,
      latest_status: "succeeded",
      parser_strategy: "yardi_rentcafe",
      provider_key: "yardi_rentcafe",
      provider_status: "validated_units_found",
      requires_browser: true,
      source_id: "ready-source",
    },
    {
      availability_url: "https://one.test/contact",
      building_id: "building-ready",
      crawl_enabled: false,
      latest_error: null,
      latest_status: null,
      parser_strategy: "unsupported",
      provider_key: "official_site",
      provider_status: "contact_or_tour_only",
      requires_browser: false,
      source_id: "secondary-disabled-source",
    },
    {
      availability_url: null,
      building_id: "building-missing",
      crawl_enabled: false,
      latest_error: null,
      latest_status: null,
      parser_strategy: "unsupported",
      provider_key: "official_site",
      provider_status: "no_availability_signal",
      requires_browser: false,
      source_id: "missing-source",
    },
  ]);

  const summary = summarizeAvailabilityCrawlerBuildingGroups(groups);

  assert.equal(summary.buildings, 2);
  assert.equal(summary.ready, 1);
  assert.equal(summary.attention, 1);
  assert.equal(summary.disabled, 1);
  assert.equal(summary.missingURL, 1);
});

test("building source groups prefer newly verified review rows over stale candidate rows", async () => {
  const { groupAvailabilityCrawlerSourcesByBuilding } = await loadHelper();

  const groups = groupAvailabilityCrawlerSourcesByBuilding([
    {
      availability_url: "https://example.com/floorplans/10j?utm_source=popstreet",
      building_id: "building-1",
      crawl_enabled: false,
      last_verified_at: null,
      parser_strategy: "official_inline",
      provider_key: "official_site",
      provider_status: "official_availability_page_found",
      source_id: "old-stale-candidate",
    },
    {
      availability_url: "https://example.com/floorplans/",
      building_id: "building-1",
      crawl_enabled: false,
      last_verified_at: "2026-08-05T12:00:00.000Z",
      parser_strategy: "unsupported",
      provider_key: "official_site",
      provider_status: "contact_or_tour_only",
      source_id: "new-reviewed-contact-only",
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].primarySource.source_id, "new-reviewed-contact-only");
});

test("crawler dashboard source rows are paged past Supabase single-request caps", async () => {
  const {
    crawlerDashboardSourcePageSize,
    crawlerSourcePageRange,
    shouldContinueCrawlerSourcePaging,
  } = await loadHelper();

  assert.ok(crawlerDashboardSourcePageSize < 1000);
  assert.deepEqual(crawlerSourcePageRange(0), { from: 0, to: crawlerDashboardSourcePageSize - 1 });
  assert.deepEqual(crawlerSourcePageRange(1), {
    from: crawlerDashboardSourcePageSize,
    to: crawlerDashboardSourcePageSize * 2 - 1,
  });
  assert.equal(shouldContinueCrawlerSourcePaging(crawlerDashboardSourcePageSize), true);
  assert.equal(shouldContinueCrawlerSourcePaging(464), false);
});

test("browser-rendered legacy concrete sources are not runnable until rediscovery validates them", async () => {
  const { isRunnableAvailabilityCrawlerSource } = await loadHelper();

  assert.equal(
    isRunnableAvailabilityCrawlerSource({
      availability_url: "https://example.com/#/availability",
      crawl_enabled: true,
      parser_strategy: "official_anchor",
      provider_key: "entrata",
      provider_status: "official_availability_page_found",
      requires_browser: true,
    }),
    false
  );

  assert.equal(
    isRunnableAvailabilityCrawlerSource({
      availability_url: "https://example.com/listings",
      crawl_enabled: true,
      parser_strategy: "official_anchor",
      provider_key: "third_party_ils",
      provider_status: "provider_link_found",
      requires_browser: false,
    }),
    false
  );

  assert.equal(
    isRunnableAvailabilityCrawlerSource({
      availability_url: "https://example.com/listings",
      crawl_enabled: true,
      parser_strategy: "unsupported",
      provider_key: "official_site",
      provider_status: "official_availability_page_found",
      requires_browser: true,
    }),
    false
  );
});

test("validated rediscovery statuses drive crawler readiness", async () => {
  const {
    isConcreteAvailabilityCrawlerSource,
    isRunnableAvailabilityCrawlerSource,
  } = await loadHelper();

  const validatedSource = {
    availability_url: "https://www.235grand.com/floorplans",
    crawl_enabled: true,
    parser_strategy: "yardi_rentcafe",
    provider_key: "yardi_rentcafe",
    provider_status: "validated_units_found",
    requires_browser: true,
  };

  const floorplanSummaryOnly = {
    availability_url: "https://heatherwood.com/our-properties/heritage-27-on-27th/floorplan",
    crawl_enabled: false,
    parser_strategy: "next_data_floorplan_summary",
    provider_key: "official_next_data",
    provider_status: "needs_floorplan_drilldown",
    requires_browser: false,
  };

  assert.equal(isConcreteAvailabilityCrawlerSource(validatedSource), true);
  assert.equal(isRunnableAvailabilityCrawlerSource(validatedSource), true);
  assert.equal(isConcreteAvailabilityCrawlerSource(floorplanSummaryOnly), false);
  assert.equal(isRunnableAvailabilityCrawlerSource(floorplanSummaryOnly), false);
});

test("crawler run list status separates active done and failed work", async () => {
  const { classifyCrawlerRunListState, matchesCrawlerRunListFilter } = await loadHelper();

  const activeState = classifyCrawlerRunListState({ currentRunStatus: "running", latestStatus: "succeeded" });
  const queuedState = classifyCrawlerRunListState({ currentRunStatus: "queued", latestStatus: null });
  const doneState = classifyCrawlerRunListState({ currentRunStatus: null, latestStatus: "no_units_found" });
  const unavailableState = classifyCrawlerRunListState({ currentRunStatus: "unavailable", latestStatus: "failed" });
  const failedState = classifyCrawlerRunListState({ currentRunStatus: null, latestStatus: "failed" });
  const untouchedState = classifyCrawlerRunListState({ currentRunStatus: null, latestStatus: null });

  assert.equal(activeState, "active");
  assert.equal(queuedState, "active");
  assert.equal(doneState, "done");
  assert.equal(unavailableState, "done");
  assert.equal(failedState, "failed");
  assert.equal(untouchedState, "not_started");
  assert.equal(matchesCrawlerRunListFilter(activeState, "active"), true);
  assert.equal(matchesCrawlerRunListFilter(doneState, "done"), true);
  assert.equal(matchesCrawlerRunListFilter(failedState, "failed"), true);
  assert.equal(matchesCrawlerRunListFilter(untouchedState, "all"), true);
  assert.equal(matchesCrawlerRunListFilter(untouchedState, "done"), false);
});

test("crawler run list filter copy uses downloader-style buckets", async () => {
  const { crawlerRunListFilterOptions, describeCrawlerRunListFilter } = await loadHelper();

  assert.deepEqual(
    crawlerRunListFilterOptions.map((option) => [option.filter, option.label]),
    [
      ["all", "All tasks"],
      ["active", "Crawling now"],
      ["done", "Completed"],
      ["failed", "Failed"],
      ["not_started", "Not started"],
    ]
  );

  assert.equal(describeCrawlerRunListFilter("active", 3).title, "Crawling now");
  assert.match(describeCrawlerRunListFilter("active", 3).helper, /queued in the current run/);
  assert.equal(describeCrawlerRunListFilter("done", 12).title, "Completed");
  assert.equal(describeCrawlerRunListFilter("failed", 2).helper.includes("Needs review"), true);
  assert.equal(describeCrawlerRunListFilter("not_started", 8).title, "Not started");
  assert.equal(describeCrawlerRunListFilter("all", 17).title, "All crawler tasks");
  assert.equal(describeCrawlerRunListFilter("all", 17).helper.includes("Crawling now, Completed, Failed, and Not started"), true);
  assert.equal(describeCrawlerRunListFilter("all", 17).countLabel, "17 buildings");
});

test("crawler run list defaults to the all-status download queue after enqueue", async () => {
  const { defaultCrawlerRunListFilter, describeCrawlerRunListFilter } = await loadHelper();

  assert.equal(defaultCrawlerRunListFilter, "all");
  assert.equal(describeCrawlerRunListFilter(defaultCrawlerRunListFilter, 42).title, "All crawler tasks");
  assert.match(describeCrawlerRunListFilter(defaultCrawlerRunListFilter, 42).helper, /Crawling now/);
  assert.match(describeCrawlerRunListFilter(defaultCrawlerRunListFilter, 42).helper, /Completed/);
  assert.match(describeCrawlerRunListFilter(defaultCrawlerRunListFilter, 42).helper, /Failed/);
});

test("crawler source filters are secondary table controls", async () => {
  const { crawlerSourceFilterOptions, describeCrawlerSourceFilter } = await loadHelper();

  assert.deepEqual(
    crawlerSourceFilterOptions.map((option) => [option.filter, option.label]),
    [
      ["all", "All source types"],
      ["ready", "Ready to crawl"],
      ["browser", "Needs browser"],
      ["attention", "Needs review"],
      ["missing_url", "Missing URL"],
      ["disabled", "Disabled"],
    ]
  );

  assert.equal(describeCrawlerSourceFilter("all").label, "All source types");
  assert.match(describeCrawlerSourceFilter("missing_url").helper, /availability link/i);
  assert.match(describeCrawlerSourceFilter("disabled").helper, /disabled/i);
});

test("crawler overview cards keep source rows as secondary context", async () => {
  const { buildAvailabilityCrawlerOverviewCards } = await loadHelper();

  const cards = buildAvailabilityCrawlerOverviewCards({
    attentionCount: 12,
    buildingCount: 165,
    missingURLCount: 1,
    readyBuildingCount: 160,
    regionLabel: "New Jersey",
    runSummary: {
      active: 134,
      failed: 6,
      noUnits: 0,
      processed: 27,
      progressPercentage: 17,
      queued: 128,
      running: 6,
      skipped: 0,
      succeeded: 20,
      total: 161,
      unsupported: 0,
    },
    sourceCount: 327,
  });

  assert.deepEqual(
    cards.map((card) => [card.label, card.value, card.helper]),
    [
      ["New Jersey buildings", "165", "160 crawl-ready · 327 source rows"],
      ["Current queue", "17%", "27/161 processed"],
      ["Crawling now", "134", "6 running · 128 queued"],
      ["Needs review", "12", "1 missing URL · 6 failed in this run"],
    ]
  );
});

test("crawler run list groups building rows into downloader-style sections", async () => {
  const { groupCrawlerRunListSections } = await loadHelper();

  const sections = groupCrawlerRunListSections(
    [
      { id: "waiting", state: "not_started" },
      { id: "done", state: "done" },
      { id: "running", state: "active" },
      { id: "failed", state: "failed" },
      { id: "queued", state: "active" },
    ],
    (row) => row.state
  );

  assert.deepEqual(
    sections.map((section) => [section.state, section.label, section.rows.map((row) => row.id)]),
    [
      ["active", "Crawling now", ["running", "queued"]],
      ["done", "Completed", ["done"]],
      ["failed", "Failed", ["failed"]],
      ["not_started", "Not started", ["waiting"]],
    ]
  );
});

test("crawler run list can keep empty downloader-style sections visible", async () => {
  const { groupCrawlerRunListSections } = await loadHelper();

  const sections = groupCrawlerRunListSections(
    [
      { id: "done", state: "done" },
      { id: "failed", state: "failed" },
    ],
    (row) => row.state,
    { includeEmpty: true }
  );

  assert.deepEqual(
    sections.map((section) => [section.state, section.rows.map((row) => row.id)]),
    [
      ["active", []],
      ["done", ["done"]],
      ["failed", ["failed"]],
      ["not_started", []],
    ]
  );
});

test("crawler run list counts summarize download-like status buckets", async () => {
  const { summarizeCrawlerRunListStateCounts } = await loadHelper();

  const counts = summarizeCrawlerRunListStateCounts([
    "active",
    "active",
    "done",
    "done",
    "failed",
    "not_started",
  ]);

  assert.deepEqual(counts, {
    active: 2,
    all: 6,
    done: 2,
    failed: 1,
    not_started: 1,
  });
});
