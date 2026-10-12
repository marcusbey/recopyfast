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

import { compressedBomb } from "@/lib/tools/fetch/__tests__/bombs";
import type { FetchPolicy } from "@/lib/tools/fetch/safe-fetch";
import { typoLens } from "@/lib/tools/lenses/typos/typo-lens";
import { parseStoredReport } from "@/lib/tools/report/report-schema";
import { normalizeScanUrl, type NormalizedScanUrl } from "../normalize-url";
import { PAGE_SKIP_REASONS, runScan } from "../run-scan";

const FILLER =
  "We bake fresh bread every morning with simple flour, water and salt. Our small team opens the shop at seven and closes when the last loaf is sold.";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
/** Keyed by pathname, or by `<host> <pathname>` for one host only. */
const routes = new Map<string, Handler>();
const requested: string[] = [];
/** `<host><pathname>` of every request, to prove a host received nothing. */
const requestedHosts: string[] = [];
const sockets = new Set<Socket>();
let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];
    const host = (req.headers.host ?? "").split(":")[0];
    requested.push(pathname);
    requestedHosts.push(`${host}${pathname}`);
    const handler = routes.get(`${host} ${pathname}`) ?? routes.get(pathname);
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
  requestedHosts.length = 0;
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

function scan(
  overrides: {
    deadlineMs?: number;
    denylist?: string[];
    authorizeTargetDomain?: (domain: string) => Promise<boolean>;
  } = {},
) {
  return runScan({
    // Every domain allowed unless a test says otherwise: the charge is required.
    authorizeTargetDomain:
      overrides.authorizeTargetDomain ?? (async () => true),
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

  /**
   * Devin review of 0c5c5e4: a report the lens bounded to 40 findings was
   * stored with `truncated: false` (only the 12 KB trim set it), so it said
   * "41 possible typos", listed 40, and showed no limited-findings notice.
   */
  it("marks the report truncated when the lens kept only 40 of its findings", async () => {
    const words = [
      "recieve",
      "seperate",
      "definately",
      "occured",
      "wierd",
      "accomodate",
      "acheive",
      "adress",
      "beleive",
      "commited",
      "concious",
      "existance",
      "foriegn",
      "goverment",
      "grammer",
      "harrass",
      "independant",
      "knowlege",
      "liason",
      "millenium",
      "neccessary",
      "noticable",
      "occassion",
      "persistant",
      "posession",
      "prefered",
      "refered",
      "relevent",
      "religous",
      "rythm",
      "sieze",
      "suprise",
      "truely",
      "writting",
      "begining",
      "beautifull",
      "buisness",
      "collegue",
      "comming",
      "completly",
      "embarass",
    ];
    routes.set(
      "/",
      html(words.map((word) => `<p>${FILLER} We ${word} it.</p>`).join("")),
    );

    const result = await scan();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.summary.headline).toBe(
      "41 possible typos on 1 page of 1",
    );
    expect(result.report.findings).toHaveLength(40);
    expect(result.report.truncated).toBe(true);
  });

  it("leaves a report with every finding listed untruncated", async () => {
    routes.set("/", html(`<p>${FILLER} We recieve orders daily.</p>`));

    const result = await scan();

    expect(result.ok && result.report.truncated).toBe(false);
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

  /**
   * Verification review of b6ad9ff, N2. Only `text/plain` (or no type) was
   * read as robots.txt; any other type counted as "no robots.txt", so
   * `Disallow: /` served as application/octet-stream — S3's default for an
   * object uploaded without a type — was ignored and the site scanned. Every
   * 2xx body is now parsed as rules (RFC 9309), except an HTML answer: a
   * single-page app serving its shell for every path has no robots.txt.
   */
  describe("a robots.txt's content type", () => {
    function robots(body: string, type?: string): Handler {
      return (_req, res) => {
        res.writeHead(200, type ? { "content-type": type } : {});
        res.end(body);
      };
    }

    it.each([
      ["application/octet-stream", "application/octet-stream"],
      ["no content type at all", undefined],
      ["text/plain", "text/plain; charset=utf-8"],
    ])("obeys `Disallow: /` served as %s", async (_label, type) => {
      routes.set("/robots.txt", robots("User-agent: *\nDisallow: /", type));
      routes.set("/", html(`<p>${FILLER}</p>`));

      expect(await scan()).toEqual({ ok: false, reason: "robots_disallowed" });
      expect(requested).toEqual(["/robots.txt"]);
    });

    it.each([
      [
        "text/html",
        "text/html; charset=utf-8",
        "<!doctype html><html><body><p>App</p></body></html>",
      ],
      [
        "an HTML body sent as text/plain",
        "text/plain",
        // Rule-shaped lines inside the shell must not be read as rules.
        "\n  <!DOCTYPE html>\nUser-agent: *\nDisallow: /\n</html>",
      ],
      [
        "an HTML body with no doctype",
        "application/octet-stream",
        "<html>\nUser-agent: *\nDisallow: /\n</html>",
      ],
    ])(
      "reads a single-page app's HTML shell (%s) as no robots.txt",
      async (_label, type, body) => {
        routes.set("/robots.txt", robots(body, type));
        routes.set("/", html(`<p>${FILLER}</p>`));

        const result = await scan();

        expect(result.ok).toBe(true);
        expect(requested).toContain("/");
      },
    );
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

  /**
   * s96 review, minor 3: the per-target cap is charged on the FINAL host too,
   * so a host that redirects to a victim cannot spend the victim's hourly
   * scans from its own bucket. Checked right after the homepage, before any
   * sitemap or page request.
   */
  /**
   * s96 review round 2, minor 3. The per-target cap was charged once, for the
   * homepage's FINAL domain, after it had been fetched: robots.txt, sitemap and
   * page fetches, and every intermediate redirect hop, reached other domains
   * uncharged. Now every hop of every fetch charges a registrable domain the
   * scan has not charged yet, BEFORE its first request there (its robots.txt
   * included), and once per scan.
   */
  describe("the per-target cap on every hop", () => {
    function redirect(location: string, status = 302): Handler {
      return (_req, res) => {
        res.writeHead(status, { location });
        res.end();
      };
    }
    function charger(verdict: (domain: string) => boolean) {
      const charged: string[] = [];
      const authorizeTargetDomain = async (domain: string) => {
        charged.push(domain);
        return verdict(domain);
      };
      return { charged, authorizeTargetDomain };
    }
    const victimRequests = () =>
      requestedHosts.filter((entry) => entry.includes("victim.test"));

    it("refuses a homepage redirect to a limited domain before the victim gets one request", async () => {
      routes.set("/", redirect(`http://www.victim.test:${port}/home`));
      routes.set("/home", html(`<p>${FILLER}</p>`));
      const { charged, authorizeTargetDomain } = charger(() => false);

      const result = await scan({ authorizeTargetDomain });

      expect(result).toEqual({ ok: false, reason: "target_limited" });
      expect(charged).toEqual(["victim.test"]);
      expect(victimRequests()).toEqual([]);
      expect(requested).not.toContain("/sitemap.xml");
    });

    it("lets the scan go on when the new domain's bucket allows it", async () => {
      routes.set("/", redirect(`http://elsewhere.test:${port}/home`));
      routes.set("/home", html(`<p>${FILLER}</p>`));
      const { charged, authorizeTargetDomain } = charger(() => true);

      const result = await scan({ authorizeTargetDomain });

      expect(result.ok).toBe(true);
      expect(charged).toEqual(["elsewhere.test"]);
    });

    it("does not charge the submitted domain again (www.)", async () => {
      routes.set("/", redirect(`http://www.bakery.test:${port}/home`, 301));
      routes.set("/home", html(`<p>${FILLER}</p>`));
      const { charged, authorizeTargetDomain } = charger(() => true);

      const result = await scan({ authorizeTargetDomain });

      expect(result.ok).toBe(true);
      expect(charged).toEqual([]);
    });

    /**
     * Verification review of e7bdd09, F1 (major). A refused charge on the
     * robots.txt chain was read as "no robots.txt", so a site whose
     * robots.txt redirects to a spent domain was scanned as if it allowed
     * everything — its owner's opt-out bypassed by spending someone else's
     * bucket. RFC 9309 §2.3.1.2 says a robots.txt reached within five
     * redirects MUST be followed; ADR 062 §5 allows only a 4xx. A refused
     * charge is now an unreachable robots.txt: the scan is refused.
     */
    it("refuses the scan when its robots.txt redirects to a limited domain; the homepage is never fetched", async () => {
      routes.set(
        "bakery.test /robots.txt",
        redirect(`http://victim.test:${port}/robots.txt`, 301),
      );
      routes.set("/", html(`<p>${FILLER}</p>`));
      const { charged, authorizeTargetDomain } = charger(() => false);

      const result = await scan({ authorizeTargetDomain });

      expect(result).toEqual({ ok: false, reason: "target_limited" });
      expect(charged).toEqual(["victim.test"]);
      expect(requestedHosts).toEqual(["bakery.test/robots.txt"]);
    });

    describe("S's robots.txt redirects to T, whose robots.txt says Disallow: /", () => {
      beforeEach(() => {
        routes.set(
          "bakery.test /robots.txt",
          redirect(`http://victim.test:${port}/robots.txt`, 301),
        );
        routes.set(
          "victim.test /robots.txt",
          text("User-agent: *\nDisallow: /"),
        );
        routes.set("/", html(`<p>${FILLER}</p>`));
      });

      it("is obeyed when T's bucket allows the charge: S is not scanned", async () => {
        const { charged, authorizeTargetDomain } = charger(() => true);

        const result = await scan({ authorizeTargetDomain });

        expect(result).toEqual({ ok: false, reason: "robots_disallowed" });
        expect(charged).toEqual(["victim.test"]);
        expect(requestedHosts).toEqual([
          "bakery.test/robots.txt",
          "victim.test/robots.txt",
        ]);
      });

      it("refuses the scan when T's bucket is spent: S's homepage is never fetched, T gets nothing", async () => {
        const { charged, authorizeTargetDomain } = charger(() => false);

        const result = await scan({ authorizeTargetDomain });

        expect(result).toEqual({ ok: false, reason: "target_limited" });
        expect(charged).toEqual(["victim.test"]);
        expect(requestedHosts).toEqual(["bakery.test/robots.txt"]);
      });
    });

    it("skips a page whose host's robots.txt redirects to a limited domain", async () => {
      routes.set(
        "/",
        html(`<p>${FILLER}</p><a href="/one">one</a><a href="/menu">menu</a>`),
      );
      routes.set("bakery.test /one", redirect(`http://other.test:${port}/a`));
      routes.set(
        "other.test /robots.txt",
        redirect(`http://victim.test:${port}/robots.txt`, 301),
      );
      routes.set("other.test /a", html(`<p>${FILLER}</p>`));
      routes.set("/menu", html(`<p>${FILLER}</p>`));
      const { charged, authorizeTargetDomain } = charger(
        (domain) => domain !== "victim.test",
      );

      const result = await scan({ authorizeTargetDomain });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const byUrl = Object.fromEntries(
          result.report.pages.map((page) => [
            new URL(page.url).pathname,
            page.status,
          ]),
        );
        expect(byUrl).toEqual({
          "/": "checked",
          "/menu": "checked",
          "/one": "skipped",
        });
      }
      expect(charged).toEqual(["other.test", "victim.test"]);
      expect(requestedHosts).not.toContain("other.test/a");
      expect(victimRequests()).toEqual([]);
    });

    it("falls back to the homepage's links when the sitemap redirects to a limited domain", async () => {
      routes.set("/", html(`<p>${FILLER}</p><a href="/menu">menu</a>`));
      routes.set(
        "bakery.test /sitemap.xml",
        redirect(`http://victim.test:${port}/sitemap.xml`),
      );
      routes.set("/menu", html(`<p>${FILLER}</p>`));
      const { charged, authorizeTargetDomain } = charger(() => false);

      const result = await scan({ authorizeTargetDomain });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.report.pages.map((page) => page.status)).toEqual([
          "checked",
          "checked",
        ]);
      }
      expect(charged).toEqual(["victim.test"]);
      expect(victimRequests()).toEqual([]);
    });

    it("skips pages that redirect to a limited domain, charging it once for all of them", async () => {
      routes.set(
        "/",
        html(
          `<p>${FILLER}</p><a href="/one">one</a><a href="/two">two</a><a href="/menu">menu</a>`,
        ),
      );
      routes.set("bakery.test /one", redirect(`http://victim.test:${port}/a`));
      routes.set(
        "bakery.test /two",
        redirect(`http://www.victim.test:${port}/b`),
      );
      routes.set("/menu", html(`<p>${FILLER}</p>`));
      const { charged, authorizeTargetDomain } = charger(() => false);

      const result = await scan({ authorizeTargetDomain });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const byUrl = Object.fromEntries(
          result.report.pages.map((page) => [
            new URL(page.url).pathname,
            page.status,
          ]),
        );
        expect(byUrl).toEqual({
          "/": "checked",
          "/menu": "checked",
          "/one": "skipped",
          "/two": "skipped",
        });
      }
      expect(charged).toEqual(["victim.test"]);
      expect(victimRequests()).toEqual([]);
    });

    it("charges each domain of a 3-hop chain (A → v1 → v2 → A) exactly once", async () => {
      routes.set("bakery.test /", redirect(`http://v1.test:${port}/hop`));
      routes.set("v1.test /hop", redirect(`http://v2.test:${port}/hop`));
      routes.set("v2.test /hop", redirect(`http://bakery.test:${port}/home`));
      routes.set(
        "bakery.test /home",
        html(`<p>${FILLER}</p><a href="/menu">menu</a>`),
      );
      routes.set("bakery.test /menu", redirect(`http://v1.test:${port}/hop`));
      const { charged, authorizeTargetDomain } = charger(() => true);

      const result = await scan({ authorizeTargetDomain });

      expect(result.ok).toBe(true);
      expect(charged).toEqual(["v1.test", "v2.test"]);
    });

    it("sends nothing to the second domain of a chain when its bucket is spent", async () => {
      routes.set("bakery.test /", redirect(`http://v1.test:${port}/hop`));
      routes.set("v1.test /hop", redirect(`http://victim.test:${port}/hop`));
      routes.set(
        "victim.test /hop",
        redirect(`http://bakery.test:${port}/home`),
      );
      routes.set("bakery.test /home", html(`<p>${FILLER}</p>`));
      const { charged, authorizeTargetDomain } = charger(
        (domain) => domain !== "victim.test",
      );

      const result = await scan({ authorizeTargetDomain });

      expect(result).toEqual({ ok: false, reason: "target_limited" });
      expect(charged).toEqual(["v1.test", "victim.test"]);
      expect(victimRequests()).toEqual([]);
    });
  });

  /**
   * s96 review, major 1: a decompression bomb anywhere in a scan used to keep
   * `runScan` pending past its deadline (> 25 s with deadlineMs 3000). Every
   * one now resolves inside deadlineMs plus a small margin.
   */
  describe("decompression bombs (200 MB decoded each)", () => {
    const DEADLINE_MS = 3_000;
    const MARGIN_MS = 1_500;

    function bomb(type: string): Handler {
      return (_req, res) => {
        void compressedBomb("gzip").then((body) => {
          res.writeHead(200, {
            "content-type": type,
            "content-encoding": "gzip",
          });
          res.end(body);
        });
      };
    }

    async function timedScan() {
      const started = Date.now();
      const result = await scan({ deadlineMs: DEADLINE_MS });
      return { result, elapsed: Date.now() - started };
    }

    beforeAll(async () => {
      await compressedBomb("gzip");
    }, 30_000);

    it("a bombed robots.txt refuses the scan as too_large, in time", async () => {
      routes.set("/robots.txt", bomb("text/plain"));
      routes.set("/", html(`<p>${FILLER}</p>`));

      const { result, elapsed } = await timedScan();

      expect(result).toEqual({ ok: false, reason: "too_large" });
      expect(elapsed).toBeLessThan(DEADLINE_MS + MARGIN_MS);
    });

    it("a bombed homepage fails the scan as too_large, in time", async () => {
      routes.set("/", bomb("text/html"));

      const { result, elapsed } = await timedScan();

      expect(result).toEqual({ ok: false, reason: "too_large" });
      expect(elapsed).toBeLessThan(DEADLINE_MS + MARGIN_MS);
    });

    it("a bombed sitemap falls back to the homepage's links, in time", async () => {
      routes.set("/", html(`<p>${FILLER}</p><a href="/menu">menu</a>`));
      routes.set("/sitemap.xml", bomb("application/xml"));
      routes.set("/menu", html(`<p>${FILLER}</p>`));

      const { result, elapsed } = await timedScan();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.report.pages.map((page) => page.status)).toEqual([
          "checked",
          "checked",
        ]);
      }
      expect(elapsed).toBeLessThan(DEADLINE_MS + MARGIN_MS);
    });

    it("a bombed sitemap page is skipped as too large, in time", async () => {
      const origin = `http://bakery.test:${port}`;
      routes.set("/", html(`<p>${FILLER}</p>`));
      routes.set(
        "/sitemap.xml",
        text(
          `<urlset><url><loc>${origin}/bomb</loc></url><url><loc>${origin}/menu</loc></url></urlset>`,
          "application/xml",
        ),
      );
      routes.set("/bomb", bomb("text/html"));
      routes.set("/menu", html(`<p>${FILLER}</p>`));

      const { result, elapsed } = await timedScan();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.report.pages).toEqual([
          { url: `${origin}/`, status: "checked" },
          {
            url: `${origin}/bomb`,
            status: "skipped",
            reason: PAGE_SKIP_REASONS.tooLarge,
          },
          { url: `${origin}/menu`, status: "checked" },
        ]);
      }
      expect(elapsed).toBeLessThan(DEADLINE_MS + MARGIN_MS);
    });
  });
});
