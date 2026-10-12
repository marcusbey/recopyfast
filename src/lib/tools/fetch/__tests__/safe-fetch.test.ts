/**
 * @jest-environment node
 */

/**
 * s96 — the free-tools fetcher, against REAL sockets.
 *
 * A public, anonymous "fetch any URL" endpoint is an SSRF primitive unless the
 * guard holds on every connection, so these tests do not mock `http`: a real
 * server listens on 127.0.0.1, counts the connections it accepts and records
 * the address each one came from. A refusal is only proven when that count
 * says no socket ever opened.
 *
 * The production defaults refuse 127.0.0.1 and every port but 80/443. To reach
 * the fixture at all, most tests inject a policy that allows exactly the
 * fixture's address and port, and a resolver that maps `*.test` names to
 * chosen answers. Production code reads no environment variable that could do
 * the same (plan decision 4): the injection is a parameter, nothing else.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer as createNetServer } from "node:net";
import http, { type IncomingHttpHeaders } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { buildSync } from "esbuild";

import {
  createRequestBudget,
  DEFAULT_TIMEOUT_MS,
  MAX_BODY_BYTES,
  MAX_REQUESTS_PER_SCAN,
  safeFetch,
  SCANNER_USER_AGENT,
  type FetchPolicy,
  type SafeFetchOptions,
} from "../safe-fetch";
import {
  BOMB_DECODED_BYTES,
  compressedBomb,
  nestedEmptyMemberBomb,
  contentEncodingOf,
  type BombEncoding,
} from "./bombs";
import {
  createValidatingLookup,
  PUBLIC_ADDRESS_RULE,
  type ResolvedAddress,
  type Resolver,
} from "../validating-lookup";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

interface Fixture {
  port: number;
  connections: string[];
  requests: { path: string; headers: IncomingHttpHeaders }[];
  route(path: string, handler: Handler): void;
  url(pathname: string, host?: string): string;
}

const routes = new Map<string, Handler>();
const openSockets = new Set<Socket>();
let server: http.Server;
let fixture: Fixture;

beforeAll(async () => {
  const connections: string[] = [];
  const requests: Fixture["requests"] = [];
  server = http.createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0];
    requests.push({ path: pathname, headers: req.headers });
    const handler = routes.get(pathname);
    if (handler) {
      handler(req, res);
      return;
    }
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<p>missing</p>");
  });
  server.on("connection", (socket) => {
    connections.push(socket.remoteAddress ?? "?");
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  fixture = {
    port,
    connections,
    requests,
    route: (pathname, handler) => routes.set(pathname, handler),
    url: (pathname, host = "fixture.test") =>
      `http://${host}:${port}${pathname}`,
  };
});

afterEach(() => {
  routes.clear();
  fixture.connections.length = 0;
  fixture.requests.length = 0;
  for (const socket of openSockets) socket.destroy();
});

afterAll(async () => {
  for (const socket of openSockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** `*.test` names answer what the table says; anything else fails to resolve. */
function tableResolver(
  table: Record<string, string[]>,
  calls: string[] = [],
): Resolver {
  return async (hostname) => {
    calls.push(hostname);
    const answers = table[hostname];
    if (!answers)
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return answers.map(
      (address): ResolvedAddress => ({
        address,
        family: address.includes(":") ? 6 : 4,
      }),
    );
  };
}

/** Allows the fixture's address and port and nothing else. */
function fixturePolicy(): FetchPolicy {
  return {
    isAllowedAddress: (address) => address === "127.0.0.1",
    isAllowedPort: (_protocol, port) =>
      port === "" || port === String(fixture.port),
  };
}

function options(overrides: Partial<SafeFetchOptions> = {}): SafeFetchOptions {
  return {
    kind: "html",
    policy: fixturePolicy(),
    resolver: tableResolver({ "fixture.test": ["127.0.0.1"] }),
    budget: createRequestBudget(MAX_REQUESTS_PER_SCAN),
    ...overrides,
  };
}

function html(body: string, headers: http.OutgoingHttpHeaders = {}): Handler {
  return (_req, res) => {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      ...headers,
    });
    res.end(body);
  };
}

function redirect(location: string, status = 302): Handler {
  return (_req, res) => {
    res.writeHead(status, { location });
    res.end();
  };
}

describe("IP-literal hosts are classified before any socket opens", () => {
  const literalPolicy = (): FetchPolicy => ({
    isAllowedAddress: PUBLIC_ADDRESS_RULE,
    isAllowedPort: (_protocol, port) => port === String(fixture.port),
  });

  it.each([
    ["127.0.0.1", "127.0.0.1"],
    ["[::1]", "::1"],
    ["2130706433", "127.0.0.1"],
    ["0x7f.1", "127.0.0.1"],
    ["[::ffff:7f00:1]", "::ffff:7f00:1"],
  ])(
    "http://%s:<port>/ is refused with zero connections",
    async (host, address) => {
      fixture.route("/", html("<p>should never be served</p>"));

      const result = await safeFetch(
        `http://${host}:${fixture.port}/`,
        options({ policy: literalPolicy() }),
      );

      expect(result).toEqual({
        ok: false,
        reason: "blocked_address",
        bytesRead: 0,
      });
      expect(fixture.connections).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(address);
    },
  );

  it("a redirect to the instance-metadata address is refused before connecting", async () => {
    fixture.route("/", redirect("http://169.254.169.254/latest/meta-data/"));

    const result = await safeFetch(fixture.url("/"), options());

    expect(result).toMatchObject({ ok: false, reason: "blocked_address" });
    expect(fixture.connections).toEqual(["127.0.0.1"]);
    expect(JSON.stringify(result)).not.toContain("169.254");
  });
});

describe("hostnames connect only to the addresses their own lookup validated", () => {
  it("the production address rule refuses the loopback fixture, with zero connections", async () => {
    fixture.route("/", html("<p>x</p>"));

    const result = await safeFetch(
      fixture.url("/"),
      options({
        policy: {
          isAllowedAddress: PUBLIC_ADDRESS_RULE,
          isAllowedPort: fixturePolicy().isAllowedPort,
        },
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "blocked_address" });
    expect(fixture.connections).toEqual([]);
  });

  it("refuses a host when ANY of its addresses is refused", async () => {
    const result = await safeFetch(
      fixture.url("/"),
      options({
        resolver: tableResolver({ "fixture.test": ["127.0.0.1", "10.0.0.1"] }),
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "blocked_address" });
    expect(fixture.connections).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/127\.0\.0\.1|10\.0\.0\.1/);
  });

  it("DNS rebinding: every connection reaches only its own validated answer", async () => {
    fixture.route("/", html("<p>first</p>"));
    let call = 0;
    const rebinding: Resolver = async () => {
      call += 1;
      return [
        call % 2 === 1
          ? { address: "127.0.0.1", family: 4 }
          : { address: "127.0.0.2", family: 4 },
      ];
    };

    const first = await safeFetch(
      fixture.url("/"),
      options({ resolver: rebinding }),
    );
    const second = await safeFetch(
      fixture.url("/"),
      options({ resolver: rebinding }),
    );

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, reason: "blocked_address" });
    expect(fixture.connections).toEqual(["127.0.0.1"]);
  });

  it("a later redirect hop that rebinds is refused on its own answer", async () => {
    fixture.route("/start", redirect(fixture.url("/next")));
    fixture.route("/next", html("<p>never</p>"));
    let call = 0;
    const rebinding: Resolver = async () => {
      call += 1;
      return [{ address: call === 1 ? "127.0.0.1" : "10.9.9.9", family: 4 }];
    };

    const result = await safeFetch(
      fixture.url("/start"),
      options({ resolver: rebinding }),
    );

    expect(result).toMatchObject({ ok: false, reason: "blocked_address" });
    expect(fixture.requests.map((request) => request.path)).toEqual(["/start"]);
  });

  it("a name that does not resolve is `dns`", async () => {
    const result = await safeFetch(fixture.url("/", "missing.test"), options());

    expect(result).toMatchObject({ ok: false, reason: "dns" });
  });
});

describe("createValidatingLookup", () => {
  const resolver = tableResolver({ "ok.test": ["127.0.0.1", "::1"] });
  const allowLoopback = (address: string) =>
    address === "127.0.0.1" || address === "::1";

  it("answers the array form Node uses with autoSelectFamily", (done) => {
    createValidatingLookup(allowLoopback, resolver)(
      "ok.test",
      { all: true },
      (error, addresses) => {
        expect(error).toBeNull();
        expect(addresses).toEqual([
          { address: "127.0.0.1", family: 4 },
          { address: "::1", family: 6 },
        ]);
        done();
      },
    );
  });

  it("answers the single-address form, honouring a requested family", (done) => {
    createValidatingLookup(allowLoopback, resolver)(
      "ok.test",
      { family: 6 },
      (error, address, family) => {
        expect(error).toBeNull();
        expect(address).toBe("::1");
        expect(family).toBe(6);
        done();
      },
    );
  });

  it("refuses with an error that names no address", (done) => {
    createValidatingLookup(PUBLIC_ADDRESS_RULE, resolver)(
      "ok.test",
      { all: true },
      (error) => {
        expect(error?.code).toBe("ERR_RCF_BLOCKED_ADDRESS");
        expect(error?.message).not.toMatch(/127|::1/);
        done();
      },
    );
  });
});

describe("redirects", () => {
  it("follows three hops, resolving a relative Location", async () => {
    fixture.route("/a", redirect("/b", 301));
    fixture.route("/b", redirect(fixture.url("/c"), 307));
    fixture.route("/c", redirect("d", 308));
    fixture.route("/d", html("<p>arrived</p>"));

    const result = await safeFetch(fixture.url("/a"), options());

    expect(result.ok && result.value.url).toBe(fixture.url("/d"));
    expect(result.ok && result.value.body).toBe("<p>arrived</p>");
  });

  it("refuses a fourth hop with `redirect_limit`", async () => {
    fixture.route("/a", redirect("/b"));
    fixture.route("/b", redirect("/c"));
    fixture.route("/c", redirect("/d"));
    fixture.route("/d", redirect("/e"));
    fixture.route("/e", html("<p>too far</p>"));

    const result = await safeFetch(fixture.url("/a"), options());

    expect(result).toMatchObject({ ok: false, reason: "redirect_limit" });
    expect(fixture.requests.map((request) => request.path)).not.toContain("/e");
  });

  it.each([
    ["file:///etc/passwd", "redirect_invalid"],
    ["javascript:alert(1)", "redirect_invalid"],
    ["http://fixture.test:8080/", "blocked_port"],
    ["http://private.test/", "blocked_address"],
    ["http://www.denied.test/", "denylisted"],
  ])("refuses a redirect to %s with `%s`", async (location, reason) => {
    fixture.route("/", redirect(location));

    const result = await safeFetch(
      fixture.url("/"),
      options({
        resolver: tableResolver({
          "fixture.test": ["127.0.0.1"],
          "private.test": ["10.0.0.7"],
          "www.denied.test": ["127.0.0.1"],
        }),
        isDenylistedHost: (hostname) => hostname.endsWith("denied.test"),
      }),
    );

    expect(result).toMatchObject({ ok: false, reason });
    expect(fixture.connections).toHaveLength(1);
  });

  it("re-asks the URL authoriser (robots.txt, in production) on every hop", async () => {
    fixture.route("/", redirect("/private"));
    const seen: string[] = [];

    const result = await safeFetch(
      fixture.url("/"),
      options({
        authorizeUrl: async (url) => {
          seen.push(url.href);
          return url.href.endsWith("/private") ? "robots_disallowed" : null;
        },
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "robots_disallowed" });
    expect(seen).toEqual([fixture.url("/"), fixture.url("/private")]);
    expect(fixture.requests.map((request) => request.path)).toEqual(["/"]);
  });
});

describe("time", () => {
  it("a server that never answers is `timeout`", async () => {
    fixture.route("/hang", () => undefined);

    const started = Date.now();
    const result = await safeFetch(
      fixture.url("/hang"),
      options({ timeoutMs: 200 }),
    );

    expect(result).toMatchObject({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("a server that trickles its body is `timeout`, not an endless read", async () => {
    fixture.route("/trickle", (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      const timer = setInterval(() => res.write("a"), 20);
      res.on("close", () => clearInterval(timer));
    });

    const result = await safeFetch(
      fixture.url("/trickle"),
      options({ timeoutMs: 200 }),
    );

    expect(result).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("never waits past the scan deadline, even inside the per-request budget", async () => {
    fixture.route("/hang", () => undefined);

    const result = await safeFetch(
      fixture.url("/hang"),
      options({ deadline: Date.now() + 150 }),
    );

    expect(result).toMatchObject({ ok: false, reason: "timeout" });
  });

  it("defaults to 8 s per request", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(8_000);
  });
});

describe("size: the 2 MB cap counts decompressed bytes", () => {
  it("a declared 3 MB Content-Length is refused before any body is read", async () => {
    fixture.route("/big", (_req, res) => {
      res.writeHead(200, {
        "content-type": "text/html",
        "content-length": String(3 * 1024 * 1024),
      });
      res.write("x".repeat(1024));
    });

    const result = await safeFetch(fixture.url("/big"), options());

    expect(result).toEqual({ ok: false, reason: "too_large", bytesRead: 0 });
  });

  it("a streamed 2 MB + 1 byte is refused", async () => {
    fixture.route("/stream", (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(Buffer.alloc(MAX_BODY_BYTES + 1, 0x61));
    });

    const result = await safeFetch(fixture.url("/stream"), options());

    expect(result).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("exactly 2 MB is accepted", async () => {
    fixture.route("/edge", html("a".repeat(MAX_BODY_BYTES)));

    const result = await safeFetch(fixture.url("/edge"), options());

    expect(result.ok && result.value.body.length).toBe(MAX_BODY_BYTES);
  });

  it("a gzip bomb (≈30 KB → 20 MB) stops at the cap, counting decompressed bytes", async () => {
    const bomb = zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x20), {
      level: 9,
    });
    expect(bomb.length).toBeLessThan(40 * 1024);
    fixture.route("/bomb", (_req, res) => {
      res.writeHead(200, {
        "content-type": "text/html",
        "content-encoding": "gzip",
      });
      res.end(bomb);
    });

    const result = await safeFetch(fixture.url("/bomb"), options());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("too_large");
    expect(result.bytesRead).toBeGreaterThan(MAX_BODY_BYTES);
    expect(result.bytesRead).toBeLessThanOrEqual(MAX_BODY_BYTES + 64 * 1024);
  });

  /**
   * s96 review, major 1. A ~200 KB body inflating to 200 MB used to hang
   * safeFetch past every timeout: the decoded-byte counter tripped after the
   * response had completed, `pipeline`'s callback never fired, and the abort
   * signal could not help because the socket was already closed. Each bomb
   * must now resolve `too_large` well inside the deadline.
   */
  it.each(["gzip", "deflate", "deflate-raw", "br"] as BombEncoding[])(
    "a %s bomb (200 MB decoded) resolves too_large inside the deadline",
    async (encoding) => {
      const bomb = await compressedBomb(encoding);
      expect(bomb.length).toBeLessThan(BOMB_DECODED_BYTES / 200);
      fixture.route("/big-bomb", (_req, res) => {
        res.writeHead(200, {
          "content-type": "text/html",
          "content-encoding": contentEncodingOf(encoding),
        });
        res.end(bomb);
      });
      const deadlineMs = 4_000;

      const started = Date.now();
      const result = await safeFetch(
        fixture.url("/big-bomb"),
        options({ deadline: Date.now() + deadlineMs }),
      );
      const elapsed = Date.now() - started;

      expect(result).toMatchObject({ ok: false, reason: "too_large" });
      expect(elapsed).toBeLessThan(deadlineMs);
      if (!result.ok) {
        expect(result.bytesRead).toBeLessThanOrEqual(
          MAX_BODY_BYTES + 256 * 1024,
        );
      }
    },
    30_000,
  );

  /**
   * s96 review round 2, minor 4. Counting only after the LAST decoder let a
   * gzip-file sitemap under `Content-Encoding: gzip` inflate its outer layer
   * without limit: the inner file is empty gzip members that decode to
   * nothing, so the one counter saw 0 bytes (0.86 GB intermediate, measured
   * by the review). Every decoder's output is now counted and capped.
   */
  it("a nested empty-member gzip bomb (.xml.gz under Content-Encoding: gzip) resolves too_large", async () => {
    const bomb = await nestedEmptyMemberBomb();
    expect(bomb.length).toBeLessThan(BOMB_DECODED_BYTES / 200);
    fixture.route("/sitemap.xml.gz", (_req, res) => {
      res.writeHead(200, {
        "content-type": "application/gzip",
        "content-encoding": "gzip",
      });
      res.end(bomb);
    });
    const deadlineMs = 4_000;

    const started = Date.now();
    const result = await safeFetch(
      fixture.url("/sitemap.xml.gz"),
      options({ kind: "sitemap", deadline: Date.now() + deadlineMs }),
    );
    const elapsed = Date.now() - started;

    expect(result).toMatchObject({ ok: false, reason: "too_large" });
    expect(elapsed).toBeLessThan(deadlineMs);
  }, 30_000);

  it("an endless compressed body is refused and its connection closed", async () => {
    let closed!: () => void;
    const serverSawClose = new Promise<void>((resolve) => (closed = resolve));
    fixture.route("/endless", (_req, res) => {
      res.writeHead(200, {
        "content-type": "text/html",
        "content-encoding": "gzip",
      });
      const gzip = zlib.createGzip();
      gzip.pipe(res);
      const zeros = Buffer.alloc(64 * 1024, 0x20);
      const timer = setInterval(() => gzip.write(zeros), 1);
      res.on("close", () => {
        clearInterval(timer);
        gzip.destroy();
        closed();
      });
    });

    const result = await safeFetch(
      fixture.url("/endless"),
      options({ deadline: Date.now() + 4_000 }),
    );

    expect(result).toMatchObject({ ok: false, reason: "too_large" });
    await expect(
      Promise.race([
        serverSawClose.then(() => "closed"),
        new Promise((resolve) => setTimeout(() => resolve("open"), 1_000)),
      ]),
    ).resolves.toBe("closed");
  });

  it.each([
    ["br", (body: Buffer) => zlib.brotliCompressSync(body)],
    ["deflate", (body: Buffer) => zlib.deflateSync(body)],
    ["deflate", (body: Buffer) => zlib.deflateRawSync(body)],
    ["gzip", (body: Buffer) => zlib.gzipSync(body)],
  ])("decodes %s", async (encoding, encode) => {
    fixture.route("/enc", (_req, res) => {
      res.writeHead(200, {
        "content-type": "text/html",
        "content-encoding": encoding,
      });
      res.end(encode(Buffer.from("<p>decoded</p>")));
    });

    const result = await safeFetch(fixture.url("/enc"), options());

    expect(result.ok && result.value.body).toBe("<p>decoded</p>");
  });

  /**
   * s96 review round 2, nit 5. `deflate` is zlib-wrapped or raw, told apart by
   * the first byte. A first chunk of ONE byte used to fail the two-byte header
   * check and pick raw inflate for a zlib body. The choice is now made from
   * the first byte alone (CM = 8, CINFO ≤ 7), so it cannot depend on chunking.
   */
  it.each([
    ["zlib-wrapped", (body: Buffer) => zlib.deflateSync(body)],
    ["raw", (body: Buffer) => zlib.deflateRawSync(body)],
  ])(
    "decodes %s deflate whose first chunk is one byte",
    async (_label, encode) => {
      const encoded = encode(Buffer.from("<p>decoded</p>"));
      fixture.route("/one-byte", (_req, res) => {
        res.writeHead(200, {
          "content-type": "text/html",
          "content-encoding": "deflate",
        });
        res.write(encoded.subarray(0, 1));
        setTimeout(() => res.end(encoded.subarray(1)), 50);
      });

      const result = await safeFetch(fixture.url("/one-byte"), options());

      expect(result.ok && result.value.body).toBe("<p>decoded</p>");
    },
  );

  /**
   * s96 review round 2, nit 6. An empty 200 with a Content-Encoding used to
   * be `unreachable`: the decoder called zero bytes a truncated stream. An
   * empty body has nothing to decode.
   */
  it.each(["gzip", "deflate", "br"])(
    "reads an empty body sent with Content-Encoding %s as empty",
    async (encoding) => {
      fixture.route("/empty", (_req, res) => {
        res.writeHead(200, {
          "content-type": "text/html",
          "content-encoding": encoding,
        });
        res.end();
      });

      const result = await safeFetch(fixture.url("/empty"), options());

      expect(result).toMatchObject({ ok: true, value: { body: "" } });
    },
  );

  it("decodes a gzipped sitemap under the same cap", async () => {
    const xml = "<urlset><url><loc>https://example.com/a</loc></url></urlset>";
    fixture.route("/sitemap.xml.gz", (_req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(zlib.gzipSync(Buffer.from(xml)));
    });
    fixture.route("/sitemap-typed", (_req, res) => {
      res.writeHead(200, { "content-type": "application/gzip" });
      res.end(zlib.gzipSync(Buffer.from(xml)));
    });

    const byName = await safeFetch(
      fixture.url("/sitemap.xml.gz"),
      options({ kind: "sitemap" }),
    );
    const byType = await safeFetch(
      fixture.url("/sitemap-typed"),
      options({ kind: "sitemap" }),
    );

    expect(byName.ok && byName.value.body).toBe(xml);
    expect(byType.ok && byType.value.body).toBe(xml);
  });
});

describe("content types and statuses", () => {
  it.each([
    ["application/json", '{"a":1}'],
    [undefined, "<p>x</p>"],
    ["application/xml", "<x/>"],
  ])("an HTML fetch of %s is `not_html`", async (type, body) => {
    fixture.route("/t", (_req, res) => {
      res.writeHead(200, type ? { "content-type": type } : {});
      res.end(body);
    });

    const result = await safeFetch(fixture.url("/t"), options());

    expect(result).toMatchObject({ ok: false, reason: "not_html" });
  });

  it("accepts XHTML", async () => {
    fixture.route(
      "/x",
      html("<p>x</p>", { "content-type": "application/xhtml+xml" }),
    );

    expect((await safeFetch(fixture.url("/x"), options())).ok).toBe(true);
  });

  it("a sitemap fetch accepts XML and plain text", async () => {
    fixture.route("/s.xml", html("<urlset/>", { "content-type": "text/xml" }));
    fixture.route(
      "/s.txt",
      html("https://e.test/a", { "content-type": "text/plain" }),
    );

    expect(
      (await safeFetch(fixture.url("/s.xml"), options({ kind: "sitemap" }))).ok,
    ).toBe(true);
    expect(
      (await safeFetch(fixture.url("/s.txt"), options({ kind: "sitemap" }))).ok,
    ).toBe(true);
  });

  it("a 404 is `http_status`", async () => {
    const result = await safeFetch(fixture.url("/nowhere"), options());

    expect(result).toMatchObject({
      ok: false,
      reason: "http_status",
      status: 404,
    });
  });
});

describe("charset", () => {
  it("decodes iso-8859-1 (WHATWG: windows-1252), curly quotes included", async () => {
    fixture.route("/latin", (_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=iso-8859-1" });
      res.end(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x78, 0x94]));
    });

    const result = await safeFetch(fixture.url("/latin"), options());

    expect(result.ok && result.value.body).toBe("café “x”");
  });

  it("falls back to <meta charset> in the first kilobyte", async () => {
    fixture.route("/meta", (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        Buffer.concat([
          Buffer.from('<meta charset="windows-1252"><p>'),
          Buffer.from([0x63, 0x61, 0x66, 0xe9]),
        ]),
      );
    });

    const result = await safeFetch(fixture.url("/meta"), options());

    expect(result.ok && result.value.body).toContain("café");
  });

  it("an unknown label decodes as UTF-8 rather than throwing", async () => {
    fixture.route(
      "/odd",
      html("<p>naïve</p>", { "content-type": "text/html; charset=x-made-up" }),
    );

    const result = await safeFetch(fixture.url("/odd"), options());

    expect(result.ok && result.value.body).toBe("<p>naïve</p>");
  });
});

describe("what we send and what we keep", () => {
  it("sends the honest user agent, no cookie and no referer", async () => {
    fixture.route("/", html("<p>x</p>"));

    await safeFetch(fixture.url("/"), options());

    const [{ headers }] = fixture.requests;
    expect(headers["user-agent"]).toBe(
      "RecopyFastToolsBot/1.0 (+https://www.recopyfa.st/tools)",
    );
    expect(SCANNER_USER_AGENT).toBe(headers["user-agent"]);
    expect(headers.accept).toBe("text/html,application/xhtml+xml");
    expect(headers["accept-encoding"]).toBe("gzip, deflate, br");
    expect(headers.cookie).toBeUndefined();
    expect(headers.referer).toBeUndefined();
  });

  it("keeps only allowlisted response headers, each capped at 4 KB", async () => {
    fixture.route(
      "/",
      html("<p>x</p>", {
        "content-security-policy": `default-src 'self'; ${"a".repeat(5_000)}`,
        "x-powered-by": "Next.js",
        "set-cookie": "session=secret",
        "x-private": "nope",
      }),
    );

    const result = await safeFetch(fixture.url("/"), options());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.headers).sort()).toEqual([
      "content-security-policy",
      "x-powered-by",
    ]);
    expect(result.value.headers["content-security-policy"]).toHaveLength(4_096);
  });

  it("spends one request per hop, and refuses once the scan's budget is gone", async () => {
    fixture.route("/a", redirect("/b"));
    fixture.route("/b", html("<p>b</p>"));
    const budget = createRequestBudget(3);

    const first = await safeFetch(fixture.url("/a"), options({ budget }));
    const second = await safeFetch(fixture.url("/b"), options({ budget }));
    const third = await safeFetch(fixture.url("/b"), options({ budget }));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(third).toMatchObject({ ok: false, reason: "request_limit" });
    expect(fixture.requests).toHaveLength(3);
    expect(MAX_REQUESTS_PER_SCAN).toBe(24);
  });
});

describe("an environment proxy never applies", () => {
  /**
   * Node 24 routes the DEFAULT agent through HTTP(S)_PROXY when the process
   * starts with NODE_USE_ENV_PROXY=1. Through a proxy, the validating lookup
   * never runs — the proxy resolves the name. `agent: false` is what keeps the
   * scanner direct; this runs a child process started with that environment,
   * proves the default agent really does go to the (dead) proxy, then proves
   * the scanner connects straight to the fixture with its lookup consulted.
   *
   * The child runs an esbuild bundle of this module under plain `node`: tsx
   * itself talks HTTP to its own helper and hangs once the env proxy is on.
   */
  it("connects directly, with the lookup consulted, while the default agent would use the proxy", async () => {
    fixture.route("/", html("<p>direct</p>"));
    const deadPort = await new Promise<number>((resolve) => {
      const probe = createNetServer();
      probe.listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });
    const script = `
      const http = require("node:http");
      const { safeFetch, createRequestBudget } = require(process.argv[1]);
      const calls = [];
      const viaDefaultAgent = new Promise((resolve) => {
        const req = http.get("http://127.0.0.1:${fixture.port}/", (res) => { res.resume(); resolve("direct"); });
        req.on("error", (error) => resolve(error.code || "error"));
      });
      viaDefaultAgent.then(async (defaultAgent) => {
        const result = await safeFetch("http://fixture.test:${fixture.port}/", {
          kind: "html",
          budget: createRequestBudget(4),
          policy: { isAllowedAddress: (a) => a === "127.0.0.1", isAllowedPort: () => true },
          resolver: async (host) => { calls.push(host); return [{ address: "127.0.0.1", family: 4 }]; },
        });
        process.stdout.write(JSON.stringify({ defaultAgent, ok: result.ok, body: result.ok ? result.value.body : result.reason, calls }));
      });
    `;
    const root = path.resolve(__dirname, "../../../../..");
    const workDir = mkdtempSync(path.join(tmpdir(), "rcf-safe-fetch-"));
    const bundle = path.join(workDir, "safe-fetch.cjs");
    buildSync({
      entryPoints: [path.join(root, "src/lib/tools/fetch/safe-fetch.ts")],
      tsconfig: path.join(root, "tsconfig.json"),
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: bundle,
      logLevel: "error",
    });
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["-e", script, bundle],
      {
        cwd: workDir,
        env: {
          ...process.env,
          NODE_USE_ENV_PROXY: "1",
          HTTP_PROXY: `http://127.0.0.1:${deadPort}`,
          HTTPS_PROXY: `http://127.0.0.1:${deadPort}`,
          NO_PROXY: "",
        },
        timeout: 30_000,
      },
    );
    const outcome = JSON.parse(stdout) as {
      defaultAgent: string;
      ok: boolean;
      body: string;
      calls: string[];
    };

    expect(outcome.defaultAgent).toBe("ECONNREFUSED");
    expect(outcome).toMatchObject({
      ok: true,
      body: "<p>direct</p>",
      calls: ["fixture.test"],
    });
    rmSync(workDir, { recursive: true, force: true });
  }, 40_000);
});
