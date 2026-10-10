/**
 * @jest-environment node
 */

/**
 * s84 — the realtime service reports its crashes to Sentry, and nothing that
 * opens a door goes with them.
 *
 * Until s84 `server/` had no error reporting: a crash was a log line and
 * `process.exit(1)` (`server/index.js` `installCrashHandlers`), visible only to
 * someone already reading `fly logs`. A crash loop on the one realtime machine
 * presents to editors as "live updates stopped", with nothing anywhere saying
 * why.
 *
 * What the service handles is unusually sensitive for an error report: the
 * socket.io handshake URL carries the site token, the staging token and the
 * edit-link token in its query string; Redis and Supabase errors can carry a
 * connection URL with its password. So the scrubber is tested on its own, and
 * then the real CLI is crashed — a real `node server/index.js`, the real
 * `@sentry/node`, posting to a fake ingest on localhost — to prove the event
 * leaves scrubbed, and the process still exits 1 exactly as before.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import * as SentryNode from "@sentry/node";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverSentry = require("../../../server/sentry.js") as {
  FILTERED: string;
  initSentry: (env?: Record<string, string | undefined>) => boolean;
  scrubEvent: <T>(event: T) => T;
  scrubBreadcrumb: <T>(breadcrumb: T) => T;
};

const SERVER_ENTRY = path.resolve(__dirname, "../../../server/index.js");

const SITE_TOKEN = "SECRET_SITE_TOKEN_9f8e";
const EDIT_TOKEN = "SECRET_EDIT_TOKEN_7d6c";
const REDIS_PASSWORD = "SECRET_REDIS_PASSWORD_5b4a";
const HANDOFF_CODE = "SECRET_HANDOFF_CODE_3e2f";
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXNlY3JldA";
const HANDSHAKE = `/socket.io/?EIO=4&transport=websocket&siteId=site-1&token=${SITE_TOKEN}&stagingMode=true&editToken=${EDIT_TOKEN}`;

describe("scrubEvent", () => {
  const event = {
    message: `handshake failed for ${HANDSHAKE}`,
    exception: {
      values: [
        {
          type: "Error",
          value: `connect failed: rediss://default:${REDIS_PASSWORD}@eu1.upstash.io:6379`,
        },
      ],
    },
    request: {
      url: `https://recopyfast-ws.fly.dev${HANDSHAKE}`,
      query_string: `token=${SITE_TOKEN}&siteId=site-1&editToken=${EDIT_TOKEN}`,
      headers: {
        authorization: `Bearer ${JWT}`,
        cookie: "sb-access-token=abc",
        "x-api-key": "key-123",
        "x-forwarded-for": "203.0.113.7",
        "fly-client-ip": "203.0.113.7",
        // The edit link's own parameters (public/embed/recopyfast.src.js):
        // the page the editor opened carries them until the embed strips them.
        referer: `https://customer.example/pricing?rcf_staging=1&rcf_edit_token=${EDIT_TOKEN}&rcf_handoff=${HANDOFF_CODE}&utm=x`,
        "user-agent": "Mozilla/5.0 test",
        origin: "https://customer.example",
      },
      cookies: { "sb-access-token": "abc" },
    },
    user: { id: "u-1", ip_address: "203.0.113.7" },
    breadcrumbs: [
      {
        category: "http",
        message: `GET https://x.supabase.co/rest/v1/sites?apikey=${JWT}`,
        data: {
          url: `https://x.supabase.co/rest/v1/sites?select=id&apikey=${JWT}`,
          "http.query": `token=${SITE_TOKEN}&siteId=site-1`,
          status_code: 401,
        },
      },
    ],
  };

  const scrubbed = serverSentry.scrubEvent(event);
  const wire = JSON.stringify(scrubbed);

  it("removes every token, password, key, cookie and IP", () => {
    for (const secret of [
      SITE_TOKEN,
      EDIT_TOKEN,
      HANDOFF_CODE,
      REDIS_PASSWORD,
      JWT,
      "sb-access-token=abc",
      "key-123",
      "203.0.113.7",
    ]) {
      expect([secret, wire.includes(secret)]).toEqual([secret, false]);
    }
  });

  it("keeps what an operator needs to read the event", () => {
    expect(wire).toContain("siteId=site-1");
    expect(wire).toContain("eu1.upstash.io:6379");
    expect(wire).toContain("Mozilla/5.0 test");
    expect(wire).toContain("https://customer.example/pricing?rcf_staging=1");
    expect(wire).toContain("/rest/v1/sites?select=id");
    expect(scrubbed.request.headers.authorization).toBe(serverSentry.FILTERED);
    expect(scrubbed.request).not.toHaveProperty("cookies");
    expect(scrubbed.user).toEqual({ id: "u-1" });
    expect(scrubbed.breadcrumbs[0].data.status_code).toBe(401);
  });

  it("returns a new event and leaves the original untouched", () => {
    expect(scrubbed).not.toBe(event);
    expect(event.request.headers.authorization).toBe(`Bearer ${JWT}`);
    expect(event.message).toContain(SITE_TOKEN);
  });

  it("scrubs a breadcrumb on its own", () => {
    const breadcrumb = serverSentry.scrubBreadcrumb({
      category: "console",
      message: `[auth] grant resolution failed for ?stagingToken=${SITE_TOKEN}`,
    });

    expect(JSON.stringify(breadcrumb)).not.toContain(SITE_TOKEN);
    expect(breadcrumb.message).toContain("[auth] grant resolution failed");
  });
});

describe("scrubEvent, below the top level and in logged objects", () => {
  // s84 review, F3. The scrubber filtered KEYS only at the top of headers,
  // request data and breadcrumb data, and filtered strings only in `?name=`
  // form. The review planted six secrets and all six reached the event: a
  // console breadcrumb's `data.arguments` holds the logged object itself, and
  // the console integration attaches recent lines to every crash event — so
  // one future `console.log(socket.handshake)` would ship every token in the
  // handshake. Keys are now filtered at every depth, and `key: value` /
  // `"key":"value"` text is filtered like a query pair.
  const PLANTED = [
    "PLANTED_ARG_TOKEN_1",
    "PLANTED_ARG_EDIT_TOKEN_2",
    "PLANTED_HANDSHAKE_AUTH_TOKEN_3",
    "PLANTED_SOCKET_QUERY_TOKEN_4",
    "PLANTED_JSON_STAGING_TOKEN_5",
    "PLANTED_INSPECT_TOKEN_6",
  ] as const;

  const event = {
    message: "realtime crashed",
    extra: {
      handshake: { auth: { token: PLANTED[2] }, url: "/socket.io/" },
    },
    contexts: {
      socket: { query: { token: PLANTED[3], siteId: "site-1" } },
    },
    breadcrumbs: [
      {
        category: "console",
        message: `join {"stagingToken":"${PLANTED[4]}","siteId":"site-1"}`,
        data: {
          logger: "console",
          arguments: [
            { token: PLANTED[0], siteId: "site-1" },
            { query: { editToken: PLANTED[1] }, transport: "websocket" },
          ],
        },
      },
      {
        category: "console",
        message: `handshake { token: '${PLANTED[5]}', siteId: 'site-1' }`,
      },
    ],
  };

  const scrubbed = serverSentry.scrubEvent(event);
  const wire = JSON.stringify(scrubbed);

  it.each(PLANTED)("does not let %s through", (secret) => {
    expect(wire).not.toContain(secret);
  });

  it("keeps the non-secret fields beside them", () => {
    expect(scrubbed.contexts.socket.query).toEqual({
      token: serverSentry.FILTERED,
      siteId: "site-1",
    });
    expect(scrubbed.breadcrumbs[0].data?.arguments[0].siteId).toBe("site-1");
    expect(scrubbed.breadcrumbs[0].data?.arguments[1].transport).toBe(
      "websocket",
    );
    expect(scrubbed.breadcrumbs[0].message).toBe(
      `join {"stagingToken":"${serverSentry.FILTERED}","siteId":"site-1"}`,
    );
    expect(scrubbed.breadcrumbs[1].message).toBe(
      `handshake { token: '${serverSentry.FILTERED}', siteId: 'site-1' }`,
    );
    expect(scrubbed.extra.handshake.url).toBe("/socket.io/");
  });

  it.each([
    [`password: hunter2-PLANTED`, "password: [Filtered]"],
    [`"apiKey": "PLANTED-key"`, `"apiKey": "[Filtered]"`],
    [`'secret':'PLANTED'`, `'secret':'[Filtered]'`],
    [`grant: PLANTED_GRANT, siteId: s1`, "grant: [Filtered], siteId: s1"],
    [`handoff="PLANTED_CODE"`, `handoff="[Filtered]"`],
    [`Authorization: Basic UExBTlRFRDpwdw==`, "Authorization: [Filtered]"],
  ])("filters %s in text", (text, expected) => {
    const { message } = serverSentry.scrubBreadcrumb({ message: text });

    expect(message).toBe(expected);
  });

  it("keeps the installed-package list as it is", () => {
    // `modulesIntegration` (a default) keys `event.modules` by package name;
    // filtering by key at every depth would otherwise blank the versions of
    // `jsonwebtoken`, `cookie` or `@supabase/auth-js` — the versions an
    // operator reads to tell a dependency bug from ours.
    const modules = {
      jsonwebtoken: "9.0.2",
      cookie: "0.7.2",
      "@supabase/auth-js": "2.71.1",
    };

    expect(serverSentry.scrubEvent({ modules }).modules).toEqual(modules);
  });

  it("drops what lies deeper than it reads, rather than passing it through", () => {
    // Past the walk's depth limit an object is replaced, not returned unread:
    // a credential nested deep enough must not ride past the scrubber.
    let deep: Record<string, unknown> = { token: "PLANTED_DEEP_TOKEN" };
    for (let level = 0; level < 20; level += 1) deep = { nested: deep };

    const scrubbed = serverSentry.scrubEvent({ extra: deep });

    expect(JSON.stringify(scrubbed)).not.toContain("PLANTED_DEEP_TOKEN");
  });

  it("keeps a host:port and other non-secret pairs as they are", () => {
    const text =
      "connect ECONNREFUSED eu1.upstash.io:6379 at 12:30, siteId: s1";

    expect(serverSentry.scrubBreadcrumb({ message: text }).message).toBe(text);
  });

  it.each([
    ["to%6ben", "ENCODED_PARTIAL_TOKEN"],
    ["%74%6f%6b%65%6e", "ENCODED_FULL_TOKEN"],
    ["EDIT%54OKEN", "ENCODED_MIXED_CASE_EDIT_TOKEN"],
    ["rcf_%74oken", "ENCODED_RCF_TOKEN"],
    ["%68andoff", "ENCODED_HANDOFF"],
    ["to%6", "MALFORMED_ESCAPE_VALUE"],
  ])("filters a query value whose raw name is %s", (name, secret) => {
    const url = `/socket.io/?siteId=site-1&${name}=${secret}&transport=websocket`;
    const scrubbed = serverSentry.scrubEvent({
      message: `handshake failed for ${url}`,
      request: {
        url: `https://recopyfast-ws.fly.dev${url}`,
        query_string: `${name}=${secret}&siteId=site-1`,
      },
    });
    const wire = JSON.stringify(scrubbed);

    expect(wire).not.toContain(secret);
    expect(wire).toContain(`${name}=${serverSentry.FILTERED}`);
    expect(wire).toContain("siteId=site-1");
    expect(wire).toContain("transport=websocket");
  });

  it("normalizes encoded query-pair names without changing ordinary URLs or query data", () => {
    const event = {
      request: {
        url: "https://recopyfast-ws.fly.dev/socket.io/?siteId=site-1&transport=websocket&feature%5Fflag=on",
        query_string: [
          ["edit%54oken", "ARRAY_ENCODED_EDIT_TOKEN"],
          ["siteId", "site-1"],
        ],
      },
    };

    const scrubbed = serverSentry.scrubEvent(event);

    expect(scrubbed.request.url).toBe(event.request.url);
    expect(scrubbed.request.query_string).toEqual([
      ["edit%54oken", serverSentry.FILTERED],
      ["siteId", "site-1"],
    ]);
  });
});

describe("initSentry", () => {
  it("is a no-op without SENTRY_DSN", () => {
    // `Sentry.init({ dsn: undefined })` would fall back to process.env itself,
    // so "unset" has to mean "never call init" — checked by the client, not by
    // a spy on init.
    expect(serverSentry.initSentry({ NODE_ENV: "production" })).toBe(false);
    expect(SentryNode.getClient()).toBeUndefined();
  });

  it("never falls back to NEXT_PUBLIC_SENTRY_DSN", () => {
    // s84 review, F4 (plan decision 8). In development this process loads the
    // repo root's `.env.local`, which carries the app's public DSN: falling
    // back to it would file every local crash in production's project.
    expect(
      serverSentry.initSentry({
        NODE_ENV: "development",
        NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.sentry.io/2",
      }),
    ).toBe(false);
    expect(SentryNode.getClient()).toBeUndefined();
  });
});

describe("the SDK's footprint while reporting is off", () => {
  // s84 review, F6. `@sentry/node` was required at module load, so the one
  // 512 MB realtime machine paid ~37 MB of RSS and ~0.5 s of boot for an SDK
  // it never initialised whenever SENTRY_DSN was unset. A fresh process is the
  // only honest probe: jest's own registry already holds the SDK.
  const SERVER_SENTRY = path.resolve(__dirname, "../../../server/sentry.js");

  function sentryModulesLoadedAfter(env: Record<string, string>): string[] {
    const script = [
      `const s = require(${JSON.stringify(SERVER_SENTRY)});`,
      `s.initSentry(${JSON.stringify(env)});`,
      "const loaded = Object.keys(require.cache).filter((file) => /[\\\\/]@sentry[\\\\/]/.test(file));",
      "process.stdout.write(JSON.stringify(loaded), () => process.exit(0));",
    ].join("\n");
    const result = spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      timeout: 20_000,
    });
    if (result.status !== 0) throw new Error(result.stderr);
    return JSON.parse(result.stdout) as string[];
  }

  it("loads nothing from @sentry without SENTRY_DSN", () => {
    expect(sentryModulesLoadedAfter({ NODE_ENV: "production" })).toEqual([]);
  });

  it("loads the SDK once SENTRY_DSN is set (control: the probe sees it)", () => {
    expect(
      sentryModulesLoadedAfter({ SENTRY_DSN: "http://k@127.0.0.1:9/1" }).length,
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The real CLI, crashed on purpose.
// ---------------------------------------------------------------------------

interface Ingest {
  dsn: string;
  envelopes: string[];
  close: () => Promise<void>;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const raw = Buffer.concat(chunks);
      const isGzip = request.headers["content-encoding"] === "gzip";
      resolve((isGzip ? zlib.gunzipSync(raw) : raw).toString("utf8"));
    });
  });
}

/** A stand-in for sentry.io: records every envelope POSTed to it. */
async function startIngest(): Promise<Ingest> {
  const envelopes: string[] = [];
  const server: Server = createServer((request, response) => {
    readBody(request).then((body) => {
      envelopes.push(body);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return {
    dsn: `http://s84publickey@127.0.0.1:${address.port}/42`,
    envelopes,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function freePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, resolve));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("no port");
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return address.port;
}

/**
 * A preload that crashes the process the way the given path would, after
 * running `before` (statements) once the server is up.
 */
function writeCrashPreload(kind: "throw" | "reject", before = ""): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rcf-s84-crash-"));
  const file = path.join(dir, "crash.cjs");
  const error = `new Error(${JSON.stringify(`boom-s84 ${kind} during ${HANDSHAKE}`)})`;
  const crash =
    kind === "throw" ? `throw ${error};` : `Promise.reject(${error});`;
  // `before` gets lines of its own so the crash line, which Sentry attaches as
  // source context, reads the same with or without it.
  const body = before ? `\n${before}\n${crash}\n` : ` ${crash} `;
  fs.writeFileSync(file, `setTimeout(() => {${body}}, 700);\n`);
  return file;
}

interface CliRun {
  code: number | null;
  output: string;
  elapsedMs: number;
}

async function crashCli(
  kind: "throw" | "reject",
  env: Record<string, string>,
  before = "",
): Promise<CliRun> {
  const preload = writeCrashPreload(kind, before);
  const port = await freePort();
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--require", preload, SERVER_ENTRY],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          WS_PORT: String(port),
          // Empty, not absent: dotenv never overrides a variable that exists,
          // so this keeps a developer's .env.local out of the run.
          REDIS_URL: "",
          SENTRY_DSN: "",
          SENTRY_RELEASE: "",
          ...env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI did not exit.\n${output}`));
    }, 20_000);
    child.on("exit", (code) => {
      clearTimeout(killTimer);
      fs.rmSync(path.dirname(preload), { recursive: true, force: true });
      resolve({ code, output, elapsedMs: Date.now() - started });
    });
  });
}

describe("the realtime CLI, when it crashes", () => {
  let ingest: Ingest;

  beforeEach(async () => {
    ingest = await startIngest();
  });

  afterEach(async () => {
    await ingest.close();
  });

  it.each([
    ["throw", "uncaughtException"],
    ["reject", "unhandledRejection"],
  ] as const)(
    "reports a %s to Sentry, scrubbed, then exits 1 as before",
    async (kind, label) => {
      const run = await crashCli(kind, { SENTRY_DSN: ingest.dsn });

      // Behaviour unchanged: the same log line, the same exit code — and
      // nothing printed by the SDK itself. Sentry's own global handlers are
      // removed because ours report and exit; left on, its rejection handler
      // prints an advisory of its own on every unhandled rejection.
      expect(run.code).toBe(1);
      expect(run.output).toContain(`[FATAL] ${label}`);
      expect(run.output).not.toContain("This error originated");

      const events = ingest.envelopes.filter((body) =>
        body.includes(`boom-s84 ${kind}`),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toContain("siteId=site-1");
      expect(events[0]).toContain('"service":"realtime"');
      for (const secret of [SITE_TOKEN, EDIT_TOKEN]) {
        expect([secret, events[0].includes(secret)]).toEqual([secret, false]);
      }
    },
    30_000,
  );

  it("sends nothing and exits 1 at once without SENTRY_DSN", async () => {
    const run = await crashCli("throw", {});

    expect(run.code).toBe(1);
    expect(run.output).toContain("[FATAL] uncaughtException");
    expect(ingest.envelopes).toEqual([]);
  }, 30_000);

  it("sends nothing when only NEXT_PUBLIC_SENTRY_DSN is set", async () => {
    // s84 review, F4: the development case. The server loads the repo root's
    // `.env.local`, which carries the app's public DSN.
    const run = await crashCli("throw", { NEXT_PUBLIC_SENTRY_DSN: ingest.dsn });

    expect(run.code).toBe(1);
    expect(ingest.envelopes).toEqual([]);
  }, 30_000);

  it("ships no token from a handshake logged before the crash", async () => {
    // s84 review, F3, through the real SDK: the console integration turns the
    // log line into a breadcrumb carrying the logged object, and attaches it
    // to the crash event.
    //
    // The values come in through the environment, as real tokens arrive at
    // run time: written into the preload's source, they would reach the event
    // as a source context line, which Sentry snips to 140 characters BEFORE
    // `beforeSend` — `{snip} …ken: "SECRET…` no longer names its key. Source
    // never holds a secret here (AGENTS.md Non-negotiable 8).
    const handshake = {
      query: { siteId: "site-1", token: SITE_TOKEN, editToken: EDIT_TOKEN },
      auth: { token: HANDOFF_CODE },
    };
    const run = await crashCli(
      "throw",
      {
        SENTRY_DSN: ingest.dsn,
        RCF_S84_HANDSHAKE: JSON.stringify(handshake),
      },
      "const handshake = JSON.parse(process.env.RCF_S84_HANDSHAKE);" +
        'console.log("handshake", handshake);' +
        "console.log(JSON.stringify(handshake));" +
        'console.log(require("node:util").inspect(handshake));',
    );

    expect(run.code).toBe(1);
    const events = ingest.envelopes.filter((body) =>
      body.includes("boom-s84 throw"),
    );
    expect(events).toHaveLength(1);
    // The breadcrumbs did travel with the event — this is not vacuous.
    expect(events[0]).toContain('"category":"console"');
    expect(events[0]).toContain("site-1");
    for (const secret of [SITE_TOKEN, EDIT_TOKEN, HANDOFF_CODE]) {
      expect([secret, events[0].includes(secret)]).toEqual([secret, false]);
    }
  }, 30_000);

  it("ships no credential from percent-encoded query names in a logged URL", async () => {
    const encodedSiteToken = "REAL_INGEST_ENCODED_SITE_TOKEN";
    const encodedHandoff = "REAL_INGEST_ENCODED_HANDOFF";
    const encodedUrl =
      `/socket.io/?siteId=site-1&to%6ben=${encodedSiteToken}` +
      `&rcf_%74oken=${encodedHandoff}&transport=websocket`;
    const run = await crashCli(
      "throw",
      {
        SENTRY_DSN: ingest.dsn,
        RCF_S84_ENCODED_URL: encodedUrl,
      },
      'console.log("encoded handshake", process.env.RCF_S84_ENCODED_URL);',
    );

    expect(run.code).toBe(1);
    const events = ingest.envelopes.filter((body) =>
      body.includes("boom-s84 throw"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("siteId=site-1");
    expect(events[0]).toContain("transport=websocket");
    for (const secret of [encodedSiteToken, encodedHandoff]) {
      expect([secret, events[0].includes(secret)]).toEqual([secret, false]);
    }
  }, 30_000);
});
