import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  edgeRegion,
  evaluateThresholds,
  parseArgs,
  percentile,
  pollFreshness,
  snapshotUrl,
  timedRequest,
} from "../measure-published-snapshot.mjs";

const SITE_ID = "6f1c2b9e-3d4a-4b5c-8d6e-7f8091a2b3c4";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("builds the one canonical snapshot URL", () => {
  assert.equal(
    snapshotUrl({
      base: "https://www.recopyfa.st/",
      siteId: SITE_ID,
      page: "/pricing",
      language: "en",
      variant: "Spring Promo",
    }),
    `https://www.recopyfa.st/api/published/${SITE_ID}?page=%2Fpricing&language=en&variant=Spring+Promo`,
  );
});

test("parses defaults and refuses a missing or uppercase site id", () => {
  const options = parseArgs(["--site", SITE_ID]);
  assert.equal(options.base, "https://www.recopyfa.st");
  assert.equal(options.page, "/");
  assert.equal(options.language, "en");
  assert.equal(options.variant, "default");
  assert.equal(options.requests, 20);
  assert.equal(options.reused, 10);
  assert.equal(options.warmup, 1);
  assert.equal(options.freshness, false);

  assert.throws(() => parseArgs([]), /--site/);
  assert.throws(() => parseArgs(["--site", SITE_ID.toUpperCase()]), /--site/);
  assert.throws(() => parseArgs(["--site", SITE_ID, "--freshness"]), /--text/);
  assert.throws(
    () =>
      parseArgs([
        "--site",
        SITE_ID,
        "--freshness",
        "--text",
        "x",
        "--expect",
        "maybe",
      ]),
    /--expect/,
  );
});

test("computes nearest-rank percentiles", () => {
  assert.equal(percentile([30, 10, 20], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([5], 99), 5);
  assert.ok(Number.isNaN(percentile([], 50)));
});

test("reads the edge region from x-vercel-id", () => {
  assert.equal(edgeRegion("yul1::iad1::abcde-1234"), "yul1");
  assert.equal(edgeRegion(undefined), null);
});

test("judges the s65a speed thresholds", () => {
  const hit = (serverWaitMs) => ({ cache: "HIT", serverWaitMs, ttfbMs: 0 });
  const passing = evaluateThresholds({
    fresh: [hit(40), hit(60), hit(70), hit(190)],
    reused: [{ ttfbMs: 20 }, { ttfbMs: 45 }, { ttfbMs: 90 }],
  });
  assert.deepEqual(
    passing.map(({ name, pass }) => [name, pass]),
    [
      ["every fresh request is a CDN HIT", true],
      ["fresh server wait p50 <= 80 ms", true],
      ["fresh server wait max < 200 ms", true],
      ["reused-connection TTFB p50 <= 50 ms", true],
    ],
  );

  const failing = evaluateThresholds({
    fresh: [hit(90), { cache: "MISS", serverWaitMs: 300, ttfbMs: 0 }],
    reused: [{ ttfbMs: 60 }],
  });
  assert.deepEqual(
    failing.map(({ pass }) => pass),
    [false, false, false, false],
  );
});

test("times a fresh-connection request and records the cache header", async () => {
  await withServer(
    (_request, response) => {
      setTimeout(() => {
        response.writeHead(200, {
          "content-type": "application/json",
          "x-vercel-cache": "HIT",
          "x-vercel-id": "yul1::iad1::test",
        });
        response.end("{}");
      }, 30);
    },
    async (base) => {
      const sample = await timedRequest(`${base}/api/published/x`);
      assert.equal(sample.status, 200);
      assert.equal(sample.cache, "HIT");
      assert.equal(sample.region, "yul1");
      assert.ok(sample.ttfbMs >= 25, `ttfb ${sample.ttfbMs}`);
      assert.ok(
        sample.serverWaitMs >= 25,
        `server wait ${sample.serverWaitMs}`,
      );
      assert.ok(sample.serverWaitMs <= sample.ttfbMs);
      assert.equal(sample.tlsMs, 0);
    },
  );
});

test("polls until a text appears, and until it disappears", async () => {
  const startedAt = Date.now();
  await withServer(
    (_request, response) => {
      const isLive = Date.now() - startedAt > 150;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          rows: isLive ? [{ current_content: "New copy" }] : [],
        }),
      );
    },
    async (base) => {
      const appeared = await pollFreshness({
        url: `${base}/api/published/x`,
        text: "New copy",
        expect: "present",
        intervalMs: 25,
        timeoutMs: 2_000,
        since: startedAt,
      });
      assert.equal(appeared.met, true);
      assert.ok(appeared.elapsedMs >= 150, `elapsed ${appeared.elapsedMs}`);
      assert.ok(appeared.attempts > 1);

      const absent = await pollFreshness({
        url: `${base}/api/published/x`,
        text: "Old copy",
        expect: "absent",
        intervalMs: 25,
        timeoutMs: 2_000,
      });
      assert.equal(absent.met, true);
      assert.equal(absent.attempts, 1);
    },
  );
});

test("gives up at the timeout without claiming freshness", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"rows":[]}');
    },
    async (base) => {
      const result = await pollFreshness({
        url: `${base}/api/published/x`,
        text: "Never",
        expect: "present",
        intervalMs: 20,
        timeoutMs: 120,
      });
      assert.equal(result.met, false);
    },
  );
});
