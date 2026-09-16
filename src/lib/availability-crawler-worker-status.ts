import type { summarizeCrawlRunItems } from "@/lib/availability-crawler-progress";

export type CrawlerWorkerState = "failed" | "succeeded_unfinished" | "succeeded" | "running" | "unknown";

export type CrawlerWorkerStatus = {
  runId: string;
  runStatus: string;
  dispatchId: string | null;
  execution: string | null;
  operation: string | null;
  workerState: CrawlerWorkerState;
  reason: "verified" | "no_dispatch" | "inspection_unavailable" | "dispatch_changed";
  completedAt: string | null;
  checkedAt: string;
  resumable: boolean;
  counts: ReturnType<typeof summarizeCrawlRunItems> & { staleRunning: number };
};

export function crawlerWorkerStatusMessage(state: CrawlerWorkerState) {
  const keys = {
    failed: "crawler.workerInterrupted",
    succeeded_unfinished: "crawler.workerUnfinished",
    succeeded: "crawler.workerCompleted",
    running: "crawler.workerProcessing",
    unknown: "crawler.workerUnknown",
  } as const;
  return keys[state];
}
