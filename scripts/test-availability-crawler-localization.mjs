import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const dashboardPath = new URL("../src/components/availability-crawler-dashboard.tsx", import.meta.url);
const messagesPath = new URL("../src/lib/availability-crawler-messages.ts", import.meta.url);

test("crawler dashboard follows site i18n instead of literal English UI", () => {
  const source = readFileSync(dashboardPath, "utf8");
  assert.match(source, /useI18n/);
  const ast = ts.createSourceFile("dashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const literals = [];
  function visit(node) {
    if (ts.isJsxText(node) && /[a-z]{2}/i.test(node.text)) literals.push(node.text.trim());
    if (ts.isJsxAttribute(node) && /^(placeholder|title|aria-label|label|helper|body)$/.test(node.name.getText(ast))
      && node.initializer && ts.isStringLiteral(node.initializer) && /[a-z]{2}/i.test(node.initializer.text)) {
      literals.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual(literals, [], "User-facing JSX copy must go through site translations");
});

test("crawler dictionaries have matching keys and interpolation tokens", async () => {
  assert.ok(existsSync(messagesPath), "Crawler EN/ZH messages must exist");
  const { crawlerMessages } = await import(messagesPath.href);
  assert.deepEqual(Object.keys(crawlerMessages.en).sort(), Object.keys(crawlerMessages.zh).sort());
  const tokens = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, english] of Object.entries(crawlerMessages.en)) {
    const chinese = crawlerMessages.zh[key];
    assert.ok(english.trim(), key);
    assert.match(chinese, /[\u3400-\u9fff]/u, `${key} must have Chinese copy`);
    assert.deepEqual(tokens(chinese), tokens(english), `${key} must retain all values`);
  }
  const source = readFileSync(dashboardPath, "utf8");
  for (const [, key] of source.matchAll(/\bt\("crawler\.([^".]+)"/g)) {
    assert.ok(crawlerMessages.en[key], `Missing English key: ${key}`);
    assert.ok(crawlerMessages.zh[key], `Missing Chinese key: ${key}`);
  }
  const i18n = readFileSync(new URL("../src/lib/i18n.tsx", import.meta.url), "utf8");
  assert.match(i18n, /crawler:\s*crawlerMessages\.en/);
  assert.match(i18n, /crawler:\s*crawlerMessages\.zh/);
});
