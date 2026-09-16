import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

async function helper() {
  const url = new URL("../src/lib/availability-crawler-status-polling.ts", import.meta.url);
  assert.ok(existsSync(url), "Bounded status polling helper must exist");
  return import(url.href);
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("polls every 30 seconds only while visible and never overlaps", async (t) => {
  const { pollCrawlerWorkerStatus } = await helper();
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let visible = false, notify, resolveRead, calls = 0;
  const values = [];
  const stop = pollCrawlerWorkerStatus({
    isVisible: () => visible,
    subscribeVisibility: (callback) => { notify = callback; return () => { notify = null; }; },
    read: () => { calls++; return new Promise((resolve) => { resolveRead = resolve; }); },
    onStatus: (value) => values.push(value),
  });
  assert.equal(calls, 0);
  visible = true; notify();
  assert.equal(calls, 1);
  t.mock.timers.tick(90_000); notify();
  assert.equal(calls, 1);
  resolveRead("running"); await flush();
  t.mock.timers.tick(29_999); assert.equal(calls, 1);
  t.mock.timers.tick(1); assert.equal(calls, 2);
  visible = false; notify();
  resolveRead("late"); await flush();
  assert.deepEqual(values, ["running"]);
  t.mock.timers.tick(90_000); assert.equal(calls, 2);
  stop(); assert.equal(notify, null);
});

test("cleanup on run change aborts old requests and ignores their responses", async () => {
  const { pollCrawlerWorkerStatus } = await helper();
  let resolveRead, signal;
  const values = [];
  const stop = pollCrawlerWorkerStatus({
    isVisible: () => true, subscribeVisibility: () => () => {},
    read: (requestSignal) => { signal = requestSignal; return new Promise((resolve) => { resolveRead = resolve; }); },
    onStatus: (value) => values.push(value),
  });
  stop(); resolveRead("old run"); await flush();
  assert.equal(signal.aborted, true);
  assert.deepEqual(values, []);
});

test("failed reads clear previously verified status instead of retaining worker death", async () => {
  const { pollCrawlerWorkerStatus } = await helper();
  const values = [];
  const stop = pollCrawlerWorkerStatus({
    isVisible: () => true, subscribeVisibility: () => () => {},
    read: async () => { throw new Error("network unavailable"); },
    onStatus: (value) => values.push(value),
  });
  await flush(); stop();
  assert.deepEqual(values, [null]);
});
