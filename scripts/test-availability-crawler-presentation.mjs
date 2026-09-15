import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { crawlerMessages } from "../src/lib/availability-crawler-messages.ts";
import { crawlerHelperMessages } from "../src/lib/availability-crawler-helper-messages.ts";
import * as helper from "../src/lib/availability-crawler-presentation.ts";

const dashboardPath = new URL("../src/components/availability-crawler-dashboard.tsx", import.meta.url);
const dashboardSource = readFileSync(dashboardPath, "utf8");
const ast = ts.createSourceFile("dashboard.tsx", dashboardSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const errorComponent = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "CrawlerError");
const errorComponentCode = ts.transpileModule(errorComponent.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;

function translator(locale) {
  return (key, params = {}) => {
    const [namespace, name] = key.split(".");
    const dictionaries = namespace === "crawler" ? crawlerMessages : crawlerHelperMessages;
    const template = dictionaries[locale][name] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
  };
}

function presentation(locale) {
  const CrawlerError = new Function("useI18n", "describeCrawlerError", "React", `${errorComponentCode}; return CrawlerError;`)(
    () => ({ t: translator(locale) }), helper.describeCrawlerError, React,
  );
  return { ...helper, CrawlerError };
}

const source = {
  building_name: "70 Greene", area: "Downtown", city: "Jersey City", state: "NJ",
  provider_key: "official_site", provider_label: "Equity Apartments",
  parser_strategy: "official_inline", provider_status: "validated_units_found",
  availability_url: "https://example.invalid/availability", website: "https://example.invalid",
};

test("generic provider keys preserve real brand names in both languages", () => {
  for (const locale of ["en", "zh"]) {
    assert.equal(presentation(locale).providerLabel(source.provider_label, source.provider_key, translator(locale)), "Equity Apartments");
  }
});

test("search matches bilingual display aliases without depending on the selected language", () => {
  const genericSource = { ...source, provider_label: "Official site" };
  for (const locale of ["en", "zh"]) {
    for (const query of ["官方网站", "官网页内房源", "official website", "official page inventory"]) {
      assert.equal(presentation(locale).sourceMatchesSearchQuery(genericSource, query), true, `${locale}: ${query}`);
    }
  }
});

test("source HTTP 403 shows source-access advice instead of backend permissions", () => {
  const { CrawlerError } = presentation("zh");
  const error = "HTTP 403: provider adapter required for yardi_rentcafe";
  const html = renderToStaticMarkup(React.createElement(CrawlerError, { error, origin: "source", compact: true }));
  assert.match(html, /来源网站拒绝了抓取请求/);
  assert.doesNotMatch(html, /后台任务的访问权限/);
  assert.ok(html.includes(error), "raw diagnostic remains available");
});

test("only generic labels are translated and supplied brands retain their spelling", () => {
  const { providerLabel } = helper;
  for (const key of ["official", "official_site", "official_next_data", "third_party_ils", "unknown", "yardi_rentcafe"]) {
    for (const label of ["Equity Apartments", "StreetEasy", "Heatherwood", "Leasing & Co."]) {
      for (const locale of ["en", "zh"]) assert.equal(providerLabel(label, key, translator(locale)), label);
    }
  }
  for (const [key, label, expected] of [
    ["official", "Official", "providerOfficial"],
    ["official_site", "Official site", "providerOfficial"],
    ["official_site", " OFFICIAL SITE ", "providerOfficial"],
    ["official_site", "official_site", "providerOfficial"],
    ["official_site", "官方网站", "providerOfficial"],
    ["official_next_data", "Official structured data", "providerStructured"],
    ["official_next_data", "Official Next.js data", "providerStructured"],
    ["third_party_ils", "Third-party ILS", "providerThirdParty"],
    ["third_party_ils", "Third-party listing platform", "providerThirdParty"],
    ["unknown", "unknown", "providerUnknown"],
    ["unknown", "未识别平台", "providerUnknown"],
  ]) {
    for (const locale of ["en", "zh"]) {
      assert.equal(providerLabel(label, key, translator(locale)), crawlerMessages[locale][expected]);
      assert.equal(providerLabel(null, key, translator(locale)), crawlerMessages[locale][expected]);
      assert.equal(providerLabel("", key, translator(locale)), crawlerMessages[locale][expected]);
    }
  }
  assert.equal(providerLabel(null, "new_vendor", translator("zh")), "new vendor");
  assert.equal(providerLabel("Yardi/RentCafe", "yardi_rentcafe", translator("zh")), "Yardi/RentCafe");
});

test("every supported strategy has identical display and bilingual search aliases", () => {
  const { providerLabel, strategyLabel, sourceMatchesSearchQuery } = helper;
  const strategies = [
    "official_anchor", "official_inline", "official_json_map", "official_units_api", "official_floorplan",
    "official_floorplan_click", "generic_official", "next_data_floorplan_summary", "realpage_unit_api",
    "veris_properties_query", "unavailable", "unsupported", "yardi_rentcafe", "entrata", "realpage",
    "realtydatatrust", "appfolio", "blt_liveworkplay", "greystar", "bozzuto", "tfc", "related_rentals",
    "rockrose", "urbanapt_nestio", "stellar_management", "mriprospectconnect", "elise_ai", "modernspaces", "future_strategy",
  ];
  for (const parser_strategy of strategies) {
    const row = { ...source, parser_strategy };
    for (const locale of ["en", "zh"]) {
      const t = translator(locale);
      const label = strategyLabel(parser_strategy, t);
      assert.ok(!label.startsWith("crawler."), `missing ${locale} strategy: ${parser_strategy}`);
      assert.equal(sourceMatchesSearchQuery(row, label.toLowerCase()), true, `${parser_strategy}: ${label}`);
      assert.equal(sourceMatchesSearchQuery(row, providerLabel(row.provider_label, row.provider_key, t).toLowerCase()), true);
    }
    assert.equal(sourceMatchesSearchQuery(row, parser_strategy), true);
  }
  assert.equal(strategyLabel("official_inline", translator("en")), "Official page inventory");
  assert.equal(strategyLabel("yardi_rentcafe", translator("zh")), "Yardi RentCafe 平台解析");
  assert.equal(strategyLabel("future_strategy", translator("zh")), "其他抓取方式");
});

test("locale switches keep identical matches and preserve all raw search fields without mutations", () => {
  const { providerLabel, strategyLabel, sourceMatchesSearchQuery } = helper;
  const rows = [
    source,
    { ...source, building_name: "Generic", provider_label: "Official site" },
    { ...source, building_name: "Other", provider_key: "yardi_rentcafe", provider_label: "Yardi/RentCafe", parser_strategy: "yardi_rentcafe" },
  ];
  const before = structuredClone(rows);
  for (const query of ["官方网站", "官网页内房源", "official website", "official page inventory", "equity", "yardi", "no-such-building"]) {
    const matches = [];
    for (const locale of ["en", "zh", "en"]) {
      rows.forEach((row) => {
        providerLabel(row.provider_label, row.provider_key, translator(locale));
        strategyLabel(row.parser_strategy, translator(locale));
      });
      matches.push(rows.filter((row) => sourceMatchesSearchQuery(row, query)).map((row) => row.building_name));
    }
    assert.deepEqual(matches[0], matches[1], query);
    assert.deepEqual(matches[1], matches[2], query);
  }
  for (const value of Object.values(source)) assert.equal(sourceMatchesSearchQuery(source, value.toLowerCase()), true, value);
  assert.equal(sourceMatchesSearchQuery(source, ""), true);
  assert.equal(sourceMatchesSearchQuery(source, "no-such-building"), false);
  assert.equal(sourceMatchesSearchQuery({ ...source, provider_label: null, area: null, city: null, state: null, availability_url: null, website: null }, "70 greene"), true);
  assert.deepEqual(rows, before);
});

test("error presentation separates backend and source denials and preserves raw diagnostics", () => {
  const { describeCrawlerError } = helper;
  for (const error of ["HTTP 403: Forbidden", "permission denied", "not authorized", "HTTP 403: provider adapter required for yardi_rentcafe"]) {
    assert.deepEqual(describeCrawlerError(error, "source"), { key: "crawler.sourceAccessDenied", details: error });
    assert.deepEqual(describeCrawlerError(error, "backend"), { key: "crawler.permissionDenied", details: error });
    assert.deepEqual(describeCrawlerError(error), describeCrawlerError(error, "backend"));
  }
  assert.deepEqual(describeCrawlerError("Failed to parse apartment 4030", "source"), {
    key: "crawler.requestFailed", details: "Failed to parse apartment 4030",
  });
});

test("local error keys remain language-independent and other diagnostic classifications are unchanged", () => {
  const { describeCrawlerError } = helper;
  for (const origin of ["backend", "source"]) {
    for (const key of ["crawler.signInAgain", "crawler.runNotConfirmed", "crawlerHelpers.launchFailed", "crawlerHelpers.launchMissingConfirmation", "crawlerHelpers.launchCancelled"]) {
      const description = describeCrawlerError(key, origin);
      assert.deepEqual(description, { key, details: null });
      assert.notEqual(translator("en")(description.key), translator("zh")(description.key));
    }
    for (const [error, key] of [
      ["column availability_crawl_run_items.snapshot_status does not exist", "crawler.schemaOutdated"],
      ["Could not find the function public.availability_crawler_review_run in the schema cache", "crawler.schemaOutdated"],
      ["preview_fingerprint_changed", "crawler.previewChanged"],
      ["Failed to fetch", "crawler.networkError"],
      ["Network error", "crawler.networkError"],
      ["arbitrary provider diagnostic", "crawler.requestFailed"],
      ["crawler.notARealKey", "crawler.requestFailed"],
      ["crawlerHelpers.notARealKey", "crawler.requestFailed"],
      ["crawler.constructor", "crawler.requestFailed"],
    ]) assert.deepEqual(describeCrawlerError(error, origin), { key, details: error });
  }
});

test("source row diagnostics pass explicit source origin and display logic stays out of load dependencies", () => {
  const uses = [];
  function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(ast) === "CrawlerError") {
      uses.push(node.attributes.properties);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const compact = uses.find((attributes) => attributes.some((attribute) => attribute.name?.getText(ast) === "compact"));
  const origin = compact?.find((attribute) => attribute.name?.getText(ast) === "origin");
  assert.equal(origin?.initializer?.text, "source");
  const root = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "AvailabilityCrawlerDashboard");
  for (const statement of root.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!["loadCrawlerDashboard", "sourceFilteredBuildingGroups"].includes(declaration.name.getText(ast))) continue;
      assert.doesNotMatch(declaration.initializer.arguments.at(-1).getText(ast), /\b(t|language)\b/);
    }
  }
});
