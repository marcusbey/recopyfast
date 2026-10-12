/**
 * @jest-environment node
 */

/**
 * Devin review of 0c5c5e4 (security): scanner traffic never carries tracing
 * metadata, whatever `tracePropagationTargets` says about the scanned host.
 *
 * How the SDK injects (read in node_modules, @sentry/core and node-core
 * 10.58): on Node ≥ 22.12 `SentryHttpInstrumentation` subscribes to the
 * `http.client.request.created` diagnostics channel and, for a URL matching
 * `tracePropagationTargets`, calls `request.setHeader` for `sentry-trace`,
 * `baggage` and `traceparent` — synchronously, while `http.request()` runs.
 * It skips a request made inside `suppressTracing` (the scope's
 * suppress-tracing flag, or OpenTelemetry's suppressed context).
 *
 * So `safeFetch` has two layers, each pinned here:
 * 1. the request is created inside `Sentry.suppressTracing` — no header, no
 *    span and no breadcrumb naming the scanned URL;
 * 2. whatever an instrumentation added while the request was created is
 *    removed before it is sent (`sentry-trace`, `baggage`, `traceparent`,
 *    `tracestate`).
 */

import diagnosticsChannel from "node:diagnostics_channel";
import { execFile } from "node:child_process";
import http, { type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";

import { createRequestBudget, safeFetch } from "../safe-fetch";
import { bundleSafeFetch } from "./bundle-safe-fetch";

const TRACE_HEADERS = [
  "sentry-trace",
  "baggage",
  "traceparent",
  "tracestate",
] as const;

const received: { path: string; headers: IncomingHttpHeaders }[] = [];
let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    received.push({ path: req.url ?? "/", headers: req.headers });
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<p>ok</p>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(() => {
  received.length = 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function headersOf(pathname: string): IncomingHttpHeaders {
  const request = received.find((entry) => entry.path === pathname);
  if (!request) throw new Error(`no request for ${pathname}`);
  return request.headers;
}

function traceHeadersOf(pathname: string): Record<string, unknown> {
  const headers = headersOf(pathname);
  return Object.fromEntries(
    TRACE_HEADERS.filter((name) => headers[name] !== undefined).map((name) => [
      name,
      headers[name],
    ]),
  );
}

describe("layer 2: headers added while the request is created are removed", () => {
  it("sends none of sentry-trace, baggage, traceparent or tracestate, though an injector adds all four", async () => {
    const inject = (message: unknown) => {
      const { request } = message as { request: http.ClientRequest };
      request.setHeader(
        "sentry-trace",
        `${"a".repeat(32)}-${"b".repeat(16)}-1`,
      );
      request.setHeader("baggage", "sentry-environment=test");
      request.setHeader(
        "traceparent",
        `00-${"a".repeat(32)}-${"b".repeat(16)}-01`,
      );
      request.setHeader("tracestate", "vendor=value");
    };
    diagnosticsChannel.subscribe("http.client.request.created", inject);
    try {
      // Control: the injector reaches an ordinary request.
      await new Promise<void>((resolve) =>
        http.get(`http://127.0.0.1:${port}/control`, (res) => {
          res.resume();
          res.on("end", () => resolve());
        }),
      );
      const result = await safeFetch(`http://fixture.test:${port}/scanned`, {
        kind: "html",
        budget: createRequestBudget(4),
        policy: {
          isAllowedAddress: (address) => address === "127.0.0.1",
          isAllowedPort: (_protocol, value) => value === String(port),
        },
        resolver: async () => [{ address: "127.0.0.1", family: 4 }],
        authorizeHost: async () => null,
      });

      expect(result.ok).toBe(true);
      expect(Object.keys(traceHeadersOf("/control")).sort()).toEqual(
        [...TRACE_HEADERS].sort(),
      );
      expect(traceHeadersOf("/scanned")).toEqual({});
    } finally {
      diagnosticsChannel.unsubscribe("http.client.request.created", inject);
    }
  });
});

describe("the real Sentry SDK, with the scanned origin in tracePropagationTargets", () => {
  /**
   * A child `node` process runs @sentry/node 10.58 with tracing on, a no-op
   * transport (nothing leaves the machine) and `tracePropagationTargets`
   * naming BOTH the control origin and the scanned one. Inside one span it
   * makes an ordinary request (the control: it must carry trace headers and
   * get a span) and a scan of `fixture.test` (no header, no span).
   */
  it("attaches no trace header to the scan and records no span for it", async () => {
    const { bundle, workDir, nodePath, cleanup } = bundleSafeFetch();
    const script = `
      const Sentry = require("@sentry/node");
      const spans = [];
      Sentry.init({
        dsn: "https://public@o0.ingest.sentry.io/0",
        tracesSampleRate: 1,
        propagateTraceparent: true,
        tracePropagationTargets: [/^http:\\/\\/(?:127\\.0\\.0\\.1|fixture\\.test):${port}(?:[/?#]|$)/],
        transport: () => ({ send: async () => ({}), flush: async () => true }),
        beforeSendTransaction(event) {
          for (const span of event.spans || []) spans.push(span.description || "");
          return null;
        },
      });
      const http = require("node:http");
      const { safeFetch, createRequestBudget } = require(process.argv[1]);
      Sentry.startSpan({ name: "scan" }, async () => {
        await new Promise((resolve) => http.get("http://127.0.0.1:${port}/control", (res) => { res.resume(); res.on("end", resolve); }));
        const result = await safeFetch("http://fixture.test:${port}/scanned", {
          kind: "html",
          budget: createRequestBudget(4),
          policy: { isAllowedAddress: (a) => a === "127.0.0.1", isAllowedPort: () => true },
          resolver: async () => [{ address: "127.0.0.1", family: 4 }],
          authorizeHost: async () => null,
        });
        return result.ok;
      }).then(async (ok) => {
        await Sentry.flush(2000);
        process.stdout.write(JSON.stringify({ ok, spans }));
      });
    `;

    let outcome: { ok: boolean; spans: string[] };
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ["-e", script, bundle],
        {
          cwd: workDir,
          env: { ...process.env, NODE_PATH: nodePath },
          timeout: 30_000,
        },
      );
      outcome = JSON.parse(stdout) as { ok: boolean; spans: string[] };
    } finally {
      cleanup();
    }

    expect(outcome.ok).toBe(true);
    // The control proves the SDK was live and the targets matched.
    expect(traceHeadersOf("/control")).toMatchObject({
      "sentry-trace": expect.any(String),
      baggage: expect.any(String),
      traceparent: expect.any(String),
    });
    expect(outcome.spans.some((span) => span.includes("/control"))).toBe(true);
    // The scan: no header (layers 1 and 2), and no span (layer 1).
    expect(traceHeadersOf("/scanned")).toEqual({});
    expect(
      outcome.spans.filter((span) => span.includes("fixture.test")),
    ).toEqual([]);
  }, 40_000);
});
