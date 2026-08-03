/**
 * The widget's client for the magic-code editor system (`/api/editor/*`).
 *
 * These tests run the code that actually ships. `public/embed/recopyfast.src.js`
 * is a browser IIFE that reads `document.currentScript` at parse time and cannot
 * simply be imported, so the client is written inside it as a
 * dependency-injected factory between two markers, and the suite slices that
 * block out of the file and evaluates it. A transcription of the client into the
 * test would pass forever while the shipped widget rotted; this cannot.
 *
 * The behaviours pinned here are the ones the server's contract actually turns
 * on, and several are recorded defects:
 *
 *   - `nextAction` has three values, not two. `refresh` means a sibling tab
 *     rotated the token and wrote the replacement to shared storage — re-read
 *     and retry, do not prompt (QA-REGISTER.md, P0-1 note).
 *   - A forwarded grant fails the User-Agent binding and must land on the code
 *     prompt. Nothing here may retry its way past that.
 *   - A 5xx is our outage, not a verdict, and must never discard a credential.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = path.join(
  process.cwd(),
  "public",
  "embed",
  "recopyfast.src.js",
);

const BEGIN = "// @rcf-editor-auth:begin";
const END = "// @rcf-editor-auth:end";

function loadClientFactory() {
  const source = readFileSync(WIDGET_SOURCE, "utf8");
  const begin = source.indexOf(BEGIN);
  const end = source.indexOf(END);

  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `public/embed/recopyfast.src.js is missing the "${BEGIN}" / "${END}" markers, ` +
        "so the editor auth client cannot be extracted. Do not delete them.",
    );
  }

  const block = source.slice(begin + BEGIN.length, end);
  return new Function(`return (${block});`)() as (
    deps: Record<string, unknown>,
  ) => EditorAuthClient;
}

interface Identity {
  status: string;
  grant?: string;
  email?: string | null;
  permissions?: string[];
  expiresAt?: string | null;
  remembered?: boolean;
  reason?: string;
}

interface EditorAuthClient {
  storageKey: string;
  consumeHandoffFromUrl(): string | null;
  boot(handoffCode: string | null): Promise<Identity>;
  requestCode(email: string): Promise<{ ok: boolean; message: string }>;
  submitCode(
    email: string,
    code: string,
    remember: boolean,
  ): Promise<{ ok: boolean; message?: string; identity?: Identity }>;
  readStored(): Record<string, unknown> | null;
  clearStored(): void;
}

const createEditorAuthClient = loadClientFactory();

const SITE_ID = "site-abc";
const API = "https://recopyfast.com/api";
const NOW = Date.parse("2026-08-03T12:00:00.000Z");

const SEVEN_DAYS = new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString();
const TWELVE_HOURS = new Date(NOW + 12 * 60 * 60 * 1000).toISOString();

/** Minimal Storage stand-in. jsdom's is shared across tests; this is not. */
function makeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, `${value}`),
    removeItem: (key: string) => void map.delete(key),
  };
}

interface Call {
  url: string;
  body: Record<string, unknown>;
}

interface Queued {
  status: number;
  body: unknown;
  /**
   * Runs while this response is in flight. The rotation cases need a sibling
   * tab to write its replacement *after* this tab has read storage and sent its
   * request — seeding it beforehand would just mean the first request already
   * carried the new token, which is a different scenario entirely.
   */
  meanwhile?: () => void;
}

function makeFetch(responses: Array<Queued | Error>) {
  const calls: Call[] = [];

  const impl = jest.fn(async (url: string, options: { body: string }) => {
    calls.push({ url, body: JSON.parse(options.body) });

    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    if (next instanceof Error) throw next;

    if (next.meanwhile) next.meanwhile();

    return {
      status: next.status,
      ok: next.status >= 200 && next.status < 300,
      json: async () => next.body,
    };
  });

  return { impl, calls };
}

function makeClient(options: {
  fetch: unknown;
  search?: string;
  local?: ReturnType<typeof makeStorage>;
  session?: ReturnType<typeof makeStorage>;
  history?: unknown;
}) {
  const local = options.local ?? makeStorage();
  const session = options.session ?? makeStorage();
  const replaced: string[] = [];

  const client = createEditorAuthClient({
    apiUrl: API,
    siteId: SITE_ID,
    fetch: options.fetch,
    localStorage: local,
    sessionStorage: session,
    location: {
      search: options.search ?? "",
      pathname: "/pricing",
      hash: "",
    },
    history: options.history ?? {
      state: { some: "state" },
      replaceState: (_state: unknown, _title: string, url: string) =>
        void replaced.push(url),
    },
    now: () => NOW,
    warn: () => {},
  });

  return { client, local, session, replaced };
}

const REDEEMED = {
  ok: true,
  grant: "rcfg1.handoff-grant",
  expiresAt: SEVEN_DAYS,
  email: "bob@example.com",
  permissions: ["view", "edit"],
};

function storedRecord(
  store: ReturnType<typeof makeStorage>,
): Record<string, unknown> | null {
  const raw = store.getItem(`rcf_editor_grant:${SITE_ID}`);
  return raw ? JSON.parse(raw) : null;
}

function seed(
  store: ReturnType<typeof makeStorage>,
  record: Record<string, unknown>,
) {
  store.setItem(`rcf_editor_grant:${SITE_ID}`, JSON.stringify(record));
}

const STORED_GRANT = {
  grant: "rcfg1.stored",
  expiresAt: SEVEN_DAYS,
  email: "bob@example.com",
  permissions: ["view", "edit"],
  remembered: true,
};

describe("editor auth client — handoff redemption", () => {
  it("takes the handoff code out of the URL and leaves the rest of the query alone", () => {
    const { client, replaced } = makeClient({
      fetch: makeFetch([]).impl,
      search: "?utm_source=email&rcf_handoff=SECRET&page=2",
    });

    expect(client.consumeHandoffFromUrl()).toBe("SECRET");
    expect(replaced).toEqual(["/pricing?utm_source=email&page=2"]);
  });

  it("returns null and rewrites nothing when there is no handoff code", () => {
    const { client, replaced } = makeClient({
      fetch: makeFetch([]).impl,
      search: "?utm_source=email",
    });

    expect(client.consumeHandoffFromUrl()).toBeNull();
    expect(replaced).toEqual([]);
  });

  it("redeems the code for a grant and reports the editor — the whole round trip", async () => {
    const { impl, calls } = makeFetch([{ status: 200, body: REDEEMED }]);
    const { client, local, replaced } = makeClient({
      fetch: impl,
      search: "?rcf_handoff=SECRET",
    });

    const code = client.consumeHandoffFromUrl();
    const identity = await client.boot(code);

    // Stripped before the request was even made.
    expect(replaced).toEqual(["/pricing"]);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${API}/editor/handoff/redeem`);
    expect(calls[0].body).toEqual({ code: "SECRET", siteId: SITE_ID });

    expect(identity).toEqual({
      status: "authenticated",
      grant: "rcfg1.handoff-grant",
      email: "bob@example.com",
      permissions: ["view", "edit"],
      expiresAt: SEVEN_DAYS,
      remembered: true,
    });

    // Persisted, so tomorrow's load is still an editor.
    expect(storedRecord(local)).toMatchObject({
      grant: "rcfg1.handoff-grant",
      email: "bob@example.com",
    });
  });

  it("strips the code even when redemption is refused", async () => {
    const { impl } = makeFetch([
      { status: 401, body: { ok: false, reason: "consumed" } },
    ]);
    const { client, replaced } = makeClient({
      fetch: impl,
      search: "?rcf_handoff=SPENT",
    });

    const code = client.consumeHandoffFromUrl();
    expect(replaced).toEqual(["/pricing"]);

    await expect(client.boot(code)).resolves.toEqual({ status: "anonymous" });
  });

  it("keeps a grant this browser already holds when a stale handoff code is refused", async () => {
    const local = makeStorage();
    seed(local, STORED_GRANT);

    const { impl } = makeFetch([
      { status: 401, body: { ok: false, reason: "consumed" } },
      {
        status: 200,
        body: {
          valid: true,
          email: "bob@example.com",
          permissions: ["view", "edit"],
          expiresAt: SEVEN_DAYS,
          shouldRefresh: false,
        },
      },
    ]);

    const { client } = makeClient({ fetch: impl, local });
    const identity = await client.boot("STALE");

    expect(identity.status).toBe("authenticated");
    expect(identity.grant).toBe("rcfg1.stored");
    expect(storedRecord(local)).not.toBeNull();
  });

  it("puts a remembered grant in localStorage and an unremembered one in sessionStorage", async () => {
    const remembered = makeFetch([{ status: 200, body: REDEEMED }]);
    const first = makeClient({ fetch: remembered.impl });
    await first.client.boot("A");

    expect(storedRecord(first.local)).toMatchObject({ remembered: true });
    expect(storedRecord(first.session)).toBeNull();

    const shortLived = makeFetch([
      { status: 200, body: { ...REDEEMED, expiresAt: TWELVE_HOURS } },
    ]);
    const second = makeClient({ fetch: shortLived.impl });
    await second.client.boot("B");

    // A twelve-hour grant is the unchecked "remember this device" box, and the
    // server refuses it after twelve hours regardless — so it belongs in
    // sessionStorage, where closing the tab ends it.
    expect(storedRecord(second.session)).toMatchObject({ remembered: false });
    expect(storedRecord(second.local)).toBeNull();
  });
});

describe("editor auth client — returning with a stored grant", () => {
  it("validates the stored grant and stays signed in", async () => {
    const local = makeStorage();
    seed(local, STORED_GRANT);

    const { impl, calls } = makeFetch([
      {
        status: 200,
        body: {
          valid: true,
          email: "bob@example.com",
          permissions: ["view", "edit", "publish"],
          expiresAt: SEVEN_DAYS,
          shouldRefresh: false,
        },
      },
    ]);

    const { client } = makeClient({ fetch: impl, local });
    const identity = await client.boot(null);

    expect(calls[0].url).toBe(`${API}/editor/validate-grant`);
    expect(calls[0].body).toEqual({ grant: "rcfg1.stored", siteId: SITE_ID });
    expect(identity).toMatchObject({
      status: "authenticated",
      permissions: ["view", "edit", "publish"],
    });
  });

  it("makes no request at all when nothing is stored", async () => {
    const { impl } = makeFetch([]);
    const { client } = makeClient({ fetch: impl });

    await expect(client.boot(null)).resolves.toEqual({ status: "anonymous" });
    expect(impl).not.toHaveBeenCalled();
  });

  it("slides the expiry when the server asks, keeping the editor's identity across the rotation", async () => {
    const local = makeStorage();
    seed(local, STORED_GRANT);

    const { impl, calls } = makeFetch([
      {
        status: 200,
        body: {
          valid: true,
          email: "bob@example.com",
          permissions: ["view", "edit"],
          expiresAt: SEVEN_DAYS,
          shouldRefresh: true,
        },
      },
      // refresh-grant returns the token and nothing else.
      {
        status: 200,
        body: { ok: true, grant: "rcfg1.rotated", expiresAt: SEVEN_DAYS },
      },
    ]);

    const { client } = makeClient({ fetch: impl, local });
    const identity = await client.boot(null);

    expect(calls[1].url).toBe(`${API}/editor/refresh-grant`);
    expect(calls[1].body).toEqual({
      grant: "rcfg1.stored",
      siteId: SITE_ID,
      rememberDevice: true,
    });

    expect(identity).toMatchObject({
      status: "authenticated",
      grant: "rcfg1.rotated",
      // Carried across, not dropped, even though refresh-grant never sent it.
      email: "bob@example.com",
      permissions: ["view", "edit"],
    });
    expect(storedRecord(local)).toMatchObject({ grant: "rcfg1.rotated" });
  });

  it("stays signed in when the slide fails for an ordinary reason", async () => {
    const local = makeStorage();
    seed(local, STORED_GRANT);

    const { impl } = makeFetch([
      {
        status: 200,
        body: {
          valid: true,
          email: "bob@example.com",
          permissions: ["view", "edit"],
          expiresAt: SEVEN_DAYS,
          shouldRefresh: true,
        },
      },
      { status: 500, body: { ok: false, reason: "error" } },
    ]);

    const { client } = makeClient({ fetch: impl, local });
    const identity = await client.boot(null);

    // validate already said the grant is good. A failed optimisation is not
    // grounds for sending a signed-in editor to a code prompt.
    expect(identity).toMatchObject({
      status: "authenticated",
      grant: "rcfg1.stored",
    });
    expect(storedRecord(local)).not.toBeNull();
  });
});

describe("editor auth client — the third nextAction", () => {
  it("re-reads storage and retries once when told to refresh, instead of prompting", async () => {
    const local = makeStorage();
    seed(local, STORED_GRANT);

    const { impl, calls } = makeFetch([
      // This tab presents the token it read at boot. A sibling rotates it while
      // that request is in flight and writes the replacement to shared storage.
      {
        status: 401,
        body: { valid: false, reason: "replayed", nextAction: "refresh" },
        meanwhile: () =>
          seed(local, { ...STORED_GRANT, grant: "rcfg1.sibling-wrote-this" }),
      },
      {
        status: 200,
        body: {
          valid: true,
          email: "bob@example.com",
          permissions: ["view", "edit"],
          expiresAt: SEVEN_DAYS,
          shouldRefresh: false,
        },
      },
    ]);

    const { client } = makeClient({ fetch: impl, local });
    const identity = await client.boot(null);

    expect(calls).toHaveLength(2);
    // The first attempt carried the token this tab actually held.
    expect(calls[0].body).toEqual({ grant: "rcfg1.stored", siteId: SITE_ID });
    expect(calls[1].body).toEqual({
      grant: "rcfg1.sibling-wrote-this",
      siteId: SITE_ID,
    });
    expect(identity).toMatchObject({
      status: "authenticated",
      grant: "rcfg1.sibling-wrote-this",
    });
  });

  it("falls through to the code prompt when the retry is also refused, and retries only once", async () => {
    const local = makeStorage();
    seed(local, STORED_GRANT);

    const { impl, calls } = makeFetch([
      {
        status: 401,
        body: { valid: false, reason: "replayed", nextAction: "refresh" },
        meanwhile: () =>
          seed(local, { ...STORED_GRANT, grant: "rcfg1.also-superseded" }),
      },
      {
        status: 401,
        body: { valid: false, reason: "replayed", nextAction: "refresh" },
        // A second sibling write. It must not buy a third attempt.
        meanwhile: () =>
          seed(local, { ...STORED_GRANT, grant: "rcfg1.and-again" }),
      },
    ]);

    const { client, session } = makeClient({ fetch: impl, local });
    const identity = await client.boot(null);

    expect(calls).toHaveLength(2);
    expect(identity).toMatchObject({
      status: "needs-code",
      reason: "replayed",
    });
    expect(storedRecord(local)).toBeNull();
    expect(storedRecord(session)).toBeNull();
  });

  it("does not retry when storage still holds the very token that was refused", async () => {
    const local = makeStorage();
    seed(local, STORED_GRANT);

    const { impl, calls } = makeFetch([
      {
        status: 401,
        body: { valid: false, reason: "raced", nextAction: "refresh" },
      },
    ]);

    const { client } = makeClient({ fetch: impl, local });
    const identity = await client.boot(null);

    // No sibling wrote anything, so re-reading cannot help and a second
    // identical request would only be noise.
    expect(calls).toHaveLength(1);
    expect(identity).toMatchObject({ status: "needs-code" });
  });

  it("picks up the winner's token when refresh-grant loses the rotation race", async () => {
    const local = makeStorage();
    seed(local, STORED_GRANT);

    const { impl } = makeFetch([
      {
        status: 200,
        body: {
          valid: true,
          email: "bob@example.com",
          permissions: ["view", "edit"],
          expiresAt: SEVEN_DAYS,
          shouldRefresh: true,
        },
      },
      {
        status: 401,
        body: { ok: false, reason: "raced", nextAction: "refresh" },
        // The tab that won the conditional UPDATE mints and stores first.
        meanwhile: () =>
          seed(local, { ...STORED_GRANT, grant: "rcfg1.winner" }),
      },
    ]);

    const { client } = makeClient({ fetch: impl, local });
    const identity = await client.boot(null);

    expect(identity).toMatchObject({
      status: "authenticated",
      grant: "rcfg1.winner",
    });
  });
});

describe("editor auth client — refusals that must stick", () => {
  it("hides rather than prompts when the editor has been revoked", async () => {
    const local = makeStorage();
    seed(local, STORED_GRANT);

    const { impl } = makeFetch([
      {
        status: 401,
        body: { valid: false, reason: "editor_revoked", nextAction: "hide" },
      },
    ]);

    const { client } = makeClient({ fetch: impl, local });
    const identity = await client.boot(null);

    expect(identity).toEqual({ status: "hidden", reason: "editor_revoked" });
    expect(storedRecord(local)).toBeNull();
  });

  it("sends a grant carried to another browser to the code prompt, without retrying past it", async () => {
    const local = makeStorage();
    seed(local, STORED_GRANT);

    const { impl, calls } = makeFetch([
      {
        status: 401,
        body: { valid: false, reason: "device_mismatch", nextAction: "verify" },
      },
    ]);

    const { client } = makeClient({ fetch: impl, local });
    const identity = await client.boot(null);

    // The User-Agent binding is the control that makes a forwarded link useless.
    // Exactly one attempt, and the credential is discarded.
    expect(calls).toHaveLength(1);
    expect(identity).toMatchObject({
      status: "needs-code",
      reason: "device_mismatch",
    });
    expect(storedRecord(local)).toBeNull();
  });

  it("keeps the grant when validation 500s — an outage is not a verdict", async () => {
    const local = makeStorage();
    seed(local, STORED_GRANT);

    const { impl } = makeFetch([{ status: 500, body: { valid: false } }]);
    const { client } = makeClient({ fetch: impl, local });

    await expect(client.boot(null)).resolves.toEqual({ status: "offline" });
    expect(storedRecord(local)).toMatchObject({ grant: "rcfg1.stored" });
  });

  it("keeps the grant when the network is unreachable", async () => {
    const local = makeStorage();
    seed(local, STORED_GRANT);

    const { impl } = makeFetch([new Error("Failed to fetch")]);
    const { client } = makeClient({ fetch: impl, local });

    await expect(client.boot(null)).resolves.toEqual({ status: "offline" });
    expect(storedRecord(local)).toMatchObject({ grant: "rcfg1.stored" });
  });
});

describe("editor auth client — the in-page code prompt", () => {
  it("asks for a code and passes the server's neutral message through unchanged", async () => {
    const message = "If that address can edit this site, a code is on its way.";
    const { impl, calls } = makeFetch([
      { status: 200, body: { ok: true, message } },
    ]);

    const { client } = makeClient({ fetch: impl });
    const result = await client.requestCode("bob@example.com");

    expect(calls[0].url).toBe(`${API}/editor/request-code`);
    expect(calls[0].body).toEqual({
      email: "bob@example.com",
      siteId: SITE_ID,
    });
    // Rewording this per outcome would rebuild the existence oracle the route
    // was changed to close.
    expect(result).toEqual({ ok: true, message });
  });

  it("exchanges a code for a grant and remembers the device when asked", async () => {
    const { impl, calls } = makeFetch([
      {
        status: 200,
        body: {
          ok: true,
          mode: "site",
          grant: "rcfg1.from-code",
          expiresAt: SEVEN_DAYS,
          rememberDevice: true,
          email: "bob@example.com",
          permissions: ["view", "edit"],
        },
      },
    ]);

    const { client, local } = makeClient({ fetch: impl });
    const result = await client.submitCode("bob@example.com", "123456", true);

    expect(calls[0].url).toBe(`${API}/editor/submit-code`);
    expect(calls[0].body).toEqual({
      email: "bob@example.com",
      code: "123456",
      siteId: SITE_ID,
      rememberDevice: true,
    });

    expect(result.ok).toBe(true);
    expect(result.identity).toMatchObject({
      status: "authenticated",
      grant: "rcfg1.from-code",
      email: "bob@example.com",
    });
    expect(storedRecord(local)).toMatchObject({ grant: "rcfg1.from-code" });
  });

  it("stores an unremembered grant in sessionStorage even when its expiry looks long", async () => {
    const { impl } = makeFetch([
      {
        status: 200,
        body: {
          ok: true,
          grant: "rcfg1.session-only",
          expiresAt: SEVEN_DAYS,
          rememberDevice: false,
          email: "bob@example.com",
          permissions: ["view"],
        },
      },
    ]);

    const { client, local, session } = makeClient({ fetch: impl });
    await client.submitCode("bob@example.com", "123456", false);

    // submit-code states the choice outright, so it is believed over the expiry
    // heuristic that handoff/redeem requires.
    expect(storedRecord(session)).toMatchObject({ remembered: false });
    expect(storedRecord(local)).toBeNull();
  });

  it("surfaces the server's rejection and stores nothing", async () => {
    const { impl } = makeFetch([
      {
        status: 401,
        body: {
          error: "invalid_code",
          message: "That code isn't valid. Request a new one.",
        },
      },
    ]);

    const { client, local, session } = makeClient({ fetch: impl });
    const result = await client.submitCode("bob@example.com", "000000", true);

    expect(result).toEqual({
      ok: false,
      message: "That code isn't valid. Request a new one.",
    });
    expect(storedRecord(local)).toBeNull();
    expect(storedRecord(session)).toBeNull();
  });
});

describe("editor auth client — storage hygiene", () => {
  it("survives storage that throws, as it does when cookies are blocked", async () => {
    const hostile = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };

    const { impl } = makeFetch([{ status: 200, body: REDEEMED }]);
    const client = createEditorAuthClient({
      apiUrl: API,
      siteId: SITE_ID,
      fetch: impl,
      localStorage: hostile,
      sessionStorage: hostile,
      location: { search: "", pathname: "/", hash: "" },
      history: { state: null, replaceState: () => {} },
      now: () => NOW,
      warn: () => {},
    });

    // An editor whose browser refuses storage is a visitor, not a stack trace
    // on the customer's page.
    await expect(client.boot("CODE")).resolves.toMatchObject({
      status: "authenticated",
    });
  });

  it("ignores a corrupted storage entry rather than throwing", async () => {
    const local = makeStorage();
    local.setItem(`rcf_editor_grant:${SITE_ID}`, "{not json");

    const { impl } = makeFetch([]);
    const { client } = makeClient({ fetch: impl, local });

    await expect(client.boot(null)).resolves.toEqual({ status: "anonymous" });
    expect(impl).not.toHaveBeenCalled();
  });

  it("scopes the credential to the site, so two sites on one domain cannot read each other's", () => {
    const { client } = makeClient({ fetch: makeFetch([]).impl });
    expect(client.storageKey).toBe(`rcf_editor_grant:${SITE_ID}`);
  });
});
