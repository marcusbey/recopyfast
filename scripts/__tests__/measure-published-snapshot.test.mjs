import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  edgeRegion,
  evaluateThresholds,
  measure,
  parseArgs,
  percentile,
  pollFreshness,
  snapshotUrl,
  timedRequest,
} from "../measure-published-snapshot.mjs";

const SITE_ID = "6f1c2b9e-3d4a-4b5c-8d6e-7f8091a2b3c4";

/** A body the route really serves: the rcf-published-v1 envelope. */
function snapshotBody(rows = []) {
  return JSON.stringify({
    format: "rcf-published-v1",
    siteId: SITE_ID,
    pagePath: "/",
    language: "en",
    variant: "default",
    rows,
  });
}

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
  const ok = { status: 200, body: snapshotBody() };
  const hit = (serverWaitMs) => ({
    ...ok,
    cache: "HIT",
    serverWaitMs,
    ttfbMs: 0,
  });
  const reusedSample = (ttfbMs) => ({ ...ok, ttfbMs });
  const passing = evaluateThresholds({
    warmup: [hit(300)],
    fresh: [hit(40), hit(60), hit(70), hit(190)],
    reused: [reusedSample(20), reusedSample(45), reusedSample(90)],
  });
  assert.deepEqual(
    passing.map(({ name, pass }) => [name, pass]),
    [
      ["every warm-up and measured response is a 200 snapshot", true],
      ["every fresh request is a CDN HIT", true],
      ["fresh server wait p50 <= 80 ms", true],
      ["fresh server wait max < 200 ms", true],
      ["reused-connection TTFB p50 <= 50 ms", true],
    ],
  );

  const failing = evaluateThresholds({
    warmup: [],
    fresh: [hit(90), { ...ok, cache: "MISS", serverWaitMs: 300, ttfbMs: 0 }],
    reused: [{ status: 500, body: "{}", ttfbMs: 60 }],
  });
  assert.deepEqual(
    failing.map(({ pass }) => pass),
    [false, false, false, false, false],
  );
});

test("a fast cached 404 never passes the speed gate (Devin, PR #64)", () => {
  // An unknown but well-formed site id is negative-cached like a 200, so a
  // mistyped --site fills the CDN with a 404 that is fast and a HIT.
  const cached404 = {
    status: 404,
    cache: "HIT",
    serverWaitMs: 10,
    ttfbMs: 10,
    body: '{"error":"Site not found"}',
  };
  const thresholds = evaluateThresholds({
    warmup: [cached404],
    fresh: [cached404, cached404],
    reused: [cached404],
  });

  const status = thresholds[0];
  assert.equal(
    status.name,
    "every warm-up and measured response is a 200 snapshot",
  );
  assert.equal(status.pass, false);
  assert.match(status.detail, /4\/4 not a 200 snapshot/);
  assert.match(status.detail, /warm-up 1: 404/);
  assert.ok(thresholds.slice(1).every(({ pass }) => pass));
});

test("a 200 that is not a snapshot envelope fails the speed gate", () => {
  const sample = (body) => ({
    status: 200,
    cache: "HIT",
    serverWaitMs: 10,
    ttfbMs: 10,
    body,
  });
  for (const body of [
    '{"error":"x"}',
    '{"format":"rcf-published-v1","rows":"nope"}',
    '{"rows":[]}',
    "<html>",
  ]) {
    const [status] = evaluateThresholds({
      warmup: [],
      fresh: [sample(body)],
      reused: [sample(snapshotBody())],
    });
    assert.equal(status.pass, false, body);
  }
});

test("measure fails the run when the warm-up is not a snapshot", async () => {
  // The warm-up is the request that fills the CDN entry every sample then
  // hits. A non-200 there means the run measured an error, whatever follows.
  let calls = 0;
  await withServer(
    (_request, response) => {
      calls += 1;
      const isWarmup = calls === 1;
      response.writeHead(isWarmup ? 500 : 200, {
        "content-type": "application/json",
        "x-vercel-cache": "HIT",
      });
      response.end(
        isWarmup ? '{"error":"Internal server error"}' : snapshotBody(),
      );
    },
    async (base) => {
      const report = await measure({
        base,
        siteId: SITE_ID,
        page: "/",
        language: "en",
        variant: "default",
        warmup: 1,
        requests: 2,
        reused: 1,
      });
      const [status] = report.thresholds;
      assert.equal(status.pass, false);
      assert.match(status.detail, /warm-up 1: 500/);
    },
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
        snapshotBody(isLive ? [{ current_content: "New copy" }] : []),
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
      response.end(snapshotBody());
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

test("a failed or malformed read never proves a deletion (Devin, PR #64)", async () => {
  // Before the fix, `--expect absent` read a 500's `{ error }` body as "no
  // rows, so the text is gone", printed MET and exited 0 on the first poll.
  for (const [status, body] of [
    [500, '{"error":"Internal server error"}'],
    [404, '{"error":"Site not found"}'],
    [429, '{"error":"Too many snapshot requests."}'],
    [200, '{"error":"not an envelope"}'],
    [200, '{"format":"rcf-published-v1","rows":null}'],
    [200, "not json"],
  ]) {
    await withServer(
      (_request, response) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(body);
      },
      async (base) => {
        const result = await pollFreshness({
          url: `${base}/api/published/x`,
          text: "Old copy",
          expect: "absent",
          intervalMs: 20,
          timeoutMs: 120,
        });
        assert.equal(result.met, false, `${status} ${body}`);
        assert.ok(result.attempts > 1, `${status} ${body}`);
        assert.equal(result.failedPolls, result.attempts, `${status} ${body}`);
      },
    );
  }
});

test("a non-200 carrying the text never proves it published", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(snapshotBody([{ current_content: "New copy" }]));
    },
    async (base) => {
      const result = await pollFreshness({
        url: `${base}/api/published/x`,
        text: "New copy",
        expect: "present",
        intervalMs: 20,
        timeoutMs: 120,
      });
      assert.equal(result.met, false);
      assert.equal(result.failedPolls, result.attempts);
    },
  );
});

test("keeps polling through failed reads until a valid snapshot proves it", async () => {
  const startedAt = Date.now();
  await withServer(
    (_request, response) => {
      if (Date.now() - startedAt < 120) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end('{"error":"Internal server error"}');
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(snapshotBody());
    },
    async (base) => {
      const result = await pollFreshness({
        url: `${base}/api/published/x`,
        text: "Old copy",
        expect: "absent",
        intervalMs: 20,
        timeoutMs: 2_000,
        since: startedAt,
      });
      assert.equal(result.met, true);
      assert.ok(result.failedPolls >= 1, `failed ${result.failedPolls}`);
      assert.equal(result.status, 200);
      assert.ok(result.elapsedMs >= 120, `elapsed ${result.elapsedMs}`);
    },
  );
});
