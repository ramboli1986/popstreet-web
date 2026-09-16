import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  availabilityCrawlerCloudRunConfigFromEnv,
  buildAvailabilityCrawlerCloudRunRequest,
  cloudRunAvailabilityCrawlerIsConfigured,
} from "@/lib/availability-crawler-cloud-run";
import { buildAvailabilityCrawlerWorkerLaunch, defaultPopStreetRepoRoot } from "@/lib/availability-crawler-worker";
import { CrawlerDispatchConflict, CrawlerLaunchRejected, dispatchAvailabilityCrawler } from "@/lib/availability-crawler-dispatch";
import { authorizeInventoryAdmin, cloudRunAccessToken, crawlerRunIdPattern, createCrawlerServiceClient, executionName, extractBearerToken, inspectCloudRunDispatch, type CloudOperation } from "@/lib/availability-crawler-server";

export async function POST(request: NextRequest) {
  const bearerToken = extractBearerToken(request.headers.get("authorization"));
  if (!bearerToken) {
    return NextResponse.json({ error: "Missing admin session." }, { status: 401 });
  }

  const authorization = await authorizeInventoryAdmin(bearerToken);
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  const body = await request.json().catch(() => null);
  const runId = typeof body?.runId === "string" ? body.runId : "";
  if (!crawlerRunIdPattern.test(runId)) {
    return NextResponse.json({ error: "Invalid crawler run id." }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  const client = createCrawlerServiceClient();
  if (!client || !supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server dispatch reservation credentials are not configured." }, { status: 503 });
  }

  const cloudRunConfig = availabilityCrawlerCloudRunConfigFromEnv();
  if (cloudRunAvailabilityCrawlerIsConfigured(cloudRunConfig)) {
    try {
      const token = await cloudRunAccessToken(request);
      const jobName = `projects/${cloudRunConfig.projectId}/locations/${cloudRunConfig.region}/jobs/${cloudRunConfig.jobName}`;
      const result = await dispatchAvailabilityCrawler({
        client, runId, mode: "cloud_run", jobName,
        launch: (dispatchId) => startCloudRunJob({
          ...cloudRunConfig, dispatchId, token,
          maxItems: positiveIntegerOrUndefined(body?.maxItems), runId,
        }),
        inspect: (dispatch) => inspectCloudRunDispatch(dispatch, token),
      });
      return NextResponse.json(result, { status: result.pending ? 202 : 200 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not start the Cloud Run crawler job." },
        { status: error instanceof CrawlerDispatchConflict ? 409 : 502 },
      );
    }
  }

  if (process.env.NODE_ENV === "production" || process.env.AVAILABILITY_CRAWLER_ALLOW_LOCAL_WORKER !== "true") {
    return NextResponse.json(
      { error: "Cloud crawler is not configured. Set the Cloud Run project, region, and job variables." },
      { status: 503 },
    );
  }

  const repoRoot = defaultPopStreetRepoRoot();
  const launch = buildAvailabilityCrawlerWorkerLaunch({
    browserFallback: body?.browserFallback !== false,
    maxItems: positiveIntegerOrUndefined(body?.maxItems),
    repoRoot,
    runId,
    serviceRoleKey,
    supabaseUrl,
  });

  try {
    const result = await dispatchAvailabilityCrawler({
      client, runId, mode: "local_development", jobName: repoRoot,
      // A PID alone cannot prove process identity after reuse. Local reservations
      // are never auto-released; reset the run after inspecting a stalled process.
      inspect: async () => null,
      launch: async (dispatchId) => {
        const pid = await spawnLocalWorker(launch, dispatchId);
        return { execution: `local:${dispatchId}:${pid}`, operation: null };
      },
    });
    return NextResponse.json({ ...result, logPath: launch.logPath }, { status: result.pending ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start local worker." }, {
      status: error instanceof CrawlerDispatchConflict ? 409 : 502,
    });
  }
}

async function spawnLocalWorker(launch: ReturnType<typeof buildAvailabilityCrawlerWorkerLaunch>, dispatchId: string) {
  mkdirSync(dirname(launch.logPath), { recursive: true });
  const logFd = openSync(launch.logPath, "a");
  let logClosed = false;
  const closeLog = () => {
    if (logClosed) return;
    logClosed = true;
    closeSync(logFd);
  };
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    detached: true,
    env: { ...process.env, ...launch.env, AVAILABILITY_CRAWLER_DISPATCH_ID: dispatchId },
    stdio: ["ignore", logFd, logFd],
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => { closeLog(); resolve(); });
    child.once("error", (error) => { closeLog(); reject(error); });
  });
  child.unref();
  return child.pid;
}


async function startCloudRunJob({
  dispatchId,
  jobName,
  maxItems,
  projectId,
  region,
  token,
  runId,
}: {
  dispatchId: string;
  jobName: string;
  maxItems?: number;
  projectId: string;
  region: string;
  token: string;
  runId: string;
}) {
  const cloudRunRequest = buildAvailabilityCrawlerCloudRunRequest({
    dispatchId,
    jobName,
    maxItems,
    projectId,
    region,
    runId,
  });
  const response = await fetch(cloudRunRequest.url, {
    body: JSON.stringify(cloudRunRequest.body),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => null)) as CloudOperation | null;
  if (!response.ok) {
    const message = payload?.error?.message ?? `Cloud Run returned HTTP ${response.status}.`;
    if ([400, 401, 403, 404, 422].includes(response.status)) {
      throw new CrawlerLaunchRejected(`Cloud Run rejected launch (HTTP ${response.status}): ${message}`, response.status);
    }
    throw new Error(message);
  }
  return { operation: payload?.name ?? null, execution: executionName(payload?.metadata?.name) ?? executionName(payload?.response?.name) };
}


function positiveIntegerOrUndefined(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
}
