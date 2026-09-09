export type AvailabilityCrawlerCloudRunConfig = {
  jobName: string;
  projectId: string;
  region: string;
};

export type AvailabilityCrawlerCloudRunRequestInput = AvailabilityCrawlerCloudRunConfig & {
  dispatchId?: string;
  batchSize?: number;
  browserConcurrency?: number;
  concurrency?: number;
  maxItems?: number;
  runId?: string;
  scheduled?: boolean;
  timeout?: number;
};

export type AvailabilityCrawlerVercelWifConfig = {
  projectNumber: string;
  providerId: string;
  serviceAccountEmail: string;
  workloadIdentityPoolId: string;
};

export type AvailabilityCrawlerSubjectTokenSupplier = () => Promise<string>;

export function cloudRunAvailabilityCrawlerIsConfigured(config: AvailabilityCrawlerCloudRunConfig) {
  return Boolean(config.projectId.trim() && config.region.trim() && config.jobName.trim());
}

export function availabilityCrawlerCloudRunConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AvailabilityCrawlerCloudRunConfig {
  return {
    projectId: env.AVAILABILITY_CRAWLER_GCP_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT_ID ?? "",
    region: env.AVAILABILITY_CRAWLER_CLOUD_RUN_REGION ?? "us-east1",
    jobName: env.AVAILABILITY_CRAWLER_CLOUD_RUN_JOB ?? "availability-crawler",
  };
}

export function availabilityCrawlerVercelWifConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AvailabilityCrawlerVercelWifConfig {
  return {
    projectNumber: env.AVAILABILITY_CRAWLER_GCP_PROJECT_NUMBER ?? "",
    providerId: env.AVAILABILITY_CRAWLER_GCP_WORKLOAD_IDENTITY_PROVIDER_ID ?? "",
    serviceAccountEmail: env.AVAILABILITY_CRAWLER_GCP_SERVICE_ACCOUNT_EMAIL ?? "",
    workloadIdentityPoolId: env.AVAILABILITY_CRAWLER_GCP_WORKLOAD_IDENTITY_POOL_ID ?? "",
  };
}

export function availabilityCrawlerVercelWifIsConfigured(config: AvailabilityCrawlerVercelWifConfig) {
  return Boolean(
    config.projectNumber.trim()
      && config.providerId.trim()
      && config.serviceAccountEmail.trim()
      && config.workloadIdentityPoolId.trim(),
  );
}

export function buildAvailabilityCrawlerVercelExternalAccountOptions(
  config: AvailabilityCrawlerVercelWifConfig,
  getSubjectToken: AvailabilityCrawlerSubjectTokenSupplier,
) {
  if (!availabilityCrawlerVercelWifIsConfigured(config)) {
    throw new Error("Vercel workload identity federation is not fully configured.");
  }

  return {
    type: "external_account" as const,
    audience: `//iam.googleapis.com/projects/${config.projectNumber}/locations/global/workloadIdentityPools/${config.workloadIdentityPoolId}/providers/${config.providerId}`,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(config.serviceAccountEmail)}:generateAccessToken`,
    subject_token_supplier: {
      getSubjectToken: async () => getSubjectToken(),
    },
  };
}

export function buildAvailabilityCrawlerCloudRunRequest({
  dispatchId,
  batchSize = 25,
  browserConcurrency = 2,
  concurrency = 6,
  jobName,
  maxItems,
  projectId,
  region,
  runId,
  scheduled = false,
  timeout = 20,
}: AvailabilityCrawlerCloudRunRequestInput) {
  if (!scheduled && !runId) {
    throw new Error("A manual availability crawler execution requires a run id.");
  }

  const args = scheduled
    ? [
        "scheduled-run",
        "--batch-size",
        String(batchSize),
        "--concurrency",
        String(concurrency),
        "--browser-concurrency",
        String(browserConcurrency),
        "--timeout",
        String(timeout),
      ]
    : [
        "worker-loop",
        "--run-id",
        runId as string,
        "--batch-size",
        String(batchSize),
        "--concurrency",
        String(concurrency),
        "--browser-concurrency",
        String(browserConcurrency),
        "--timeout",
        String(timeout),
      ];

  if (maxItems && maxItems > 0) {
    args.push("--max-items", String(maxItems));
  }
  if (!scheduled) {
    args.push("--once");
  }

  return {
    url: `https://run.googleapis.com/v2/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(region)}/jobs/${encodeURIComponent(jobName)}:run`,
    body: {
      overrides: {
        containerOverrides: [{ args, ...(dispatchId ? { env: [{ name: "AVAILABILITY_CRAWLER_DISPATCH_ID", value: dispatchId }] } : {}) }],
        taskCount: 1,
        timeout: "7200s",
      },
    },
  };
}
