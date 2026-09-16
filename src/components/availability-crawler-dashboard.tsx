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
import { pollCrawlerWorkerStatus } from "@/lib/availability-crawler-status-polling";
import { crawlerWorkerStatusMessage, type CrawlerWorkerState, type CrawlerWorkerStatus } from "@/lib/availability-crawler-worker-status";
import {
  availabilityCrawlerManualSteps,
  canPublishAvailabilityCrawlerReview,
  confirmAvailabilityCrawlerLaunch,
  describeAvailabilityCrawlerReview,
  type AvailabilityCrawlerManualReview,
} from "@/lib/availability-crawler-manual-workflow";
import {
  getAvailabilityCrawlerRegionOptions,
  buildAvailabilityCrawlerOverviewCards,
  canQueueCrawlerRun,
  canTriggerCrawlerRun,
  classifyCrawlerRunListState,
  countStaleRunningItems,
  describeCrawlerSnapshotQuality,
  crawlerDashboardSourcePageSize,
  getCrawlerRunListFilterOptions,
  getCrawlerSourceFilterOptions,
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
import { useI18n, type Language } from "@/lib/i18n";
import type { CrawlerTranslator } from "@/lib/availability-crawler-helper-messages";
import {
  describeCrawlerError,
  providerLabel,
  sourceMatchesSearchQuery,
  strategyLabel,
  type CrawlerErrorOrigin,
} from "@/lib/availability-crawler-presentation";
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

type CrawlerNotice = { key: string; params?: Record<string, string | number> };

export function AvailabilityCrawlerDashboard() {
  const { t } = useI18n();
  const [sources, setSources] = useState<AvailabilityCrawlerDashboardRow[]>([]);
  const [runs, setRuns] = useState<AvailabilityCrawlRun[]>([]);
  const [runItems, setRunItems] = useState<AvailabilityCrawlRunItem[]>([]);
  const [workerStatus, setWorkerStatus] = useState<CrawlerWorkerStatus | null>(null);
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
  const [enqueueMessage, setEnqueueMessage] = useState<CrawlerNotice | null>(null);
  const [publishResult, setPublishResult] = useState<InventoryPublishResult | null>(null);
  const enqueueInFlight = useRef(false);
  const launchAbort = useRef<AbortController | null>(null);
  const dashboardLoadId = useRef(0);
  const dashboardInFlight = useRef<number | null>(null);

  useEffect(() => () => launchAbort.current?.abort(), []);

  const loadCrawlerDashboard = useCallback(async (options?: { quiet?: boolean }) => {
    if (options?.quiet && dashboardInFlight.current !== null) return;
    const loadId = ++dashboardLoadId.current;
    dashboardInFlight.current = loadId;
    try {
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

      if (loadId !== dashboardLoadId.current) return;

      if (sourcesResult.error || runsResult.error) {
        setError(
          sourcesResult.error?.message ??
            runsResult.error?.message ??
            "crawler.loadFailed"
        );
        return;
      }

      const loadedRuns = (runsResult.data ?? []) as AvailabilityCrawlRun[];
      const runForProgress = loadedRuns.find(isCrawlerRunActive) ?? loadedRuns[0] ?? null;
      const loadedRunItems: AvailabilityCrawlRunItem[] = [];

      if (runForProgress) {
        for (let offset = 0; ; offset += crawlerDashboardSourcePageSize) {
          const runItemsResult = await supabase
            .from("availability_crawl_run_items")
            .select(
              "id, run_id, source_id, building_id, provider_key, parser_strategy, status, snapshot_status, committed_at, attempt_id, lease_expires_at, heartbeat_at, started_at, finished_at, units_found, observations_created, changes_detected, error, buildings(name, area, city, state)"
            )
            .eq("run_id", runForProgress.id)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(offset, offset + crawlerDashboardSourcePageSize - 1);

          if (loadId !== dashboardLoadId.current) return;

          if (runItemsResult.error) {
            setError(runItemsResult.error.message);
            return;
          }

          loadedRunItems.push(...normalizeRunItemRows(runItemsResult.data ?? []));
          if ((runItemsResult.data?.length ?? 0) < crawlerDashboardSourcePageSize) break;
        }
      }

      setSources((sourcesResult.data ?? []) as AvailabilityCrawlerDashboardRow[]);
      setRuns(loadedRuns);
      setRunItems(loadedRunItems);
    } catch {
      if (loadId === dashboardLoadId.current) setError("crawler.loadFailed");
    } finally {
      if (loadId === dashboardLoadId.current) {
        dashboardInFlight.current = null;
        setIsLoading(false);
      }
    }
  }, [regionFilter]);

  useEffect(() => {
    loadCrawlerDashboard();
    return () => {
      dashboardLoadId.current++;
      dashboardInFlight.current = null;
    };
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
  const activeRunId = activeRun?.id;
  const currentWorkerStatus = !isEnqueueing && workerStatus?.runId === activeRunId ? workerStatus : null;
  const workerState = currentWorkerStatus?.workerState ?? "unknown";
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
    }, t).map((step) => activeRun && step.number === "1"
      ? { ...step, body: t(crawlerWorkerStatusMessage(workerState)) } : step),
    [activeRun, publishResult, publishReview, t, workerState],
  );

  useEffect(() => {
    setPublishResult(null);
  }, [latestPublishableRun?.id, latestPublishableRun?.finished_at, latestPublishableRun?.observation_count, regionFilter]);

  useEffect(() => {
    if (!activeRunId || isEnqueueing) return;
    return pollCrawlerWorkerStatus<CrawlerWorkerStatus>({
      isVisible: () => document.visibilityState === "visible",
      subscribeVisibility: (callback) => {
        document.addEventListener("visibilitychange", callback);
        return () => document.removeEventListener("visibilitychange", callback);
      },
      read: async (signal) => {
        await loadCrawlerDashboard({ quiet: true });
        const { data } = await supabase.auth.getSession();
        if (!data.session?.access_token) throw new Error("Missing session");
        signal.throwIfAborted();
        const response = await fetch(`/api/availability-crawler/worker-status?runId=${encodeURIComponent(activeRunId)}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
        });
        if (!response.ok) throw new Error("Status unavailable");
        const status = await response.json() as CrawlerWorkerStatus;
        if (status.runId !== activeRunId) throw new Error("Run changed");
        return status;
      },
      onStatus: setWorkerStatus,
    });
  }, [activeRunId, isEnqueueing, loadCrawlerDashboard]);

  const regionSummaries = useMemo(() => summarizeAvailabilityCrawlerRegions(sources), [sources]);
  const selectedRegionSummary = regionSummaries[regionFilter];
  const selectedRegionCopy = describeAvailabilityCrawlerRegionFilter(regionFilter, selectedRegionSummary, t);

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
          label: providerLabel(source.provider_label, source.provider_key, t),
          count: 1
        });
      }
    }
    return Array.from(grouped.values()).sort((first, second) => second.count - first.count || first.label.localeCompare(second.label));
  }, [sources, t]);

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
    () => describeCrawlerRunListFilter(runStateFilter, filteredBuildingGroups.length, t),
    [filteredBuildingGroups.length, runStateFilter, t]
  );
  const sourceFilterCopy = useMemo(() => describeCrawlerSourceFilter(activeFilter, t), [activeFilter, t]);
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
      }, t),
    [runItemSummary, selectedRegionCopy.label, totals.attention, totals.buildings, totals.missingURL, totals.ready, totals.sources, t]
  );
  const canRestartStalledRun =
    activeRun?.status === "running" &&
    (runItemSummary.queued > 0 || staleRunningItemCount > 0) &&
    runItemSummary.running === staleRunningItemCount;
  const canRunSelectedRegion =
    !activeRunHasOutOfRegionSources &&
    workerState !== "running" &&
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
      ? t("crawler.resetOtherMarket", { scope: selectedRegionCopy.label })
      : workerState === "running"
        ? t("crawler.workerRunningHint")
      : activeRun?.status === "queued" || canRestartStalledRun
      ? t("crawler.resumeHint")
      : activeRun?.status === "running"
        ? t(crawlerWorkerStatusMessage(workerState))
        : undefined;

  const startCrawlerWorker = useCallback(async (runId: string, sourceCount?: number) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      throw new Error("crawler.signInAgain");
    }

    launchAbort.current = new AbortController();
    setWorkerStatus(null);
    const signal = launchAbort.current.signal;
    setEnqueueMessage({ key: "crawler.confirmingLaunch" });
    await confirmAvailabilityCrawlerLaunch(() => fetch("/api/availability-crawler/start-worker", {
      body: JSON.stringify({ browserFallback: true, maxItems: sourceCount, runId }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal,
    }), { signal, t: (key) => key });
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
          setEnqueueMessage({ key: "crawler.launchConfirmed" });
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
          throw new Error("crawler.runNotConfirmed");
        }
        setRunStateFilter(defaultCrawlerRunListFilter);
        setEnqueueMessage(
          result?.reused
            ? { key: "crawler.reusedRun", params: { count: result.source_count ?? 0 } }
            : { key: "crawler.queuedRun", params: { count: result?.source_count ?? 0 } }
        );
        await loadCrawlerDashboard({ quiet: true });
      } catch (workerError) {
        await loadCrawlerDashboard({ quiet: true });
        setError(workerError instanceof Error ? workerError.message : "crawler.launchFailed");
        setEnqueueMessage(null);
      } finally {
        enqueueInFlight.current = false;
        setWorkerStatus(null);
        setIsEnqueueing(false);
      }
    },
    [activeRun, loadCrawlerDashboard, startCrawlerWorker]
  );

  const resetActiveRun = useCallback(async () => {
    if (!activeRun) return;
    const confirmed = window.confirm(
      t("crawler.resetConfirm")
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
        ? { key: "crawler.resetDone", params: { count: result.skipped_unfinished_item_count ?? 0 } }
        : { key: "crawler.nothingToReset" }
    );
    await loadCrawlerDashboard({ quiet: true });
  }, [activeRun, loadCrawlerDashboard, t]);

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
      setError("crawler.previewFirst");
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
      setError("crawler.reviewAgain");
      return;
    }

    const confirmed = window.confirm(
      t("crawler.publishConfirm", { scope: selectedRegionCopy.label, id: shortRunId(latestPublishableRun.id, t), count: publishResult?.marked_unavailable_count ?? 0 })
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
    setEnqueueMessage(inventoryPublishNotice(result));
    await loadCrawlerDashboard({ quiet: true });
  }, [latestPublishableRun, loadCrawlerDashboard, publishResult, publishReview, regionFilter, selectedRegionCopy.label, t]);

  return (
    <div className="crawler-page">
      <div className="page-hero crawler-hero">
        <div>
          <div className="eyebrow">{t("crawler.eyebrow")}</div>
          <h1>{t("crawler.title")}</h1>
        </div>
        <div className="page-actions crawler-actions">
          <label className="crawler-region-picker">
            <span>{t("crawler.area")}</span>
            <select
              value={regionFilter}
              onChange={(event) => setRegionFilter(event.target.value as AvailabilityCrawlerRegionFilter)}
            >
              {getAvailabilityCrawlerRegionOptions(t).map((option) => (
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
            {isEnqueueing ? t("crawler.starting") : activeRun ? t("crawler.resumeRun") : regionFilter === "all" ? t("crawler.runAll") : t("crawler.runScope", { scope: selectedRegionCopy.label })}
          </button>
          <button
            className="ghost-button crawler-refresh-action"
            disabled={isLoading}
            onClick={() => loadCrawlerDashboard()}
            type="button"
          >
            <RefreshCcw size={15} />
            {isLoading ? t("crawler.refreshing") : t("crawler.refresh")}
          </button>
          <div className="crawler-action-menu">
            <button
              aria-expanded={isActionMenuOpen}
              aria-label={t("crawler.moreActions")}
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
                    workerState === "running" ||
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
                    <strong>{t("crawler.runFiltered")}</strong>
                    <small>{t("crawler.readySources", { count: filteredRunnableSources.length })}</small>
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
                    <strong>{isResetting ? t("crawler.resetting") : t("crawler.reset")}</strong>
                    <small>{t("crawler.resetHint")}</small>
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <CrawlerError error={error} /> : null}
      {enqueueMessage ? <div className="message">{t(enqueueMessage.key, enqueueMessage.params)}</div> : null}

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
              ? t("crawler.scopeNotice", { scope: selectedRegionCopy.label })
              : null
          }
          summary={runItemSummary}
          snapshotSummary={snapshotSummary}
          workerState={workerState}
          resumable={Boolean(currentWorkerStatus?.resumable && canRunSelectedRegion)}
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
            helper={card.id === "running" && hasActiveRun && workerState !== "running"
              ? t("crawler.pendingTaskCounts", { claimed: runItemSummary.running, queued: runItemSummary.queued }) : card.helper}
            icon={overviewCardIcon(card.id)}
            key={card.id}
            label={card.id === "running" && hasActiveRun && workerState !== "running" ? t("crawler.pendingTasks") : card.label}
            tone={card.tone}
            value={card.value}
          />
        ))}
      </section>

      <section className="analytics-card crawler-table-card">
        <div className="crawler-table-header">
          <div>
            <div className="eyebrow">{t("crawler.queueEyebrow")}</div>
            <h3>{t("crawler.listTitle", { scope: selectedRegionCopy.label })}</h3>
          </div>
          <div className="crawler-quick-stats">
            <span>{selectedRegionCopy.buildingLabel}</span>
            <span>{selectedRegionCopy.runnableLabel}</span>
            <span>{selectedRegionCopy.sourceLabel}</span>
          </div>
        </div>

        <div className="crawler-run-switcher" aria-label={t("crawler.statusOverview")}>
          <span className="crawler-filter-section-label">{t("crawler.taskStatus")}</span>
          {getCrawlerRunListFilterOptions(t).map((option) => (
            <CrawlerRunStateButton
              key={option.filter}
              active={runStateFilter === option.filter}
              count={runListCounts[option.filter]}
              label={option.filter === "active" && hasActiveRun && workerState !== "running" ? t("crawler.pendingTasks") : option.label}
              onClick={() => setRunStateFilter(option.filter)}
              state={option.filter}
            />
          ))}
        </div>

        <div className={`crawler-run-list-summary ${runStateFilter}`}>
          <div>
            <h4>{runStateFilter === "active" && hasActiveRun && workerState !== "running" ? t("crawler.pendingTasks") : runListView.title}</h4>
            <p>
              {runListView.helper}
              {activeFilter !== "all" ? t("crawler.sourceTypeSuffix", { type: sourceFilterCopy.label }) : ""}
            </p>
          </div>
          <strong>{runListView.countLabel}</strong>
        </div>

        <div className="crawler-filter-bar">
          <label className="crawler-search-field">
            <Search size={16} />
            <input
              placeholder={t("crawler.searchPlaceholder")}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <label className="crawler-select-field">
            <span>{t("crawler.sourceType")}</span>
            <select
              value={activeFilter}
              onChange={(event) => changeSourceFilter(event.target.value as CrawlerSourceFilter)}
              title={sourceFilterCopy.helper}
            >
              {getCrawlerSourceFilterOptions(t).map((option) => (
                <option key={option.filter} value={option.filter}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="crawler-select-field">
            <span>{t("crawler.provider")}</span>
            <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
              <option value="all">{t("crawler.allProviders")}</option>
              {providerOptions.map((provider) => (
                <option key={provider.key} value={provider.key}>
                  {provider.label} ({provider.count})
                </option>
              ))}
            </select>
          </label>
          <label className="crawler-select-field">
            <span>{t("crawler.strategy")}</span>
            <select value={strategyFilter} onChange={(event) => setStrategyFilter(event.target.value)}>
              <option value="all">{t("crawler.allStrategies")}</option>
              {strategyOptions.map((option) => (
                <option key={option.strategy} value={option.strategy}>
                  {strategyLabel(option.strategy, t)} ({option.count})
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
            {t("crawler.clear")}
          </button>
        </div>

        <CrawlerSourceTable
          activeRun={activeRun}
          isEnqueueing={isEnqueueing || isResetting}
          onRunSource={(source) => enqueueRun({ sourceIds: [source.source_id], maxSources: 1 })}
          runItemsBySourceId={runItemsBySourceId}
          groups={filteredBuildingGroups}
          showEmptySections={runStateFilter === "all" && filteredBuildingGroups.length > 0}
          workerState={workerState}
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
  const { t } = useI18n();
  return (
    <section className="analytics-card crawler-manual-workflow">
      <div className="crawler-manual-workflow-heading">
        <div>
          <div className="eyebrow">{t("crawler.manualControl")}</div>
          <h3>{t("crawler.workflowTitle")}</h3>
        </div>
        <span className="crawler-manual-mode">{t("crawler.automaticOff")}</span>
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
  summary,
  workerState,
  resumable,
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
  workerState: CrawlerWorkerState;
  resumable: boolean;
}) {
  const { t } = useI18n();

  return (
    <section className="analytics-card crawler-progress-card">
      <div className="crawler-progress-header">
        <div>
          <div className="eyebrow">{active ? t("crawler.currentRun") : t("crawler.latestRun")}</div>
          <h3>{t(active ? "crawler.scopeProgress" : "crawler.lastScopeRun", { scope: scopeLabel })}</h3>
          <div className="crawler-progress-message-row">
            <p>
              {active
                ? t(crawlerWorkerStatusMessage(workerState))
                : snapshotSummary.partial + snapshotSummary.unverified > 0
                  ? t("crawler.endedReview")
                  : t("crawler.endedSources", { count: summary.processed })}
              {resumable ? ` ${t("crawler.workerResumable")}` : ""}
              {scopeNotice ? ` ${scopeNotice}` : ""}
            </p>
            {canReset ? (
              <button className="ghost-button compact-button crawler-inline-reset" disabled={isResetting} onClick={onReset} type="button">
                <XCircle size={14} />
                {isResetting ? t("crawler.resetting") : t("crawler.reset")}
              </button>
            ) : null}
          </div>
        </div>
        <div className="crawler-progress-main-stat">
          <strong>{summary.progressPercentage}%</strong>
          <span>
            {t("crawler.processed", { processed: summary.processed, total: summary.total || run.source_count })}
          </span>
        </div>
      </div>

      <div className="crawler-progress-track" aria-label={t("crawler.progress")}>
        <span style={{ width: `${summary.progressPercentage}%` }} />
      </div>

      <div className="crawler-run-status-grid">
        <CrawlerRunStatusMetric label={t("crawler.queued")} value={summary.queued} />
        <CrawlerRunStatusMetric label={t(active && workerState !== "running" ? "crawler.claimedTasks" : "crawler.running")} value={summary.running} tone="brand" />
        <CrawlerRunStatusMetric label={t("crawler.parsedSources")} value={summary.succeeded} />
        <CrawlerRunStatusMetric label={t("crawler.noUnits")} value={summary.noUnits} />
        <CrawlerRunStatusMetric label={t("crawler.adapterNeeded")} value={summary.unsupported} />
        <CrawlerRunStatusMetric label={t("crawler.failed")} value={summary.failed} tone="danger" />
      </div>
      <p className="table-subtext crawler-snapshot-summary">{t("crawler.runObservations", { count: summary.observationsCreated })}</p>
      <p className="table-subtext crawler-snapshot-summary" aria-label={t("crawler.snapshotQuality")}>
        {t("crawler.snapshotSummary", { complete: snapshotSummary.complete, empty: snapshotSummary.confirmedEmpty, partial: snapshotSummary.partial, unverified: snapshotSummary.unverified })}
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
  const { t, language } = useI18n();
  const review = result?.dry_run ? result as AvailabilityCrawlerManualReview : null;
  const canPublish = canPublishAvailabilityCrawlerReview(review, targetRun?.id ?? null, market);
  const reviewCopy = review ? describeAvailabilityCrawlerReview(review, t) : null;

  return (
    <section className="analytics-card crawler-publish-card">
      <div>
        <div className="eyebrow">{t("crawler.inventoryPublish")}</div>
        <h3>{t("crawler.publishTitle")}</h3>
        <div className="crawler-publish-run">
          {targetRun ? (
            <>
              <strong>{t("crawler.targetRun", { id: shortRunId(targetRun.id, t) })}</strong>
              <span>
                {t("crawler.targetRunSummary", { status: runStatusLabel(targetRun.status, t), count: targetRun.observation_count, date: formatNullableDate(targetRun.finished_at, language, t) })}
              </span>
            </>
          ) : (
            <span>{t("crawler.noPublishRun")}</span>
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
          {isPreviewing ? t("crawler.previewing") : t("crawler.preview")}
        </button>
        <button className="button crawler-primary-action" disabled={disabled || !canPublish} onClick={onPublish} type="button">
          <CheckCircle2 size={15} />
          {isPublishing ? t("crawler.publishing") : t("crawler.publishScope", { scope: scopeLabel })}
        </button>
      </div>
      <div className="crawler-publish-preview">
        {result ? (
          <>
            <CrawlerPublishMetric label={t("crawler.sourcesChecked")} value={result.checked_source_count ?? result.source_count} />
            <CrawlerPublishMetric label={t("crawler.publishableUnits")} value={result.candidate_observation_count} tone="brand" />
            <CrawlerPublishMetric label={t("crawler.newListings")} value={result.created_listing_count} tone="success" />
            <CrawlerPublishMetric label={t("crawler.updatedListings")} value={result.updated_listing_count} />
            <CrawlerPublishMetric label={t("crawler.unavailableListings")} value={result.marked_unavailable_count} tone="danger" />
            <CrawlerPublishMetric label={t("crawler.skippedRows")} value={result.skipped_observation_count} />
          </>
        ) : (
          <div className="crawler-publish-empty">
            {t("crawler.noPreview")}
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

function RunItemStatusPill({ status, workerState }: { status: string; workerState: CrawlerWorkerState }) {
  const { t } = useI18n();
  if (status === "running") return <span className="status-pill pending">{t(workerState === "running" ? "crawler.running" : "crawler.claimedTasks")}</span>;
  if (status === "succeeded") return <span className="status-pill active">{t("crawler.parsed")}</span>;
  if (status === "no_units_found") return <span className="status-pill pending">{t("crawler.noUnits")}</span>;
  if (status === "failed") return <span className="status-pill suspended">{t("crawler.failed")}</span>;
  if (status === "unsupported") return <span className="status-pill pending">{t("crawler.adapterNeeded")}</span>;
  if (status === "unavailable") return <span className="status-pill pending">{t("crawler.empty")}</span>;
  if (status === "skipped") return <span className="status-pill pending">{t("crawler.skipped")}</span>;
  return <span className="status-pill pending">{t("crawler.queued")}</span>;
}

function runItemNote(status: string, t: CrawlerTranslator) {
  const keys: Record<string, string> = {
    queued: "waitingNote", running: "runningNote", succeeded: "parsedNote",
    no_units_found: "noUnitsNote", unavailable: "emptyNote", failed: "failedNote",
    unsupported: "parserRequired", skipped: "skippedNote",
  };
  return keys[status] ? t(`crawler.${keys[status]}`) : runStatusLabel(status, t);
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

function overviewCardIcon(id: string) {
  if (id === "queue") return <SearchCode size={17} />;
  if (id === "running") return <Bot size={17} />;
  if (id === "review") return <AlertTriangle size={17} />;
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
  showEmptySections,
  workerState,
}: {
  activeRun: AvailabilityCrawlRun | null;
  groups: CrawlerBuildingGroup[];
  isEnqueueing: boolean;
  onRunSource: (source: AvailabilityCrawlerDashboardRow) => void;
  runItemsBySourceId: Map<string, AvailabilityCrawlRunItem>;
  showEmptySections: boolean;
  workerState: CrawlerWorkerState;
}) {
  const { t } = useI18n();
  const sections = groupCrawlerRunListSections(
    groups,
    (group) => crawlerRunStateForGroup(group, runItemsBySourceId),
    { includeEmpty: showEmptySections },
    t,
  );

  return (
    <div className="admin-table-wrap crawler-source-table-wrap">
      <table className="admin-table crawler-source-table">
        <thead>
          <tr>
            <th>{t("crawler.building")}</th>
            <th>{t("crawler.providerStrategy")}</th>
            <th>{t("crawler.crawlStatus")}</th>
            <th>{t("crawler.latestCrawl")}</th>
            <th>{t("crawler.unitsChanges")}</th>
            <th>{t("crawler.notes")}</th>
            <th>{t("crawler.action")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.length === 0 ? (
            <tr>
              <td colSpan={7}>
                <EmptyCrawlerState title={t("crawler.noBuildings")} body={t("crawler.noBuildingsHint")} />
              </td>
            </tr>
          ) : null}
          {sections.map((section) => (
            <Fragment key={section.state}>
              <CrawlerSourceSectionHeader
                count={section.rows.length}
                helper={section.state === "active" && activeRun && workerState !== "running" ? t("crawler.pendingTaskGroup") : section.helper}
                label={section.state === "active" && activeRun && workerState !== "running" ? t("crawler.pendingTasks") : section.label}
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
                    workerState={workerState}
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
  const { t } = useI18n();
  const copy =
    state === "active"
      ? t("crawler.emptyActive")
      : state === "done"
        ? t("crawler.emptyDone")
        : state === "failed"
          ? t("crawler.emptyFailed")
          : t("crawler.emptyNotStarted");

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
  const { t } = useI18n();
  return (
    <tr className={`crawler-source-section-row section-${state}`}>
      <td colSpan={7}>
        <div className="crawler-source-section-header">
          <div>
            <span>{label}</span>
            <small>{helper}</small>
          </div>
          <strong>{t("crawler.buildingCount", { count })}</strong>
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
  runItem,
  workerState,
}: {
  activeRun: AvailabilityCrawlRun | null;
  group: CrawlerBuildingGroup;
  isEnqueueing: boolean;
  onRunSource: (source: AvailabilityCrawlerDashboardRow) => void;
  runItem: AvailabilityCrawlRunItem | null;
  workerState: CrawlerWorkerState;
}) {
  const { t, language } = useI18n();
  const row = group.primarySource;
  const currentUnits = runItem ? runItem.units_found : row.latest_units_found ?? 0;
  const currentChanges = runItem ? runItem.changes_detected : row.change_count_7d;
  const statusTime = runItem ? runItem.finished_at ?? runItem.started_at : row.last_crawled_at;
  const diagnostic = runItem ? runItem.error : row.latest_error;
  const statusNote = runItem?.status === "running" && workerState !== "running" ? t("crawler.claimedTaskNote")
    : runItem ? runItemNote(runItem.status, t) : noteForSource(row, t);
  const quality = describeCrawlerSnapshotQuality(runItem, t);

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
          {[row.area, row.city, row.state].filter(Boolean).join(" · ") || t("crawler.noArea")}
          {row.year_built ? ` · ${row.year_built}` : ""}
          {row.total_units ? ` · ${t("crawler.unitCount", { count: row.total_units })}` : ""}
          {group.sourceCount > 1 ? ` · ${t("crawler.sourceCount", { count: group.sourceCount })}` : ""}
        </p>
      </td>
      <td>
        <strong>{providerLabel(row.provider_label, row.provider_key, t)}</strong>
        <p className="table-subtext">
          <span title={row.parser_strategy}>{strategyLabel(row.parser_strategy, t)}</span>
          {row.requires_browser ? <span className="crawler-mini-pill">{t("crawler.browser")}</span> : null}
        </p>
      </td>
      <td>
        {runItem ? <RunItemStatusPill status={runItem.status} workerState={workerState} /> : <StatusPill row={row} />}
        {runItem?.status !== "running" && runItem?.status !== "queued" ? (
          <p className="table-subtext"><span className={`status-pill ${quality.tone}`} title={quality.note}>{quality.label}</span></p>
        ) : null}
        <p className="table-subtext">{runItem ? t("crawler.currentRunNote") : providerStatusLabel(row.provider_status, t)}</p>
      </td>
      <td>
        <strong className="crawler-date-text">{formatNullableDate(statusTime, language, t)}</strong>
        {row.last_success_at && !runItem ? <p className="table-subtext">{t("crawler.lastSuccess", { date: formatNullableDate(row.last_success_at, language, t) })}</p> : null}
      </td>
      <td>
        <strong>{t("crawler.unitCount", { count: currentUnits })}</strong>
        <p className="table-subtext">
          {t("crawler.changeCount", { count: currentChanges })}
          {runItem ? "" : t("crawler.changeBreakdown", { price: row.price_change_count_7d, unavailable: row.went_unavailable_count_7d })}
        </p>
      </td>
      <td>
        <div className="crawler-note-text">{diagnostic ? <CrawlerError error={diagnostic} origin="source" compact /> : statusNote}</div>
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
              ? t("crawler.runAlreadyActive")
              : isRunnableSource(row)
                ? t("crawler.queueBuilding")
                : t("crawler.parserRequired")
          }
          type="button"
        >
          <SearchCode size={13} />
          {t("crawler.run")}
        </button>
      </td>
    </tr>
  );
}

function StatusPill({ row }: { row: AvailabilityCrawlerDashboardRow }) {
  const { t } = useI18n();
  if (row.provider_status === "validated_units_found" && isRunnableSource(row)) {
    return (
      <span className="status-pill active">
        <CheckCircle2 size={12} />
        {t("crawler.validated")}
      </span>
    );
  }

  if (row.provider_status === "confirmed_no_current_units" && isRunnableSource(row)) {
    return (
      <span className="status-pill pending">
        <CheckCircle2 size={12} />
        {t("crawler.noUnitsNow")}
      </span>
    );
  }

  if (isReferenceOnlySource(row)) {
    return <span className="status-pill pending">{t("crawler.reference")}</span>;
  }

  if (!row.crawl_enabled) {
    return (
      <span className="status-pill suspended">
        <XCircle size={12} />
        {t("crawler.disabled")}
      </span>
    );
  }

  if (row.latest_status === "succeeded") {
    return (
      <span className="status-pill active">
        <CheckCircle2 size={12} />
        {t("crawler.parsed")}
      </span>
    );
  }

  if (row.requires_browser && isConcreteSource(row)) {
    return (
      <span className="status-pill pending">
        <Bot size={12} />
        {t("crawler.browser")}
      </span>
    );
  }

  if (needsAttention(row)) {
    return (
      <span className="status-pill pending">
        <AlertTriangle size={12} />
        {t("crawler.review")}
      </span>
    );
  }

  if (isRunnableSource(row)) {
    return (
      <span className="status-pill active">
        <CheckCircle2 size={12} />
        {t("crawler.ready")}
      </span>
    );
  }

  return <span className="status-pill pending">{t("crawler.pending")}</span>;
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

function noteForSource(source: AvailabilityCrawlerDashboardRow, t: CrawlerTranslator) {
  if (!source.availability_url) return t("crawler.missingURLNote");
  if (isReferenceOnlySource(source)) return t("crawler.referenceNote");
  if (source.provider_status === "validated_units_found") return t("crawler.validatedNote");
  if (source.provider_status === "confirmed_no_current_units") return t("crawler.confirmedEmptyNote");
  if (source.provider_status === "needs_floorplan_drilldown") return t("crawler.drilldownNote");
  if (source.provider_status === "surface_found_needs_parser") return t("crawler.surfaceNote");
  if (source.provider_status === "count_mismatch_needs_parser_review") return t("crawler.mismatchNote");
  if (!source.crawl_enabled) return t("crawler.disabledNote");
  if (source.requires_browser) return t("crawler.browserNote");
  if (source.latest_status === "no_units_found") return t("crawler.noUnitsNote");
  if (source.latest_status === "skipped" && isRunnableSource(source)) return t("crawler.nextCrawlNote");
  if (source.latest_status) return runItemNote(source.latest_status, t);
  return t("crawler.firstCrawlNote");
}

function runStatusLabel(status: string, t: CrawlerTranslator) {
  const keys: Record<string, string> = {
    queued: "queued", running: "running", succeeded: "completed", partial: "partialRun",
    failed: "failed", cancelled: "cancelled", skipped: "skipped", unsupported: "adapterNeeded",
    unavailable: "empty", no_units_found: "noUnits",
  };
  return t(`crawler.${keys[status] ?? "unknownStatus"}`);
}

function providerStatusLabel(status: string, t: CrawlerTranslator) {
  const keys: Record<string, string> = {
    validated_units_found: "validated", confirmed_no_current_units: "noUnitsNow",
    needs_floorplan_drilldown: "drilldownNote", surface_found_needs_parser: "surfaceNote",
    count_mismatch_needs_parser_review: "mismatchNote", provider_link_found: "statusProviderLink",
    official_availability_page_found: "statusOfficialPage", missing_website: "statusMissingWebsite",
    website_unavailable: "statusWebsiteUnavailable", fetch_failed: "statusFetchFailed",
    browser_fetch_failed: "statusBrowserFailed", contact_or_tour_only: "statusContactOnly",
    no_availability_signal: "statusNoSignal", provider_signal_without_link: "statusSignalOnly",
  };
  return t(`crawler.${keys[status] ?? "pending"}`);
}

function inventoryPublishNotice(result: InventoryPublishResult): CrawlerNotice {
  return {
    key: "crawler.publishedMessage",
    params: {
      count: result.candidate_observation_count,
      id: result.run_id?.slice(0, 8) ?? "-",
      created: result.created_listing_count,
      updated: result.updated_listing_count,
      unavailable: result.marked_unavailable_count,
    },
  };
}

function shortRunId(runId: string | null | undefined, t: CrawlerTranslator) {
  return runId ? runId.slice(0, 8) : t("crawler.unknown");
}

function formatNullableDate(value: string | null, language: Language, t: CrawlerTranslator) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return t("crawler.notAvailable");
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function CrawlerError({ error, compact = false, origin = "backend" }: {
  error: string;
  compact?: boolean;
  origin?: CrawlerErrorOrigin;
}) {
  const { t } = useI18n();
  const { key, details } = describeCrawlerError(error, origin);
  const content = (
    <>
      <span>{t(key)}</span>
      {details !== null ? (
        <details className="crawler-error-details">
          <summary>{t("crawler.technicalDetails")}</summary>
          <code>{details}</code>
        </details>
      ) : null}
    </>
  );
  return compact ? <>{content}</> : <div className="message error">{content}</div>;
}
