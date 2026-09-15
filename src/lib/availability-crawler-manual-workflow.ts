// @ts-expect-error Explicit TS extension also supports the standalone Node helper tests.
import { defaultCrawlerTranslator, type CrawlerTranslator } from "./availability-crawler-helper-messages.ts";

export type AvailabilityCrawlerManualReview = {
  checked_source_count?: number;
  dry_run: boolean;
  eligible: boolean;
  failed_count: number;
  gate_failures: string[];
  market: string;
  run_id?: string;
  source_count: number;
  success_ratio: number;
  preview_fingerprint?: string;
  complete_source_count?: number;
  confirmed_empty_source_count?: number;
  partial_source_count?: number;
  unknown_source_count?: number;
  unverified_source_count?: number;
  reset_existing_inventory?: boolean;
};

export type AvailabilityCrawlerManualStepState = "active" | "complete" | "waiting";

export async function confirmAvailabilityCrawlerLaunch(
  requestLaunch: () => Promise<Response>,
  { signal, pause = () => new Promise<void>((resolve) => setTimeout(resolve, 3000)), t = defaultCrawlerTranslator }: {
    signal?: AbortSignal;
    pause?: () => Promise<void>;
    t?: CrawlerTranslator;
  } = {},
) {
  while (!signal?.aborted) {
    const response = await requestLaunch();
    const payload = await response.json().catch(() => null) as { started?: boolean; pending?: boolean; error?: string } | null;
    if (!response.ok) throw new Error(payload?.error ?? t("crawlerHelpers.launchFailed"));
    if (payload?.started && !payload.pending) return;
    if (!payload?.pending) throw new Error(t("crawlerHelpers.launchMissingConfirmation"));
    await pause();
  }
  throw new Error(t("crawlerHelpers.launchCancelled"));
}

export function canPublishAvailabilityCrawlerReview(
  review: AvailabilityCrawlerManualReview | null,
  runId: string | null,
  market: string,
) {
  return Boolean(
    review?.dry_run
      && review.eligible
      && review.preview_fingerprint?.trim()
      && !review.reset_existing_inventory
      && review.run_id
      && review.run_id === runId
      && review.market.toUpperCase() === market.toUpperCase(),
  );
}

export function describeAvailabilityCrawlerReview(review: AvailabilityCrawlerManualReview, t: CrawlerTranslator = defaultCrawlerTranslator) {
  const successPercentage = Math.round(review.success_ratio * 100);
  const qualityKnown = typeof review.complete_source_count === "number" && typeof review.confirmed_empty_source_count === "number";
  const qualityCopy = qualityKnown
    ? t("crawlerHelpers.reviewQualityKnown", {
      complete: review.complete_source_count ?? 0,
      empty: review.confirmed_empty_source_count ?? 0,
      partial: review.partial_source_count ?? 0,
      unknown: review.unknown_source_count ?? 0,
      percentage: successPercentage,
    })
    : t("crawlerHelpers.reviewQualityUnknown");
  if (review.eligible && review.preview_fingerprint && !review.reset_existing_inventory) {
    return {
      body: t("crawlerHelpers.reviewReadyBody", { quality: qualityCopy }),
      title: t("crawlerHelpers.reviewReadyTitle"),
    };
  }

  const reasons = review.gate_failures.map((reason) => reviewFailureCopy(reason, t)).join(" ");
  return {
    body: `${qualityCopy} ${reasons}`.trim(),
    title: t("crawlerHelpers.reviewRequiredTitle"),
  };
}

export function availabilityCrawlerManualSteps({
  activeRun,
  preview,
  published,
}: {
  activeRun: { id: string; status: string } | null;
  preview: AvailabilityCrawlerManualReview | null;
  published: boolean;
}, t: CrawlerTranslator = defaultCrawlerTranslator) {
  if (activeRun) {
    return [
      manualStep("1", t("crawlerHelpers.stepCrawl"), t("crawlerHelpers.stepCrawlActive"), "active"),
      manualStep("2", t("crawlerHelpers.stepReview"), t("crawlerHelpers.stepReviewWaiting"), "waiting"),
      manualStep("3", t("crawlerHelpers.stepPublish"), t("crawlerHelpers.stepPublishWaiting"), "waiting"),
    ];
  }

  if (published) {
    return [
      manualStep("1", t("crawlerHelpers.stepCrawl"), t("crawlerHelpers.stepCrawlComplete"), "complete"),
      manualStep("2", t("crawlerHelpers.stepReview"), t("crawlerHelpers.stepReviewComplete"), "complete"),
      manualStep("3", t("crawlerHelpers.stepPublish"), t("crawlerHelpers.stepPublishComplete"), "complete"),
    ];
  }

  if (preview) {
    return [
      manualStep("1", t("crawlerHelpers.stepCrawl"), t("crawlerHelpers.stepCrawlComplete"), "complete"),
      manualStep("2", t("crawlerHelpers.stepReview"), t(preview.eligible ? "crawlerHelpers.stepReviewPassed" : "crawlerHelpers.stepReviewIssues"), "complete"),
      manualStep(
        "3",
        t("crawlerHelpers.stepPublish"),
        t(preview.eligible ? "crawlerHelpers.stepPublishReady" : "crawlerHelpers.stepPublishBlocked"),
        preview.eligible ? "active" : "waiting",
      ),
    ];
  }

  return [
    manualStep("1", t("crawlerHelpers.stepCrawl"), t("crawlerHelpers.stepCrawlStart"), "active"),
    manualStep("2", t("crawlerHelpers.stepReview"), t("crawlerHelpers.stepReviewStart"), "waiting"),
    manualStep("3", t("crawlerHelpers.stepPublish"), t("crawlerHelpers.stepPublishStart"), "waiting"),
  ];
}

function manualStep(
  number: string,
  title: string,
  body: string,
  state: AvailabilityCrawlerManualStepState,
) {
  return { body, number, state, title };
}

function reviewFailureCopy(reason: string, t: CrawlerTranslator) {
  if (reason === "no_verified_snapshots") return t("crawlerHelpers.reviewGate_no_verified_snapshots");
  if (reason === "abnormal_inventory_drop") return t("crawlerHelpers.reviewGate_abnormal_inventory_drop");
  if (reason === "reset_inventory_not_supported") return t("crawlerHelpers.reviewGate_reset_inventory_not_supported");
  if (reason === "run_still_active") return t("crawlerHelpers.reviewGate_run_still_active");
  if (reason === "run_status_not_publishable") return t("crawlerHelpers.reviewGate_run_status_not_publishable");
  if (reason === "success_ratio_below_minimum") return t("crawlerHelpers.reviewGate_success_ratio_below_minimum");
  if (reason === "failed_count_above_maximum") return t("crawlerHelpers.reviewGate_failed_count_above_maximum");
  if (reason === "run_market_mismatch") return t("crawlerHelpers.reviewGate_run_market_mismatch");
  if (reason === "no_sources_in_market") return t("crawlerHelpers.reviewGate_no_sources_in_market");
  return t("crawlerHelpers.reviewGateUnknown");
}
