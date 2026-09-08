# Availability Crawler Dispatch Reliability

This change is not deployed. Apply the parent queue/snapshot migration 002,
review/publish migration 003 and dispatch migration 004 together with the worker
and dashboard during the separately approved rollout. No automation is enabled.

## Server Configuration And IAM

Set `SUPABASE_SERVICE_ROLE_KEY` in the web server's secret environment (never
`NEXT_PUBLIC_*`). The user's bearer session is checked with
`can_manage_inventory` before server-only reservation RPCs are used. Browser
roles cannot reserve, release, or forge Cloud execution state.

The dispatcher service account needs more than `roles/run.invoker`: this route
uses per-execution overrides and reads executions for recovery. Prefer a custom
role containing only the following permissions, bound to the single crawler
Cloud Run job, not a project-wide Cloud Run admin/developer role:

```text
run.jobs.run
run.jobs.runWithOverrides
run.executions.get
run.executions.list
```

An alternative is job-scoped `roles/run.jobsExecutorWithOverrides` plus
job-scoped `roles/run.viewer`. This is broader than the custom role (including
cancel and other read permissions). The old invoker-only binding is insufficient.
Keep WIF impersonation on the dispatcher account restricted to the existing
Vercel identity; do not grant these roles to browser users or the worker account
just to enable the dashboard. IAM changes require separate operator approval;
no live IAM changes are performed by the test scripts.

Regional operations are never queried: `run.operations.get` is not required.
Operation names are saved only for audit. Even operation-only acknowledgments
reconcile through the job's execution list, matching both dispatch ID and run.
The official API documents list authorization on the parent job and get on its
child execution; Cloud Run's IAM reference allows execution-reader roles at job
scope. This avoids relying on unverified regional-operation IAM inheritance.

References: [execution get](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs.executions/get),
[execution list](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs.executions/list),
[job run overrides](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.jobs/run),
[Cloud Run IAM roles](https://docs.cloud.google.com/run/docs/reference/iam/roles).

## Reservation And Recovery

- `reserved`: no external request has begun. After five minutes a new request
  may atomically replace the reservation. The old owner then fails its required
  `record_dispatch(..., 'launching')` check and cannot launch.
- `launching` / `uncertain`: never expire automatically. Network timeouts,
  HTTP 408/429/5xx, missing responses, or failed DB acknowledgments do not prove
  that Cloud rejected a launch. Duplicate requests return HTTP 202 and retain
  the dispatch identity. They search the configured job's executions for the
  exact `AVAILABILITY_CRAWLER_DISPATCH_ID` and run argument.
- `launched`: duplicates return the saved operation and execution identities.
  A new worker requires a confirmed execution `completionTime`, then an atomic
  fresh reservation. A queued item or expired running lease must remain, and
  no running item may have a live lease. Unknown/missing execution state never
  authorizes replacement. Execution listing scans at most 300 recent entries;
  an unresolved older launch needs operator investigation, not automatic retry.
- A direct HTTP 400/401/403/404/422 rejection before any accepted identity can
  be attested by the trusted server. Its reservation becomes `rejected`, and the
  user sees the error instead of an endless pending state. The next request can
  retry after correcting configuration or permissions. Ambiguous errors never
  use this path.
- Completed/cancelled/reset runs reject new launches. Local-development PIDs
  are not sufficient proof of terminal execution (PID reuse), so local workers
  retain their reservation until the run is reset after operator inspection.

If execution reads fail, the route returns an actionable error, not launch
success or an endless pending response. The reservation is retained unchanged.
Fix dispatcher read permissions or connectivity and retry the same run.
Do not delete reservations or fabricate completion to unstick
launching/uncertain work. Inspect Cloud operations/executions and confirm the old
worker has stopped before resetting. Item attempts remain fenced by migration
002 even after reset; this dashboard does not cancel Cloud processes itself.

## Review And Snapshot Quality

Task progress is separate from snapshot quality. Legacy succeeded/empty statuses
without committed quality evidence display as unverified. Complete/confirmed-empty
snapshots still require the backend publish gate. Partial/unknown snapshots preserve
existing inventory. Review returns `preview_fingerprint`; publish must submit it
as `p_preview_fingerprint`. Changed previews fail closed and are cleared locally.
Whole-inventory reset is not offered. Publish retries with the same fingerprint
are handled by migration 003's `already_published` contract.
Needs review counts and filters include terminal partial/unverified snapshots,
deduplicated by building even when multiple sources need attention. Queued or
running items are not classified as incomplete merely because they lack a result.

## Local Verification

```sh
node --experimental-strip-types --test scripts/test-availability-crawler-*.mjs scripts/test-admin-session.mjs
npm run lint
npm run build
```

The SQL suite starts its own temporary PostgreSQL cluster using `initdb`,
`pg_ctl` and `psql`, then removes it. It never reads production credentials.
The route suite executes the real handler with Cloud and Supabase replaced.

For browser verification start an offline dev server:

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:59999 NEXT_PUBLIC_SUPABASE_ANON_KEY=offline-fixture npm run dev -- --port 3014
```

Then open an isolated Playwright CLI session and pass the contents of
`scripts/verify-availability-crawler-browser.js` to `run-code`. The fixture
intercepts all backend/start-worker traffic, rejects remote traffic, checks
double-click/pending and preview-fingerprint behavior, and writes desktop/mobile
screenshots to `/tmp/crawler-reliability-*.png`. No live crawler, publish, or IAM
request is sent.
