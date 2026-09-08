"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  CheckCircle2,
  DatabaseZap,
  ExternalLink,
  MoreHorizontal,
  RefreshCcw,
  Search,
  SearchCode,
  XCircle
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  availabilityCrawlerManualSteps,
  canPublishAvailabilityCrawlerReview,
  confirmAvailabilityCrawlerLaunch,
  describeAvailabilityCrawlerReview,
  type AvailabilityCrawlerManualReview,
} from "@/lib/availability-crawler-manual-workflow";
import {
  availabilityCrawlerRegionOptions,
  buildAvailabilityCrawlerOverviewCards,
  canQueueCrawlerRun,
  canTriggerCrawlerRun,
  classifyCrawlerRunListState,
  countStaleRunningItems,
  describeCrawlerSnapshotQuality,
  crawlerDashboardSourcePageSize,
  crawlerRunListFilterOptions,
  crawlerSourceFilterOptions,
  crawlerSourcePageRange,
  defaultAvailabilityCrawlerRegionFilter,
  defaultCrawlerRunListFilter,
  describeAvailabilityCrawlerRegionFilter,
  describeCrawlerRunListFilter,
  describeCrawlerSourceFilter,
  doesAvailabilityCrawlerBuildingGroupNeedAttention,
  groupCrawlerRunListSections,
  groupAvailabilityCrawlerSourcesByBuilding,
  isConcreteAvailabilityCrawlerSource,
  isAvailabilityCrawlerBuildingGroupRunnable,
  isCrawlerRunActive,
  isReferenceOnlyAvailabilityCrawlerSource,
  isRunnableAvailabilityCrawlerSource,
  matchesCrawlerRunListFilter,
  mapCrawlRunItemsBySourceId,
  shouldContinueCrawlerSourcePaging,
  sortCrawlRunItemsForDisplay,
  summarizeAvailabilityCrawlerBuildingGroups,
  summarizeAvailabilityCrawlerRegions,
  summarizeCrawlerRunListStateCounts,
  summarizeCrawlerSnapshotQuality,
  summarizeCrawlRunItems
} from "@/lib/availability-crawler-progress";
import type {
  AvailabilityCrawlerBuildingSourceGroup,
  AvailabilityCrawlerRegionFilter,
  CrawlerSourceFilter,
  CrawlerRunListFilter
} from "@/lib/availability-crawler-progress";
import { formatDate } from "@/lib/format";
import type {
  AvailabilityCrawlRun,
  AvailabilityCrawlRunItem,
  AvailabilityCrawlerDashboardRow
} from "@/lib/types";

const latestFailureStatuses = new Set(["failed", "unsupported"]);

type CrawlerBuildingGroup = AvailabilityCrawlerBuildingSourceGroup<AvailabilityCrawlerDashboardRow>;

type InventoryPublishResult = {
  dry_run: boolean;
  market: string;
  run_id?: string;
  source_count: number;
  candidate_observation_count: number;
  skipped_observation_count: number;
  created_unit_count: number;
  updated_unit_count: number;
  created_listing_count: number;
  updated_listing_count: number;
  marked_unavailable_count: number;
  reset_existing_inventory?: boolean;
  reset_available_listing_count?: number;
  publish_run_id?: string;
} & Partial<AvailabilityCrawlerManualReview>;

export function AvailabilityCrawlerDashboard() {
  const [sources, setSources] = useState<AvailabilityCrawlerDashboardRow[]>([]);
  const [runs, setRuns] = useState<AvailabilityCrawlRun[]>([]);
  const [runItems, setRunItems] = useState<AvailabilityCrawlRunItem[]>([]);
  const [regionFilter, setRegionFilter] = useState<AvailabilityCrawlerRegionFilter>(defaultAvailabilityCrawlerRegionFilter);
  const [runStateFilter, setRunStateFilter] = useState<CrawlerRunListFilter>(defaultCrawlerRunListFilter);
  const [activeFilter, setActiveFilter] = useState<CrawlerSourceFilter>("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [strategyFilter, setStrategyFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isEnqueueing, setIsEnqueueing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isPreviewingPublish, setIsPreviewingPublish] = useState(false);
  const [isPublishingInventory, setIsPublishingInventory] = useState(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enqueueMessage, setEnqueueMessage] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<InventoryPublishResult | null>(null);
  const enqueueInFlight = useRef(false);
  const launchAbort = useRef<AbortController | null>(null);

  useEffect(() => () => launchAbort.current?.abort(), []);

  const loadCrawlerDashboard = useCallback(async (options?: { quiet?: boolean }) => {
    if (!options?.quiet) {
      setIsLoading(true);
      setError(null);
    }

    const [sourcesResult, runsResult] = await Promise.all([
      loadAllCrawlerSourceRows(regionFilter),
      supabase
        .from("availability_crawl_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(25)
    ]);

    if (!options?.quiet) {
      setIsLoading(false);
    }

    if (sourcesResult.error || runsResult.error) {
      setError(
        sourcesResult.error?.message ??
          runsResult.error?.message ??
          "Could not load crawler dashboard."
      );
      return;
    }

    const loadedRuns = (runsResult.data ?? []) as AvailabilityCrawlRun[];
    const runForProgress = loadedRuns.find(isCrawlerRunActive) ?? loadedRuns[0] ?? null;
    let loadedRunItems: AvailabilityCrawlRunItem[] = [];

    if (runForProgress) {
      const runItemsResult = await supabase
        .from("availability_crawl_run_items")
        .select(
          "id, run_id, source_id, building_id, provider_key, parser_strategy, status, snapshot_status, committed_at, attempt_id, lease_expires_at, heartbeat_at, started_at, finished_at, units_found, observations_created, changes_detected, error, buildings(name, area, city, state)"
        )
        .eq("run_id", runForProgress.id)
        .order("created_at", { ascending: true })
        .limit(1000);

      if (runItemsResult.error) {
        setError(runItemsResult.error.message);
        return;
      }

      loadedRunItems = normalizeRunItemRows(runItemsResult.data ?? []);
    }

    setSources((sourcesResult.data ?? []) as AvailabilityCrawlerDashboardRow[]);
    setRuns(loadedRuns);
    setRunItems(loadedRunItems);
  }, [regionFilter]);

  useEffect(() => {
    loadCrawlerDashboard();
  }, [loadCrawlerDashboard]);

  useEffect(() => {
    setRunStateFilter(defaultCrawlerRunListFilter);
    setActiveFilter("all");
    setProviderFilter("all");
    setStrategyFilter("all");
    setSearchQuery("");
    setPublishResult(null);
  }, [regionFilter]);

  const latestRun = runs[0] ?? null;
  const activeRun = useMemo(() => runs.find(isCrawlerRunActive) ?? null, [runs]);
  const latestPublishableRun = useMemo(
    () => runs.find((run) => run.status === "succeeded" || run.status === "partial") ?? null,
    [runs]
  );
  const progressRun = activeRun ?? latestRun;
  const hasActiveRun = Boolean(activeRun);
  const publishReview = publishResult?.dry_run ? publishResult as AvailabilityCrawlerManualReview : null;
  const workflowSteps = useMemo(
    () => availabilityCrawlerManualSteps({
      activeRun,
      preview: publishReview,
      published: Boolean(publishResult && !publishResult.dry_run),
    }),
    [activeRun, publishResult, publishReview],
  );

  useEffect(() => {
    setPublishResult(null);
  }, [latestPublishableRun?.id, latestPublishableRun?.finished_at, latestPublishableRun?.observation_count, regionFilter]);

  useEffect(() => {
    if (!hasActiveRun) return undefined;
    const timer = window.setInterval(() => {
      loadCrawlerDashboard({ quiet: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasActiveRun, loadCrawlerDashboard]);

  const regionSummaries = useMemo(() => summarizeAvailabilityCrawlerRegions(sources), [sources]);
  const selectedRegionSummary = regionSummaries[regionFilter];
  const selectedRegionCopy = describeAvailabilityCrawlerRegionFilter(regionFilter, selectedRegionSummary);

  const allBuildingGroups = useMemo(() => groupAvailabilityCrawlerSourcesByBuilding(sources), [sources]);
  const runItemsBySourceId = useMemo(() => mapCrawlRunItemsBySourceId(runItems), [runItems]);

  const totals = useMemo(() => {
    const buildingSummary = summarizeAvailabilityCrawlerBuildingGroups(allBuildingGroups, runItemsBySourceId);
    return {
      ...buildingSummary,
      observed: allBuildingGroups.reduce((total, group) => total + (group.primarySource.latest_units_found ?? 0), 0),
      changes7d: allBuildingGroups.reduce((total, group) => total + group.primarySource.change_count_7d, 0)
    };
  }, [allBuildingGroups, runItemsBySourceId]);

  const providerOptions = useMemo(() => {
    const grouped = new Map<string, { key: string; label: string; count: number }>();
    for (const source of sources) {
      const current = grouped.get(source.provider_key);
      if (current) {
        current.count += 1;
      } else {
        grouped.set(source.provider_key, {
          key: source.provider_key,
          label: providerLabel(source.provider_label, source.provider_key),
          count: 1
        });
      }
    }
    return Array.from(grouped.values()).sort((first, second) => second.count - first.count || first.label.localeCompare(second.label));
  }, [sources]);

  const strategyOptions = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const source of sources) {
      grouped.set(source.parser_strategy, (grouped.get(source.parser_strategy) ?? 0) + 1);
    }
    return Array.from(grouped.entries())
      .map(([strategy, count]) => ({ strategy, count }))
      .sort((first, second) => second.count - first.count || first.strategy.localeCompare(second.strategy));
  }, [sources]);

  const sourceFilteredBuildingGroups = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return allBuildingGroups.filter((group) => {
      if (!matchesBuildingGroupFilter(group, activeFilter, runItemsBySourceId)) return false;
      if (providerFilter !== "all" && !group.sources.some((source) => source.provider_key === providerFilter)) return false;
      if (strategyFilter !== "all" && !group.sources.some((source) => source.parser_strategy === strategyFilter)) return false;
      if (!normalizedQuery) return true;

      return group.sources.some((source) => sourceMatchesSearchQuery(source, normalizedQuery));
    });
  }, [activeFilter, allBuildingGroups, providerFilter, runItemsBySourceId, searchQuery, strategyFilter]);

  const runnableSources = useMemo(() => sources.filter(isRunnableSource), [sources]);
  const sourceIdsInSelectedRegion = useMemo(() => new Set(sources.map((source) => source.source_id)), [sources]);
  const scopedRunItems = useMemo(
    () => runItems.filter((item) => item.source_id && sourceIdsInSelectedRegion.has(item.source_id)),
    [runItems, sourceIdsInSelectedRegion]
  );
  const runItemSummary = useMemo(() => summarizeCrawlRunItems(scopedRunItems), [scopedRunItems]);
  const snapshotSummary = useMemo(() => summarizeCrawlerSnapshotQuality(scopedRunItems), [scopedRunItems]);
  const staleRunningItemCount = useMemo(() => countStaleRunningItems(scopedRunItems), [scopedRunItems]);
  const activeRunHasOutOfRegionSources = Boolean(activeRun && runItems.length > 0 && scopedRunItems.length < runItems.length);
  const runListCounts = useMemo(() => {
    return summarizeCrawlerRunListStateCounts(
      sourceFilteredBuildingGroups.map((group) => crawlerRunStateForGroup(group, runItemsBySourceId))
    );
  }, [runItemsBySourceId, sourceFilteredBuildingGroups]);
  const filteredBuildingGroups = useMemo(
    () =>
      sourceFilteredBuildingGroups.filter((group) =>
        matchesCrawlerRunListFilter(crawlerRunStateForGroup(group, runItemsBySourceId), runStateFilter)
      ),
    [runItemsBySourceId, runStateFilter, sourceFilteredBuildingGroups]
  );
  const runListView = useMemo(
    () => describeCrawlerRunListFilter(runStateFilter, filteredBuildingGroups.length),
    [filteredBuildingGroups.length, runStateFilter]
  );
  const sourceFilterCopy = useMemo(() => describeCrawlerSourceFilter(activeFilter), [activeFilter]);
  const hasTableFilters =
    activeFilter !== "all" ||
    providerFilter !== "all" ||
    strategyFilter !== "all" ||
    searchQuery.trim().length > 0;
  const filteredRunnableSources = useMemo(
    () => filteredBuildingGroups.flatMap((group) => group.sources).filter(isRunnableSource),
    [filteredBuildingGroups]
  );
  const overviewCards = useMemo(
    () =>
      buildAvailabilityCrawlerOverviewCards({
        attentionCount: totals.attention,
        buildingCount: totals.buildings,
        missingURLCount: totals.missingURL,
        readyBuildingCount: totals.ready,
        regionLabel: selectedRegionCopy.label,
        runSummary: runItemSummary,
        sourceCount: totals.sources,
      }),
    [runItemSummary, selectedRegionCopy.label, totals.attention, totals.buildings, totals.missingURL, totals.ready, totals.sources]
  );
  const canRestartStalledRun =
    activeRun?.status === "running" &&
    (runItemSummary.queued > 0 || staleRunningItemCount > 0) &&
    runItemSummary.running === staleRunningItemCount;
  const canRunSelectedRegion =
    !activeRunHasOutOfRegionSources &&
    canTriggerCrawlerRun({
      activeRun,
      isEnqueueing: isEnqueueing || isResetting,
      queuedItemCount: runItemSummary.queued,
      runnableCount: runnableSources.length,
      runningItemCount: runItemSummary.running,
      staleRunningItemCount
    });
  const runButtonTitle =
    activeRunHasOutOfRegionSources
      ? `Reset the current all-market run before starting a ${selectedRegionCopy.label}-only run`
      : activeRun?.status === "queued" || canRestartStalledRun
      ? "Check existing execution and resume recoverable tasks"
      : activeRun?.status === "running"
        ? "Crawler worker is already running"
        : undefined;

  const startCrawlerWorker = useCallback(async (runId: string, sourceCount?: number) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      throw new Error("Please sign in again before starting the crawler worker.");
    }

    launchAbort.current = new AbortController();
    const signal = launchAbort.current.signal;
    setEnqueueMessage("Confirming worker launch. An existing execution will be reused.");
    await confirmAvailabilityCrawlerLaunch(() => fetch("/api/availability-crawler/start-worker", {
      body: JSON.stringify({ browserFallback: true, maxItems: sourceCount, runId }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    }), { signal });
  }, []);

  const enqueueRun = useCallback(
    async ({
      maxSources = 1000,
      sourceIds = null
    }: {
      maxSources?: number;
      sourceIds?: string[] | null;
    }) => {
      if (enqueueInFlight.current) return;
      enqueueInFlight.current = true;
      setIsEnqueueing(true);
      setError(null);
      setEnqueueMessage(null);
      setPublishResult(null);

      try {
        // Resuming must not enqueue another run after a concurrent reset.
        if (activeRun) {
          await startCrawlerWorker(activeRun.id);
          setEnqueueMessage("Worker launch confirmed for the existing run.");
          await loadCrawlerDashboard({ quiet: true });
          return;
        }
        const { data, error: rpcError } = await supabase.rpc("availability_crawler_enqueue_run", {
          p_source_ids: sourceIds,
          p_provider_key: null,
          p_parser_strategy: null,
          p_include_browser: true,
          p_trigger_source: "manual",
          p_max_sources: maxSources
        });

        if (rpcError) throw new Error(rpcError.message);

        const result = data as { run_id?: string; source_count?: number; status?: string; reused?: boolean } | null;
        if (result?.run_id) {
          await startCrawlerWorker(result.run_id, result.source_count);
        } else {
          throw new Error("The crawler run was not confirmed. Refresh before trying again.");
        }
        setRunStateFilter(defaultCrawlerRunListFilter);
        setEnqueueMessage(
          result?.reused
            ? `Using the active ${result.status ?? "queued"} run with ${result.source_count ?? 0} building sources. Worker launch confirmed.`
            : `Queued ${result?.source_count ?? 0} ${selectedRegionCopy.label} building sources. Worker launch confirmed.`
        );
        await loadCrawlerDashboard({ quiet: true });
      } catch (workerError) {
        await loadCrawlerDashboard({ quiet: true });
        setError(workerError instanceof Error ? workerError.message : "Could not confirm the crawler worker.");
        setEnqueueMessage(null);
      } finally {
        enqueueInFlight.current = false;
        setIsEnqueueing(false);
      }
    },
    [activeRun, loadCrawlerDashboard, selectedRegionCopy.label, startCrawlerWorker]
  );

  const resetActiveRun = useCallback(async () => {
    if (!activeRun) return;
    const confirmed = window.confirm(
      "Reset the current crawler run? This clears queued/running item status so you can start a fresh run. Parsed observations and history will stay."
    );
    if (!confirmed) return;

    setIsResetting(true);
    setPublishResult(null);
    setError(null);
    setEnqueueMessage(null);

    const { data, error: rpcError } = await supabase.rpc("availability_crawler_reset_active_run", {
      p_run_id: activeRun.id,
    });

    setIsResetting(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const result = data as { reset?: boolean; skipped_unfinished_item_count?: number } | null;
    setEnqueueMessage(
      result?.reset
        ? `Reset current crawler run. ${result.skipped_unfinished_item_count ?? 0} queued/running items cleared.`
        : "No active crawler run to reset."
    );
    await loadCrawlerDashboard({ quiet: true });
  }, [activeRun, loadCrawlerDashboard]);

  const clearTableFilters = useCallback(() => {
    setActiveFilter("all");
    setProviderFilter("all");
    setStrategyFilter("all");
    setSearchQuery("");
  }, []);

  const changeSourceFilter = useCallback((filter: CrawlerSourceFilter) => {
    setActiveFilter(filter);
    setRunStateFilter(defaultCrawlerRunListFilter);
  }, []);

  const previewInventoryPublish = useCallback(async () => {
    if (!latestPublishableRun) {
      setError("Run the crawler first, then preview the latest completed run before publishing.");
      return;
    }

    setIsPreviewingPublish(true);
    setPublishResult(null);
    setError(null);
    setEnqueueMessage(null);

    const { data, error: rpcError } = await supabase.rpc("availability_crawler_review_run", {
      p_market: regionFilter,
      p_run_id: latestPublishableRun.id,
      p_reset_existing_inventory: false,
    });

    setIsPreviewingPublish(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setPublishResult(data as InventoryPublishResult);
  }, [latestPublishableRun, regionFilter]);

  const publishLatestInventory = useCallback(async () => {
    if (!latestPublishableRun || !canPublishAvailabilityCrawlerReview(publishReview, latestPublishableRun.id, regionFilter)) {
      setError("Run the crawler first, then preview the latest completed run before publishing.");
      return;
    }

    const confirmed = window.confirm(
      `Publish the reviewed ${selectedRegionCopy.label} changes from run ${shortRunId(latestPublishableRun.id)}? ${publishResult?.marked_unavailable_count ?? 0} listings will be marked unavailable.`
    );
    if (!confirmed) return;

    setIsPublishingInventory(true);
    setError(null);
    setEnqueueMessage(null);

    const { data, error: rpcError } = await supabase.rpc("availability_crawler_publish_reviewed_run", {
      p_market: regionFilter,
      p_run_id: latestPublishableRun.id,
      p_reset_existing_inventory: false,
      p_preview_fingerprint: publishReview?.preview_fingerprint,
    });

    setIsPublishingInventory(false);

    if (rpcError) {
      setPublishResult(null);
      setError(rpcError.message);
      return;
    }

    const result = data as InventoryPublishResult;
    setPublishResult(result);
    setEnqueueMessage(formatInventoryPublishMessage(result, selectedRegionCopy.label));
    await loadCrawlerDashboard({ quiet: true });
  }, [latestPublishableRun, loadCrawlerDashboard, publishResult, publishReview, regionFilter, selectedRegionCopy.label]);

  return (
    <div className="crawler-page">
      <div className="page-hero crawler-hero">
        <div>
          <div className="eyebrow">Availability crawler</div>
          <h1>Availability crawler queue</h1>
          <p>
            Track each building like a download task: what is crawling now, what finished, what failed, and what
            has not started yet.
          </p>
        </div>
        <div className="page-actions crawler-actions">
          <label className="crawler-region-picker">
            <span>Area</span>
            <select
              value={regionFilter}
              onChange={(event) => setRegionFilter(event.target.value as AvailabilityCrawlerRegionFilter)}
            >
              {availabilityCrawlerRegionOptions.map((option) => (
                <option key={option.filter} value={option.filter}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button crawler-primary-action"
            aria-busy={isEnqueueing}
            disabled={!canRunSelectedRegion}
            onClick={() => enqueueRun({ sourceIds: runnableSources.slice(0, 1000).map((source) => source.source_id) })}
            title={runButtonTitle}
            type="button"
          >
            <Bot size={16} />
            {isEnqueueing ? "Starting" : `Run ${regionFilter === "all" ? "crawler" : regionFilter}`}
          </button>
          <button
            className="ghost-button crawler-refresh-action"
            disabled={isLoading}
            onClick={() => loadCrawlerDashboard()}
            type="button"
          >
            <RefreshCcw size={15} />
            {isLoading ? "Refreshing" : "Refresh"}
          </button>
          <div className="crawler-action-menu">
            <button
              aria-expanded={isActionMenuOpen}
              aria-label="More crawler actions"
              className="ghost-button crawler-menu-trigger"
              onClick={() => setIsActionMenuOpen((isOpen) => !isOpen)}
              type="button"
            >
              <MoreHorizontal size={17} />
              <ChevronDown size={13} />
            </button>
            {isActionMenuOpen ? (
              <div className="crawler-action-popover">
                <button
                  disabled={
                    activeRunHasOutOfRegionSources ||
                    !canTriggerCrawlerRun({
                      activeRun,
                      isEnqueueing: isEnqueueing || isResetting,
                      queuedItemCount: runItemSummary.queued,
                      runnableCount: filteredRunnableSources.length,
                      runningItemCount: runItemSummary.running,
                      staleRunningItemCount
                    })
                  }
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    enqueueRun({ sourceIds: filteredRunnableSources.slice(0, 1000).map((source) => source.source_id) });
                  }}
                  type="button"
                >
                  <SearchCode size={15} />
                  <span>
                    <strong>Run filtered</strong>
                    <small>{filteredRunnableSources.length.toLocaleString("en-US")} ready sources in current filters</small>
                  </span>
                </button>
                <button
                  disabled={!activeRun || isResetting || isEnqueueing}
                  onClick={() => {
                    setIsActionMenuOpen(false);
                    resetActiveRun();
                  }}
                  type="button"
                >
                  <XCircle size={15} />
                  <span>
                    <strong>{isResetting ? "Resetting" : "Reset run"}</strong>
                    <small>Cancel queued/running items and start fresh</small>
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <div className="message error">{error}</div> : null}
      {enqueueMessage ? <div className="message">{enqueueMessage}</div> : null}

      <CrawlerManualWorkflow steps={workflowSteps} />

      {progressRun ? (
        <CrawlerRunProgressCard
          active={Boolean(activeRun)}
          canReset={Boolean(activeRun && activeRunHasOutOfRegionSources)}
          isResetting={isResetting}
          onReset={resetActiveRun}
          run={progressRun}
          scopeLabel={selectedRegionCopy.label}
          scopeNotice={
            activeRunHasOutOfRegionSources
              ? `The active run still contains sources outside ${selectedRegionCopy.label}. Reset it before starting a clean ${selectedRegionCopy.label}-only crawl.`
              : null
          }
          summary={runItemSummary}
          snapshotSummary={snapshotSummary}
        />
      ) : null}

      <InventoryPublishCard
        disabled={isLoading || isEnqueueing || isResetting || isPreviewingPublish || isPublishingInventory || hasActiveRun}
        isPreviewing={isPreviewingPublish}
        isPublishing={isPublishingInventory}
        onPreview={previewInventoryPublish}
        onPublish={publishLatestInventory}
        result={publishResult}
        targetRun={latestPublishableRun}
        market={regionFilter}
        scopeLabel={selectedRegionCopy.label}
      />

      <section className="kpi-strip crawler-kpi-strip">
        {overviewCards.map((card) => (
          <CrawlerMetric
            helper={card.helper}
            icon={overviewCardIcon(card.label)}
            key={card.label}
            label={card.label}
            tone={card.tone}
            value={card.value}
          />
        ))}
      </section>

      <section className="analytics-card crawler-table-card">
        <div className="crawler-table-header">
          <div>
            <div className="eyebrow">Crawler queue</div>
            <h3>{selectedRegionCopy.label} crawler list</h3>
            <p>
              One row per building. Building names open the verified availability page when we have one; source rows stay
              folded into each building task.
            </p>
          </div>
          <div className="crawler-quick-stats">
            <span>{selectedRegionCopy.buildingLabel}</span>
            <span>{selectedRegionCopy.runnableLabel}</span>
            <span>{selectedRegionCopy.sourceLabel}</span>
          </div>
        </div>

        <div className="crawler-run-switcher" aria-label="Crawler run status overview">
          <span className="crawler-filter-section-label">Task status</span>
          {crawlerRunListFilterOptions.map((option) => (
            <CrawlerRunStateButton
              key={option.filter}
              active={runStateFilter === option.filter}
              count={runListCounts[option.filter]}
              label={option.label}
              onClick={() => setRunStateFilter(option.filter)}
              state={option.filter}
            />
          ))}
        </div>

        <div className={`crawler-run-list-summary ${runStateFilter}`}>
          <div>
            <h4>{runListView.title}</h4>
            <p>
              {runListView.helper}
              {activeFilter !== "all" ? ` Source type: ${sourceFilterCopy.label}.` : ""}
            </p>
          </div>
          <strong>{runListView.countLabel}</strong>
        </div>

        <div className="crawler-filter-bar">
          <label className="crawler-search-field">
            <Search size={16} />
            <input
              placeholder="Search building, provider, city, strategy..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <label className="crawler-select-field">
            <span>Source type</span>
            <select
              value={activeFilter}
              onChange={(event) => changeSourceFilter(event.target.value as CrawlerSourceFilter)}
              title={sourceFilterCopy.helper}
            >
              {crawlerSourceFilterOptions.map((option) => (
                <option key={option.filter} value={option.filter}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="crawler-select-field">
            <span>Provider</span>
            <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
              <option value="all">All providers</option>
              {providerOptions.map((provider) => (
                <option key={provider.key} value={provider.key}>
                  {provider.label} ({provider.count})
                </option>
              ))}
            </select>
          </label>
          <label className="crawler-select-field">
            <span>Strategy</span>
            <select value={strategyFilter} onChange={(event) => setStrategyFilter(event.target.value)}>
              <option value="all">All strategies</option>
              {strategyOptions.map((option) => (
                <option key={option.strategy} value={option.strategy}>
                  {option.strategy.replaceAll("_", " ")} ({option.count})
                </option>
              ))}
            </select>
          </label>
          <button
            className="ghost-button crawler-clear-filters"
            disabled={!hasTableFilters}
            onClick={clearTableFilters}
            type="button"
          >
            Clear
          </button>
        </div>

        <CrawlerSourceTable
          activeRun={activeRun}
          isEnqueueing={isEnqueueing || isResetting}
          onRunSource={(source) => enqueueRun({ sourceIds: [source.source_id], maxSources: 1 })}
          runItemsBySourceId={runItemsBySourceId}
          groups={filteredBuildingGroups}
          showEmptySections={runStateFilter === "all" && filteredBuildingGroups.length > 0}
        />
      </section>
    </div>
  );
}

function CrawlerManualWorkflow({
  steps,
}: {
  steps: ReturnType<typeof availabilityCrawlerManualSteps>;
}) {
  return (
    <section className="analytics-card crawler-manual-workflow">
      <div className="crawler-manual-workflow-heading">
        <div>
          <div className="eyebrow">Manual control</div>
          <h3>Crawl, review, then publish</h3>
        </div>
        <span className="crawler-manual-mode">Automatic runs off</span>
      </div>
      <div className="crawler-manual-steps">
        {steps.map((step) => (
          <div className={`crawler-manual-step ${step.state}`} key={step.number}>
            <span>{step.state === "complete" ? <CheckCircle2 size={16} /> : step.number}</span>
            <div>
              <strong>{step.title}</strong>
              <small>{step.body}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

async function loadAllCrawlerSourceRows(regionFilter: AvailabilityCrawlerRegionFilter) {
  const rows: AvailabilityCrawlerDashboardRow[] = [];

  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const { from, to } = crawlerSourcePageRange(pageIndex, crawlerDashboardSourcePageSize);
    let query = supabase
      .from("availability_crawler_dashboard")
      .select("*")
      .order("building_name", { ascending: true })
      .order("source_id", { ascending: true })
      .range(from, to);

    if (regionFilter !== "all") {
      query = query.eq("state", regionFilter);
    }

    const result = await query;

    if (result.error) {
      return { data: rows, error: result.error };
    }

    const pageRows = (result.data ?? []) as AvailabilityCrawlerDashboardRow[];
    rows.push(...pageRows);

    if (!shouldContinueCrawlerSourcePaging(pageRows.length, crawlerDashboardSourcePageSize)) {
      break;
    }
  }

  return { data: rows, error: null };
}

function CrawlerRunProgressCard({
  active,
  canReset,
  isResetting,
  onReset,
  run,
  scopeLabel,
  scopeNotice,
  snapshotSummary,
  summary
}: {
  active: boolean;
  canReset: boolean;
  isResetting: boolean;
  onReset: () => void;
  run: AvailabilityCrawlRun;
  scopeLabel: string;
  scopeNotice: string | null;
  snapshotSummary: ReturnType<typeof summarizeCrawlerSnapshotQuality>;
  summary: ReturnType<typeof summarizeCrawlRunItems>;
}) {
  const waitingForWorker = active && run.status === "queued" && summary.running === 0 && summary.processed === 0;

  return (
    <section className="analytics-card crawler-progress-card">
      <div className="crawler-progress-header">
        <div>
          <div className="eyebrow">{active ? "Current run" : "Latest run"}</div>
          <h3>{active ? `${scopeLabel} progress` : `Last ${scopeLabel} run`}</h3>
          <div className="crawler-progress-message-row">
            <p>
              {scopeNotice ??
                (active
                ? waitingForWorker
                  ? "Queued and waiting for the background worker to claim items."
                  : "Refreshing every few seconds while the worker processes sources."
                : snapshotSummary.partial + snapshotSummary.unverified > 0
                  ? "Run ended. Partial or unverified snapshots need review."
                  : `Run ended. ${summary.processed} sources processed.`)}
            </p>
            {canReset ? (
              <button className="ghost-button compact-button crawler-inline-reset" disabled={isResetting} onClick={onReset} type="button">
                <XCircle size={14} />
                {isResetting ? "Resetting" : "Reset run"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="crawler-progress-main-stat">
          <strong>{summary.progressPercentage}%</strong>
          <span>
            {summary.processed}/{summary.total || run.source_count} processed
          </span>
        </div>
      </div>

      <div className="crawler-progress-track" aria-label="Crawler run progress">
        <span style={{ width: `${summary.progressPercentage}%` }} />
      </div>

      <div className="crawler-run-status-grid">
        <CrawlerRunStatusMetric label="Queued" value={summary.queued} />
        <CrawlerRunStatusMetric label="Running" value={summary.running} tone="brand" />
        <CrawlerRunStatusMetric label="Parsed units" value={summary.succeeded} />
        <CrawlerRunStatusMetric label="No units parsed" value={summary.noUnits} />
        <CrawlerRunStatusMetric label="Adapter needed" value={summary.unsupported} />
        <CrawlerRunStatusMetric label="Failed" value={summary.failed} tone="danger" />
      </div>
      <p className="table-subtext crawler-snapshot-summary" aria-label="Snapshot quality">
        Snapshot quality: {snapshotSummary.complete} complete · {snapshotSummary.confirmedEmpty} confirmed empty · {snapshotSummary.partial} partial · {snapshotSummary.unverified} unverified. Task completion is not inventory accuracy.
      </p>
    </section>
  );
}

function InventoryPublishCard({
  disabled,
  isPreviewing,
  isPublishing,
  market,
  onPreview,
  onPublish,
  result,
  targetRun,
  scopeLabel,
}: {
  disabled: boolean;
  isPreviewing: boolean;
  isPublishing: boolean;
  market: AvailabilityCrawlerRegionFilter;
  onPreview: () => void;
  onPublish: () => void;
  result: InventoryPublishResult | null;
  targetRun: AvailabilityCrawlRun | null;
  scopeLabel: string;
}) {
  const review = result?.dry_run ? result as AvailabilityCrawlerManualReview : null;
  const canPublish = canPublishAvailabilityCrawlerReview(review, targetRun?.id ?? null, market);
  const reviewCopy = review ? describeAvailabilityCrawlerReview(review) : null;

  return (
    <section className="analytics-card crawler-publish-card">
      <div>
        <div className="eyebrow">Inventory publish</div>
        <h3>Publish latest crawler data</h3>
        <p>
          Preview first, then publish validated observations into app listings. Publishing can add new units, update prices,
          and mark crawler-linked units unavailable when they disappear from a reliable latest crawl.
        </p>
        <div className="crawler-publish-run">
          {targetRun ? (
            <>
              <strong>Target run {shortRunId(targetRun.id)}</strong>
              <span>
                {targetRun.status} · {targetRun.observation_count.toLocaleString("en-US")} observations · finished{" "}
                {formatNullableDate(targetRun.finished_at)}
              </span>
            </>
          ) : (
            <span>Run the crawler and wait for a completed or partial run before publishing.</span>
          )}
        </div>
        {reviewCopy ? (
          <div className={`crawler-review-result ${review?.eligible ? "ready" : "blocked"}`}>
            {review?.eligible ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <div>
              <strong>{reviewCopy.title}</strong>
              <span>{reviewCopy.body}</span>
            </div>
          </div>
        ) : null}
      </div>
      <div className="crawler-publish-actions">
        <button className="ghost-button" disabled={disabled || !targetRun} onClick={onPreview} type="button">
          <DatabaseZap size={15} />
          {isPreviewing ? "Previewing" : "Preview"}
        </button>
        <button className="button crawler-primary-action" disabled={disabled || !canPublish} onClick={onPublish} type="button">
          <CheckCircle2 size={15} />
          {isPublishing ? "Publishing" : `Publish ${scopeLabel}`}
        </button>
      </div>
      <div className="crawler-publish-preview">
        {result ? (
          <>
            <CrawlerPublishMetric label="Sources checked" value={result.checked_source_count ?? result.source_count} />
            <CrawlerPublishMetric label="Publishable units" value={result.candidate_observation_count} tone="brand" />
            <CrawlerPublishMetric label="New listings" value={result.created_listing_count} tone="success" />
            <CrawlerPublishMetric label="Updated listings" value={result.updated_listing_count} />
            <CrawlerPublishMetric label="Marked unavailable" value={result.marked_unavailable_count} tone="danger" />
            <CrawlerPublishMetric label="Skipped rows" value={result.skipped_observation_count} />
          </>
        ) : (
          <div className="crawler-publish-empty">
            Preview the target run to see exactly what will be merged before touching app inventory.
          </div>
        )}
      </div>
    </section>
  );
}

function CrawlerPublishMetric({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: "brand" | "danger" | "success";
  value: number;
}) {
  return (
    <div className={`crawler-publish-metric ${tone ?? ""}`}>
      <strong>{value.toLocaleString("en-US")}</strong>
      <span>{label}</span>
    </div>
  );
}

function normalizeRunItemRows(rows: unknown[]): AvailabilityCrawlRunItem[] {
  return rows.map((row) => {
    const item = row as Omit<AvailabilityCrawlRunItem, "buildings"> & {
      buildings?: AvailabilityCrawlRunItem["buildings"] | AvailabilityCrawlRunItem["buildings"][];
    };
    return {
      ...item,
      buildings: Array.isArray(item.buildings) ? item.buildings[0] ?? null : item.buildings ?? null
    };
  });
}

function CrawlerRunStatusMetric({
  label,
  tone,
  value
}: {
  label: string;
  tone?: "brand" | "danger" | "success";
  value: number;
}) {
  return (
    <div className={`crawler-run-status-metric ${tone ?? ""}`}>
      <strong>{value.toLocaleString("en-US")}</strong>
      <span>{label}</span>
    </div>
  );
}

function RunItemStatusPill({ status }: { status: string }) {
  if (status === "running") return <span className="status-pill pending">Running</span>;
  if (status === "succeeded") return <span className="status-pill active">Parsed</span>;
  if (status === "no_units_found") return <span className="status-pill pending">No units parsed</span>;
  if (status === "failed") return <span className="status-pill suspended">Failed</span>;
  if (status === "unsupported") return <span className="status-pill pending">Adapter needed</span>;
  if (status === "unavailable") return <span className="status-pill pending">Empty result</span>;
  if (status === "skipped") return <span className="status-pill pending">Skipped</span>;
  return <span className="status-pill pending">Queued</span>;
}

function runItemNote(status: string) {
  if (status === "queued") return "Waiting for worker.";
  if (status === "running") return "Crawler is processing this source.";
  if (status === "succeeded") return "Available units parsed.";
  if (status === "no_units_found") return "Page loaded but no available units were found.";
  if (status === "unavailable") return "No units reported. Check snapshot quality before publishing.";
  if (status === "failed") return "Crawler failed on this source.";
  return status.replaceAll("_", " ");
}

function CrawlerMetric({
  helper,
  icon,
  label,
  tone,
  value
}: {
  helper: string;
  icon: ReactNode;
  label: string;
  tone?: "brand" | "danger" | "success";
  value: number | string;
}) {
  return (
    <article className={`metric-card latest-metric crawler-metric ${tone ?? ""}`}>
      <div className="metric-row">
        <span>{label}</span>
        {icon}
      </div>
      <div className="metric-value">{typeof value === "number" ? value.toLocaleString("en-US") : value}</div>
      <div className="metric-trend">{helper}</div>
    </article>
  );
}

function overviewCardIcon(label: string) {
  if (label === "Current queue") return <SearchCode size={17} />;
  if (label === "Crawling now") return <Bot size={17} />;
  if (label === "Needs review") return <AlertTriangle size={17} />;
  return <DatabaseZap size={17} />;
}

function CrawlerRunStateButton({
  active,
  count,
  label,
  onClick,
  state
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
  state: CrawlerRunListFilter;
}) {
  return (
    <button
      className={`crawler-run-state-button state-${state} ${active ? "selected" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <strong>{count.toLocaleString("en-US")}</strong>
    </button>
  );
}

function runItemForGroup(
  group: CrawlerBuildingGroup,
  runItemsBySourceId: Map<string, AvailabilityCrawlRunItem>
) {
  return (
    sortCrawlRunItemsForDisplay(
      group.sources
        .map((source) => runItemsBySourceId.get(source.source_id))
        .filter((item): item is AvailabilityCrawlRunItem => Boolean(item))
    )[0] ?? null
  );
}

function crawlerRunStateForGroup(
  group: CrawlerBuildingGroup,
  runItemsBySourceId: Map<string, AvailabilityCrawlRunItem>
) {
  const runItem = runItemForGroup(group, runItemsBySourceId);
  const row = group.primarySource;
  return classifyCrawlerRunListState({
    consecutiveFailures: row.consecutive_failures,
    currentRunStatus: runItem?.status ?? null,
    latestError: row.latest_error,
    latestStatus: row.latest_status,
  });
}

function CrawlerSourceTable({
  activeRun,
  groups,
  isEnqueueing,
  onRunSource,
  runItemsBySourceId,
  showEmptySections
}: {
  activeRun: AvailabilityCrawlRun | null;
  groups: CrawlerBuildingGroup[];
  isEnqueueing: boolean;
  onRunSource: (source: AvailabilityCrawlerDashboardRow) => void;
  runItemsBySourceId: Map<string, AvailabilityCrawlRunItem>;
  showEmptySections: boolean;
}) {
  const sections = groupCrawlerRunListSections(
    groups,
    (group) => crawlerRunStateForGroup(group, runItemsBySourceId),
    { includeEmpty: showEmptySections }
  );

  return (
    <div className="admin-table-wrap crawler-source-table-wrap">
      <table className="admin-table crawler-source-table">
        <thead>
          <tr>
            <th>Building</th>
            <th>Provider & strategy</th>
            <th>Crawl status</th>
            <th>Latest crawl</th>
            <th>Units / changes</th>
            <th>Notes</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 ? (
            <tr>
              <td colSpan={7}>
                <EmptyCrawlerState title="No buildings match these filters" body="Try a different provider, strategy, or status filter." />
              </td>
            </tr>
          ) : null}
          {sections.map((section) => (
            <Fragment key={section.state}>
              <CrawlerSourceSectionHeader
                count={section.rows.length}
                helper={section.helper}
                label={section.label}
                state={section.state}
              />
              {section.rows.length === 0 ? (
                <CrawlerSourceEmptySectionRow state={section.state} />
              ) : null}
              {section.rows.map((group) => {
                const runItem = runItemForGroup(group, runItemsBySourceId);

                return (
                  <CrawlerSourceTableRow
                    key={group.building_id}
                    activeRun={activeRun}
                    group={group}
                    isEnqueueing={isEnqueueing}
                    onRunSource={onRunSource}
                    runItem={runItem}
                  />
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CrawlerSourceEmptySectionRow({ state }: { state: string }) {
  const copy =
    state === "active"
      ? "No buildings are actively crawling right now."
      : state === "done"
        ? "No buildings have completed in this view yet."
        : state === "failed"
          ? "No failures in this view."
          : "No not-started buildings in this view.";

  return (
    <tr className={`crawler-source-empty-section section-${state}`}>
      <td colSpan={7}>{copy}</td>
    </tr>
  );
}

function CrawlerSourceSectionHeader({
  count,
  helper,
  label,
  state,
}: {
  count: number;
  helper: string;
  label: string;
  state: string;
}) {
  return (
    <tr className={`crawler-source-section-row section-${state}`}>
      <td colSpan={7}>
        <div className="crawler-source-section-header">
          <div>
            <span>{label}</span>
            <small>{helper}</small>
          </div>
          <strong>{count.toLocaleString("en-US")} {count === 1 ? "building" : "buildings"}</strong>
        </div>
      </td>
    </tr>
  );
}

function CrawlerSourceTableRow({
  activeRun,
  group,
  isEnqueueing,
  onRunSource,
  runItem
}: {
  activeRun: AvailabilityCrawlRun | null;
  group: CrawlerBuildingGroup;
  isEnqueueing: boolean;
  onRunSource: (source: AvailabilityCrawlerDashboardRow) => void;
  runItem: AvailabilityCrawlRunItem | null;
}) {
  const row = group.primarySource;
  const currentUnits = runItem ? runItem.units_found : row.latest_units_found ?? 0;
  const currentChanges = runItem ? runItem.changes_detected : row.change_count_7d;
  const statusTime = runItem ? runItem.finished_at ?? runItem.started_at : row.last_crawled_at;
  const statusNote = runItem ? runItem.error || runItemNote(runItem.status) : noteForSource(row);
  const quality = describeCrawlerSnapshotQuality(runItem);

  return (
    <tr>
      <td>
        {row.availability_url ? (
          <a className="crawler-building-link" href={row.availability_url} rel="noreferrer" target="_blank">
            {row.building_name}
            <ExternalLink size={13} />
          </a>
        ) : (
          <strong>{row.building_name}</strong>
        )}
        <p className="table-subtext">
          {[row.area, row.city, row.state].filter(Boolean).join(" · ") || "No area"}
          {row.year_built ? ` · ${row.year_built}` : ""}
          {row.total_units ? ` · ${row.total_units} units` : ""}
          {group.sourceCount > 1 ? ` · ${group.sourceCount} sources` : ""}
        </p>
      </td>
      <td>
        <strong>{providerLabel(row.provider_label, row.provider_key)}</strong>
        <p className="table-subtext">{row.provider_key}</p>
        <p className="table-subtext">
          <code>{row.parser_strategy.replaceAll("_", " ")}</code>
          {row.requires_browser ? <span className="crawler-mini-pill">browser</span> : null}
        </p>
      </td>
      <td>
        {runItem ? <RunItemStatusPill status={runItem.status} /> : <StatusPill row={row} />}
        {runItem?.status !== "running" && runItem?.status !== "queued" ? (
          <p className="table-subtext"><span className={`status-pill ${quality.tone}`} title={quality.note}>{quality.label}</span></p>
        ) : null}
        <p className="table-subtext">{runItem ? "current run" : row.provider_status.replaceAll("_", " ")}</p>
      </td>
      <td>
        <strong className="crawler-date-text">{formatNullableDate(statusTime)}</strong>
        {row.last_success_at && !runItem ? <p className="table-subtext">success {formatNullableDate(row.last_success_at)}</p> : null}
      </td>
      <td>
        <strong>{currentUnits} units</strong>
        <p className="table-subtext">
          {currentChanges} changes
          {runItem ? "" : ` · ${row.price_change_count_7d} price · ${row.went_unavailable_count_7d} leased`}
        </p>
      </td>
      <td>
        <span className="crawler-note-text">{statusNote}</span>
      </td>
      <td>
        <button
          className="mini-action crawler-row-run"
          disabled={
            !canQueueCrawlerRun({
              activeRun,
              isEnqueueing,
              runnableCount: isRunnableSource(row) ? 1 : 0
            })
          }
          onClick={() => onRunSource(row)}
          title={
            activeRun
              ? "A crawler run is already queued or running"
              : isRunnableSource(row)
                ? "Queue this building for crawl"
                : "This source needs a supported availability parser first"
          }
          type="button"
        >
          <SearchCode size={13} />
          Run
        </button>
      </td>
    </tr>
  );
}

function StatusPill({ row }: { row: AvailabilityCrawlerDashboardRow }) {
  if (row.provider_status === "validated_units_found" && isRunnableSource(row)) {
    return (
      <span className="status-pill active">
        <CheckCircle2 size={12} />
        Validated
      </span>
    );
  }

  if (row.provider_status === "confirmed_no_current_units" && isRunnableSource(row)) {
    return (
      <span className="status-pill pending">
        <CheckCircle2 size={12} />
        No units now
      </span>
    );
  }

  if (isReferenceOnlySource(row)) {
    return <span className="status-pill pending">Reference</span>;
  }

  if (!row.crawl_enabled) {
    return (
      <span className="status-pill suspended">
        <XCircle size={12} />
        Disabled
      </span>
    );
  }

  if (row.latest_status === "succeeded") {
    return (
      <span className="status-pill active">
        <CheckCircle2 size={12} />
        Parsed
      </span>
    );
  }

  if (row.requires_browser && isConcreteSource(row)) {
    return (
      <span className="status-pill pending">
        <Bot size={12} />
        Browser
      </span>
    );
  }

  if (needsAttention(row)) {
    return (
      <span className="status-pill pending">
        <AlertTriangle size={12} />
        Review
      </span>
    );
  }

  if (isRunnableSource(row)) {
    return (
      <span className="status-pill active">
        <CheckCircle2 size={12} />
        Ready
      </span>
    );
  }

  return <span className="status-pill pending">Pending</span>;
}

function EmptyCrawlerState({ body, title }: { body: string; title: string }) {
  return (
    <div className="empty-state compact-empty crawler-empty">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function matchesBuildingGroupFilter(
  group: CrawlerBuildingGroup,
  filter: CrawlerSourceFilter,
  runItemsBySourceId: ReadonlyMap<string, AvailabilityCrawlRunItem>,
) {
  switch (filter) {
    case "ready":
      return isAvailabilityCrawlerBuildingGroupRunnable(group);
    case "browser":
      return group.sources.some((source) => source.requires_browser && isConcreteSource(source));
    case "attention":
      return doesAvailabilityCrawlerBuildingGroupNeedAttention(group, runItemsBySourceId);
    case "missing_url":
      return !group.sources.some((source) => Boolean(source.availability_url));
    case "disabled":
      return !isAvailabilityCrawlerBuildingGroupRunnable(group);
    case "all":
    default:
      return true;
  }
}

function sourceMatchesSearchQuery(source: AvailabilityCrawlerDashboardRow, normalizedQuery: string) {
  const haystack = [
    source.building_name,
    source.area,
    source.city,
    source.state,
    source.provider_key,
    source.provider_label,
    source.parser_strategy,
    source.provider_status,
    source.availability_url,
    source.website
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function isConcreteSource(source: AvailabilityCrawlerDashboardRow) {
  return isConcreteAvailabilityCrawlerSource(source);
}

function isReferenceOnlySource(source: AvailabilityCrawlerDashboardRow) {
  return isReferenceOnlyAvailabilityCrawlerSource(source);
}

function isRunnableSource(source: AvailabilityCrawlerDashboardRow) {
  return isRunnableAvailabilityCrawlerSource(source);
}

function needsAttention(source: AvailabilityCrawlerDashboardRow) {
  return (
    !source.availability_url ||
    (!source.crawl_enabled && !isReferenceOnlySource(source)) ||
    source.consecutive_failures > 0 ||
    Boolean(source.latest_error) ||
    (source.latest_status ? latestFailureStatuses.has(source.latest_status) : false)
  );
}

function noteForSource(source: AvailabilityCrawlerDashboardRow) {
  if (source.latest_error) return source.latest_error;
  if (!source.availability_url) return "No concrete availability URL yet.";
  if (isReferenceOnlySource(source)) return "Reference link only; not an available-unit parser source.";
  if (source.provider_status === "validated_units_found") return "Validated unit rows; ready for scheduled monitoring.";
  if (source.provider_status === "confirmed_no_current_units") return "Availability page confirmed, currently no units.";
  if (source.provider_status === "needs_floorplan_drilldown") return "Floor plan counts found; needs a unit-level parser before crawling.";
  if (source.provider_status === "surface_found_needs_parser") return "Availability surface found; parser still needs validation.";
  if (source.provider_status === "count_mismatch_needs_parser_review") return "Parsed unit count did not match the page count; keep disabled.";
  if (!source.crawl_enabled) return "Crawler disabled until source is confirmed.";
  if (source.requires_browser) return "Ready for browser-rendered crawl.";
  if (source.latest_status === "no_units_found") return "Page loaded but no available units parsed.";
  if (source.latest_status === "skipped" && isRunnableSource(source)) return "Ready for next crawl.";
  if (source.latest_status) return source.latest_status.replaceAll("_", " ");
  return "Ready for first crawl.";
}

function providerLabel(label: string | null, key: string) {
  return label || key.replaceAll("_", " ");
}

function formatInventoryPublishMessage(result: InventoryPublishResult, scopeLabel: string) {
  return [
    `Published ${result.candidate_observation_count.toLocaleString("en-US")} ${scopeLabel} observations from run ${shortRunId(result.run_id)} to app inventory.`,
    `${result.created_listing_count.toLocaleString("en-US")} new listings`,
    `${result.updated_listing_count.toLocaleString("en-US")} updated`,
    `${result.marked_unavailable_count.toLocaleString("en-US")} marked unavailable`,
  ].join(" ");
}

function shortRunId(runId: string | null | undefined) {
  return runId ? runId.slice(0, 8) : "unknown";
}

function formatNullableDate(value: string | null) {
  return value ? formatDate(value) : "N/A";
}
