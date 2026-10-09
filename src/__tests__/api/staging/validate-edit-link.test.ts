/**
 * @jest-environment node
 */

/*
 * s76 (ADR 055) — the widget's boot check spends an edit-link code, once.
 *
 * The owner's "Edit website" link carries `#rcf_edit=<code>`: a signed
 * envelope naming one edit session and one site, dead after 60 seconds. The
 * widget sends it as `editToken` to POST /api/staging/validate, the one route
 * that recognises it. Spent = the conditional write `last_used_at = now()` on
 * a session that has never been used, which is exactly a link that has never
 * been opened. The answer carries the session's token; from then on the tab
 * holds the token (ADR 036) and the code is worthless.
 *
 * The fake is stateful and applies every filter, so "the same code again"
 * really meets a session the first request spent, and a consume that forgot
 * `last_used_at IS NULL` or the site goes red.
 */

process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { mintEditLinkCode } from "@/lib/auth/edit-link";
import {
  CRYPTO_DOMAIN,
  encodeSignedToken,
  resetSigningKeyCache,
} from "@/lib/auth/editor-crypto";
import { POST as VALIDATE } from "@/app/api/staging/validate/route";
import { validateEditorAccess } from "@/lib/auth/editor-access";

jest.mock("@/lib/supabase/service");

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SITE_ID = "99999999-9999-4999-8999-999999999999";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "the-edit-session-token-the-tab-will-hold";
const ORIGIN = "https://customer.example";

type Row = Record<string, unknown>;

function makeWorld(
  options: { failConsume?: boolean; liveGrant?: boolean } = {},
) {
  const tables: Record<string, Row[]> = {
    sites: [{ id: SITE_ID, domain: "customer.example" }],
    edit_sessions: [
      {
        id: SESSION_ID,
        token: TOKEN,
        site_id: SITE_ID,
        user_id: OWNER_ID,
        permissions: ["edit", "admin"],
        is_active: true,
        created_at: new Date(Date.now() - 1000).toISOString(),
        expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        last_used_at: null,
      },
    ],
    site_permissions:
      options.liveGrant === false
        ? []
        : [{ site_id: SITE_ID, user_id: OWNER_ID, permission: "admin" }],
  };
  let calls = 0;

  function from(table: string) {
    calls += 1;
    const filters: Array<(row: Row) => boolean> = [];
    let update: Row | null = null;

    const matching = () =>
      (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));

    const run = (single: boolean) => {
      if (update) {
        if (
          table === "edit_sessions" &&
          options.failConsume &&
          "last_used_at" in update
        ) {
          return { data: null, error: { message: "connection reset" } };
        }
        const rows = matching();
        for (const row of rows) Object.assign(row, update);
        return { data: rows.map((row) => ({ ...row })), error: null };
      }
      const rows = matching();
      return single
        ? { data: rows[0] ?? null, error: null }
        : { data: rows, error: null };
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (values: Row) => {
        update = values;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return chain;
      },
      gt: (column: string, value: string) => {
        filters.push((row) => String(row[column]) > value);
        return chain;
      },
      gte: (column: string, value: string) => {
        filters.push((row) => String(row[column]) >= value);
        return chain;
      },
      maybeSingle: () => Promise.resolve(run(true)),
      single: () => Promise.resolve(run(true)),
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(run(false)).then(onOk, onErr),
    };
    return chain;
  }

  jest
    .mocked(createServiceRoleClient)
    .mockReturnValue({ from } as unknown as ReturnType<
      typeof createServiceRoleClient
    >);

  return {
    session: () => tables.edit_sessions[0],
    databaseCalls: () => calls,
  };
}

function bootCheck(
  editToken: string,
  options: { siteId?: string; origin?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/120",
  };
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin) headers.Origin = origin;

  return VALIDATE(
    new NextRequest("https://www.recopyfa.st/api/staging/validate", {
      method: "POST",
      headers,
      // Exactly the widget's body since s76: no `|| undefined`, so an absent
      // staging token is sent as null.
      body: JSON.stringify({
        token: null,
        editToken,
        siteId: options.siteId ?? SITE_ID,
      }),
    }),
  ) as unknown as Promise<Response>;
}

function freshCode(siteId = SITE_ID) {
  return mintEditLinkCode({ sessionId: SESSION_ID, siteId });
}

beforeEach(() => {
  resetSigningKeyCache();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /api/staging/validate spends an edit-link code once", () => {
  it("answers the session's token for a fresh code, and marks the link opened", async () => {
    const world = makeWorld();

    const response = await bootCheck(freshCode());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      valid: true,
      kind: "edit-session",
      editToken: TOKEN,
      permissions: ["view", "edit", "publish", "admin"],
    });
    expect(typeof world.session().last_used_at).toBe("string");
  });

  it("refuses the same code a second time and answers no token", async () => {
    makeWorld();
    const code = freshCode();
    expect((await bootCheck(code)).status).toBe(200);

    const replay = await bootCheck(code);
    const body = await replay.json();

    expect(replay.status).toBe(401);
    expect(body.valid).toBe(false);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("refuses a code for a session the token has already been used on", async () => {
    // Opening the link is the session's first use; any use closes the link.
    const world = makeWorld();
    world.session().last_used_at = new Date().toISOString();

    const response = await bootCheck(freshCode());

    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain(TOKEN);
  });

  it.each([
    [
      "expired",
      () =>
        encodeSignedToken("rcfl1", CRYPTO_DOMAIN.editLink, {
          e: SESSION_ID,
          s: SITE_ID,
          x: Math.floor(Date.now() / 1000) - 1,
        }),
    ],
    ["minted for another site", () => freshCode(OTHER_SITE_ID)],
    [
      "forged",
      () => {
        const [prefix, , signature] = freshCode().split(".");
        const payload = Buffer.from(
          JSON.stringify({ e: SESSION_ID, s: SITE_ID, x: 4102444800 }),
        ).toString("base64url");
        return `${prefix}.${payload}.${signature}`;
      },
    ],
  ])(
    "refuses a code that is %s before touching the database",
    async (_, code) => {
      const world = makeWorld();

      const response = await bootCheck(code());

      expect(response.status).toBe(401);
      expect(world.databaseCalls()).toBe(0);
      expect(world.session().last_used_at).toBeNull();
    },
  );

  it.each([
    ["another origin", "https://attacker.example"],
    ["a subdomain of the site (L12)", "https://evil.customer.example"],
    ["no Origin at all", null],
  ])(
    "refuses a code presented from %s, and leaves it unspent",
    async (_, origin) => {
      const world = makeWorld();

      const response = await bootCheck(freshCode(), { origin });

      expect(response.status).toBe(403);
      expect(world.session().last_used_at).toBeNull();
    },
  );

  it("answers 503, not 401, when the code cannot be spent for an outage", async () => {
    // The widget keeps what it holds on a 5xx and the code is still unspent,
    // so a retry within the minute still works.
    const world = makeWorld({ failConsume: true });

    const response = await bootCheck(freshCode());

    expect(response.status).toBe(503);
    expect(world.session().last_used_at).toBeNull();
  });

  it("refuses a code whose session's holder has lost their grant (ADR 047)", async () => {
    makeWorld({ liveGrant: false });

    const response = await bootCheck(freshCode());

    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain(TOKEN);
  });

  it("still validates a tab's stored token, and re-issues nothing", async () => {
    // The next page of the site: the tab sends the token it holds.
    makeWorld();

    const response = await bootCheck(TOKEN);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body).not.toHaveProperty("editToken");
  });
});

describe("no other route spends a code", () => {
  it("the validator every other route uses treats a code as an unknown edit token", async () => {
    // One spender is what makes "single use" checkable (ADR 055). Content
    // reads and writes, publish, AI suggest, extend and edit-sessions/validate
    // all reach an edit-session credential through `validateEditorAccess`
    // (via validateEditorTokenFromRequest), so a code that arrives there —
    // as `?rcf_edit_token=` or a body `editToken` — must be refused as the
    // unknown token it is, and must leave the link unopened.
    const world = makeWorld();

    const result = await validateEditorAccess({
      siteId: SITE_ID,
      token: { kind: "edit-session", token: freshCode() },
    });

    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
    expect(world.session().last_used_at).toBeNull();
  });
});
