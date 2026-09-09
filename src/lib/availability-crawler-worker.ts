import { resolve } from "node:path";

export type AvailabilityCrawlerWorkerLaunch = {
  args: string[];
  command: string;
  cwd: string;
  env: Record<string, string | undefined>;
  logPath: string;
};

export type AvailabilityCrawlerWorkerLaunchInput = {
  batchSize?: number;
  browserFallback?: boolean;
  concurrency?: number;
  maxItems?: number;
  repoRoot?: string;
  runId: string;
  serviceRoleKey?: string;
  supabaseUrl: string;
  timeout?: number;
};

export function defaultPopStreetRepoRoot() {
  return process.env.POPSTREET_REPO_ROOT ?? resolve(process.cwd(), "..", "PopStreet");
}

export function buildAvailabilityCrawlerWorkerLaunch({
  batchSize = 25,
  browserFallback = false,
  concurrency = 12,
  maxItems,
  repoRoot = defaultPopStreetRepoRoot(),
  runId,
  serviceRoleKey,
  supabaseUrl,
  timeout = 12,
}: AvailabilityCrawlerWorkerLaunchInput): AvailabilityCrawlerWorkerLaunch {
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to launch the availability crawler worker.");
  }

  const scriptPath = resolve(repoRoot, "scripts", "availability_crawler.py");
  const logPath = resolve(repoRoot, "tmp", `availability-crawler-worker-${runId}.log`);
  const args = [
    scriptPath,
    "worker-loop",
    "--run-id",
    runId,
    "--batch-size",
    String(batchSize),
    "--concurrency",
    String(concurrency),
    "--timeout",
    String(timeout),
    "--once",
  ];

  if (maxItems && maxItems > 0) {
    args.push("--max-items", String(maxItems));
  }

  return {
    args,
    command: process.env.POPSTREET_PYTHON_BIN ?? "python3",
    cwd: repoRoot,
    env: {
      NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      AVAILABILITY_BROWSER_FALLBACK: browserFallback ? "1" : undefined,
      SUPABASE_ANON_KEY: undefined,
      SUPABASE_AUTH_TOKEN: undefined,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      SUPABASE_URL: supabaseUrl,
    },
    logPath,
  };
}
