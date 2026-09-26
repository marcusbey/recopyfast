/**
 * s40 — what the widget's "🪄 AI" modal sends, driven through the whole widget.
 *
 * Before s40 the modal sent `Authorization: Bearer <SITE_TOKEN>` and nothing
 * else: no `siteId`, no editor credential. The route wanted a dashboard cookie
 * the widget can never send cross-origin, so every suggestion failed. The
 * route now authorises the EDITOR — a device grant, or an edit-session /
 * staging token — and the site token is not a credential for spend at all.
 *
 * So these assert the request itself: the grant in `X-RCF-Editor-Grant` and
 * nowhere else, an edit-session token in the body and never in a URL, the
 * `siteId` the route needs, and no site token. Driven through
 * `recopyfast.src.js` rather than an extracted helper, for the reason
 * `editor-grant-requests.test.ts` gives: a helper test proves the helper while
 * a call site that forgot to use it goes on shipping the old request.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-abc";
const SITE_TOKEN = "site-token-xyz";
const ORIGIN = "https://helloworld.com";
const API = `${ORIGIN}/api`;
const GRANT = "rcfg1.the-device-grant";
const EDIT_TOKEN = "edit-tok";
const EXPIRES_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const STORAGE_KEY = `rcf_editor_grant:${SITE_ID}`;
const GRANT_HEADER = "X-RCF-Editor-Grant";
const EDITOR_DENIED =
  "AI suggestions aren't available on this site's plan right now. Ask the site owner to add AI credits.";

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

interface Reply {
  status?: number;
  body: unknown;
}

function installFetch(routes: Record<string, Reply>) {
  const recorded: Recorded[] = [];

  const impl = jest.fn(
    async (
      url: string,
      options?: {
        method?: string;
        body?: string;
        headers?: Record<string, string>;
      },
    ) => {
      recorded.push({
        url,
        method: options?.method ?? "GET",
        headers: options?.headers ?? {},
        body: options?.body ? JSON.parse(options.body) : null,
      });

      for (const [fragment, reply] of Object.entries(routes)) {
        if (url.includes(fragment)) {
          const status = reply.status ?? 200;
          return {
            ok: status < 400,
            status,
            json: async () => reply.body,
          };
        }
      }

      return { ok: true, status: 200, json: async () => [] };
    },
  );

  (window as unknown as { fetch: unknown }).fetch = impl;
  return recorded;
}

function installScriptTag() {
  const script = document.createElement("script");
  script.setAttribute("data-site-id", SITE_ID);
  script.setAttribute("data-site-token", SITE_TOKEN);
  script.setAttribute("data-api-url", API);
  document.head.appendChild(script);

  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get: () => script,
  });
}

async function settle() {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface WidgetInstance {
  showAISuggestions(input: { value: string }, elementId: string): void;
}

function widget(): WidgetInstance {
  return (window as unknown as { ReCopyFast: WidgetInstance }).ReCopyFast;
}

const SUGGESTED: Reply = {
  body: { success: true, suggestions: ["Hello, world!"] },
};

/** Boots with a device grant already in this browser's storage. */
async function bootGrantHolder(aiReply: Reply = SUGGESTED) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      grant: GRANT,
      expiresAt: EXPIRES_AT,
      email: "bob@example.com",
      permissions: ["view", "edit"],
      remembered: true,
    }),
  );

  const recorded = installFetch({
    "editor/validate-grant": {
      body: {
        valid: true,
        email: "bob@example.com",
        permissions: ["view", "edit"],
        expiresAt: EXPIRES_AT,
        shouldRefresh: false,
      },
    },
    "staging/content": { body: { content: [] } },
    "/ai/suggest": aiReply,
  });

  new Function(WIDGET_SOURCE)();
  await settle();
  return recorded;
}

/** Boots the owner's edit-session link, as the dashboard's "Edit" opens it. */
async function bootEditSessionOwner() {
  window.history.replaceState(
    null,
    "",
    `/pricing?rcf_edit_token=${EDIT_TOKEN}`,
  );

  const recorded = installFetch({
    "staging/validate": {
      body: {
        valid: true,
        email: "owner@example.com",
        permissions: ["view", "edit"],
        expiresAt: EXPIRES_AT,
      },
    },
    "staging/content": { body: { content: [] } },
    "/ai/suggest": SUGGESTED,
  });

  new Function(WIDGET_SOURCE)();
  await settle();
  return recorded;
}

async function generateFor(text: string) {
  widget().showAISuggestions({ value: text }, "rcf-headline");
  const generate = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.includes("Generate Suggestions"),
  );
  expect(generate).toBeDefined();
  generate!.click();
  await settle();
}

function aiCalls(recorded: Recorded[]) {
  return recorded.filter((call) => call.url.includes("/ai/suggest"));
}

describe("the AI modal sends editor credentials, never the site token", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML =
      '<h1 id="headline">Hello world</h1><p>Some copy to edit.</p>';
    document.body.style.paddingTop = "";
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/pricing");
    delete (window as unknown as Record<string, unknown>).ReCopyFast;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_API;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_WS;
    installScriptTag();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("a grant holder's request carries the grant header, the siteId, and nothing in the URL", async () => {
    const recorded = await bootGrantHolder();

    await generateFor("Hello world");

    const calls = aiCalls(recorded);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${API}/ai/suggest`);
    expect(call.headers[GRANT_HEADER]).toBe(GRANT);
    expect(call.headers).not.toHaveProperty("Authorization");
    expect(call.body).toEqual({
      siteId: SITE_ID,
      text: "Hello world",
      context: "website content",
      goal: "improve",
      tone: "professional",
    });
    expect(call.url).not.toContain(GRANT);
    expect(JSON.stringify(call.body)).not.toContain(GRANT);
    expect(JSON.stringify(call)).not.toContain(SITE_TOKEN);
    // And the suggestion arrived.
    expect(document.body.textContent).toContain("Hello, world!");
  });

  it("an edit-session owner's token rides in the body, never a URL or header", async () => {
    const recorded = await bootEditSessionOwner();

    await generateFor("Hello world");

    const calls = aiCalls(recorded);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.body?.editToken).toBe(EDIT_TOKEN);
    expect(call.body?.siteId).toBe(SITE_ID);
    expect(call.url).toBe(`${API}/ai/suggest`);
    expect(call.url).not.toContain(EDIT_TOKEN);
    expect(JSON.stringify(call.headers)).not.toContain(EDIT_TOKEN);
    expect(call.headers).not.toHaveProperty(GRANT_HEADER);
    expect(call.headers).not.toHaveProperty("Authorization");
    expect(window.location.href).not.toContain(EDIT_TOKEN);
  });

  it("shows the server's own sentence when the request is refused", async () => {
    await bootGrantHolder({ status: 403, body: { error: EDITOR_DENIED } });

    await generateFor("Hello world");

    expect(document.body.textContent).toContain(EDITOR_DENIED);
  });

  it("falls back to the generic sentence when the server gives none", async () => {
    await bootGrantHolder({ status: 500, body: {} });

    await generateFor("Hello world");

    expect(document.body.textContent).toContain(
      "Failed to generate suggestions. Please try again.",
    );
  });
});

describe("the Edit Board no longer offers AI auto-translation", () => {
  it("has no auto-translate control or field anywhere in the widget", () => {
    expect(WIDGET_SOURCE).not.toContain("autoTranslate");
    expect(WIDGET_SOURCE).not.toContain("Auto-translate");
  });

  it("adds a language with only the site and the language code", () => {
    const post = WIDGET_SOURCE.match(
      /fetch\(RECOPYFAST_API \+ '\/edit-board\/languages', \{\s*method: 'POST'[\s\S]*?body: JSON\.stringify\((\{[\s\S]*?\})\)/,
    );

    // GUARD: the absences above only mean something if the request still exists.
    expect(post).not.toBeNull();
    const fields = (post![1].match(/(\w+)\s*:/g) ?? []).map((field) =>
      field.replace(/\s*:$/, ""),
    );
    expect(fields).toEqual(["siteId", "languageCode"]);
  });
});
