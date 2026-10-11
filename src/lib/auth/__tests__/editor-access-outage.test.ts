/**
 * @jest-environment node
 */

/*
 * s76 (s41 review follow-up): an outage is not a verdict.
 *
 * The widget forgets an edit link, locks a session's writes, or throws away a
 * device grant only when the server says the credential itself was refused —
 * 401 or 403. Everything else (a 5xx, a network failure) is "try again later"
 * and the credential is kept (recopyfast.src.js: initStagingMode,
 * handleTerminalWriteFailure, the grant client's validate()). So the server
 * must never answer an infrastructure failure with 401. It did: supabase-js
 * RETURNS its errors rather than throwing them, and every editor validator
 * folded "the database did not answer" into "no such credential" — a
 * `.single()` that errored looked exactly like a `.single()` that found
 * nothing. One database blip signed every link editor out of every site.
 *
 * The fake applies every filter and can make any one table fail, so each row
 * below fails one read and nothing else. The 401 rows are the controls: the
 * verdicts must not turn into 503s.
 */

process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { validateEditorAccess } from "../editor-access";
import {
  CRYPTO_DOMAIN,
  encodeSignedToken,
  hashOpaqueSecret,
  hashOrigin,
  hashUserAgent,
  resetSigningKeyCache,
} from "../editor-crypto";

jest.mock("@/lib/supabase/service");

const SITE_ID = "site-a";
const ORIGIN = "https://customer.example";
const USER_AGENT = "Mozilla/5.0 (Macintosh) Chrome/120";
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const ISSUED = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const DB_ERROR = {
  message: "connection terminated unexpectedly",
  code: "08006",
};

const GRANT = encodeSignedToken("rcfg1", CRYPTO_DOMAIN.grant, {
  g: "grant-row-1",
  s: SITE_ID,
  o: hashOrigin(ORIGIN),
  x: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
  n: "nonce",
});

type Row = Record<string, unknown>;

const tables: Record<string, Row[]> = {
  edit_sessions: [
    {
      id: "session-a",
      token: "edit-token-a",
      site_id: SITE_ID,
      user_id: "user-a",
      is_active: true,
      created_at: ISSUED,
      expires_at: FUTURE,
      permissions: ["view", "edit"],
    },
  ],
  site_permissions: [
    { site_id: SITE_ID, user_id: "user-a", permission: "edit" },
  ],
  staging_access: [
    {
      id: "access-a",
      token: "staging-token-a",
      site_id: SITE_ID,
      is_active: true,
      expires_at: FUTURE,
      access_type: "invite",
      email: "bob@example.com",
      email_verified: false,
      permissions: ["view", "edit"],
    },
  ],
  site_editors: [],
  editor_device_grants: [
    {
      id: "grant-row-1",
      site_editor_id: "editor-1",
      grant_hash: hashOpaqueSecret(GRANT),
      user_agent_hash: hashUserAgent(USER_AGENT),
      origin_hash: hashOrigin(ORIGIN),
      created_at: ISSUED,
      expires_at: FUTURE,
      revoked_at: null,
      revoked_reason: null,
      site_editors: {
        id: "editor-1",
        site_id: SITE_ID,
        email: "bob@example.com",
        permissions: ["edit"],
        revoked_at: null,
      },
    },
  ],
};

/** A client whose reads of `failing` answer a connection error. */
function clientFailing(
  failing: string | null,
  overrides: Partial<typeof tables> = {},
) {
  const data = { ...tables, ...overrides };
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const rows = () =>
        (data[table] ?? []).filter((row) => filters.every((f) => f(row)));
      const answer = (pick: () => { data: unknown; error: unknown }) =>
        Promise.resolve(
          table === failing ? { data: null, error: DB_ERROR } : pick(),
        );
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return chain;
        },
        gte: (column: string, value: string) => {
          filters.push((row) => String(row[column]) >= value);
          return chain;
        },
        is: () => chain,
        single: () =>
          answer(() => {
            const found = rows();
            return found.length === 1
              ? { data: found[0], error: null }
              : { data: null, error: { code: "PGRST116", message: "no rows" } };
          }),
        maybeSingle: () =>
          answer(() => ({ data: rows()[0] ?? null, error: null })),
        update: () => chain,
        then: (onOk: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(onOk),
      };
      return chain;
    },
  } as unknown as ReturnType<typeof createServiceRoleClient>;
}

function editSession(token: string) {
  return validateEditorAccess({
    siteId: SITE_ID,
    token: { kind: "edit-session", token },
  });
}

function staging(token: string) {
  return validateEditorAccess({
    siteId: SITE_ID,
    token: { kind: "staging", token },
    allowUnverified: true,
    device: { userAgentHash: "ua", acceptLanguage: "en" } as never,
  });
}

function deviceGrant() {
  return validateEditorAccess({
    siteId: SITE_ID,
    token: { kind: "device-grant", token: GRANT },
    deviceContext: { origin: ORIGIN, userAgent: USER_AGENT, ip: null },
  });
}

beforeEach(() => {
  resetSigningKeyCache();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function failing(table: string | null, overrides?: Partial<typeof tables>) {
  jest
    .mocked(createServiceRoleClient)
    .mockReturnValue(clientFailing(table, overrides));
}

describe("an outage is answered 503, never 401", () => {
  it("an edit session whose lookup fails", async () => {
    failing("edit_sessions");
    const result = await editSession("edit-token-a");

    expect(result.valid).toBe(false);
    expect(result.status).toBe(503);
    // The database's own words never reach a caller.
    expect(result.error).not.toContain("connection");
  });

  it("an edit session whose holder's live grant cannot be read", async () => {
    failing("site_permissions");
    const result = await editSession("edit-token-a");

    expect(result.valid).toBe(false);
    expect(result.status).toBe(503);
  });

  it("a staging invite whose lookup fails", async () => {
    failing("staging_access");
    const result = await staging("staging-token-a");

    expect(result.valid).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).not.toContain("connection");
  });

  it("a staging invite whose removed-editor check cannot be read", async () => {
    failing("site_editors");
    const result = await staging("staging-token-a");

    expect(result.valid).toBe(false);
    expect(result.status).toBe(503);
  });

  it("a device grant whose row cannot be read", async () => {
    failing("editor_device_grants");
    const result = await deviceGrant();

    expect(result.valid).toBe(false);
    expect(result.status).toBe(503);
  });
});

describe("a refusal is still a 401 (controls)", () => {
  it("the fixtures validate when nothing fails", async () => {
    failing(null);

    expect((await editSession("edit-token-a")).valid).toBe(true);
    expect((await staging("staging-token-a")).valid).toBe(true);
    expect((await deviceGrant()).valid).toBe(true);
  });

  it("an unknown edit token", async () => {
    failing(null);
    const result = await editSession("no-such-token");

    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toBe("Invalid or expired edit session");
  });

  it("an edit session whose holder has no live grant", async () => {
    failing(null, { site_permissions: [] });
    const result = await editSession("edit-token-a");

    expect(result.status).toBe(401);
  });

  it("an unknown staging token", async () => {
    failing(null);
    const result = await staging("no-such-token");

    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
  });

  it("a revoked device grant", async () => {
    failing(null, {
      editor_device_grants: [
        {
          ...tables.editor_device_grants[0],
          revoked_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          revoked_reason: "manual",
        },
      ],
    });
    const result = await deviceGrant();

    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
  });
});
