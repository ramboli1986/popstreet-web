// Run with playwright-cli run-code using the offline dev server on port 3014.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const runId = "11111111-1111-4111-8111-111111111111";
  const now = new Date().toISOString();
  let active = false, launchConfirmed = false, launchRejected = false, enqueueCalls = 0, launchCalls = 0, published = null;
  const sources = ["Complete Example", "Partial Example", "Unverified Example", "Empty Example"].map((name, index) => ({
    source_id: `source-${index}`, building_id: `building-${index}`, building_name: name,
    state: "NJ", city: "Jersey City", area: "Downtown", provider_key: "official", provider_label: "Official",
    parser_strategy: "official_units_api", provider_status: "validated_units_found", crawl_enabled: true,
    availability_url: "https://example.invalid/availability", requires_browser: false,
    latest_units_found: index === 3 ? 0 : 10, latest_status: "succeeded", last_crawled_at: now,
    change_count_7d: 0, price_change_count_7d: 0, went_unavailable_count_7d: 0, consecutive_failures: 0,
  }));
  const preview = {
    dry_run: true, eligible: true, gate_failures: [], failed_count: 0, market: "NJ", run_id: runId,
    source_count: 4, checked_source_count: 4, success_ratio: 0.5, complete_source_count: 1,
    confirmed_empty_source_count: 1, partial_source_count: 1, unknown_source_count: 1, unverified_source_count: 2,
    preview_fingerprint: "offline-reviewed-version", candidate_observation_count: 10, skipped_observation_count: 5,
    created_listing_count: 2, updated_listing_count: 3, marked_unavailable_count: 2,
  };
  await page.unrouteAll();
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const path = url.split("?")[0];
    if (!url.startsWith("http://localhost:3014/") && !url.startsWith("http://127.0.0.1:59999/")) return route.abort();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.endsWith("/start-worker")) {
      launchCalls++;
      if (launchRejected) return json({ error: "Cloud Run rejected launch (HTTP 403): offline permission denied" }, 502);
      return json({ started: launchConfirmed, pending: !launchConfirmed }, launchConfirmed ? 200 : 202);
    }
    if (!url.startsWith("http://127.0.0.1:59999/")) return route.continue();
    if (path.includes("account_profiles")) return json({ id: "offline-admin", full_name: "Offline QA", role: "admin", account_kind: "admin", status: "active" });
    if (path.endsWith("availability_crawler_dashboard")) return json(sources);
    if (path.endsWith("availability_crawl_runs")) return json([{
      id: runId, status: active ? "queued" : "succeeded", started_at: now, finished_at: active ? null : now,
      observation_count: 30, source_count: 4,
    }]);
    if (path.endsWith("availability_crawl_run_items")) return json(sources.map((source, index) => ({
      id: `item-${index}`, run_id: runId, source_id: source.source_id, building_id: source.building_id,
      status: active ? "queued" : index === 3 ? "unavailable" : "succeeded",
      snapshot_status: ["complete", "partial", "unknown", "confirmed_empty"][index],
      committed_at: index === 2 ? null : now, started_at: now, finished_at: now, units_found: index === 3 ? 0 : 10,
      changes_detected: 0, observations_created: 10, validation: {}, buildings: { name: source.building_name },
    })));
    if (path.endsWith("availability_crawler_review_run")) return json(preview);
    if (path.endsWith("availability_crawler_publish_reviewed_run")) {
      published = route.request().postDataJSON();
      return json({ message: "preview_fingerprint_changed", code: "P0001" }, 409);
    }
    if (path.endsWith("availability_crawler_enqueue_run")) {
      enqueueCalls++;
      active = true;
      return json({ run_id: runId, source_count: 4, status: "queued" });
    }
    return json([]);
  });
  await page.addInitScript(() => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: "offline.token.only", refresh_token: "offline-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600, token_type: "bearer", user: { id: "offline-admin", email: "qa@example.invalid", user_metadata: {} },
    }));
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto("http://localhost:3014/availability-crawler");
  await page.getByText("Complete snapshot", { exact: true }).waitFor();
  for (const label of ["Partial snapshot", "Unverified", "Confirmed empty"]) {
    check(await page.getByText(label, { exact: true }).isVisible(), `${label} missing`);
  }
  const reviewCount = page.locator(".crawler-metric").filter({ hasText: "Needs review" }).locator(".metric-value");
  check((await reviewCount.innerText()).trim() === "2", "Needs review must include partial and unverified buildings");
  await page.getByRole("combobox").nth(1).selectOption("attention");
  const reviewBuildings = await page.locator(".crawler-source-table .crawler-building-link").allTextContents();
  check(reviewBuildings.length === 2 && reviewBuildings.some((name) => name.includes("Partial Example")) && reviewBuildings.some((name) => name.includes("Unverified Example")), "Needs review filter omitted incomplete nonfailed snapshots");
  await page.getByRole("combobox").nth(1).selectOption("all");
  check(await page.getByText("Finished as succeeded.", { exact: true }).count() === 0, "Legacy run success implies verified quality");
  check(await page.getByText("Replace current app inventory before publishing").count() === 0, "Unsafe reset still offered");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const publishButton = page.getByRole("button", { name: "Publish New Jersey", exact: true });
  await page.getByText("Ready to publish", { exact: true }).waitFor();
  check(await publishButton.isEnabled(), "Versioned preview should enable publish");
  await page.evaluate(() => { window.confirm = () => true; });
  await publishButton.click();
  await page.getByText("preview_fingerprint_changed", { exact: true }).waitFor();
  check(published?.p_preview_fingerprint === preview.preview_fingerprint, "Publish omitted reviewed fingerprint");
  check(published?.p_reset_existing_inventory === false, "Publish requested inventory reset");
  check(await publishButton.isDisabled(), "Changed preview was not invalidated");
  const runButton = page.locator(".crawler-actions .crawler-primary-action");
  await runButton.evaluate((button) => { button.click(); button.click(); });
  await page.getByText("Confirming worker launch. An existing execution will be reused.").waitFor();
  await page.waitForTimeout(3500);
  check(enqueueCalls === 1, `Double click enqueued ${enqueueCalls} runs`);
  check(launchCalls >= 2, "Pending launch was not reconciled");
  check(await runButton.isDisabled(), "Button released before launch confirmation");
  check(await runButton.getAttribute("aria-busy") === "true", "Pending launch has no visible busy state");
  launchConfirmed = true;
  await page.getByText(/Worker launch confirmed\./).first().waitFor();
  active = false;
  await page.reload();
  await page.getByText("Complete snapshot", { exact: true }).waitFor();
  launchRejected = true;
  await runButton.click();
  const rejection = page.getByText("Cloud Run rejected launch (HTTP 403): offline permission denied", { exact: true });
  await rejection.waitFor();
  await page.waitForTimeout(3500);
  check(await rejection.isVisible(), "Polling erased the actionable Cloud rejection");
  check(await runButton.getAttribute("aria-busy") === "false", "Definitive rejection left the button pending");
  active = false;
  await page.reload();
  await page.getByText("Complete snapshot", { exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/crawler-reliability-desktop.png", fullPage: true });
  await page.locator(".crawler-source-table").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/crawler-reliability-desktop-table.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".console-content").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: "/tmp/crawler-reliability-mobile.png", fullPage: true });
  const panel = await page.locator(".crawler-progress-card").boundingBox();
  check(panel.x >= 0 && panel.x + panel.width <= 390, "Quality panel is clipped on mobile");
  await page.locator("[aria-label='Snapshot quality']").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/crawler-reliability-mobile-quality.png" });
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  check(width.scroll <= width.viewport, `Page overflows mobile viewport: ${JSON.stringify(width)}`);
  console.log(JSON.stringify({ enqueueCalls, launchCalls, fingerprint: published.p_preview_fingerprint, desktop: "/tmp/crawler-reliability-desktop.png", mobile: "/tmp/crawler-reliability-mobile.png" }));
}
