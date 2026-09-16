import { ExternalAccountClient, GoogleAuth } from "google-auth-library";
import { createClient } from "@supabase/supabase-js";
import {
  availabilityCrawlerVercelWifConfigFromEnv,
  availabilityCrawlerVercelWifIsConfigured,
  buildAvailabilityCrawlerVercelExternalAccountOptions,
} from "@/lib/availability-crawler-cloud-run";
import type { CrawlerDispatch, CrawlerExecution } from "@/lib/availability-crawler-dispatch";

export const crawlerRunIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createCrawlerServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function authorizeInventoryAdmin(accessToken: string) {
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

type CloudExecution = {
  name?: string;
  startTime?: string;
  completionTime?: string;
  runningCount?: number;
  failedCount?: number;
  cancelledCount?: number;
  succeededCount?: number;
  taskCount?: number;
  conditions?: { type?: string; state?: string }[];
  template?: { containers?: { env?: { name: string; value: string }[]; args?: string[] }[] };
};
export type CloudOperation = { name?: string; error?: { message?: string }; metadata?: CloudExecution; response?: CloudExecution };

export function executionName(name?: string) {
  return name && /^projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+\/executions\/[^/]+$/.test(name) ? name : null;
}

function inspectedExecution(execution: CloudExecution, operation: string | null): CrawlerExecution {
  const completed = execution.conditions?.find((condition) => condition.type === "Completed")?.state;
  const terminal = Boolean(execution.completionTime)
    || completed === "CONDITION_FAILED" || completed === "CONDITION_SUCCEEDED";
  let state: CrawlerExecution["state"] = "unknown";
  if (terminal) {
    if (completed === "CONDITION_FAILED" || (execution.failedCount ?? 0) > 0 || (execution.cancelledCount ?? 0) > 0) state = "failed";
    else if (completed === "CONDITION_SUCCEEDED"
      || ((execution.taskCount ?? 0) > 0 && execution.succeededCount === execution.taskCount)) state = "succeeded";
  } else if ((execution.runningCount ?? 0) > 0 || execution.startTime
    || completed === "CONDITION_PENDING" || completed === "CONDITION_RECONCILING") state = "running";
  return { execution: execution.name ?? null, operation, terminal, state, completedAt: execution.completionTime ?? null };
}

export async function inspectCloudRunDispatch(dispatch: CrawlerDispatch, token: string): Promise<CrawlerExecution | null> {
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
    if (execution.name !== name) throw new Error("Cloud execution identity did not match.");
    return inspectedExecution(execution, dispatch.operation_name);
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
      return inspectedExecution(execution, dispatch.operation_name);
    }
    if (!result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }
  return null;
}

export async function cloudRunAccessToken(request: Request) {
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

export function extractBearerToken(header: string | null) {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

