/**
 * @jest-environment node
 */

/**
 * The realtime service, driven as a service.
 *
 * This file replaces `src/__tests__/websocket/server.test.ts`, which never
 * imported `server/index.js`: all 416 of its lines re-implemented the server's
 * logic inline and asserted on literals — `expect("site:site-123").toBe(
 * "site:site-123")`. Twenty-two `WS-nnn` ids gave the appearance of a covered
 * surface while server-code coverage was 0%, so every security defect this
 * story fixes shipped past a green suite.
 *
 * Everything here boots the real factory on an ephemeral port and drives it
 * with a real `socket.io-client`. The Supabase double records every call it
 * receives, which is how "the socket never writes" is asserted as a property of
 * the running server rather than as a claim about the source.
 */

import { createServer, type Server as HttpServer } from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import type { Socket } from "socket.io-client";

import { createRealtimeServer } from "../../../server/index.js";
import {
  RecordingSupabase,
  buildSiteToken,
  memoryStore,
  openSocket,
  throwingStore,
  track,
  waitFor,
  type Row,
} from "./harness";

/**
 * Jest's 5 s default is a poor fit here and was producing intermittent red.
 *
 * Every test in this file binds a real listener and opens real WebSocket
 * connections; a describe that boots a fresh server per case spends most of its
 * budget on TCP rather than on the thing under test, and lost the race on a
 * loaded machine. The ceiling is raised, not removed — `waitFor` keeps its own
 * 5 s deadline and fails with the condition it was waiting for, so a genuine
 * hang still reports as a hang rather than as a timeout with no explanation.
 */
jest.setTimeout(30_000);

const SERVER_ENTRY = path.resolve(__dirname, "../../../server/index.js");

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SITE_ID = "22222222-2222-4222-8222-222222222222";
const API_KEY = "test-api-key";
const DOMAIN = "example.com";
const ORIGIN = "https://example.com";
const DAY_SECONDS = 24 * 60 * 60;

const NO_DOMAIN_SITE_ID = "44444444-4444-4444-8444-444444444444";

/**
 * One token, built once, reused for the handshake AND for every message that
 * echoes it back.
 *
 * `buildSiteToken` derives `issuedAt` from the clock, so calling it twice
 * either side of a second boundary produces two different valid tokens — and
 * the message handlers compare the echoed token against the one the handshake
 * carried, byte for byte. Rebuilding it per call made roughly one run in
 * thirty fail on `auth-error: Invalid site token`, which read as a flaky
 * broadcast rather than as the clock skew it was.
 */
const SITE_TOKEN = buildSiteToken(SITE_ID, API_KEY);

function seedSites(): Row[] {
  return [
    { id: SITE_ID, domain: DOMAIN, api_key: API_KEY },
    { id: OTHER_SITE_ID, domain: "other.example", api_key: "other-key" },
    { id: NO_DOMAIN_SITE_ID, domain: null, api_key: API_KEY },
  ];
}

function roomSize(
  server: { io: { sockets: { adapter: { rooms: Map<string, Set<string>> } } } },
  room: string,
): number {
  return server.io.sockets.adapter.rooms.get(room)?.size ?? 0;
}

/** Bind a port so the server cannot have it, and report which one. */
async function occupyPort(): Promise<{
  port: number;
  release: () => Promise<void>;
}> {
  const blocker: HttpServer = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    blocker.once("error", reject);
    // No host argument, deliberately: `listen(port)` binds the unspecified IPv6
    // address on a dual-stack box, so a blocker pinned to 0.0.0.0 does NOT
    // collide with it and the "port is taken" case never actually happens.
    // Both sides must bind the same way for this to mean anything.
    blocker.listen(0, () => {
      const address = blocker.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected a TCP address"));
        return;
      }
      resolve(address.port);
    });
  });

  return {
    port,
    release: () =>
      new Promise<void>((resolve) => {
        blocker.close(() => resolve());
      }),
  };
}

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

// `Record<string, string>` rather than `NodeJS.ProcessEnv`: Next augments that
// type to require NODE_ENV, so every call site would have to restate it.
function runNode(
  args: string[],
  env: Record<string, string>,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const killTimer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `Child process did not exit.\nstdout: ${stdout}\nstderr: ${stderr}`,
        ),
      );
    }, 15_000);

    child.on("error", (error) => {
      clearTimeout(killTimer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(killTimer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("realtime service lifecycle", () => {
  it("starts no listener when the module is merely required", async () => {
    // `startServer(PORT)` used to run at module load, which is why the server
    // could not be imported by a test at all. The auto-start now lives behind
    // `require.main === module`.
    const result = await runNode(
      [
        "-e",
        `require(${JSON.stringify(SERVER_ENTRY)}); setTimeout(() => process.exit(0), 500);`,
      ],
      {},
    );

    expect(result.code).toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toMatch(
      /WebSocket server running/,
    );
  }, 30_000);

  it("binds the requested port and reports it", async () => {
    const server = createRealtimeServer({ port: 0 });
    const boundPort = await server.listen();

    expect(typeof boundPort).toBe("number");
    expect(boundPort).toBeGreaterThan(0);

    await server.close();
  });

  it("refuses an occupied port instead of walking to the next one", async () => {
    // fly.toml:33 and :58 pin 4001. The old startServer() walked 4001→4010 on
    // EADDRINUSE, so a deploy that lost the port presented as healthy
    // application logs plus a health check that never passed (T9).
    const blocked = await occupyPort();

    const server = createRealtimeServer({ port: blocked.port });
    await expect(server.listen()).rejects.toMatchObject({ code: "EADDRINUSE" });

    await server.close();
    await blocked.release();
  });

  it("exits non-zero when started from the CLI on an occupied port", async () => {
    const blocked = await occupyPort();

    const result = await runNode([SERVER_ENTRY], {
      WS_PORT: String(blocked.port),
    });

    expect(result.code).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).not.toMatch(/trying \d+/);
    expect(output).toMatch(new RegExp(String(blocked.port)));

    await blocked.release();
  }, 30_000);
});

describe("handshake authentication", () => {
  let db: RecordingSupabase;
  let server: ReturnType<typeof createRealtimeServer>;
  let port: number;
  const open: Socket[] = [];

  beforeAll(async () => {
    db = new RecordingSupabase({ sites: seedSites() });
    server = createRealtimeServer({ port: 0, supabase: db });
    port = await server.listen();
  });

  afterEach(() => {
    while (open.length > 0) {
      open.pop()?.close();
    }
  });

  afterAll(async () => {
    await server.close();
  });

  function connect(
    query: Record<string, string>,
    origin: string | null = ORIGIN,
  ) {
    const socket = openSocket({ port, query, origin });
    open.push(socket);
    return track(socket);
  }

  it("admits a socket carrying a valid token and joins it to its site room", async () => {
    connect({ siteId: SITE_ID, token: SITE_TOKEN });

    await waitFor(
      () => roomSize(server, `site:${SITE_ID}`) === 1,
      "the socket to join its site room",
    );

    expect(roomSize(server, `site:${SITE_ID}:staging`)).toBe(0);
  });

  it("refuses a handshake with no site id", async () => {
    const handshake = connect({ token: SITE_TOKEN });

    await handshake.refused();
    expect(roomSize(server, `site:${SITE_ID}`)).toBe(0);
  });

  it("refuses a handshake with no token", async () => {
    const handshake = connect({ siteId: SITE_ID });

    expect(await handshake.refused()).toBe("Missing site token");
  });

  it("refuses a token signed with the wrong key", async () => {
    const handshake = connect({
      siteId: SITE_ID,
      token: buildSiteToken(SITE_ID, "not-the-api-key"),
    });

    expect(await handshake.refused()).toBe("Invalid site token");
  });

  it("refuses a token older than its 90-day lifetime", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 91 * DAY_SECONDS;
    const handshake = connect({
      siteId: SITE_ID,
      token: buildSiteToken(SITE_ID, API_KEY, issuedAt),
    });

    expect(await handshake.refused()).toBe("Invalid site token");
  });

  it("refuses a future-dated token beyond the clock-skew allowance", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) + 3600;
    const handshake = connect({
      siteId: SITE_ID,
      token: buildSiteToken(SITE_ID, API_KEY, issuedAt),
    });

    expect(await handshake.refused()).toBe("Invalid site token");
  });

  it("refuses a token whose site does not exist", async () => {
    const unknown = "33333333-3333-4333-8333-333333333333";
    const handshake = connect({
      siteId: unknown,
      token: buildSiteToken(unknown, API_KEY),
    });

    expect(await handshake.refused()).toBe("Site not found");
  });
});

/**
 * T2 / A-2 — the domain pin is mandatory, not conditional on a header being
 * offered.
 *
 * The socket used to read `if (allowedDomain && requestHost && requestHost !==
 * allowedDomain)`: two truthiness guards that turned a missing `Origin` into
 * "nothing to check" and a site with a null or unparseable `domain` into "no pin
 * at all". `site-auth.ts:162` has compared unconditionally since A-2. The case
 * that mattered is the one no browser can produce: a `wscat`-shaped client with
 * a token scraped out of the customer's page markup and no `Origin` at all.
 */
describe("handshake origin pin", () => {
  let db: RecordingSupabase;
  let server: ReturnType<typeof createRealtimeServer>;
  let port: number;
  const open: Socket[] = [];

  beforeAll(async () => {
    db = new RecordingSupabase({ sites: seedSites() });
    server = createRealtimeServer({ port: 0, supabase: db });
    port = await server.listen();
  });

  afterEach(() => {
    while (open.length > 0) {
      open.pop()?.close();
    }
  });

  afterAll(async () => {
    await server.close();
  });

  function connect(
    headers: { origin?: string; referer?: string },
    siteId = SITE_ID,
  ) {
    const socket = openSocket({
      port,
      query: { siteId, token: buildSiteToken(siteId, API_KEY) },
      origin: headers.origin ?? null,
      referer: headers.referer ?? null,
    });
    open.push(socket);
    return track(socket);
  }

  it("admits a socket whose Origin is the registered domain", async () => {
    connect({ origin: ORIGIN });

    await waitFor(
      () => roomSize(server, `site:${SITE_ID}`) === 1,
      "the socket to join its site room",
    );
  });

  it("admits a socket whose Referer alone is the registered domain", async () => {
    connect({ referer: "https://example.com/pricing" });

    await waitFor(
      () => roomSize(server, `site:${SITE_ID}`) === 1,
      "the socket to join its site room",
    );
  });

  it("refuses a socket presenting neither Origin nor Referer", async () => {
    const handshake = connect({});

    expect(await handshake.refused()).toBe("Origin not allowed");
    expect(roomSize(server, `site:${SITE_ID}`)).toBe(0);
  });

  it("refuses a socket whose Origin is a different host", async () => {
    const handshake = connect({ origin: "https://evil.example" });

    expect(await handshake.refused()).toBe("Origin not allowed");
  });

  it("refuses a socket whose Origin is unparseable", async () => {
    const handshake = connect({ origin: "not-a-url" });

    expect(await handshake.refused()).toBe("Origin not allowed");
  });

  it("refuses every socket for a site with no registered domain", async () => {
    const handshake = connect({ origin: ORIGIN }, NO_DOMAIN_SITE_ID);

    expect(await handshake.refused()).toBe("Origin not allowed");
    expect(roomSize(server, `site:${NO_DOMAIN_SITE_ID}`)).toBe(0);
  });
});

/**
 * T4 — the degraded, no-Supabase mode was gated on env presence, not on
 * NODE_ENV.
 *
 * It skipped token verification entirely and set `socket.data.isStaging = true`
 * on the client's own say-so, joining `site:{id}:staging`. One typo'd
 * `SUPABASE_SERVICE_ROLE_KEY` in production therefore degraded the service to
 * "anyone can watch any site's unpublished staging traffic" — silently, with a
 * healthy `/health` and a warning in a log nobody reads.
 *
 * Two changes, one per environment: production refuses to start at all, and
 * outside production the degraded mode can never reach a staging room.
 */
describe("degraded mode without Supabase", () => {
  let server: ReturnType<typeof createRealtimeServer>;
  let port: number;
  const open: Socket[] = [];

  beforeAll(async () => {
    server = createRealtimeServer({ port: 0, supabase: null });
    port = await server.listen();
  });

  afterEach(() => {
    while (open.length > 0) {
      open.pop()?.close();
    }
  });

  afterAll(async () => {
    await server.close();
  });

  it("never grants staging-room membership on the client's say-so", async () => {
    const socket = openSocket({
      port,
      origin: ORIGIN,
      query: {
        siteId: SITE_ID,
        token: "anything-at-all",
        stagingMode: "true",
        stagingToken: "made-up",
      },
    });
    open.push(socket);
    track(socket);

    await waitFor(
      () => roomSize(server, `site:${SITE_ID}`) === 1,
      "the socket to land in the live room",
    );

    expect(roomSize(server, `site:${SITE_ID}:staging`)).toBe(0);
  });

  it("refuses to start in production without the required environment", async () => {
    const result = await runNode([SERVER_ENTRY], {
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_APP_URL: "https://www.recopyfa.st",
      REDIS_URL: "redis://localhost:6379",
      // Present-but-empty rather than deleted: dotenv only fills keys that are
      // absent from process.env, so an operator's local .env.local cannot leak
      // a real key into this run and quietly turn the assertion vacuous.
      SUPABASE_SERVICE_ROLE_KEY: "",
    });

    expect(result.code).not.toBe(0);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(output).not.toMatch(/WebSocket server running/);
  }, 30_000);
});

/**
 * T3 / ADR 002 rule 4 — a fail-closed per-site limiter.
 *
 * This process holds `SUPABASE_SERVICE_ROLE_KEY` and had no limiter of any
 * kind. The credential that opens the socket is published in the customer's own
 * page markup, so `onStoreFailure` is `"deny"`: losing Redis must not remove the
 * limit, because "Redis is down" and "someone is using a copied token" look
 * identical from here.
 *
 * The limiter also runs BEFORE the `sites` lookup. AGENTS.md spells out why —
 * authorization itself costs a database round trip, so a limiter placed behind
 * it never sees the flood it exists to stop.
 */
describe("rate limiting", () => {
  const open: Socket[] = [];
  let db: RecordingSupabase;

  afterEach(() => {
    while (open.length > 0) {
      open.pop()?.close();
    }
  });

  async function bootWith(options: {
    rateLimitStore: { increment: (key: string) => Promise<number> };
    rateLimit?: Record<string, number>;
  }) {
    db = new RecordingSupabase({ sites: seedSites() });
    const server = createRealtimeServer({
      port: 0,
      supabase: db,
      rateLimitStore: options.rateLimitStore,
      rateLimit: options.rateLimit,
    });
    const port = await server.listen();
    return { server, port };
  }

  function connect(port: number) {
    const socket = openSocket({
      port,
      origin: ORIGIN,
      query: { siteId: SITE_ID, token: SITE_TOKEN },
    });
    open.push(socket);
    return track(socket);
  }

  it("refuses a connection over the per-site limit", async () => {
    const { server, port } = await bootWith({
      rateLimitStore: memoryStore(),
      rateLimit: { maxConnectionsPerSite: 1 },
    });

    connect(port);
    await waitFor(
      () => roomSize(server, `site:${SITE_ID}`) === 1,
      "the first socket to be admitted",
    );

    const second = connect(port);
    expect(await second.refused()).toMatch(/rate limit|too many/i);
    expect(roomSize(server, `site:${SITE_ID}`)).toBe(1);

    await server.close();
  });

  it("spends no database round trip on a connection it has already refused", async () => {
    // The limiter is in front of the `sites` lookup, not behind it.
    const { server, port } = await bootWith({
      rateLimitStore: memoryStore(),
      rateLimit: { maxConnectionsPerSite: 0 },
    });

    const handshake = connect(port);
    await handshake.refused();

    expect(db.reads).toEqual([]);

    await server.close();
  });

  it("refuses every connection when the store is unreachable (fail closed)", async () => {
    const { server, port } = await bootWith({
      rateLimitStore: throwingStore(),
    });

    const handshake = connect(port);
    expect(await handshake.refused()).toMatch(/rate limit|too many/i);
    expect(roomSize(server, `site:${SITE_ID}`)).toBe(0);
    expect(db.reads).toEqual([]);

    await server.close();
  });

  it("drops an over-limit message without broadcasting it", async () => {
    const { server, port } = await bootWith({
      rateLimitStore: memoryStore(),
      rateLimit: { maxMessagesPerSocket: 1 },
    });

    const sender = connect(port);
    const listener = connect(port);
    await waitFor(
      () => roomSize(server, `site:${SITE_ID}`) === 2,
      "both sockets to be admitted",
    );

    const relayed: unknown[] = [];
    const errors: unknown[] = [];
    listener.socket.on("content-map-updated", (data) => relayed.push(data));
    sender.socket.on("rate-limit-error", (data) => errors.push(data));
    listener.socket.emit("join-dashboard", { siteId: SITE_ID });
    await waitFor(
      () => roomSize(server, `dashboard:${SITE_ID}`) === 1,
      "the listener to join the dashboard room",
    );

    const map = {
      url: "https://example.com/",
      token: SITE_TOKEN,
      contentMap: {},
    };
    sender.socket.emit("content-map", map);
    await waitFor(() => relayed.length === 1, "the first message to land");

    sender.socket.emit("content-map", map);
    await waitFor(
      () => errors.length === 1,
      "the second message to be refused",
    );
    expect(relayed).toHaveLength(1);

    await server.close();
  });
});

/**
 * ADR 004 rule 1 — HTTP stays authoritative. Realtime broadcasts; it never
 * becomes a second write path.
 *
 * The service used to write `content_elements` and insert `staging_history`
 * straight off a socket message, and to call `create_content_version`,
 * `restore_content_version` and `publish_staging_content_atomic` under the
 * service-role key from five more handlers that no client has ever emitted.
 *
 * These assertions are made against `db.writes`, which the double appends to on
 * every `insert` / `update` / `upsert` / `rpc` the server asks for. So this is
 * not "the source no longer contains an upsert" — it is "the running server,
 * driven through every event it still accepts, asked the database to change
 * nothing".
 */
describe("the socket is broadcast-only", () => {
  const STAGING_TOKEN = "staging-token-1";
  const EDITOR_EMAIL = "editor@example.com";

  let db: RecordingSupabase;
  let server: ReturnType<typeof createRealtimeServer>;
  let port: number;
  const open: Socket[] = [];

  function futureIso(minutes = 60): string {
    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
  }

  beforeEach(async () => {
    db = new RecordingSupabase({
      sites: seedSites(),
      staging_access: [
        {
          id: "access-1",
          token: STAGING_TOKEN,
          site_id: SITE_ID,
          is_active: true,
          revoked_at: null,
          expires_at: futureIso(),
          email_verified: true,
          email: EDITOR_EMAIL,
          // `admin`, deliberately the most permissive grant there is: the point
          // of these cases is that the write does not happen, and a fixture
          // that fails the permission check first would assert nothing about
          // the write. Same reason the language and theme rows below exist.
          permissions: ["admin"],
        },
      ],
      site_editors: [
        {
          id: "editor-1",
          site_id: SITE_ID,
          email: EDITOR_EMAIL,
          revoked_at: null,
        },
      ],
      content_elements: [
        {
          id: "element-1",
          site_id: SITE_ID,
          element_id: "headline",
          language: "en",
          variant: "default",
          staging_content: "Staged copy",
        },
      ],
      site_languages: [
        {
          site_id: SITE_ID,
          language_code: "fr",
          language_name: "French",
          translations: { headline: "Bonjour" },
        },
      ],
      site_themes: [
        {
          id: "t1",
          site_id: SITE_ID,
          name: "Bold",
          content_overrides: { headline: "Bold headline" },
        },
      ],
    });
    server = createRealtimeServer({ port: 0, supabase: db });
    port = await server.listen();
  });

  afterEach(async () => {
    while (open.length > 0) {
      open.pop()?.close();
    }
    await server.close();
  });

  async function connectEditor(): Promise<Socket> {
    // Wait for the room to GROW, not merely to be non-empty. Two editors are
    // needed to observe a broadcast at all (the sender is excluded from
    // `socket.to(...)`), and "> 0" was satisfied by the first one — so the
    // second could still be mid-handshake when the emit went out, and the
    // assertion raced the join.
    const expected = roomSize(server, `site:${SITE_ID}:staging`) + 1;
    const socket = openSocket({
      port,
      origin: ORIGIN,
      query: {
        siteId: SITE_ID,
        token: SITE_TOKEN,
        stagingMode: "true",
        stagingToken: STAGING_TOKEN,
      },
    });
    open.push(socket);
    track(socket);
    await waitFor(
      () => roomSize(server, `site:${SITE_ID}:staging`) >= expected,
      "the editor to join the staging room",
    );
    return socket;
  }

  async function connectDashboard(): Promise<Socket> {
    const expected = roomSize(server, `site:${SITE_ID}`) + 1;
    const socket = openSocket({
      port,
      origin: ORIGIN,
      query: { siteId: SITE_ID, token: SITE_TOKEN },
    });
    open.push(socket);
    track(socket);
    await waitFor(
      () => roomSize(server, `site:${SITE_ID}`) >= expected,
      "the dashboard socket to join the site room",
    );
    socket.emit("join-dashboard", { siteId: SITE_ID });
    await waitFor(
      () => roomSize(server, `dashboard:${SITE_ID}`) > 0,
      "the dashboard socket to join the dashboard room",
    );
    return socket;
  }

  /**
   * An ordering barrier, not a sleep.
   *
   * Socket.io delivers one socket's messages in order, so once the effect of a
   * later message is observed, every earlier message has already been handled.
   * That is what makes "nothing was broadcast" assertable without guessing at a
   * grace period.
   */
  async function drain(editor: Socket, dashboard: Socket): Promise<void> {
    const seen: unknown[] = [];
    dashboard.once("content-map-updated", (payload) => seen.push(payload));
    editor.emit("content-map", {
      url: "https://example.com/",
      token: SITE_TOKEN,
      contentMap: {},
    });
    await waitFor(() => seen.length === 1, "the ordering barrier to come back");
  }

  it("registers no content element when a content map arrives", async () => {
    const editor = await connectEditor();
    const dashboard = await connectDashboard();
    const notified: Array<{ elementCount: number }> = [];
    dashboard.on("content-map-updated", (payload) => notified.push(payload));

    editor.emit("content-map", {
      url: "https://example.com/",
      token: SITE_TOKEN,
      contentMap: {
        headline: { selector: "h1", content: "Hello", type: "text" },
      },
    });

    await waitFor(() => notified.length === 1, "the dashboard notification");

    // POST /api/content/:siteId owns this write and the widget calls it
    // unconditionally before it ever reaches the socket.
    expect(db.writes).toEqual([]);
    expect(notified[0].elementCount).toBe(1);
  });

  it("persists nothing on a content update that does not claim to be persisted", async () => {
    const editor = await connectEditor();
    const listener = await connectEditor();
    const received: Array<{ elementId: string; content: string }> = [];
    listener.on("content-update", (payload) => received.push(payload));

    // `persisted` deliberately absent: the real client always sets it, so this
    // is the hand-crafted client the old `!data.persisted` branch existed for.
    editor.emit("content-update", {
      elementId: "headline",
      content: "Rewritten by a socket",
      token: SITE_TOKEN,
    });

    await waitFor(() => received.length === 1, "the staging broadcast");

    expect(db.writes).toEqual([]);
    expect(received[0]).toMatchObject({
      elementId: "headline",
      content: "Rewritten by a socket",
    });
  });

  it("still fans a persisted content update out to the staging room only", async () => {
    const editor = await connectEditor();
    const listener = await connectEditor();
    const dashboard = await connectDashboard();
    const stagingReceived: unknown[] = [];
    const liveReceived: unknown[] = [];
    listener.on("content-update", (payload) => stagingReceived.push(payload));
    dashboard.on("content-update", (payload) => liveReceived.push(payload));

    editor.emit("content-update", {
      elementId: "headline",
      content: "Saved over HTTP first",
      persisted: true,
      token: SITE_TOKEN,
    });

    await waitFor(() => stagingReceived.length === 1, "the staging broadcast");
    expect(liveReceived).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it.each([
    [
      "bulk-update",
      { updates: [{ elementId: "headline", content: "x" }] },
      "bulk-update-success",
    ],
    ["switch-language", { languageCode: "fr" }, "switch-language-success"],
    ["restore-version", { versionId: "v1" }, "restore-version-success"],
    ["activate-theme", { themeId: "t1" }, "activate-theme-success"],
    ["staging-publish", { elementIds: ["headline"] }, "publish-success"],
  ])(
    "no longer handles %s: no write, no broadcast, no acknowledgement",
    async (event, payload, successEvent) => {
      const editor = await connectEditor();
      const dashboard = await connectDashboard();
      const acknowledged: unknown[] = [];
      const broadcast: unknown[] = [];
      editor.on(successEvent, (data) => acknowledged.push(data));
      dashboard.on("content-update", (data) => broadcast.push(data));
      dashboard.on("content-published", (data) => broadcast.push(data));

      editor.emit(event, {
        ...payload,
        token: SITE_TOKEN,
      });
      await drain(editor, dashboard);

      expect(db.writes).toEqual([]);
      expect(acknowledged).toEqual([]);
      expect(broadcast).toEqual([]);
    },
  );

  it("no longer relays ab-test-status-change to a site's rooms", async () => {
    // 3099c07 closed the HTTP twin of this. The socket handler had no token
    // re-check and no permission check at all, so any holder of the public site
    // token — which ships in the customer's own page markup — could broadcast an
    // arbitrary A/B status to every client on that site.
    const editor = await connectEditor();
    const dashboard = await connectDashboard();
    const relayed: unknown[] = [];
    dashboard.on("ab-test-update", (data) => relayed.push(data));

    editor.emit("ab-test-status-change", {
      testId: "test-1",
      status: "active",
      siteId: SITE_ID,
    });
    await drain(editor, dashboard);

    expect(relayed).toEqual([]);
    expect(db.writes).toEqual([]);
  });
});

/**
 * M5 — revocation has to reach a live socket.
 *
 * The grant was resolved once, at the handshake, and cached on `socket.data`;
 * every `content-update` read that cache and nothing ever re-read the database.
 * An editor whose access was revoked therefore kept working for as long as the
 * tab stayed open — which for an editing session is exactly as long as it takes
 * to notice you have been removed and keep going.
 *
 * `s14` owns revoking; `s08` replaces only the widget's client library. Neither
 * covers the Socket.io path, so it lives here.
 *
 * Two halves, and the second is the one that is easy to miss: a socket that
 * TALKS is caught by the per-message re-resolution, and a socket that says
 * nothing is caught only by the sweep. After the socket stopped writing (task
 * 4) the residual exposure of a silent revoked socket is disclosure — it still
 * receives other editors' staging broadcasts — and the sweep is what closes it.
 */
describe("revocation reaches a live socket", () => {
  const STAGING_TOKEN = "staging-token-revocation";
  const EDIT_TOKEN = "edit-token-revocation";
  const EDITOR_EMAIL = "revocable@example.com";
  const SWEEP_MS = 50;

  let db: RecordingSupabase;
  let server: ReturnType<typeof createRealtimeServer>;
  let port: number;
  const open: Socket[] = [];

  function futureIso(minutes = 60): string {
    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
  }

  beforeEach(async () => {
    db = new RecordingSupabase({
      sites: seedSites(),
      staging_access: [
        {
          id: "access-1",
          token: STAGING_TOKEN,
          site_id: SITE_ID,
          is_active: true,
          revoked_at: null,
          expires_at: futureIso(),
          email_verified: true,
          email: EDITOR_EMAIL,
          permissions: ["edit"],
        },
      ],
      edit_sessions: [
        {
          id: "session-1",
          token: EDIT_TOKEN,
          site_id: SITE_ID,
          user_id: "user-1",
          is_active: true,
          revoked_at: null,
          expires_at: futureIso(),
          permissions: ["edit"],
        },
      ],
      site_editors: [
        {
          id: "editor-1",
          site_id: SITE_ID,
          email: EDITOR_EMAIL,
          revoked_at: null,
        },
      ],
    });
    server = createRealtimeServer({
      port: 0,
      supabase: db,
      revalidationIntervalMs: SWEEP_MS,
    });
    port = await server.listen();
  });

  afterEach(async () => {
    while (open.length > 0) {
      open.pop()?.close();
    }
    await server.close();
  });

  async function connectEditor(
    credential: { stagingToken?: string; editToken?: string } = {
      stagingToken: STAGING_TOKEN,
    },
  ) {
    const expected = roomSize(server, `site:${SITE_ID}:staging`) + 1;
    const socket = openSocket({
      port,
      origin: ORIGIN,
      query: {
        siteId: SITE_ID,
        token: SITE_TOKEN,
        stagingMode: "true",
        stagingToken: credential.stagingToken ?? "",
        editToken: credential.editToken ?? "",
      },
    });
    open.push(socket);
    const tracked = track(socket);
    await waitFor(
      () => roomSize(server, `site:${SITE_ID}:staging`) >= expected,
      "the editor to join the staging room",
    );
    return tracked;
  }

  function update(socket: Socket) {
    socket.emit("content-update", {
      elementId: "headline",
      content: "After revocation",
      persisted: true,
      token: SITE_TOKEN,
    });
  }

  it("keeps broadcasting while the grant stands (control)", async () => {
    const editor = await connectEditor();
    const listener = await connectEditor();
    const received: unknown[] = [];
    listener.socket.on("content-update", (data) => received.push(data));

    update(editor.socket);
    await waitFor(() => received.length === 1, "the first broadcast");
    update(editor.socket);
    await waitFor(() => received.length === 2, "the second broadcast");

    expect(editor.socket.connected).toBe(true);
  });

  it.each([
    [
      "the grant is deactivated",
      () => {
        db.rows("staging_access")[0].is_active = false;
      },
    ],
    [
      "the grant is revoked",
      () => {
        db.rows("staging_access")[0].revoked_at = new Date().toISOString();
      },
    ],
    [
      "the grant expires",
      () => {
        db.rows("staging_access")[0].expires_at = new Date(
          Date.now() - 1000,
        ).toISOString();
      },
    ],
    [
      "the editor is removed from the site's allowlist",
      () => {
        db.rows("site_editors")[0].revoked_at = new Date().toISOString();
      },
    ],
  ])(
    "refuses the next message and drops the socket once %s",
    async (_label, revoke) => {
      const editor = await connectEditor();
      const listener = await connectEditor();
      const received: unknown[] = [];
      listener.socket.on("content-update", (data) => received.push(data));

      update(editor.socket);
      await waitFor(
        () => received.length === 1,
        "the pre-revocation broadcast",
      );

      revoke();
      update(editor.socket);

      expect(await editor.refused()).toMatch(/revoked|no longer|access/i);
      expect(received).toHaveLength(1);
    },
  );

  it("drops a silent revoked socket within one sweep interval", async () => {
    // The residual exposure after task 4 is disclosure, not writes: this socket
    // is still in `site:{id}:staging` and still receiving other editors'
    // unpublished copy. Per-message re-resolution never fires for a socket that
    // says nothing, so only the sweep closes it.
    const editor = await connectEditor();

    db.rows("staging_access")[0].revoked_at = new Date().toISOString();

    // Both conditions are waited on, not one waited on and the other asserted.
    //
    // `socket.disconnected` is the CLIENT observing the close; leaving the room
    // is the SERVER reacting to it. They are separate events, and on a busy
    // machine the client can flip first — so asserting `roomSize` immediately
    // after the first `waitFor` went red while the server was behaving
    // correctly. That is a suite failing under load rather than on a defect,
    // which is what `waitFor`'s own comment says it exists to avoid.
    //
    // Not a weakened assertion: the room still has to reach 0, and `waitFor`
    // throws naming the condition if it never does. Removing the predicate
    // makes this test time out, which is how it was checked.
    await waitFor(
      () => editor.socket.disconnected,
      "the sweep to drop the silent socket",
    );
    await waitFor(
      () => roomSize(server, `site:${SITE_ID}:staging`) === 0,
      "the server to remove the dropped socket from the staging room",
    );
    expect(roomSize(server, `site:${SITE_ID}:staging`)).toBe(0);
  });

  it("applies the same rule to an edit-session grant", async () => {
    const editor = await connectEditor({ editToken: EDIT_TOKEN });

    db.rows("edit_sessions")[0].revoked_at = new Date().toISOString();

    await waitFor(
      () => editor.socket.disconnected,
      "the sweep to drop the revoked edit session",
    );
  });

  it("leaves a plain viewer alone — it holds no grant to revoke", async () => {
    // A socket with no editor credential never enters the staging room and has
    // nothing to re-resolve. The sweep must not disconnect it, or turning
    // realtime on would drop every visitor every 50 ms.
    const socket = openSocket({
      port,
      origin: ORIGIN,
      query: { siteId: SITE_ID, token: SITE_TOKEN },
    });
    open.push(socket);
    track(socket);
    await waitFor(
      () => roomSize(server, `site:${SITE_ID}`) === 1,
      "the viewer to join the live room",
    );

    await new Promise((resolve) => setTimeout(resolve, SWEEP_MS * 6));

    expect(socket.connected).toBe(true);
    expect(roomSize(server, `site:${SITE_ID}`)).toBe(1);
  });
});
