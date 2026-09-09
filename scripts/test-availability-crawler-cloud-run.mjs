import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const moduleURL = pathToFileURL(resolve(process.cwd(), "src/lib/availability-crawler-cloud-run.ts")).href;
const {
  availabilityCrawlerVercelWifConfigFromEnv,
  buildAvailabilityCrawlerCloudRunRequest,
  buildAvailabilityCrawlerVercelExternalAccountOptions,
  cloudRunAvailabilityCrawlerIsConfigured,
  availabilityCrawlerVercelWifIsConfigured,
} = await import(moduleURL);

assert.equal(
  cloudRunAvailabilityCrawlerIsConfigured({
    projectId: "popstreet-prod",
    region: "us-east1",
    jobName: "availability-crawler",
  }),
  true,
);

assert.equal(
  cloudRunAvailabilityCrawlerIsConfigured({
    projectId: "",
    region: "us-east1",
    jobName: "availability-crawler",
  }),
  false,
);

const manualRequest = buildAvailabilityCrawlerCloudRunRequest({
  projectId: "popstreet-prod",
  region: "us-east1",
  jobName: "availability-crawler",
  runId: "3b5cf70f-57f7-4c0d-b81e-699de836f51b",
  maxItems: 42,
});

assert.equal(
  manualRequest.url,
  "https://run.googleapis.com/v2/projects/popstreet-prod/locations/us-east1/jobs/availability-crawler:run",
);
assert.deepEqual(manualRequest.body, {
  overrides: {
    containerOverrides: [
      {
        args: [
          "worker-loop",
          "--run-id",
          "3b5cf70f-57f7-4c0d-b81e-699de836f51b",
          "--batch-size",
          "25",
          "--concurrency",
          "6",
          "--browser-concurrency",
          "2",
          "--timeout",
          "20",
          "--max-items",
          "42",
          "--once",
        ],
      },
    ],
    taskCount: 1,
    timeout: "7200s",
  },
});

const scheduledRequest = buildAvailabilityCrawlerCloudRunRequest({
  projectId: "popstreet-prod",
  region: "us-east1",
  jobName: "availability-crawler",
  scheduled: true,
});

assert.deepEqual(scheduledRequest.body.overrides.containerOverrides[0].args, [
  "scheduled-run",
  "--batch-size",
  "25",
  "--concurrency",
  "6",
  "--browser-concurrency",
  "2",
  "--timeout",
  "20",
]);

const wifConfig = availabilityCrawlerVercelWifConfigFromEnv({
  AVAILABILITY_CRAWLER_GCP_PROJECT_NUMBER: "1234567890",
  AVAILABILITY_CRAWLER_GCP_SERVICE_ACCOUNT_EMAIL: "availability-crawler-dispatcher@popstreet-prod.iam.gserviceaccount.com",
  AVAILABILITY_CRAWLER_GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
  AVAILABILITY_CRAWLER_GCP_WORKLOAD_IDENTITY_PROVIDER_ID: "vercel",
});
assert.equal(availabilityCrawlerVercelWifIsConfigured(wifConfig), true);
const tokenSupplier = async () => "vercel-oidc-token";
const externalAccount = buildAvailabilityCrawlerVercelExternalAccountOptions(wifConfig, tokenSupplier);
assert.equal(
  externalAccount.audience,
  "//iam.googleapis.com/projects/1234567890/locations/global/workloadIdentityPools/vercel/providers/vercel",
);
assert.equal(
  externalAccount.service_account_impersonation_url,
  "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/availability-crawler-dispatcher%40popstreet-prod.iam.gserviceaccount.com:generateAccessToken",
);
assert.equal(await externalAccount.subject_token_supplier.getSubjectToken({}), "vercel-oidc-token");

assert.equal(
  availabilityCrawlerVercelWifIsConfigured(
    availabilityCrawlerVercelWifConfigFromEnv({
      AVAILABILITY_CRAWLER_GCP_PROJECT_NUMBER: "",
    }),
  ),
  false,
);

console.log("availability crawler cloud run helper tests passed");
