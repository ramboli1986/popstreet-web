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
  { signal, pause = () => new Promise<void>((resolve) => setTimeout(resolve, 3000)) }: {
    signal?: AbortSignal;
    pause?: () => Promise<void>;
  } = {},
) {
  while (!signal?.aborted) {
    const response = await requestLaunch();
    const payload = await response.json().catch(() => null) as { started?: boolean; pending?: boolean; error?: string } | null;
    if (!response.ok) throw new Error(payload?.error ?? "Could not confirm the crawler launch.");
    if (payload?.started && !payload.pending) return;
    if (!payload?.pending) throw new Error("Crawler launch confirmation is missing. Refresh before trying again.");
    await pause();
  }
  throw new Error("Crawler launch confirmation was cancelled.");
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

export function describeAvailabilityCrawlerReview(review: AvailabilityCrawlerManualReview) {
  const successPercentage = Math.round(review.success_ratio * 100);
  const qualityKnown = typeof review.complete_source_count === "number" && typeof review.confirmed_empty_source_count === "number";
  const qualityCopy = qualityKnown
    ? `${review.complete_source_count} complete, ${review.confirmed_empty_source_count} confirmed empty, ${review.partial_source_count ?? 0} partial, ${review.unknown_source_count ?? 0} unknown. ${successPercentage}% passed snapshot safety checks.`
    : "Snapshot quality is unverified. Refresh the preview before publishing.";
  if (review.eligible && review.preview_fingerprint && !review.reset_existing_inventory) {
    return {
      body: `${qualityCopy} The reviewed changes are ready for approval.`,
      title: "Ready to publish",
    };
  }

  const reasons = review.gate_failures.map(reviewFailureCopy).join(" ");
  return {
    body: `${qualityCopy} ${reasons}`.trim(),
    title: "Review required before publishing",
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
}) {
  if (activeRun) {
    return [
      manualStep("1", "Crawl", "Cloud worker is processing building sources.", "active"),
      manualStep("2", "Review", "Available after this run finishes.", "waiting"),
      manualStep("3", "Publish", "Requires a successful review and your confirmation.", "waiting"),
    ];
  }

  if (published) {
    return [
      manualStep("1", "Crawl", "Latest run completed.", "complete"),
      manualStep("2", "Review", "Safety review completed.", "complete"),
      manualStep("3", "Publish", "Inventory published.", "complete"),
    ];
  }

  if (preview) {
    return [
      manualStep("1", "Crawl", "Latest run completed.", "complete"),
      manualStep("2", "Review", preview.eligible ? "Safety checks passed." : "Issues need attention.", "complete"),
      manualStep(
        "3",
        "Publish",
        preview.eligible ? "Ready for your confirmation." : "Blocked until the review passes.",
        preview.eligible ? "active" : "waiting",
      ),
    ];
  }

  return [
    manualStep("1", "Crawl", "Start a cloud crawl for the selected market.", "active"),
    manualStep("2", "Review", "Inspect changes and failed sources.", "waiting"),
    manualStep("3", "Publish", "Publish only after review.", "waiting"),
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

function reviewFailureCopy(reason: string) {
  if (reason === "no_verified_snapshots") return "No verified snapshots are ready to publish.";
  if (reason === "abnormal_inventory_drop") return "The inventory decrease needs separate operator review.";
  if (reason === "reset_inventory_not_supported") return "Whole-inventory replacement is not supported.";
  if (reason === "run_still_active") return "The crawl is still running.";
  if (reason === "run_status_not_publishable") return "The run did not finish in a publishable state.";
  if (reason === "success_ratio_below_minimum") return "Too few sources passed snapshot safety checks.";
  if (reason === "failed_count_above_maximum") return "The failed-source count is above the safety limit.";
  if (reason === "run_market_mismatch") return "The reviewed run does not match the selected market.";
  if (reason === "no_sources_in_market") return "The run contains no sources for this market.";
  return "This run did not pass every publish safety check.";
}
