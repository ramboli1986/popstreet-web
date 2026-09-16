// Offline browser QA: run with playwright-cli run-code and the dummy Supabase dev server on 3015.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  await page.unrouteAll();
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const runId = "69f39d1d-93c6-45da-bd35-5436c693afa8";
  let workerState = "failed", active = true, checks = 0, writes = 0;
  const sources = Array.from({ length: 162 }, (_, i) => ({
    source_id: `source-${i}`, building_id: `building-${i}`, building_name: `Building ${i + 1}`,
    state: "NJ", city: "Jersey City", area: "Downtown", provider_key: "official", provider_label: "Official",
    parser_strategy: "official_units_api", provider_status: "validated_units_found", crawl_enabled: true,
    availability_url: "https://example.invalid/availability", requires_browser: false,
    latest_status: "succeeded", latest_units_found: 0, change_count_7d: 0, consecutive_failures: 0,
  }));
  const items = sources.map((source, i) => ({
    id: `item-${i}`, run_id: runId, source_id: source.source_id, building_id: source.building_id,
    status: i < 146 ? "queued" : i < 148 ? "running" : i < 156 ? "succeeded" : i < 158 ? "no_units_found" : i < 160 ? "unsupported" : "failed",
    snapshot_status: i >= 148 && i < 152 ? "complete" : i >= 152 && i < 156 ? "partial" : "unknown",
    committed_at: i >= 148 ? "2026-09-15T17:00:00Z" : null,
    lease_expires_at: "2026-09-15T17:10:00Z", observations_created: i === 148 ? 23 : i > 148 && i < 156 ? 10 : 0,
    buildings: { name: source.building_name },
  }));
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const path = url.split("?")[0];
    if (!url.startsWith("http://127.0.0.1:3015/") && !url.startsWith("http://127.0.0.1:59999/")) return route.abort();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.endsWith("/worker-status")) {
      checks++;
      return json({ runId, workerState, resumable: workerState === "failed" || workerState === "succeeded_unfinished", checkedAt: new Date().toISOString() });
    }
    if (path.endsWith("/start-worker") || path.includes("/rest/v1/rpc/")) { writes++; return json({ error: "No mutations in QA" }, 403); }
    if (!url.startsWith("http://127.0.0.1:59999/")) return route.continue();
    if (path.includes("account_profiles")) return json({ id: "offline-admin", full_name: "Offline QA", role: "admin", account_kind: "admin", status: "active" });
    if (path.endsWith("availability_crawler_dashboard")) return json(sources);
    if (path.endsWith("availability_crawl_runs")) return json([{ id: runId, status: active ? "running" : "partial", source_count: 162, observation_count: 67, started_at: "2026-09-15T17:00:00Z" }]);
    if (path.endsWith("availability_crawl_run_items")) return json(items);
    return json([]);
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem("popstreet.admin.language")) localStorage.setItem("popstreet.admin.language", "en");
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "offline.token.only", refresh_token: "offline-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user: { id: "offline-admin", email: "qa@example.invalid", user_metadata: {} } }));
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto("http://127.0.0.1:3015/availability-crawler");
  await page.locator(".crawler-progress-message-row").getByText(/Crawl interrupted/).waitFor();
  check(await page.getByRole("button", { name: "Resume run", exact: true }).isEnabled(), "Existing run must be resumable");
  check(await page.getByText("93 observations recorded in this run's tasks", { exact: true }).isVisible(), "Stale run observation count leaked into UI");
  check((await page.locator(".crawler-progress-main-stat").innerText()).includes("14/162"), "Wrong effective progress");
  check(await page.getByText("Crawler is processing this source.", { exact: true }).count() === 0, "Interrupted worker still has processing row notes");
  await page.screenshot({ path: "/tmp/crawler-worker-status-en.png", animations: "disabled" });
  await page.getByRole("button", { name: "中文", exact: true }).click();
  await page.locator(".crawler-progress-message-row").getByText(/抓取已中断/).waitFor();
  check(await page.getByRole("button", { name: "恢复本轮", exact: true }).isEnabled(), "Chinese resume missing");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/crawler-worker-status-zh-mobile.png", animations: "disabled" });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile overflow");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  for (const [state, text] of [["succeeded_unfinished", /still has unfinished tasks/], ["unknown", /Cannot confirm the worker status/], ["running", /Background worker is processing sources/]]) {
    workerState = state;
    await page.reload();
    await page.locator(".crawler-progress-message-row").getByText(text).waitFor();
    if (state === "running") check(await page.getByRole("button", { name: "Resume run", exact: true }).isDisabled(), "Verified live worker must not offer another launch");
  }
  active = false;
  await page.reload();
  await page.getByText("93 observations recorded in this run's tasks", { exact: true }).waitFor();
  const endedChecks = checks;
  await page.waitForTimeout(1000);
  check(checks === endedChecks, "Inactive run polled Cloud");
  check(writes === 0, "Status checks caused writes");
  console.log(JSON.stringify({ checks, writes, passed: true }));
};
