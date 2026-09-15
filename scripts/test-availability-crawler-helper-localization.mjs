import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import * as progress from "../src/lib/availability-crawler-progress.ts";
import * as workflow from "../src/lib/availability-crawler-manual-workflow.ts";

const messagesURL = new URL("../src/lib/availability-crawler-helper-messages.ts", import.meta.url);
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

async function loadMessages() {
  assert.ok(existsSync(messagesURL), "shared crawler helper dictionary must exist");
  return import(messagesURL.href);
}

async function translatorFor(locale) {
  const { crawlerHelperMessages } = await loadMessages();
  return (key, params = {}) => {
    assert.ok(key.startsWith("crawlerHelpers."), `unexpected namespace: ${key}`);
    const template = crawlerHelperMessages[locale][key.slice("crawlerHelpers.".length)];
    assert.equal(typeof template, "string", `missing ${locale} translation: ${key}`);
    assert.deepEqual(Object.keys(params).sort(), [...new Set(placeholders(template))], `parameter mismatch: ${key}`);
    return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
  };
}

const review = {
  dry_run: true, eligible: true, failed_count: 0, gate_failures: [], market: "NJ",
  run_id: "run-1", source_count: 20, success_ratio: 0.7, preview_fingerprint: "version-1",
  complete_source_count: 11, confirmed_empty_source_count: 3, partial_source_count: 4, unknown_source_count: 2,
};

const overview = {
  attentionCount: 12, buildingCount: 1234, missingURLCount: 1, readyBuildingCount: 1160,
  regionLabel: "新泽西州", sourceCount: 2327,
  runSummary: { active: 134, failed: 6, processed: 27, progressPercentage: 17, queued: 128, running: 6, total: 161 },
};

test("snapshot presentation uses the supplied translator without changing its tone", () => {
  const quality = progress.describeCrawlerSnapshotQuality(null, () => "已翻译");
  assert.equal(quality.label, "已翻译");
  assert.equal(quality.note, "已翻译");
  assert.equal(quality.tone, "pending");
});

test("manual workflow uses the supplied translator without changing step order or state", () => {
  const steps = workflow.availabilityCrawlerManualSteps(
    { activeRun: null, preview: null, published: false },
    () => "已翻译",
  );
  assert.deepEqual(steps.map(({ title, body }) => [title, body]), Array(3).fill(["已翻译", "已翻译"]));
  assert.deepEqual(steps.map(({ number, state }) => [number, state]), [
    ["1", "active"], ["2", "waiting"], ["3", "waiting"],
  ]);
});

test("both flat dictionaries have identical keys and interpolation parameters", async () => {
  const { crawlerHelperMessages, defaultCrawlerTranslator } = await loadMessages();
  const { en, zh } = crawlerHelperMessages;
  assert.ok(Object.keys(en).length > 0);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const key of Object.keys(en)) {
    assert.ok(!key.includes("."), `keys must be flat: ${key}`);
    assert.equal(typeof en[key], "string");
    assert.equal(typeof zh[key], "string");
    assert.match(zh[key], /\p{Script=Han}/u, `${key} needs Chinese copy`);
    assert.doesNotMatch(zh[key], /快照|验证/, `${key} should use plain-language data and verification copy`);
    assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), key);
    const params = Object.fromEntries(placeholders(en[key]).map((name) => [name, name === "region" ? "Jersey City $&" : 1234]));
    const expected = en[key].replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
    assert.equal(defaultCrawlerTranslator(`crawlerHelpers.${key}`, params), expected);
    assert.equal(defaultCrawlerTranslator(`crawlerHelpers.${key}`), en[key]);
  }
  assert.equal(defaultCrawlerTranslator("crawlerHelpers.notARealKey"), "crawlerHelpers.notARealKey");
  assert.equal(defaultCrawlerTranslator("unrelated.key"), "unrelated.key");
});

for (const [item, label, tone] of [
  [null, "未核验", "pending"],
  [{ status: "succeeded" }, "未核验", "pending"],
  [{ status: "succeeded", snapshot_status: "complete" }, "未核验", "pending"],
  [{ status: "failed", snapshot_status: "complete", committed_at: "today" }, "未核验", "pending"],
  [{ status: "running", snapshot_status: "confirmed_empty", committed_at: "today" }, "未核验", "pending"],
  [{ status: "succeeded", snapshot_status: "partial", committed_at: "today" }, "数据不完整", "pending"],
  [{ status: "failed", snapshot_status: "partial" }, "数据不完整", "pending"],
  ...["succeeded", "unavailable", "no_units_found"].flatMap((status) => [
    [{ status, snapshot_status: "complete", committed_at: "today" }, "完整数据", "active"],
    [{ status, snapshot_status: "confirmed_empty", committed_at: "today" }, "已确认无房源", "active"],
  ]),
]) {
  test(`snapshot localizes ${JSON.stringify(item)} without granting additional trust`, async () => {
    const zh = progress.describeCrawlerSnapshotQuality(item, await translatorFor("zh"));
    assert.equal(zh.label, label);
    assert.equal(zh.tone, tone);
    assert.equal(progress.describeCrawlerSnapshotQuality(item).tone, tone);
    assert.match(zh.note, tone === "active" ? /发布安全检查/ : /保留现有房源/);
    assert.deepEqual(progress.describeCrawlerSnapshotQuality(item), progress.describeCrawlerSnapshotQuality(item, await translatorFor("en")));
  });
}

test("localized options preserve exported English constants and semantic filter ordering", async () => {
  const zh = await translatorFor("zh");
  for (const [getter, original, expected] of [
    [progress.getAvailabilityCrawlerRegionOptions, progress.availabilityCrawlerRegionOptions, [["NJ", "新泽西州"], ["NY", "纽约州"], ["all", "所有市场"]]],
    [progress.getCrawlerRunListFilterOptions, progress.crawlerRunListFilterOptions, [["all", "全部任务"], ["active", "抓取中"], ["done", "已完成"], ["failed", "失败"], ["not_started", "未开始"]]],
    [progress.getCrawlerSourceFilterOptions, progress.crawlerSourceFilterOptions, [["all", "所有来源类型"], ["ready", "可抓取"], ["browser", "需要浏览器"], ["attention", "待审核"], ["missing_url", "缺少链接"], ["disabled", "已禁用"]]],
  ]) {
    assert.equal(typeof getter, "function");
    const before = structuredClone(original);
    assert.deepEqual(getter(zh).map(({ filter, label }) => [filter, label]), expected);
    assert.deepEqual(getter(), original);
    assert.deepEqual(original, before);
  }
});

for (const count of [0, 1, 2, 1234]) {
  test(`region and task counts localize count ${count} and preserve English plurals`, async () => {
    const zh = await translatorFor("zh");
    const formatted = count.toLocaleString("en-US");
    const summary = { buildingCount: count, runnableBuildingCount: count, runnableSourceCount: count, sourceCount: count };
    for (const [region, label] of [["NJ", "新泽西州"], ["NY", "纽约州"], ["all", "所有市场"], ["unknown", "所选市场"]]) {
      assert.deepEqual(progress.describeAvailabilityCrawlerRegionFilter(region, summary, zh), {
        label, buildingLabel: `${formatted} 栋大楼`, runnableLabel: `${formatted} 栋可抓取大楼`, sourceLabel: `${formatted} 条来源记录`,
      });
    }
    const en = progress.describeAvailabilityCrawlerRegionFilter("NJ", summary);
    assert.equal(en.buildingLabel, `${formatted} ${count === 1 ? "building" : "buildings"}`);
    assert.equal(en.runnableLabel, `${formatted} crawl-ready ${count === 1 ? "building" : "buildings"}`);
    assert.equal(en.sourceLabel, `${formatted} source ${count === 1 ? "row" : "rows"}`);
    for (const filter of ["all", "active", "done", "failed", "not_started", "unknown"]) {
      assert.equal(progress.describeCrawlerRunListFilter(filter, count, zh).countLabel, `${formatted} 栋大楼`);
      assert.equal(progress.describeCrawlerRunListFilter(filter, count).countLabel, en.buildingLabel);
    }
  });
}

test("overview localizes the region and every helper count while keeping stable IDs tones and values", async () => {
  const cards = progress.buildAvailabilityCrawlerOverviewCards(overview, await translatorFor("zh"));
  assert.deepEqual(cards.map(({ id }) => id), ["buildings", "queue", "running", "review"]);
  assert.deepEqual(cards.map(({ label, helper }) => [label, helper]), [
    ["新泽西州大楼", "1,160 栋可抓取 · 2,327 条来源记录"],
    ["当前队列", "已处理 27/161"],
    ["抓取中", "6 个运行中 · 128 个排队中"],
    ["待审核", "1 栋缺少链接 · 本次运行失败 6 个"],
  ]);
  const semantic = (values) => values.map(({ id, tone, value }) => ({ id, tone, value }));
  assert.deepEqual(semantic(cards), semantic(progress.buildAvailabilityCrawlerOverviewCards(overview)));
  assert.deepEqual(cards.map(({ value }) => value), ["1,234", "17%", "134", "12"]);
  assert.deepEqual(progress.buildAvailabilityCrawlerOverviewCards(overview), progress.buildAvailabilityCrawlerOverviewCards(overview, await translatorFor("en")));
});

test("inventory copy localizes with and without catalog coverage", async () => {
  for (const catalogBuildingCount of [undefined, null, 0, 741]) {
    const input = { catalogBuildingCount, inventoryBuildingCount: 505, sourceRecordCount: 1000 };
    const zh = progress.summarizeCrawlerInventory(input, await translatorFor("zh"));
    const en = progress.summarizeCrawlerInventory(input);
    assert.equal(zh.coverageValue, en.coverageValue);
    assert.equal(zh.sourceRecordValue, "1,000");
    assert.equal(zh.coverageHelper, catalogBuildingCount ? "抓取清单中的活跃大楼" : "抓取清单中的大楼");
    assert.equal(zh.sourceRecordHelper, "这些大楼下保存的房源链接");
  }
});

test("all task and source filter descriptions localize including fallback branches", async () => {
  const zh = await translatorFor("zh");
  for (const [filter, title] of [["all", "全部抓取任务"], ["active", "抓取中"], ["done", "已完成"], ["failed", "失败列表"], ["not_started", "未开始"], ["unknown", "全部抓取任务"]]) {
    const result = progress.describeCrawlerRunListFilter(filter, 5, zh);
    assert.equal(result.title, title);
    assert.match(result.helper, /\p{Script=Han}/u);
    assert.notEqual(result.helper, progress.describeCrawlerRunListFilter(filter, 5).helper);
  }
  for (const option of progress.getCrawlerSourceFilterOptions(zh)) {
    const result = progress.describeCrawlerSourceFilter(option.filter, zh);
    assert.equal(result.label, option.label);
    assert.match(result.helper, /\p{Script=Han}/u);
    assert.notEqual(result.helper, progress.describeCrawlerSourceFilter(option.filter).helper);
  }
  assert.deepEqual(progress.describeCrawlerSourceFilter("unknown", zh), progress.describeCrawlerSourceFilter("all", zh));
});

test("localized sections preserve grouping input identity state ordering and includeEmpty behavior", async () => {
  const zh = await translatorFor("zh");
  const rows = [
    { id: "waiting", state: "not_started" }, { id: "done", state: "done" },
    { id: "running", state: "active" }, { id: "failed", state: "failed" }, { id: "queued", state: "active" },
  ];
  const before = structuredClone(rows);
  for (const input of [rows, rows.slice(0, 2), []]) {
    for (const options of [undefined, {}, { includeEmpty: false }, { includeEmpty: true }]) {
      const sections = progress.groupCrawlerRunListSections(input, (row) => row.state, options, zh);
      const en = progress.groupCrawlerRunListSections(input, (row) => row.state, options);
      assert.deepEqual(sections.map(({ state, rows }) => ({ state, rows })), en.map(({ state, rows }) => ({ state, rows })));
      sections.forEach((section, index) => {
        assert.match(section.label, /\p{Script=Han}/u);
        assert.match(section.helper, /\p{Script=Han}/u);
        section.rows.forEach((row, rowIndex) => assert.equal(row, en[index].rows[rowIndex]));
      });
    }
  }
  assert.deepEqual(rows, before);
});

test("review quality localizes counts percentages and unknown-quality fallbacks without implying safety", async () => {
  const zh = await translatorFor("zh");
  assert.deepEqual(workflow.describeAvailabilityCrawlerReview(review, zh), {
    title: "可发布", body: "11 个来源数据完整，3 个已确认无房源，4 个数据不完整，2 个未知。70% 通过了数据安全检查。 已审核的变更可供批准。",
  });
  const zeroCounts = workflow.describeAvailabilityCrawlerReview({ ...review, partial_source_count: undefined, unknown_source_count: undefined }, zh);
  assert.match(zeroCounts.body, /0 个数据不完整，0 个未知/);
  assert.match(workflow.describeAvailabilityCrawlerReview({ ...review, success_ratio: 0.756 }, zh).body, /76%/);
  for (const patch of [{ complete_source_count: undefined }, { confirmed_empty_source_count: undefined }]) {
    assert.match(workflow.describeAvailabilityCrawlerReview({ ...review, ...patch }, zh).body, /数据质量尚未核验。发布前请刷新预览/);
  }
  for (const patch of [{ eligible: false }, { preview_fingerprint: "" }, { preview_fingerprint: undefined }, { reset_existing_inventory: true }]) {
    assert.equal(workflow.describeAvailabilityCrawlerReview({ ...review, ...patch }, zh).title, "发布前需要审核");
  }
});

const gateMessages = [
  ["no_verified_snapshots", "没有可发布的已核验数据。"],
  ["abnormal_inventory_drop", "房源数量下降需要操作人员单独审核。"],
  ["reset_inventory_not_supported", "不支持替换全部房源。"],
  ["run_still_active", "抓取仍在运行。"],
  ["run_status_not_publishable", "本次运行未以可发布状态结束。"],
  ["success_ratio_below_minimum", "通过数据安全检查的来源太少。"],
  ["failed_count_above_maximum", "失败来源数量超过安全上限。"],
  ["run_market_mismatch", "已审核的运行与所选市场不匹配。"],
  ["no_sources_in_market", "本次运行不包含该市场的来源。"],
  ["future_unknown_gate", "本次运行未通过所有发布安全检查。"],
];

for (const [reason, expected] of gateMessages) {
  test(`review localizes safety gate ${reason}`, async () => {
    const input = { ...review, eligible: false, gate_failures: [reason] };
    const result = workflow.describeAvailabilityCrawlerReview(input, await translatorFor("zh"));
    assert.equal(result.title, "发布前需要审核");
    assert.ok(result.body.endsWith(expected));
    assert.deepEqual(workflow.describeAvailabilityCrawlerReview(input), workflow.describeAvailabilityCrawlerReview(input, await translatorFor("en")));
  });
}

test("review keeps gate order and does not change the strict publish eligibility checks", async () => {
  const zh = await translatorFor("zh");
  const blocked = { ...review, eligible: false, gate_failures: gateMessages.map(([reason]) => reason) };
  assert.ok(workflow.describeAvailabilityCrawlerReview(blocked, zh).body.endsWith(gateMessages.map(([, message]) => message).join(" ")));
  assert.equal(workflow.canPublishAvailabilityCrawlerReview(review, "run-1", "nj"), true);
  for (const input of [null, ...[
    { dry_run: false }, { eligible: false }, { preview_fingerprint: undefined }, { preview_fingerprint: " " },
    { reset_existing_inventory: true }, { run_id: undefined }, { run_id: "other" }, { market: "NY" },
  ].map((patch) => ({ ...review, ...patch }))]) {
    if (input) workflow.describeAvailabilityCrawlerReview(input, zh);
    assert.equal(workflow.canPublishAvailabilityCrawlerReview(input, "run-1", "NJ"), false);
  }
});

for (const [input, states] of [
  [{ activeRun: null, preview: null, published: false }, ["active", "waiting", "waiting"]],
  [{ activeRun: { id: "run-1", status: "running" }, preview: null, published: false }, ["active", "waiting", "waiting"]],
  [{ activeRun: { id: "run-1", status: "queued" }, preview: review, published: true }, ["active", "waiting", "waiting"]],
  [{ activeRun: null, preview: review, published: true }, ["complete", "complete", "complete"]],
  [{ activeRun: null, preview: review, published: false }, ["complete", "complete", "active"]],
  [{ activeRun: null, preview: { ...review, eligible: false }, published: false }, ["complete", "complete", "waiting"]],
]) {
  test(`manual step branch localizes ${JSON.stringify(input)}`, async () => {
    const steps = workflow.availabilityCrawlerManualSteps(input, await translatorFor("zh"));
    assert.deepEqual(steps.map(({ state }) => state), states);
    assert.deepEqual(steps.map(({ number }) => number), ["1", "2", "3"]);
    assert.deepEqual(steps.map(({ title }) => title), ["抓取", "审核", "发布"]);
    steps.forEach(({ body }) => assert.match(body, /\p{Script=Han}/u));
    assert.deepEqual(workflow.availabilityCrawlerManualSteps(input), workflow.availabilityCrawlerManualSteps(input, await translatorFor("en")));
  });
}

test("launch confirmation localizes generated errors while preserving raw diagnostics and pending behavior", async () => {
  const t = await translatorFor("zh");
  for (const [response, expected] of [
    [() => Response.json({}, { status: 500 }), "无法确认抓取已启动。"],
    [() => new Response("not json", { status: 500 }), "无法确认抓取已启动。"],
    [() => Response.json({}), "缺少抓取启动确认。请刷新后重试。"],
    [() => new Response("not json"), "缺少抓取启动确认。请刷新后重试。"],
    [() => Response.json({ error: "raw provider diagnostic" }, { status: 500 }), "raw provider diagnostic"],
    [() => Response.json({ error: "" }, { status: 500 }), ""],
  ]) {
    await assert.rejects(workflow.confirmAvailabilityCrawlerLaunch(async () => response(), { t }), { message: expected });
  }
  await assert.rejects(workflow.confirmAvailabilityCrawlerLaunch(async () => Response.json({}, { status: 500 })), { message: "Could not confirm the crawler launch." });
  await assert.rejects(workflow.confirmAvailabilityCrawlerLaunch(async () => Response.json({})), { message: "Crawler launch confirmation is missing. Refresh before trying again." });
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(workflow.confirmAvailabilityCrawlerLaunch(async () => {
    calls++;
    return Response.json({ pending: true, started: true }, { status: 202 });
  }, { t, signal: controller.signal, pause: async () => controller.abort() }), { message: "抓取启动确认已取消。" });
  assert.equal(calls, 1);
  await assert.rejects(workflow.confirmAvailabilityCrawlerLaunch(async () => { throw new Error("must not request"); }, { signal: controller.signal }), { message: "Crawler launch confirmation was cancelled." });
  let requests = 0;
  let pauses = 0;
  await workflow.confirmAvailabilityCrawlerLaunch(async () => {
    requests++;
    return Response.json(requests < 3 ? { started: true, pending: true } : { started: true, pending: false });
  }, { t, pause: async () => { pauses++; } });
  assert.equal(requests, 3);
  assert.equal(pauses, 2);
});

test("launch errors can persist translation keys and translate again after a locale switch", async () => {
  const identity = (key) => key;
  const en = await translatorFor("en");
  const zh = await translatorFor("zh");
  for (const [response, key] of [
    [() => Response.json({}, { status: 503 }), "crawlerHelpers.launchFailed"],
    [() => Response.json({}), "crawlerHelpers.launchMissingConfirmation"],
  ]) {
    await assert.rejects(workflow.confirmAvailabilityCrawlerLaunch(async () => response(), { t: identity }), (error) => {
      assert.equal(error.message, key);
      assert.notEqual(en(error.message), zh(error.message));
      assert.match(zh(error.message), /\p{Script=Han}/u);
      return true;
    });
  }
  await assert.rejects(workflow.confirmAvailabilityCrawlerLaunch(async () => { throw new Error("must not request"); }, {
    signal: AbortSignal.abort(), t: identity,
  }), { message: "crawlerHelpers.launchCancelled" });
  await assert.rejects(workflow.confirmAvailabilityCrawlerLaunch(async () => Response.json({ error: "raw API diagnostic" }, { status: 503 }), {
    t: identity,
  }), { message: "raw API diagnostic" });
});
