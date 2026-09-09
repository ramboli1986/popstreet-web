export type CrawlRunLike = {
  status: string | null;
} | null;

export type CrawlRunItemLike = {
  started_at?: string | null;
  heartbeat_at?: string | null;
  lease_expires_at?: string | null;
  snapshot_status?: "unknown" | "partial" | "complete" | "confirmed_empty" | null;
  committed_at?: string | null;
  validation?: Record<string, unknown> | null;
  status: string | null;
};

const activeRunStatuses = new Set(["queued", "running"]);
const skippedItemStatuses = new Set(["skipped", "unsupported"]);
const activeItemStatuses = new Set(["queued", "running"]);
const doneItemStatuses = new Set(["succeeded", "no_units_found", "unavailable", "skipped"]);
const failedItemStatuses = new Set(["failed", "unsupported"]);
const concreteSourceStatuses = new Set(["validated_units_found", "confirmed_no_current_units"]);
const referenceOnlyProviderKeys = new Set(["third_party_ils"]);
export const crawlerDashboardSourcePageSize = 500;
const itemStatusPriority = new Map([
  ["running", 0],
  ["failed", 1],
  ["succeeded", 2],
  ["no_units_found", 2],
  ["queued", 3],
  ["skipped", 4],
  ["unsupported", 4],
  ["unavailable", 4],
]);

export function isCrawlerRunActive(run: CrawlRunLike) {
  return Boolean(run?.status && activeRunStatuses.has(run.status));
}

export function canQueueCrawlerRun({
  activeRun,
  isEnqueueing,
  runnableCount,
}: {
  activeRun: CrawlRunLike;
  isEnqueueing: boolean;
  runnableCount: number;
}) {
  return !isEnqueueing && !isCrawlerRunActive(activeRun) && runnableCount > 0;
}

export function canTriggerCrawlerRun({
  activeRun,
  isEnqueueing,
  queuedItemCount,
  runnableCount,
  runningItemCount,
  staleRunningItemCount,
}: {
  activeRun: CrawlRunLike;
  isEnqueueing: boolean;
  queuedItemCount?: number;
  runnableCount: number;
  runningItemCount?: number;
  staleRunningItemCount?: number;
}) {
  if (isEnqueueing) return false;
  if (activeRun?.status === "running") {
    const running = runningItemCount ?? 1;
    const stale = staleRunningItemCount ?? 0;
    return ((queuedItemCount ?? 0) > 0 || stale > 0) && running === stale;
  }
  if (activeRun?.status === "queued") return true;
  return runnableCount > 0;
}

export function countStaleRunningItems(items: CrawlRunItemLike[], nowMs = Date.now(), staleAfterMs = 120_000) {
  return items.reduce((count, item) => {
    if (item.status !== "running") return count;
    if (item.lease_expires_at) {
      const expiry = Date.parse(item.lease_expires_at);
      return Number.isFinite(expiry) && expiry <= nowMs ? count + 1 : count;
    }
    const lastActivity = Date.parse(item.heartbeat_at ?? item.started_at ?? "");
    return Number.isFinite(lastActivity) && nowMs - lastActivity >= staleAfterMs ? count + 1 : count;
  }, 0);
}

export function describeCrawlerSnapshotQuality(item: CrawlRunItemLike | null) {
  const committed = Boolean(item?.committed_at && item.status && ["succeeded", "unavailable", "no_units_found"].includes(item.status));
  if (committed && item?.snapshot_status === "complete") {
    return { label: "Complete snapshot", tone: "active", note: "Complete snapshot committed. Publish safety checks still apply." };
  }
  if (committed && item?.snapshot_status === "confirmed_empty") {
    return { label: "Confirmed empty", tone: "active", note: "Verified empty snapshot committed. Publish safety checks still apply." };
  }
  if (item?.snapshot_status === "partial") {
    return { label: "Partial snapshot", tone: "pending", note: "Incomplete coverage. Existing inventory is preserved." };
  }
  return { label: "Unverified", tone: "pending", note: "Snapshot completeness is unverified. Existing inventory is preserved." };
}

export function summarizeCrawlerSnapshotQuality(items: CrawlRunItemLike[]) {
  const summary = { complete: 0, confirmedEmpty: 0, partial: 0, unverified: 0 };
  for (const item of items) {
    if (item.status === "queued" || item.status === "running") continue;
    const quality = describeCrawlerSnapshotQuality(item);
    if (quality.label === "Complete snapshot") summary.complete++;
    else if (quality.label === "Confirmed empty") summary.confirmedEmpty++;
    else if (quality.label === "Partial snapshot") summary.partial++;
    else summary.unverified++;
  }
  return summary;
}

export function summarizeCrawlRunItems(items: CrawlRunItemLike[]) {
  const summary = {
    total: items.length,
    queued: 0,
    running: 0,
    succeeded: 0,
    noUnits: 0,
    failed: 0,
    unsupported: 0,
    skipped: 0,
    active: 0,
    processed: 0,
    progressPercentage: 0,
  };

  for (const item of items) {
    const status = item.status ?? "queued";
    if (status === "queued") summary.queued += 1;
    else if (status === "running") summary.running += 1;
    else if (status === "succeeded") summary.succeeded += 1;
    else if (status === "no_units_found") summary.noUnits += 1;
    else if (status === "failed") summary.failed += 1;
    else if (status === "unsupported") summary.unsupported += 1;
    else if (status === "unavailable") summary.noUnits += 1;
    else if (skippedItemStatuses.has(status)) summary.skipped += 1;
    else summary.skipped += 1;
  }

  summary.active = summary.queued + summary.running;
  summary.processed = summary.succeeded + summary.noUnits + summary.failed + summary.unsupported + summary.skipped;
  summary.progressPercentage = summary.total > 0 ? Math.round((summary.processed / summary.total) * 100) : 0;

  return summary;
}

export function sortCrawlRunItemsForDisplay<T extends CrawlRunItemLike>(items: T[]) {
  return [...items].sort((first, second) => {
    const firstPriority = itemStatusPriority.get(first.status ?? "queued") ?? 5;
    const secondPriority = itemStatusPriority.get(second.status ?? "queued") ?? 5;
    return firstPriority - secondPriority;
  });
}

export function mapCrawlRunItemsBySourceId<T extends CrawlRunItemLike & { source_id?: string | null }>(items: T[]) {
  const indexed = new Map<string, T>();
  for (const item of items) {
    if (item.source_id) {
      indexed.set(item.source_id, item);
    }
  }
  return indexed;
}

export type AvailabilityCrawlerSourceLike = {
  availability_url?: string | null;
  building_id?: string | null;
  consecutive_failures?: number | null;
  crawl_enabled?: boolean | null;
  last_verified_at?: string | null;
  latest_error?: string | null;
  latest_status?: string | null;
  parser_strategy?: string | null;
  provider_key?: string | null;
  provider_status?: string | null;
  requires_browser?: boolean | null;
  source_id?: string | null;
  state?: string | null;
};

export type AvailabilityCrawlerBuildingSourceGroup<T extends AvailabilityCrawlerSourceLike> = {
  building_id: string;
  primarySource: T;
  sourceCount: number;
  sources: T[];
};

export type AvailabilityCrawlerRegionFilter = "NJ" | "NY" | "all";

export type AvailabilityCrawlerRegionSummary = {
  buildingCount: number;
  runnableBuildingCount: number;
  runnableSourceCount: number;
  sourceCount: number;
};

export type AvailabilityCrawlerBuildingGroupSummary = {
  attention: number;
  browser: number;
  buildings: number;
  concrete: number;
  disabled: number;
  enabled: number;
  missingURL: number;
  ready: number;
  sources: number;
};

export type AvailabilityCrawlerRunSummaryLike = {
  active: number;
  failed: number;
  processed: number;
  progressPercentage: number;
  queued: number;
  running: number;
  total: number;
};

export type AvailabilityCrawlerOverviewCard = {
  helper: string;
  label: string;
  tone?: "brand" | "danger" | "success";
  value: string;
};

export const defaultAvailabilityCrawlerRegionFilter: AvailabilityCrawlerRegionFilter = "NJ";

export const availabilityCrawlerRegionOptions: { filter: AvailabilityCrawlerRegionFilter; label: string }[] = [
  { filter: "NJ", label: "New Jersey" },
  { filter: "NY", label: "New York" },
  { filter: "all", label: "All markets" },
];

export function isConcreteAvailabilityCrawlerSource(source: AvailabilityCrawlerSourceLike) {
  return Boolean(source.provider_status && concreteSourceStatuses.has(source.provider_status) && source.availability_url);
}

export function isReferenceOnlyAvailabilityCrawlerSource(source: AvailabilityCrawlerSourceLike) {
  return isConcreteAvailabilityCrawlerSource(source) && Boolean(source.provider_key && referenceOnlyProviderKeys.has(source.provider_key));
}

export function isRunnableAvailabilityCrawlerSource(source: AvailabilityCrawlerSourceLike) {
  return (
    isConcreteAvailabilityCrawlerSource(source) &&
    Boolean(source.crawl_enabled) &&
    !isReferenceOnlyAvailabilityCrawlerSource(source) &&
    source.parser_strategy !== "unsupported"
  );
}

export function groupAvailabilityCrawlerSourcesByBuilding<T extends AvailabilityCrawlerSourceLike>(
  sources: T[]
): AvailabilityCrawlerBuildingSourceGroup<T>[] {
  const grouped = new Map<string, T[]>();

  sources.forEach((source, index) => {
    const key = source.building_id || `source:${source.source_id ?? index}`;
    const current = grouped.get(key);
    if (current) {
      current.push(source);
    } else {
      grouped.set(key, [source]);
    }
  });

  return Array.from(grouped.entries()).map(([building_id, buildingSources]) => {
    const sortedSources = sortSourcesForPrimaryRow(buildingSources);
    return {
      building_id,
      primarySource: sortedSources[0],
      sourceCount: buildingSources.length,
      sources: sortedSources,
    };
  });
}

export function countDistinctCrawlerSourceBuildings<T extends AvailabilityCrawlerSourceLike>(sources: T[]) {
  return groupAvailabilityCrawlerSourcesByBuilding(sources).length;
}

export function summarizeAvailabilityCrawlerBuildingGroups<T extends AvailabilityCrawlerSourceLike>(
  groups: AvailabilityCrawlerBuildingSourceGroup<T>[],
  runItemsBySourceId?: ReadonlyMap<string, CrawlRunItemLike>
): AvailabilityCrawlerBuildingGroupSummary {
  const summary: AvailabilityCrawlerBuildingGroupSummary = {
    attention: 0,
    browser: 0,
    buildings: groups.length,
    concrete: 0,
    disabled: 0,
    enabled: 0,
    missingURL: 0,
    ready: 0,
    sources: groups.reduce((total, group) => total + group.sourceCount, 0),
  };

  for (const group of groups) {
    if (isAvailabilityCrawlerBuildingGroupRunnable(group)) summary.ready += 1;
    if (group.sources.some(isConcreteAvailabilityCrawlerSource)) summary.concrete += 1;
    if (group.sources.some((source) => Boolean(source.crawl_enabled))) summary.enabled += 1;
    if (group.sources.some((source) => Boolean(source.requires_browser) && isConcreteAvailabilityCrawlerSource(source))) {
      summary.browser += 1;
    }
    if (!group.sources.some((source) => Boolean(source.availability_url))) summary.missingURL += 1;
    if (!isAvailabilityCrawlerBuildingGroupRunnable(group)) summary.disabled += 1;
    if (doesAvailabilityCrawlerBuildingGroupNeedAttention(group, runItemsBySourceId)) summary.attention += 1;
  }

  return summary;
}

export function isAvailabilityCrawlerBuildingGroupRunnable<T extends AvailabilityCrawlerSourceLike>(
  group: AvailabilityCrawlerBuildingSourceGroup<T>
) {
  return group.sources.some(isRunnableAvailabilityCrawlerSource);
}

export function doesAvailabilityCrawlerBuildingGroupNeedAttention<T extends AvailabilityCrawlerSourceLike>(
  group: AvailabilityCrawlerBuildingSourceGroup<T>,
  runItemsBySourceId?: ReadonlyMap<string, CrawlRunItemLike>
) {
  if (!isAvailabilityCrawlerBuildingGroupRunnable(group)) return true;
  if (sourceHasCrawlerFailureSignal(group.primarySource)) return true;
  return group.sources.some((source) => {
    const item = source.source_id ? runItemsBySourceId?.get(source.source_id) : null;
    if (!item?.status || activeItemStatuses.has(item.status)) return false;
    return describeCrawlerSnapshotQuality(item).tone === "pending";
  });
}

export function matchesAvailabilityCrawlerRegion(
  source: AvailabilityCrawlerSourceLike,
  regionFilter: AvailabilityCrawlerRegionFilter
) {
  if (regionFilter === "all") return true;
  return source.state === regionFilter;
}

export function filterAvailabilityCrawlerSourcesByRegion<T extends AvailabilityCrawlerSourceLike>(
  sources: T[],
  regionFilter: AvailabilityCrawlerRegionFilter
) {
  return sources.filter((source) => matchesAvailabilityCrawlerRegion(source, regionFilter));
}

export function summarizeAvailabilityCrawlerRegions<T extends AvailabilityCrawlerSourceLike>(sources: T[]) {
  return {
    all: summarizeAvailabilityCrawlerRegion(sources),
    NJ: summarizeAvailabilityCrawlerRegion(filterAvailabilityCrawlerSourcesByRegion(sources, "NJ")),
    NY: summarizeAvailabilityCrawlerRegion(filterAvailabilityCrawlerSourcesByRegion(sources, "NY")),
  };
}

export function describeAvailabilityCrawlerRegionFilter(
  regionFilter: AvailabilityCrawlerRegionFilter,
  summary: AvailabilityCrawlerRegionSummary
) {
  const label = availabilityCrawlerRegionOptions.find((option) => option.filter === regionFilter)?.label ?? "Selected market";
  return {
    buildingLabel: `${summary.buildingCount.toLocaleString("en-US")} ${summary.buildingCount === 1 ? "building" : "buildings"}`,
    label,
    runnableLabel: `${summary.runnableBuildingCount.toLocaleString("en-US")} crawl-ready ${
      summary.runnableBuildingCount === 1 ? "building" : "buildings"
    }`,
    sourceLabel: `${summary.sourceCount.toLocaleString("en-US")} source ${
      summary.sourceCount === 1 ? "row" : "rows"
    }`,
  };
}

export function summarizeCrawlerInventory({
  catalogBuildingCount,
  inventoryBuildingCount,
  sourceRecordCount,
}: {
  catalogBuildingCount?: number | null;
  inventoryBuildingCount: number;
  sourceRecordCount: number;
}) {
  return {
    coverageValue: catalogBuildingCount
      ? `${inventoryBuildingCount.toLocaleString("en-US")} / ${catalogBuildingCount.toLocaleString("en-US")}`
      : inventoryBuildingCount.toLocaleString("en-US"),
    coverageHelper: catalogBuildingCount ? "active buildings in crawler inventory" : "buildings in crawler inventory",
    sourceRecordValue: sourceRecordCount.toLocaleString("en-US"),
    sourceRecordHelper: "availability URLs stored under those building rows",
  };
}

export function buildAvailabilityCrawlerOverviewCards({
  attentionCount,
  buildingCount,
  missingURLCount,
  readyBuildingCount,
  regionLabel,
  runSummary,
  sourceCount,
}: {
  attentionCount: number;
  buildingCount: number;
  missingURLCount: number;
  readyBuildingCount: number;
  regionLabel: string;
  runSummary: AvailabilityCrawlerRunSummaryLike;
  sourceCount: number;
}): AvailabilityCrawlerOverviewCard[] {
  return [
    {
      helper: `${readyBuildingCount.toLocaleString("en-US")} crawl-ready · ${sourceCount.toLocaleString("en-US")} source rows`,
      label: `${regionLabel} buildings`,
      value: buildingCount.toLocaleString("en-US"),
    },
    {
      helper: `${runSummary.processed.toLocaleString("en-US")}/${runSummary.total.toLocaleString("en-US")} processed`,
      label: "Current queue",
      tone: "brand",
      value: `${runSummary.progressPercentage}%`,
    },
    {
      helper: `${runSummary.running.toLocaleString("en-US")} running · ${runSummary.queued.toLocaleString("en-US")} queued`,
      label: "Crawling now",
      value: runSummary.active.toLocaleString("en-US"),
    },
    {
      helper: `${missingURLCount.toLocaleString("en-US")} missing URL · ${runSummary.failed.toLocaleString("en-US")} failed in this run`,
      label: "Needs review",
      tone: "danger",
      value: attentionCount.toLocaleString("en-US"),
    },
  ];
}

export function crawlerSourcePageRange(pageIndex: number, pageSize = crawlerDashboardSourcePageSize) {
  const safePageIndex = Math.max(0, Math.floor(pageIndex));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const from = safePageIndex * safePageSize;
  return {
    from,
    to: from + safePageSize - 1,
  };
}

export function shouldContinueCrawlerSourcePaging(rowCount: number, pageSize = crawlerDashboardSourcePageSize) {
  return rowCount >= Math.max(1, Math.floor(pageSize));
}

export type CrawlerRunListState = "active" | "done" | "failed" | "not_started";
export type CrawlerRunListFilter = "all" | CrawlerRunListState;
export type CrawlerSourceFilter = "all" | "ready" | "browser" | "attention" | "missing_url" | "disabled";
export type CrawlerRunListSection<T> = {
  helper: string;
  label: string;
  rows: T[];
  state: CrawlerRunListState;
};

export const defaultCrawlerRunListFilter: CrawlerRunListFilter = "all";

export const crawlerRunListFilterOptions: { filter: CrawlerRunListFilter; label: string }[] = [
  { filter: "all", label: "All tasks" },
  { filter: "active", label: "Crawling now" },
  { filter: "done", label: "Completed" },
  { filter: "failed", label: "Failed" },
  { filter: "not_started", label: "Not started" },
];

export const crawlerSourceFilterOptions: { filter: CrawlerSourceFilter; label: string }[] = [
  { filter: "all", label: "All source types" },
  { filter: "ready", label: "Ready to crawl" },
  { filter: "browser", label: "Needs browser" },
  { filter: "attention", label: "Needs review" },
  { filter: "missing_url", label: "Missing URL" },
  { filter: "disabled", label: "Disabled" },
];

const crawlerRunListSectionOptions: {
  helper: string;
  label: string;
  state: CrawlerRunListState;
}[] = [
  {
    helper: "Running now or queued in the current crawler run.",
    label: "Crawling now",
    state: "active",
  },
  {
    helper: "Processed tasks. Snapshot quality is shown separately from task completion.",
    label: "Completed",
    state: "done",
  },
  {
    helper: "Failed or unsupported rows that need review.",
    label: "Failed",
    state: "failed",
  },
  {
    helper: "Known sources that have not been processed by the current run yet.",
    label: "Not started",
    state: "not_started",
  },
];

export function classifyCrawlerRunListState({
  consecutiveFailures = 0,
  currentRunStatus,
  latestError,
  latestStatus,
}: {
  consecutiveFailures?: number | null;
  currentRunStatus?: string | null;
  latestError?: string | null;
  latestStatus?: string | null;
}): CrawlerRunListState {
  if (currentRunStatus && activeItemStatuses.has(currentRunStatus)) return "active";
  if (currentRunStatus && failedItemStatuses.has(currentRunStatus)) return "failed";
  if (currentRunStatus && doneItemStatuses.has(currentRunStatus)) return "done";

  if (latestError || (consecutiveFailures ?? 0) > 0) return "failed";
  if (latestStatus && failedItemStatuses.has(latestStatus)) return "failed";
  if (latestStatus && doneItemStatuses.has(latestStatus)) return "done";
  return "not_started";
}

export function groupCrawlerRunListSections<T>(
  rows: T[],
  stateForRow: (row: T) => CrawlerRunListState,
  options: { includeEmpty?: boolean } = {}
): CrawlerRunListSection<T>[] {
  const grouped = new Map<CrawlerRunListState, T[]>();
  for (const option of crawlerRunListSectionOptions) {
    grouped.set(option.state, []);
  }

  for (const row of rows) {
    grouped.get(stateForRow(row))?.push(row);
  }

  return crawlerRunListSectionOptions
    .map((option) => ({
      ...option,
      rows: grouped.get(option.state) ?? [],
    }))
    .filter((section) => options.includeEmpty || section.rows.length > 0);
}

export function matchesCrawlerRunListFilter(state: CrawlerRunListState, filter: CrawlerRunListFilter) {
  if (filter === "all") return true;
  return state === filter;
}

export function summarizeCrawlerRunListStateCounts(states: CrawlerRunListState[]) {
  const counts = {
    active: 0,
    all: states.length,
    done: 0,
    failed: 0,
    not_started: 0,
  };

  for (const state of states) {
    counts[state] += 1;
  }

  return counts;
}

export function describeCrawlerRunListFilter(filter: CrawlerRunListFilter, count: number) {
  const countLabel = `${count.toLocaleString("en-US")} ${count === 1 ? "building" : "buildings"}`;

  if (filter === "active") {
    return {
      countLabel,
      helper: "Running now or queued in the current run, like the active download list.",
      title: "Crawling now",
    };
  }

  if (filter === "done") {
    return {
      countLabel,
      helper: "Processed tasks. Completion does not establish snapshot completeness or inventory accuracy.",
      title: "Completed",
    };
  }

  if (filter === "failed") {
    return {
      countLabel,
      helper: "Needs review before these sources can be trusted in automated runs.",
      title: "Failed list",
    };
  }

  if (filter === "not_started") {
    return {
      countLabel,
      helper: "Ready or known sources that have not been processed by the current run yet.",
      title: "Not started",
    };
  }

  return {
    countLabel,
    helper: "The table below is split into Crawling now, Completed, Failed, and Not started, so the run reads like a download queue.",
    title: "All crawler tasks",
  };
}

export function describeCrawlerSourceFilter(filter: CrawlerSourceFilter) {
  if (filter === "ready") {
    return {
      helper: "Sources that already have a verified parser and can be queued now.",
      label: "Ready to crawl",
    };
  }

  if (filter === "browser") {
    return {
      helper: "Sources that need rendered-page crawling instead of a simple static fetch.",
      label: "Needs browser",
    };
  }

  if (filter === "attention") {
    return {
      helper: "Sources that need review because the parser is missing, stale, or recently failed.",
      label: "Needs review",
    };
  }

  if (filter === "missing_url") {
    return {
      helper: "Availability link missing. These buildings need source discovery before crawling.",
      label: "Missing URL",
    };
  }

  if (filter === "disabled") {
    return {
      helper: "Crawler disabled for this source until the availability surface is verified.",
      label: "Disabled",
    };
  }

  return {
    helper: "No source-type filter is applied.",
    label: "All source types",
  };
}

function summarizeAvailabilityCrawlerRegion<T extends AvailabilityCrawlerSourceLike>(
  sources: T[]
): AvailabilityCrawlerRegionSummary {
  return {
    buildingCount: countDistinctCrawlerSourceBuildings(sources),
    runnableBuildingCount: countDistinctCrawlerSourceBuildings(sources.filter(isRunnableAvailabilityCrawlerSource)),
    runnableSourceCount: sources.filter(isRunnableAvailabilityCrawlerSource).length,
    sourceCount: sources.length,
  };
}

function sortSourcesForPrimaryRow<T extends AvailabilityCrawlerSourceLike>(sources: T[]) {
  return [...sources].sort((first, second) => {
    const firstRank = sourcePrimaryRank(first);
    const secondRank = sourcePrimaryRank(second);
    if (firstRank !== secondRank) return secondRank - firstRank;

    const firstId = first.source_id ?? "";
    const secondId = second.source_id ?? "";
    return firstId.localeCompare(secondId);
  });
}

function sourcePrimaryRank(source: AvailabilityCrawlerSourceLike) {
  let rank = 0;
  if (isRunnableAvailabilityCrawlerSource(source)) rank += 1000;
  if (isConcreteAvailabilityCrawlerSource(source)) rank += 500;
  if (source.last_verified_at) rank += 120;
  if (source.provider_status === "validated_units_found") rank += 120;
  if (source.provider_status === "confirmed_no_current_units") rank += 80;
  if (source.availability_url) rank += 60;
  if (source.crawl_enabled) rank += 30;
  if (source.parser_strategy && source.parser_strategy !== "unsupported") rank += 10;
  if (isReferenceOnlyAvailabilityCrawlerSource(source)) rank -= 250;
  return rank;
}

function sourceHasCrawlerFailureSignal(source: AvailabilityCrawlerSourceLike) {
  return Boolean(
    source.latest_error ||
      (source.consecutive_failures ?? 0) > 0 ||
      (source.latest_status && failedItemStatuses.has(source.latest_status))
  );
}
