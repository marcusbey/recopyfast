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

import { spawn } from "node:child_process";
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

describe("initSentry", () => {
  it("is a no-op without SENTRY_DSN", () => {
    // `Sentry.init({ dsn: undefined })` would fall back to process.env itself,
    // so "unset" has to mean "never call init" — checked by the client, not by
    // a spy on init.
    expect(serverSentry.initSentry({ NODE_ENV: "production" })).toBe(false);
    expect(SentryNode.getClient()).toBeUndefined();
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

/** A preload that crashes the process the way the given path would. */
function writeCrashPreload(kind: "throw" | "reject"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rcf-s84-crash-"));
  const file = path.join(dir, "crash.cjs");
  const error = `new Error(${JSON.stringify(`boom-s84 ${kind} during ${HANDSHAKE}`)})`;
  const crash =
    kind === "throw" ? `throw ${error};` : `Promise.reject(${error});`;
  fs.writeFileSync(file, `setTimeout(() => { ${crash} }, 700);\n`);
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
): Promise<CliRun> {
  const preload = writeCrashPreload(kind);
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
});
