/**
 * @jest-environment node
 */

/**
 * s96 — one scan end to end against a real loopback site: robots.txt, the
 * homepage, the sitemap, the sampled pages, the lens and the stored report.
 * The policy and resolver are injected to reach the fixture (the production
 * defaults refuse loopback and non-default ports).
 */

import http from "node:http";
import type { AddressInfo, Socket } from "node:net";

import type { FetchPolicy } from "@/lib/tools/fetch/safe-fetch";
import { typoLens } from "@/lib/tools/lenses/typos/typo-lens";
import { parseStoredReport } from "@/lib/tools/report/report-schema";
import { normalizeScanUrl, type NormalizedScanUrl } from "../normalize-url";
import { PAGE_SKIP_REASONS, runScan } from "../run-scan";

const FILLER =
  "We bake fresh bread every morning with simple flour, water and salt. Our small team opens the shop at seven and closes when the last loaf is sold.";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
const routes = new Map<string, Handler>();
const requested: string[] = [];
const sockets = new Set<Socket>();
let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];
    requested.push(pathname);
    const handler = routes.get(pathname);
    if (handler) return handler(req, res);
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("missing");
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(() => {
  routes.clear();
  requested.length = 0;
  for (const socket of sockets) socket.destroy();
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const policy = (): FetchPolicy => ({
  isAllowedAddress: (address) => address === "127.0.0.1",
  isAllowedPort: (_protocol, value) => value === String(port),
});
const resolver = async () => [{ address: "127.0.0.1", family: 4 as const }];

function site(pathname = "/"): NormalizedScanUrl {
  const normalized = normalizeScanUrl(`http://bakery.test:${port}${pathname}`, {
    isAllowedPort: policy().isAllowedPort,
  });
  if (!normalized.ok) throw new Error("bad fixture url");
  return normalized.value;
}

function html(body: string): Handler {
  return (_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<html lang="en"><head><title>Bakery</title></head><body>${body}</body></html>`,
    );
  };
}

function text(body: string, type = "text/plain"): Handler {
  return (_req, res) => {
    res.writeHead(200, { "content-type": type });
    res.end(body);
  };
}

function scan(overrides: { deadlineMs?: number; denylist?: string[] } = {}) {
  return runScan({
    tool: "website-spell-checker",
    lens: typoLens,
    url: site(),
    now: new Date(),
    denylist: overrides.denylist ?? [],
    policy: policy(),
    resolver,
    deadlineMs: overrides.deadlineMs,
  });
}

describe("runScan", () => {
  it("reads robots.txt, the homepage and the sitemap's pages, and stores a valid report", async () => {
    const origin = `http://bakery.test:${port}`;
    routes.set("/robots.txt", text("User-agent: *\nDisallow: /private"));
    routes.set("/", html(`<p>${FILLER} We recieve orders daily.</p>`));
    routes.set(
      "/sitemap.xml",
      text(
        `<urlset><url><loc>${origin}/menu</loc></url><url><loc>${origin}/private/admin</loc></url><url><loc>${origin}/gone</loc></url></urlset>`,
        "application/xml",
      ),
    );
    routes.set("/menu", html(`<p>${FILLER} Our seperate menu.</p>`));

    const result = await scan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const report = result.report;
    expect(parseStoredReport(JSON.parse(JSON.stringify(report)))).toEqual(
      report,
    );
    expect(
      report.findings.map((finding) => [finding.page, finding.match]),
    ).toEqual([
      [`${origin}/`, "recieve"],
      [`${origin}/menu`, "seperate"],
    ]);
    // Shallowest first, then shortest: /gone, /menu, /private/admin.
    expect(report.pages).toEqual([
      { url: `${origin}/`, status: "checked" },
      {
        url: `${origin}/gone`,
        status: "skipped",
        reason: PAGE_SKIP_REASONS.failed,
      },
      { url: `${origin}/menu`, status: "checked" },
      {
        url: `${origin}/private/admin`,
        status: "skipped",
        reason: PAGE_SKIP_REASONS.robots,
      },
    ]);
    // robots.txt once, and the disallowed page never requested.
    expect(requested.filter((path) => path === "/robots.txt")).toHaveLength(1);
    expect(requested).not.toContain("/private/admin");
    expect(report).toMatchObject({
      v: 1,
      tool: "website-spell-checker",
      truncated: false,
    });
  });

  it("refuses the whole scan when robots.txt disallows the homepage", async () => {
    routes.set(
      "/robots.txt",
      text("User-agent: RecopyFastToolsBot\nDisallow: /"),
    );
    routes.set("/", html(`<p>${FILLER}</p>`));

    expect(await scan()).toEqual({ ok: false, reason: "robots_disallowed" });
    expect(requested).toEqual(["/robots.txt"]);
  });

  it("refuses the scan when robots.txt answers a server error (RFC 9309: assume disallow)", async () => {
    routes.set("/robots.txt", (_req, res) => {
      res.writeHead(503);
      res.end();
    });

    expect(await scan()).toEqual({ ok: false, reason: "http_status" });
  });

  it("fails with the homepage's own reason", async () => {
    routes.set("/", (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });

    expect(await scan()).toEqual({ ok: false, reason: "not_html" });
  });

  it("refuses a denylisted host before any request", async () => {
    expect(await scan({ denylist: ["bakery.test"] })).toEqual({
      ok: false,
      reason: "denylisted",
    });
    expect(requested).toEqual([]);
  });

  it("falls back to the homepage's links without a sitemap, and lists pages it could not reach in time", async () => {
    const origin = `http://bakery.test:${port}`;
    routes.set(
      "/",
      html(`<p>${FILLER}</p><a href="/slow">slow</a><a href="/fast">fast</a>`),
    );
    routes.set("/fast", html(`<p>${FILLER}</p>`));
    routes.set("/slow", () => undefined);

    const result = await scan({ deadlineMs: 1_500 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.pages).toEqual([
      { url: `${origin}/`, status: "checked" },
      { url: `${origin}/fast`, status: "checked" },
      {
        url: `${origin}/slow`,
        status: "skipped",
        reason: PAGE_SKIP_REASONS.timeLimit,
      },
    ]);
  });
});
