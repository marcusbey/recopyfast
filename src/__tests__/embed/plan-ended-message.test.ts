/**
 * s51 — the owner-plan refusal reaches the person editing, for 0 embed bytes.
 *
 * The artifact sits at its gzip ceiling, so s51 adds nothing to the widget.
 * Instead the server answers a lapsed owner's writes with a 402 whose body
 * carries the message in both `error` and `message`, and these pins prove the
 * widget ALREADY shows it and keeps its credentials:
 *
 *   - any 401/403 on a write goes to `handleTerminalWriteFailure`, which
 *     forgets the edit link, locks editing and says "Session ended — draft
 *     kept". A plan that lapsed is not a session that ended, and "nothing is
 *     revoked" means the same link must work once the owner pays. A 402 stays
 *     out of that path and is alerted as the body's own text.
 *   - the code prompt shows `message` from submit-code;
 *   - a refused grant refresh is an optimisation that failed, not a verdict:
 *     the stored grant stays.
 *
 * If one of these fails, the fix is on the server's status or body shape —
 * not a widget change, which would have to pay for itself in bytes.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const PLAN_ENDED_MESSAGE =
  "This site's plan has ended — the owner can reactivate it.";
const PLAN_ENDED_BODY = {
  error: PLAN_ENDED_MESSAGE,
  message: PLAN_ENDED_MESSAGE,
  reason: "plan_ended",
  upgradeRequired: true,
};

const WIDGET_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "embed", "recopyfast.src.js"),
  "utf8",
);

const SITE_ID = "site-abc";
const SITE_TOKEN = "site-token-xyz";
const ORIGIN = "https://app.recopyfast.test";
const API = `${ORIGIN}/api`;
const EXPIRES_AT = new Date(Date.now() + 86400000).toISOString();
const EDIT_LINK_KEY = `rcf_edit_link:${SITE_ID}`;

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("the widget shows a 402 plan_ended and keeps editing", () => {
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

  /** The owner's own edit link, as the dashboard's Edit website opens it. */
  function installFetch(writeStatus: number) {
    const impl = jest.fn(async (url: string, options?: { method?: string }) => {
      if (url.includes("staging/validate")) {
        return response(200, {
          valid: true,
          email: "owner@example.com",
          permissions: ["view", "edit", "publish"],
          expiresAt: EXPIRES_AT,
        });
      }
      if (url.includes("/staging/content/") && options?.method === "PUT") {
        return response(writeStatus, PLAN_ENDED_BODY);
      }
      if (url.includes("/staging/content/")) {
        return response(200, { content: [] });
      }
      if (url.includes("/staging/publish") && options?.method === "POST") {
        return response(writeStatus, PLAN_ENDED_BODY);
      }
      if (url.includes("/staging/publish")) {
        return response(200, { success: true, pendingChanges: 1 });
      }
      return response(200, []);
    });
    (window as unknown as { fetch: unknown }).fetch = impl;
    return impl;
  }

  async function settle() {
    for (let i = 0; i < 25; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  async function boot(writeStatus: number) {
    // A tab that already holds the owner's edit session (ADR 036); before s76
    // this landed on `?rcf_staging=1&rcf_edit_token=…`, which the widget no
    // longer reads.
    window.sessionStorage.setItem(
      `rcf_edit_link:${SITE_ID}`,
      JSON.stringify([null, "owner-edit-token"]),
    );
    window.history.replaceState(null, "", "/pricing");
    installFetch(writeStatus);
    new Function(WIDGET_SOURCE)();
    await settle();
  }

  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML =
      '<h1 id="headline">Original copy</h1><p>Another element</p>';
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/pricing");
    delete (window as unknown as Record<string, unknown>).ReCopyFast;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_API;
    delete (window as unknown as Record<string, unknown>).RECOPYFAST_WS;
    installScriptTag();
    jest.spyOn(window, "alert").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("a 402 plan_ended save alerts the server's message and keeps the edit link and editing unlocked", async () => {
    await boot(402);
    expect(window.sessionStorage.getItem(EDIT_LINK_KEY)).not.toBeNull();

    const headline = document.querySelector("h1") as HTMLElement;
    headline.click();
    headline.textContent = "Typed while the plan is lapsed";
    (document.querySelector(".rcf-btn-save") as HTMLButtonElement).click();
    await settle();

    expect(window.alert).toHaveBeenCalledWith(PLAN_ENDED_MESSAGE);
    // Not the terminal path: the link survives for when the owner pays...
    expect(window.sessionStorage.getItem(EDIT_LINK_KEY)).not.toBeNull();
    // ...editing stays open, and nothing claims the session ended.
    expect(headline.getAttribute("contenteditable")).toBe("true");
    expect(document.body.textContent).not.toContain("Session ended");
    expect(
      (
        window as unknown as {
          ReCopyFast: { isMutationLocked: boolean };
        }
      ).ReCopyFast.isMutationLocked,
    ).toBeFalsy();
  });

  it("a 402 plan_ended publish shows the server's message", async () => {
    await boot(402);
    const instance = (
      window as unknown as {
        ReCopyFast: { showPublishConfirmation(): Promise<void> };
      }
    ).ReCopyFast;

    await instance.showPublishConfirmation();
    await settle();
    (
      document.querySelector(".rcf-modal-btn-success") as HTMLButtonElement
    ).click();
    await settle();

    expect(document.querySelector("#rcf-publish-status p")?.textContent).toBe(
      PLAN_ENDED_MESSAGE,
    );
    expect(window.sessionStorage.getItem(EDIT_LINK_KEY)).not.toBeNull();
  });
});

describe("the editor auth client shows the plan-ended message and keeps its grant", () => {
  const BEGIN = "// @rcf-editor-auth:begin";
  const END = "// @rcf-editor-auth:end";
  const NOW = Date.parse("2026-09-28T12:00:00.000Z");
  const SEVEN_DAYS = new Date(NOW + 7 * 24 * 60 * 60 * 1000).toISOString();
  const GRANT_KEY = `rcf_editor_grant:${SITE_ID}`;

  interface AuthClient {
    boot(handoffCode: string | null): Promise<Record<string, unknown>>;
    submitCode(
      email: string,
      code: string,
      remember: boolean,
    ): Promise<{ ok: boolean; message?: string }>;
  }

  function loadClientFactory() {
    const begin = WIDGET_SOURCE.indexOf(BEGIN);
    const end = WIDGET_SOURCE.indexOf(END);
    if (begin === -1 || end === -1 || end < begin) {
      throw new Error(
        `recopyfast.src.js is missing the "${BEGIN}" / "${END}" markers.`,
      );
    }
    const block = WIDGET_SOURCE.slice(begin + BEGIN.length, end);
    return new Function(`return (${block});`)() as (
      deps: Record<string, unknown>,
    ) => AuthClient;
  }

  function makeStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => void map.set(key, `${value}`),
      removeItem: (key: string) => void map.delete(key),
    };
  }

  function makeClient(
    responses: Array<{ status: number; body: unknown }>,
    local = makeStorage(),
  ) {
    const fetch = jest.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return response(next.status, next.body);
    });
    const client = loadClientFactory()({
      apiUrl: API,
      siteId: SITE_ID,
      fetch,
      localStorage: local,
      sessionStorage: makeStorage(),
      location: { search: "", pathname: "/pricing", hash: "" },
      history: { state: null, replaceState: () => {} },
      now: () => NOW,
      warn: () => {},
    });
    return { client, local, fetch };
  }

  it("the code prompt shows the plan-ended message from submit-code", async () => {
    const { client, local } = makeClient([
      { status: 402, body: PLAN_ENDED_BODY },
    ]);

    const result = await client.submitCode("bob@example.com", "123456", true);

    expect(result).toEqual({ ok: false, message: PLAN_ENDED_MESSAGE });
    expect(local.getItem(GRANT_KEY)).toBeNull();
  });

  it("a refused grant refresh keeps the stored grant", async () => {
    const stored = JSON.stringify({
      grant: "rcfg1.stored",
      expiresAt: SEVEN_DAYS,
      email: "bob@example.com",
      permissions: ["view", "edit"],
      remembered: true,
    });
    const local = makeStorage();
    local.setItem(GRANT_KEY, stored);

    const { client, fetch } = makeClient(
      [
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
          status: 402,
          body: {
            ok: false,
            reason: "plan_ended",
            message: PLAN_ENDED_MESSAGE,
          },
        },
      ],
      local,
    );

    const identity = await client.boot(null);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(identity).toMatchObject({
      status: "authenticated",
      grant: "rcfg1.stored",
    });
    expect(local.getItem(GRANT_KEY)).toBe(stored);
  });
});
