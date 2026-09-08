import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { ExternalAccountClient, GoogleAuth } from "google-auth-library";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  availabilityCrawlerCloudRunConfigFromEnv,
  availabilityCrawlerVercelWifConfigFromEnv,
  availabilityCrawlerVercelWifIsConfigured,
  buildAvailabilityCrawlerCloudRunRequest,
  buildAvailabilityCrawlerVercelExternalAccountOptions,
  cloudRunAvailabilityCrawlerIsConfigured,
} from "@/lib/availability-crawler-cloud-run";
import { buildAvailabilityCrawlerWorkerLaunch, defaultPopStreetRepoRoot } from "@/lib/availability-crawler-worker";
import { CrawlerDispatchConflict, CrawlerLaunchRejected, dispatchAvailabilityCrawler, type CrawlerDispatch, type CrawlerExecution } from "@/lib/availability-crawler-dispatch";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!uuidPattern.test(runId)) {
    return NextResponse.json({ error: "Invalid crawler run id." }, { status: 400 });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server dispatch reservation credentials are not configured." }, { status: 503 });
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

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

async function authorizeInventoryAdmin(accessToken: string) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { error: "Admin authorization is not configured.", ok: false as const, status: 500 };
  }

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await client.rpc("can_manage_inventory");
  if (error || data !== true) {
    return { error: "This account cannot run the availability crawler.", ok: false as const, status: 403 };
  }
  return { ok: true as const };
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

type CloudExecution = {
  name?: string;
  completionTime?: string;
  template?: { containers?: { env?: { name: string; value: string }[]; args?: string[] }[] };
};
type CloudOperation = { name?: string; error?: { message?: string }; metadata?: CloudExecution; response?: CloudExecution };

function executionName(name?: string) {
  return name && /^projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+\/executions\/[^/]+$/.test(name) ? name : null;
}

async function inspectCloudRunDispatch(dispatch: CrawlerDispatch, token: string): Promise<CrawlerExecution | null> {
  if (dispatch.mode && dispatch.mode !== "cloud_run") return null;
  const read = async (path: string) => {
    // Resource paths come from our persisted Cloud response, never request body.
    if (!/^projects\/[\w.-]+\/locations\/[\w-]+\//.test(path) || path.includes("..")) throw new Error("Invalid Cloud resource.");
    const response = await fetch(`https://run.googleapis.com/v2/${path}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const detail = typeof payload?.error?.message === "string" ? payload.error.message : "Execution lookup was rejected.";
      throw new Error(`Cloud HTTP ${response.status}: ${detail}`);
    }
    return response.json();
  };
  const name = dispatch.execution_name;
  if (name) {
    if (!executionName(name)) return null;
    const execution = await read(name) as CloudExecution;
    return { execution: name, operation: dispatch.operation_name, terminal: Boolean(execution.completionTime) };
  }

  // Recover an accepted launch whose response was lost by its exact reservation
  // identity. An empty list (including eventual consistency) does NOT free it.
  if (!dispatch.job_name) return null;
  let pageToken = "";
  for (let page = 0; page < 3; page++) {
    const result = await read(`${dispatch.job_name}/executions?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`) as {
      executions?: CloudExecution[]; nextPageToken?: string;
    };
    const execution = result.executions?.find((item) => item.template?.containers?.some((container) =>
      container.env?.some((env) => env.name === "AVAILABILITY_CRAWLER_DISPATCH_ID" && env.value === dispatch.dispatch_id)
      && container.args?.includes(dispatch.run_id),
    ));
    if (execution && executionName(execution.name)) {
      return { execution: execution.name as string, operation: dispatch.operation_name, terminal: Boolean(execution.completionTime) };
    }
    if (!result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }
  return null;
}

async function cloudRunAccessToken(request: NextRequest) {
  const oidcToken = request.headers.get("x-vercel-oidc-token");
  const wifConfig = availabilityCrawlerVercelWifConfigFromEnv();
  if (oidcToken && availabilityCrawlerVercelWifIsConfigured(wifConfig)) {
    const authClient = ExternalAccountClient.fromJSON(
      buildAvailabilityCrawlerVercelExternalAccountOptions(wifConfig, async () => oidcToken),
    );
    if (!authClient) {
      throw new Error("Could not initialize Vercel workload identity federation.");
    }
    const response = await authClient.getAccessToken();
    if (!response.token) {
      throw new Error("Could not exchange the Vercel identity token for Google Cloud access.");
    }
    return response.token;
  }

  const credentialsText = process.env.AVAILABILITY_CRAWLER_GCP_SERVICE_ACCOUNT_JSON;
  if (credentialsText) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(credentialsText) as Record<string, unknown>;
    } catch {
      throw new Error("Cloud Run dispatch credentials are not valid JSON.");
    }
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const token = await auth.getAccessToken();
    if (!token) {
      throw new Error("Could not obtain a Google Cloud access token.");
    }
    return token;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Cloud Run dispatch authentication is not configured.");
  }
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const token = await auth.getAccessToken();
  if (!token) {
    throw new Error("Could not obtain a local Google Cloud access token.");
  }
  return token;
}

function extractBearerToken(header: string | null) {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function positiveIntegerOrUndefined(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
}
