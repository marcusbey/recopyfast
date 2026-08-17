/**
 * AC 4, HTTP half: revoking an editor takes effect on the very next request.
 *
 * The behaviour is already true — `validateDeviceGrant` re-reads the parent
 * `site_editors` row on every call rather than trusting anything cached in the
 * token (`editor-grants.ts`, "the immediate-revocation check"). This test is
 * what makes it a criterion rather than an accident: it is one careless
 * "optimisation" away from being false, and what it would cost is a removed
 * editor still defacing a customer's live page.
 *
 * Two halves, because the system has two independent defences and only one of
 * them is guaranteed to run:
 *
 *   1. `revokeSiteEditor` marks the row AND sweeps every device grant beneath
 *      it. That is what makes existing sessions die immediately.
 *   2. The sweep is best-effort — `revokeAllGrantsForEditor` logs and returns 0
 *      when it fails, and the editor is still revoked. So the second test
 *      revokes the parent row with the sweep suppressed and asserts the save is
 *      refused anyway.
 *
 * The WebSocket half of AC 4 is NOT here and must not be: `server/index.js`
 * caches permissions at handshake and no WebSocket service is deployed, so a
 * criterion written here would pass against nothing. It belongs to s07a.
 */

// Must precede the imports: editor-crypto memoises the signing key on first use.
process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import { NextRequest } from "next/server";
import {
  CRYPTO_DOMAIN,
  encodeSignedToken,
  hashOpaqueSecret,
  hashOrigin,
  hashUserAgent,
  resetSigningKeyCache,
} from "@/lib/auth/editor-crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";

const mockGetUser = jest.fn();
const mockPermissionRow = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => mockPermissionRow() }),
          }),
        }),
      }),
    }),
  ),
}));

jest.mock("@/lib/supabase/service");

import { PUT } from "@/app/api/staging/content/[siteId]/route";
import { DELETE as REVOKE_EDITOR } from "@/app/api/editor/editors/route";

const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

const SITE_ID = "site-abc";
const EDITOR_ID = "site-editor-1";
const GRANT_ROW_ID = "grant-row-1";
const ORIGIN = "https://helloworld.example";
const USER_AGENT = "Mozilla/5.0 (Macintosh) Chrome/120";
const EDITOR_EMAIL = "bob@corp.example";
const OWNER_ID = "owner-1";

const GRANT = encodeSignedToken("rcfg1", CRYPTO_DOMAIN.grant, {
  g: GRANT_ROW_ID,
  s: SITE_ID,
  o: hashOrigin(ORIGIN),
  x: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
  n: "nonce",
});

/**
 * A small stateful stand-in for the two tables that matter, so a revoke made
 * through one route is visible to the next request through another. A stub that
 * answered from a frozen fixture could not express "mid-session" at all.
 */
function makeWorld(options: { sweepGrants: boolean }) {
  const state = {
    editorRevokedAt: null as string | null,
    grantRevokedAt: null as string | null,
    grantRevokedReason: null as string | null,
    contentWrites: 0,
  };

  function from(table: string) {
    let kind: "select" | "update" | "insert" | "delete" = "select";
    let payload: Record<string, unknown> = {};
    const filters: Array<[string, unknown]> = [];

    const resolve = () => Promise.resolve(run());

    function run(): { data: unknown; error: unknown } {
      if (table === "editor_device_grants") {
        if (kind === "select") {
          return {
            data: {
              id: GRANT_ROW_ID,
              site_editor_id: EDITOR_ID,
              grant_hash: hashOpaqueSecret(GRANT),
              user_agent_hash: hashUserAgent(USER_AGENT),
              origin_hash: hashOrigin(ORIGIN),
              expires_at: new Date(Date.now() + 3_600_000).toISOString(),
              revoked_at: state.grantRevokedAt,
              revoked_reason: state.grantRevokedReason,
              site_editors: {
                id: EDITOR_ID,
                site_id: SITE_ID,
                email: EDITOR_EMAIL,
                permissions: ["edit"],
                revoked_at: state.editorRevokedAt,
              },
            },
            error: null,
          };
        }

        const isSweep = filters.some(([column]) => column === "site_editor_id");
        if (isSweep) {
          if (!options.sweepGrants) {
            // The sweep "failed". The editor is revoked either way — this is
            // the state defence 2 has to hold on its own.
            return { data: [], error: null };
          }
          if (!state.grantRevokedAt) {
            state.grantRevokedAt = String(payload.revoked_at);
            state.grantRevokedReason = String(payload.revoked_reason);
            return { data: [{ id: GRANT_ROW_ID }], error: null };
          }
          return { data: [], error: null };
        }

        // last_used_at touch.
        return { data: null, error: null };
      }

      if (table === "site_editors") {
        if (kind === "select") {
          return { data: { id: EDITOR_ID, site_id: SITE_ID }, error: null };
        }
        state.editorRevokedAt = String(payload.revoked_at);
        return { data: null, error: null };
      }

      if (table === "content_elements") {
        if (kind === "select") {
          return {
            data: { id: "content-element-1", staging_content: "Old copy" },
            error: null,
          };
        }
        state.contentWrites += 1;
        return { data: null, error: null };
      }

      return { data: null, error: null };
    }

    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (next: Record<string, unknown>) => {
        kind = "update";
        payload = next;
        return builder;
      },
      insert: () => {
        kind = "insert";
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      single: resolve,
      maybeSingle: resolve,
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        resolve().then(onOk, onErr),
    };

    return builder;
  }

  return {
    state,
    client: { from } as unknown as ReturnType<typeof createServiceRoleClient>,
  };
}

function saveWithGrant(): Promise<Response> {
  // The editor is not a signed-in user: the first-party branch must not stand
  // in for the credential under test.
  mockGetUser.mockResolvedValue({ data: { user: null } });

  return PUT(
    new NextRequest(`https://www.recopyfa.st/api/staging/content/${SITE_ID}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        Origin: ORIGIN,
        "X-RCF-Editor-Grant": GRANT,
      },
      body: JSON.stringify({ elementId: "headline", content: "New copy" }),
    }),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  ) as unknown as Promise<Response>;
}

function revokeEditorAsOwner(): Promise<Response> {
  mockGetUser.mockResolvedValue({
    data: { user: { id: OWNER_ID, email: "owner@corp.example" } },
  });
  mockPermissionRow.mockResolvedValue({
    data: { permission: "admin" },
    error: null,
  });

  return REVOKE_EDITOR(
    new NextRequest(
      `https://www.recopyfa.st/api/editor/editors?siteEditorId=${EDITOR_ID}`,
      { method: "DELETE" },
    ),
  ) as unknown as Promise<Response>;
}

describe("revoking an editor mid-session", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses the next save with the same grant, immediately", async () => {
    const world = makeWorld({ sweepGrants: true });
    mockCreateServiceRoleClient.mockReturnValue(world.client);

    const before = await saveWithGrant();
    expect(before.status).toBe(200);
    expect(world.state.contentWrites).toBe(1);

    const revoke = await revokeEditorAsOwner();
    expect(revoke.status).toBe(200);

    // Same grant, same browser, same origin — nothing about the credential has
    // changed. The only thing that changed is a row the server re-reads.
    const after = await saveWithGrant();
    expect(after.status).toBe(401);
    expect(world.state.contentWrites).toBe(1);
  });

  it("still refuses when the grant sweep did not land and only the parent row was revoked", async () => {
    const world = makeWorld({ sweepGrants: false });
    mockCreateServiceRoleClient.mockReturnValue(world.client);

    expect((await saveWithGrant()).status).toBe(200);

    await revokeEditorAsOwner();
    // The grant row itself is untouched: it is live, unexpired and matches this
    // browser. Only `site_editors.revoked_at` is set.
    expect(world.state.grantRevokedAt).toBeNull();

    const after = await saveWithGrant();
    const body = await after.json();

    expect(after.status).toBe(401);
    expect(body.error).toBe("editor_revoked");
    expect(world.state.contentWrites).toBe(1);
  });
});
