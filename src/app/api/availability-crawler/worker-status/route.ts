import { NextResponse } from "next/server";
import type { CrawlerDispatch, CrawlerExecution } from "@/lib/availability-crawler-dispatch";
import {
  authorizeInventoryAdmin, cloudRunAccessToken, crawlerRunIdPattern,
  createCrawlerServiceClient, extractBearerToken, inspectCloudRunDispatch,
} from "@/lib/availability-crawler-server";
import { countStaleRunningItems, isCrawlerRunActive, summarizeCrawlRunItems, type CrawlRunItemLike } from "@/lib/availability-crawler-progress";
import type { CrawlerWorkerStatus } from "@/lib/availability-crawler-worker-status";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  const bearer = extractBearerToken(request.headers.get("authorization"));
  if (!bearer) return json({ error: "Missing admin session." }, 401);
  const authorization = await authorizeInventoryAdmin(bearer);
  if (!authorization.ok) return json({ error: authorization.error }, authorization.status);

  const runId = new URL(request.url).searchParams.get("runId") ?? "";
  if (!crawlerRunIdPattern.test(runId)) return json({ error: "Invalid crawler run id." }, 400);
  const client = createCrawlerServiceClient();
  if (!client) return json({ error: "Server status credentials are not configured." }, 503);

  try {
    const run = await client.from("availability_crawl_runs").select("id, status").eq("id", runId).maybeSingle();
    if (run.error) throw run.error;
    if (!run.data) return json({ error: "Crawler run not found." }, 404);

    // Page compact task fields; run-level counters may stop updating after a crash.
    const items: CrawlRunItemLike[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const page = await client.from("availability_crawl_run_items")
        .select("status, lease_expires_at, heartbeat_at, started_at, observations_created")
        .eq("run_id", runId).order("id", { ascending: true }).range(offset, offset + pageSize - 1);
      if (page.error) throw page.error;
      items.push(...(page.data ?? []));
      if ((page.data?.length ?? 0) < pageSize) break;
    }
    const counts = { ...summarizeCrawlRunItems(items), staleRunning: countStaleRunningItems(items) };
    const readDispatch = () => client.from("availability_crawler_dispatches")
      .select("run_id, dispatch_id, mode, job_name, state, operation_name, execution_name")
      .eq("run_id", runId).maybeSingle();
    const stored = await readDispatch();
    const dispatch = stored.data as CrawlerDispatch | null;
    let identity: CrawlerExecution | null = null;
    let reason: CrawlerWorkerStatus["reason"] = stored.error ? "inspection_unavailable" : "no_dispatch";
    if (!stored.error && dispatch) {
      reason = "inspection_unavailable";
      if (dispatch.mode === "cloud_run") {
        try {
          identity = await inspectCloudRunDispatch(dispatch, await cloudRunAccessToken(request));
          if (identity?.state && identity.state !== "unknown") reason = "verified";
        } catch {
          // Missing IAM, credentials, timeouts and 404s never prove worker death.
        }
      }
      // A concurrent resume may have replaced the execution during the Cloud read.
      const current = await readDispatch();
      if (current.error || current.data?.dispatch_id !== dispatch.dispatch_id
        || current.data?.execution_name !== dispatch.execution_name) {
        identity = null;
        reason = current.error ? "inspection_unavailable" : "dispatch_changed";
      }
    }
    const workerState = identity?.state === "succeeded" && counts.active > 0
      ? "succeeded_unfinished" : identity?.state ?? "unknown";
    const result: CrawlerWorkerStatus = {
      runId, runStatus: run.data.status,
      dispatchId: dispatch?.dispatch_id ?? null,
      execution: identity?.execution ?? dispatch?.execution_name ?? null,
      operation: identity?.operation ?? dispatch?.operation_name ?? null,
      workerState, reason, completedAt: identity?.completedAt ?? null,
      checkedAt: new Date().toISOString(), counts,
      resumable: isCrawlerRunActive(run.data) && counts.active > 0 && counts.running === counts.staleRunning
        && (workerState === "failed" || workerState === "succeeded_unfinished"),
    };
    return json(result);
  } catch {
    return json({ error: "Could not read crawler run status." }, 503);
  }
}
