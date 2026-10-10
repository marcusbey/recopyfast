#!/usr/bin/env node
/**
 * s65a — measure the published-copy snapshot from the operator's machine.
 *
 * Green tests never stand in for the speed and freshness acceptance criteria:
 * those are properties of Vercel's edge and of the network between it and a
 * real client, so they are measured here, against a deployed URL, and recorded
 * in the PR beside the edge region they came from.
 *
 * Measure mode (default):
 *   node scripts/measure-published-snapshot.mjs --site <uuid> [--page /] \
 *     [--base https://www.recopyfa.st] [-n 20] [--reused 10] [--warmup 1] \
 *     [--content-token <site token> --origin <registered origin>] [--json]
 *
 *   - `--warmup` requests first (reported, not counted) so the sample measures
 *     a warm CDN entry, which is the claim being tested.
 *   - N fresh-connection requests (a new TCP+TLS connection each). Server wait
 *     is time to first byte minus connection setup — curl's
 *     `time_starttransfer - time_appconnect` — so a slow handshake on the
 *     operator's network is not charged to the edge. `x-vercel-cache` and the
 *     edge region (first segment of `x-vercel-id`) are recorded per request.
 *   - A reused-connection sample: one keep-alive socket, TTFB per request.
 *   - With `--content-token` and `--origin`, the same number of fresh requests
 *     to today's widget content GET, for a same-session comparison. The token
 *     is sent as the widget sends it and never printed.
 *   - Every warm-up and measured snapshot response must be HTTP 200 with the
 *     `rcf-published-v1` envelope, or the run fails: a fast cached 404 (a
 *     mistyped `--site`) is not a speed result.
 *
 * Freshness mode:
 *   node scripts/measure-published-snapshot.mjs --site <uuid> --freshness \
 *     --text "New headline" [--expect present|absent] [--since <ISO time>] \
 *     [--interval-ms 2000] [--timeout-ms 120000]
 *
 *   Polls the canonical snapshot URL until the text appears in (or disappears
 *   from) some row's `current_content`, and prints the elapsed time — from
 *   `--since` (the moment you published or deleted) when given, else from the
 *   start of polling. The story bound is ≤ 60 s. Only an HTTP 200 carrying the
 *   snapshot envelope can prove the condition; any other response is counted
 *   as a failed poll and polling continues to the timeout.
 *
 * Exit code 1 when a threshold or the freshness condition is not met.
 */

import http from "node:http";
import https from "node:https";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const SITE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_TIMEOUT_MS = 30_000;

/** s65a speed criteria, measured on CDN hits from the operator's machine. */
const SERVER_WAIT_P50_MAX_MS = 80;
const SERVER_WAIT_MAX_EXCLUSIVE_MS = 200;
const REUSED_TTFB_P50_MAX_MS = 50;

export function snapshotUrl({ base, siteId, page, language, variant }) {
  const query = new URLSearchParams([
    ["page", page],
    ["language", language],
    ["variant", variant],
  ]).toString();
  return `${base.replace(/\/+$/, "")}/api/published/${siteId}?${query}`;
}

function contentUrl({ base, siteId, page }) {
  return `${base.replace(/\/+$/, "")}/api/content/${siteId}?page_path=${encodeURIComponent(page)}`;
}

function positiveInteger(name, raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

export function parseArgs(argv) {
  const options = {
    base: "https://www.recopyfa.st",
    siteId: null,
    page: "/",
    language: "en",
    variant: "default",
    requests: 20,
    reused: 10,
    warmup: 1,
    contentToken: null,
    origin: null,
    freshness: false,
    text: null,
    expect: "present",
    intervalMs: 2_000,
    timeoutMs: 120_000,
    since: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      index += 1;
      return value;
    };
    switch (flag) {
      case "--base":
        options.base = next();
        break;
      case "--site":
        options.siteId = next();
        break;
      case "--page":
        options.page = next();
        break;
      case "--language":
        options.language = next();
        break;
      case "--variant":
        options.variant = next();
        break;
      case "-n":
      case "--requests":
        options.requests = positiveInteger(flag, next());
        break;
      case "--reused":
        options.reused = positiveInteger(flag, next());
        break;
      case "--warmup":
        options.warmup = positiveInteger(flag, next());
        break;
      case "--content-token":
        options.contentToken = next();
        break;
      case "--origin":
        options.origin = next();
        break;
      case "--freshness":
        options.freshness = true;
        break;
      case "--text":
        options.text = next();
        break;
      case "--expect":
        options.expect = next();
        break;
      case "--interval-ms":
        options.intervalMs = positiveInteger(flag, next());
        break;
      case "--timeout-ms":
        options.timeoutMs = positiveInteger(flag, next());
        break;
      case "--since": {
        const since = Date.parse(next());
        if (Number.isNaN(since)) throw new Error("--since must be an ISO time");
        options.since = since;
        break;
      }
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }

  if (!options.siteId || !SITE_ID_PATTERN.test(options.siteId)) {
    throw new Error("--site must be the site's lowercase UUID");
  }
  if (options.freshness && !options.text) {
    throw new Error("--freshness needs --text");
  }
  if (!["present", "absent"].includes(options.expect)) {
    throw new Error("--expect must be present or absent");
  }
  if (Boolean(options.contentToken) !== Boolean(options.origin)) {
    throw new Error("--content-token and --origin go together");
  }
  return options;
}

/** Nearest-rank percentile; NaN for an empty sample. */
export function percentile(values, p) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export function edgeRegion(vercelId) {
  if (typeof vercelId !== "string" || vercelId === "") return null;
  return vercelId.split("::")[0] || null;
}

/**
 * One GET with connection timings. `agent: false` forces a fresh connection;
 * pass a keep-alive agent to reuse one. On a reused socket there is no connect
 * phase, so server wait equals TTFB.
 */
export function timedRequest(url, { agent = false, headers = {} } = {}) {
  const target = new URL(url);
  const client = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let connectedAt = null;
    let secureAt = null;

    const request = client.request(
      target,
      {
        method: "GET",
        agent,
        headers: { "user-agent": "recopyfast-measure-published/1", ...headers },
      },
      (response) => {
        const firstByteAt = performance.now();
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const readyAt = secureAt ?? connectedAt ?? startedAt;
          resolve({
            status: response.statusCode,
            ttfbMs: firstByteAt - startedAt,
            connectMs: connectedAt === null ? 0 : connectedAt - startedAt,
            tlsMs:
              secureAt === null || connectedAt === null
                ? 0
                : secureAt - connectedAt,
            serverWaitMs: firstByteAt - readyAt,
            cache: response.headers["x-vercel-cache"] ?? null,
            region: edgeRegion(response.headers["x-vercel-id"]),
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    request.on("socket", (socket) => {
      if (!socket.connecting) return;
      socket.once("connect", () => {
        connectedAt = performance.now();
      });
      socket.once("secureConnect", () => {
        secureAt = performance.now();
      });
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () =>
      request.destroy(new Error(`Timed out after ${REQUEST_TIMEOUT_MS} ms`)),
    );
    request.on("error", reject);
    request.end();
  });
}

/** How many offending samples a threshold detail names before it stops. */
const MAX_LISTED_SAMPLES = 5;

/**
 * Every timed sample must be a real snapshot before its timing means
 * anything. Devin's review of PR #64 found the hole: an unknown but
 * well-formed site id is negative-cached as a 404 with the same CDN lifetime
 * as a 200, so a mistyped `--site` produced fast HITs that passed every speed
 * threshold while delivering no snapshot at all.
 */
function snapshotStatusThreshold({ warmup, fresh, reused }) {
  const labelled = [
    ...warmup.map((sample, index) => [`warm-up ${index + 1}`, sample]),
    ...fresh.map((sample, index) => [`fresh ${index + 1}`, sample]),
    ...reused.map((sample, index) => [`reused ${index + 1}`, sample]),
  ];
  const bad = labelled.filter(([, sample]) => readSnapshot(sample) === null);
  const listed = bad
    .slice(0, MAX_LISTED_SAMPLES)
    .map(([label, sample]) => `${label}: ${sample.status ?? "no status"}`);
  const more =
    bad.length > MAX_LISTED_SAMPLES
      ? `, +${bad.length - MAX_LISTED_SAMPLES} more`
      : "";

  return {
    name: "every warm-up and measured response is a 200 snapshot",
    pass: labelled.length > 0 && bad.length === 0,
    detail:
      bad.length === 0
        ? `${labelled.length}/${labelled.length} 200 snapshot`
        : `${bad.length}/${labelled.length} not a 200 snapshot: ${listed.join(", ")}${more}`,
  };
}

export function evaluateThresholds({ warmup = [], fresh, reused }) {
  const waits = fresh.map((sample) => sample.serverWaitMs);
  const waitP50 = percentile(waits, 50);
  const waitMax = waits.length === 0 ? Number.NaN : Math.max(...waits);
  const reusedP50 = percentile(
    reused.map((sample) => sample.ttfbMs),
    50,
  );

  return [
    snapshotStatusThreshold({ warmup, fresh, reused }),
    {
      name: "every fresh request is a CDN HIT",
      pass: fresh.length > 0 && fresh.every((sample) => sample.cache === "HIT"),
      detail: `${fresh.filter((sample) => sample.cache === "HIT").length}/${fresh.length} HIT`,
    },
    {
      name: `fresh server wait p50 <= ${SERVER_WAIT_P50_MAX_MS} ms`,
      pass: waitP50 <= SERVER_WAIT_P50_MAX_MS,
      detail: `p50 ${waitP50.toFixed(1)} ms`,
    },
    {
      name: `fresh server wait max < ${SERVER_WAIT_MAX_EXCLUSIVE_MS} ms`,
      pass: waitMax < SERVER_WAIT_MAX_EXCLUSIVE_MS,
      detail: `max ${waitMax.toFixed(1)} ms`,
    },
    {
      name: `reused-connection TTFB p50 <= ${REUSED_TTFB_P50_MAX_MS} ms`,
      pass: reusedP50 <= REUSED_TTFB_P50_MAX_MS,
      detail: `p50 ${reusedP50.toFixed(1)} ms`,
    },
  ];
}

const SNAPSHOT_FORMAT = "rcf-published-v1";

/**
 * The parsed snapshot when a sample is one — HTTP 200 and the
 * `rcf-published-v1` envelope with a `rows` array — else null. Anything else
 * (an error status, an `{ error }` body, an HTML error page) proves nothing
 * about published copy, in either direction.
 */
function readSnapshot(sample) {
  if (sample?.status !== 200 || typeof sample.body !== "string") return null;
  try {
    const parsed = JSON.parse(sample.body);
    return parsed?.format === SNAPSHOT_FORMAT && Array.isArray(parsed.rows)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function hasText(snapshot, text) {
  return snapshot.rows.some(
    (row) =>
      typeof row?.current_content === "string" &&
      row.current_content.includes(text),
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function pollFreshness({
  url,
  text,
  expect,
  intervalMs = 2_000,
  timeoutMs = 120_000,
  since = Date.now(),
}) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let failedPolls = 0;
  let last = null;
  const outcome = (met) => ({
    met,
    elapsedMs: Date.now() - since,
    attempts,
    failedPolls,
    status: last.status,
    cache: last.cache,
    region: last.region,
  });

  for (;;) {
    attempts += 1;
    last = await timedRequest(url);
    // Only a valid snapshot can prove the condition. Before Devin's review of
    // PR #64, a 500's `{ error }` body read as "no rows", so `--expect absent`
    // printed MET on the first failed request. A failed read is counted and
    // polling goes on until the deadline.
    const snapshot = readSnapshot(last);
    if (snapshot === null) {
      failedPolls += 1;
    } else if ((expect === "present") === hasText(snapshot, text)) {
      return outcome(true);
    }
    if (Date.now() + intervalMs > deadline) {
      return outcome(false);
    }
    await sleep(intervalMs);
  }
}

function describeSample(samples) {
  const metric = (name) => samples.map((sample) => sample[name]);
  const stats = (values) =>
    `p50 ${percentile(values, 50).toFixed(1)} / max ${Math.max(...values).toFixed(1)} ms`;
  return samples.length === 0
    ? "no samples"
    : `TTFB ${stats(metric("ttfbMs"))}; server wait ${stats(metric("serverWaitMs"))}; ` +
        `TLS ${stats(metric("tlsMs"))}`;
}

function withoutBody({ body: _body, ...sample }) {
  return sample;
}

export async function measure(options) {
  const url = snapshotUrl(options);
  const warmup = [];
  for (let index = 0; index < options.warmup; index += 1) {
    warmup.push(await timedRequest(url));
  }

  const fresh = [];
  for (let index = 0; index < options.requests; index += 1) {
    fresh.push(await timedRequest(url));
  }

  // One socket for the whole sample; the first request opens it and is not
  // counted, so every counted request rides an established connection.
  const keepAliveAgent = new (url.startsWith("https:") ? https : http).Agent({
    keepAlive: true,
    maxSockets: 1,
  });
  const reused = [];
  try {
    if (options.reused > 0) await timedRequest(url, { agent: keepAliveAgent });
    for (let index = 0; index < options.reused; index += 1) {
      reused.push(await timedRequest(url, { agent: keepAliveAgent }));
    }
  } finally {
    keepAliveAgent.destroy();
  }

  const content = [];
  if (options.contentToken) {
    for (let index = 0; index < options.requests; index += 1) {
      content.push(
        await timedRequest(contentUrl(options), {
          headers: {
            authorization: `Bearer ${options.contentToken}`,
            origin: options.origin,
          },
        }),
      );
    }
  }

  const thresholds = evaluateThresholds({ warmup, fresh, reused });
  const regions = [
    ...new Set(fresh.map((sample) => sample.region ?? "unknown")),
  ];
  return {
    url,
    measuredAt: new Date().toISOString(),
    regions,
    warmup: warmup.map(withoutBody),
    fresh: fresh.map(withoutBody),
    reused: reused.map(withoutBody),
    content: content.map(withoutBody),
    thresholds,
  };
}

function printMeasurement(report) {
  console.log(`Snapshot: ${report.url}`);
  console.log(
    `Measured: ${report.measuredAt}  edge region(s): ${report.regions.join(", ")}`,
  );
  for (const sample of report.warmup) {
    console.log(
      `warm-up: ${sample.status} ${sample.cache ?? "-"} ${sample.ttfbMs.toFixed(1)} ms`,
    );
  }
  console.log("\n#   status cache   TLS ms  wait ms  TTFB ms  region");
  report.fresh.forEach((sample, index) => {
    console.log(
      `${String(index + 1).padStart(2)}  ${sample.status}    ${String(sample.cache ?? "-").padEnd(6)} ` +
        `${sample.tlsMs.toFixed(1).padStart(6)}  ${sample.serverWaitMs.toFixed(1).padStart(7)}  ` +
        `${sample.ttfbMs.toFixed(1).padStart(7)}  ${sample.region ?? "-"}`,
    );
  });
  console.log(
    `\nFresh (${report.fresh.length}): ${describeSample(report.fresh)}`,
  );
  console.log(
    `Reused (${report.reused.length}): ${describeSample(report.reused)}`,
  );
  if (report.content.length > 0) {
    console.log(
      `Content GET, same session (${report.content.length}): ${describeSample(report.content)}`,
    );
  }
  console.log("");
  for (const threshold of report.thresholds) {
    console.log(
      `${threshold.pass ? "PASS" : "FAIL"}  ${threshold.name} (${threshold.detail})`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.freshness) {
    const result = await pollFreshness({
      url: snapshotUrl(options),
      text: options.text,
      expect: options.expect,
      intervalMs: options.intervalMs,
      timeoutMs: options.timeoutMs,
      since: options.since ?? Date.now(),
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        `${result.met ? "MET" : "NOT MET"}: text ${options.expect} after ` +
          `${(result.elapsedMs / 1000).toFixed(1)} s, ${result.attempts} poll(s) ` +
          `(${result.failedPolls} failed: not a 200 snapshot), ` +
          `last ${result.status} ${result.cache ?? "-"} ${result.region ?? "-"}`,
      );
    }
    process.exit(result.met ? 0 : 1);
  }

  const report = await measure(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printMeasurement(report);
  }
  process.exit(report.thresholds.every((threshold) => threshold.pass) ? 0 : 1);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`\n${error.message}\n`);
    process.exit(1);
  });
}
