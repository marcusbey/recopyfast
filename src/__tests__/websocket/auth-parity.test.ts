/**
 * @jest-environment node
 */

/**
 * `server/auth.js` re-implements three rules the HTTP side already owns.
 *
 * That duplication is deliberate — `server/` ships as its own npm package with
 * `server/` as the Docker build context, so importing from `src/` would resolve
 * locally and `MODULE_NOT_FOUND` inside the image (this is a run interdict of
 * the plan, not a preference). What duplication costs is drift, and drift here
 * is a security boundary quietly disagreeing with itself: that is exactly how
 * the socket ended up with the pre-A-2 origin rule while the HTTP side had been
 * fixed.
 *
 * So this is a parity table. Each case is fed to both implementations and their
 * verdicts are compared to each other, not to a literal — a future change to
 * either side shows up here as a red test rather than as an incident.
 */

import { createHmac } from "node:crypto";

import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  buildSiteToken,
  normalizeDomain as normalizeDomainHttp,
  verifySiteTokenSignature,
} from "@/lib/security/site-auth";
import {
  normalizePermissions as normalizePermissionsHttp,
  validateEditorAccess,
} from "@/lib/auth/editor-access";
import { hashUserAgent as hashUserAgentHttp } from "@/lib/auth/editor-crypto";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import {
  STAGING_VERIFICATION_TTL_MS,
  checkStagingDeviceBinding as checkStagingDeviceBindingHttp,
  readStagingDeviceFingerprint,
  type RecordedStagingVerification,
} from "@/lib/auth/staging-device";
import {
  checkStagingDeviceBinding,
  hashUserAgent,
  isOriginAllowed,
  normalizeDomain,
  normalizePermissions,
  parseHost,
  resolveGrant,
  verifySiteToken,
} from "../../../server/auth.js";
import { RecordingSupabase, type Row } from "./harness";

// The HTTP edit-session validator reads through the service-role client; the
// edit-session rows below hand it the same in-memory tables the socket reads.
jest.mock("@/lib/supabase/service");

const SITE_ID = "site-parity";
const API_KEY = "parity-api-key";
const DAY_SECONDS = 24 * 60 * 60;

/**
 * Both sides answer "is this acceptable", but they say no differently: the HTTP
 * helper throws on a malformed signature (`timingSafeEqual` rejects unequal
 * buffer lengths), while the socket helper catches and returns false. Parity is
 * about the verdict, so both refusals are collapsed to `false` here — and the
 * collapsing is one-directional: a throw can never be read as an accept.
 */
function verdict(run: () => boolean): boolean {
  try {
    return run();
  } catch {
    return false;
  }
}

function signedAt(offsetSeconds: number): string {
  const issuedAt = Math.floor(Date.now() / 1000) + offsetSeconds;
  const payload = `${SITE_ID}.${issuedAt}`;
  const signature = createHmac("sha256", API_KEY).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

describe("site token verification parity", () => {
  const cases: Array<[string, string]> = [
    ["a freshly issued token", buildSiteToken(SITE_ID, API_KEY)],
    ["a token signed with another key", buildSiteToken(SITE_ID, "other-key")],
    ["a token issued for another site", buildSiteToken("other-site", API_KEY)],
    ["a token 91 days old", signedAt(-91 * DAY_SECONDS)],
    ["a token 89 days old", signedAt(-89 * DAY_SECONDS)],
    ["a token dated 30 seconds ahead", signedAt(30)],
    ["a token dated an hour ahead", signedAt(3600)],
    ["a two-part token", `${SITE_ID}.123`],
    ["a token with a non-numeric issuedAt", `${SITE_ID}.notanumber.abcdef`],
    ["a token with a short signature", `${SITE_ID}.1700000000.abc`],
    ["an empty token", ""],
  ];

  it.each(cases)("agrees on %s", (_label, token) => {
    const http = verdict(() =>
      verifySiteTokenSignature(SITE_ID, API_KEY, token),
    );
    const socket = verdict(() => verifySiteToken(SITE_ID, API_KEY, token));

    expect(socket).toBe(http);
  });

  it("accepts a valid token on both sides (guard against agreeing on 'no')", () => {
    const token = buildSiteToken(SITE_ID, API_KEY);

    expect(verifySiteTokenSignature(SITE_ID, API_KEY, token)).toBe(true);
    expect(verifySiteToken(SITE_ID, API_KEY, token)).toBe(true);
  });

  it("accepts a token older than 90 days on both sides", () => {
    const token = signedAt(-365 * DAY_SECONDS);

    expect(verifySiteTokenSignature(SITE_ID, API_KEY, token)).toBe(true);
    expect(verifySiteToken(SITE_ID, API_KEY, token)).toBe(true);
  });

  it("rejects that old token on both sides after key rotation", () => {
    const token = signedAt(-365 * DAY_SECONDS);

    expect(verifySiteTokenSignature(SITE_ID, "rotated-key", token)).toBe(false);
    expect(verifySiteToken(SITE_ID, "rotated-key", token)).toBe(false);
  });
});

describe("domain normalisation parity", () => {
  const cases = [
    "example.com",
    "EXAMPLE.com",
    "https://example.com",
    "https://example.com/path",
    "example.com:8080",
    "sub.example.com",
  ];

  it.each(cases)("resolves %s to the same host", (domain) => {
    expect(normalizeDomain(domain)).toBe(normalizeDomainHttp(domain));
  });

  it.each(["", "   ", null, undefined])(
    "refuses %s on both sides",
    (domain) => {
      // The HTTP side throws "Invalid domain"; the socket side returns null.
      // Both are refusals, and `isOriginAllowed` turns null into a refusal.
      expect(() => normalizeDomainHttp(domain as string)).toThrow();
      expect(normalizeDomain(domain)).toBeNull();
    },
  );
});

describe("parseHost", () => {
  it("lowercases the host and drops the port and path", () => {
    expect(parseHost("https://EXAMPLE.com:8443/a/b?c=d")).toBe("example.com");
  });

  it("returns null for anything it cannot parse", () => {
    expect(parseHost("example.com")).toBeNull();
    expect(parseHost("")).toBeNull();
    expect(parseHost(undefined)).toBeNull();
  });
});

describe("isOriginAllowed", () => {
  it("admits an exact host match", () => {
    expect(isOriginAllowed("example.com", "https://example.com")).toBe(true);
    expect(
      isOriginAllowed("https://example.com", "https://example.com:443"),
    ).toBe(true);
  });

  it("refuses a subdomain of the registered domain", () => {
    expect(isOriginAllowed("example.com", "https://evil.example.com")).toBe(
      false,
    );
  });

  it("refuses a missing or unparseable origin (A-2)", () => {
    expect(isOriginAllowed("example.com", undefined)).toBe(false);
    expect(isOriginAllowed("example.com", "")).toBe(false);
    expect(isOriginAllowed("example.com", "not-a-url")).toBe(false);
  });

  it("refuses a site with no registered domain, whatever the origin", () => {
    expect(isOriginAllowed(null, "https://example.com")).toBe(false);
    expect(isOriginAllowed(undefined, undefined)).toBe(false);
  });
});

describe("permission hierarchy parity", () => {
  const cases: Array<[string, string[]]> = [
    ["admin", ["admin"]],
    ["publish", ["publish"]],
    ["edit", ["edit"]],
    ["view", ["view"]],
    ["nothing", []],
    ["an unknown grant", ["owner"]],
    ["a duplicated grant", ["edit", "edit", "view"]],
  ];

  it.each(cases)("expands %s identically", (_label, permissions) => {
    expect(normalizePermissions(permissions)).toEqual(
      normalizePermissionsHttp(permissions),
    );
  });

  it("expands admin to the whole ladder (guard against agreeing on '[]')", () => {
    expect(normalizePermissions(["admin"])).toEqual([
      "view",
      "edit",
      "publish",
      "admin",
    ]);
  });
});

/**
 * s68c (M7) — the device binding HTTP enforces on a verified staging token.
 *
 * `validateStagingAccess` has refused a verified token presented from another
 * browser, or verified more than 12 h ago, since the forwarded-invite fix
 * (`src/lib/auth/staging-device.ts`). The socket never applied it: a forwarded
 * link that HTTP answered "re-verify" was admitted to `site:{id}:staging` and
 * received every editor's unpublished copy. The server now carries its own copy
 * of the rule, and these rows are what keep the two copies saying the same
 * thing — including for a request that sends no User-Agent at all.
 */
describe("staging device binding parity", () => {
  const NOW = Date.parse("2026-10-08T12:00:00.000Z");
  const HOUR_MS = 60 * 60 * 1000;
  const INVITEE_UA = "Mozilla/5.0 (Macintosh) Chrome/120";
  const FORWARDEE_UA = "Mozilla/5.0 (Windows NT 10.0) Firefox/121";
  const boundHash = hashUserAgentHttp(INVITEE_UA);

  function fingerprintFor(userAgent: string) {
    return readStagingDeviceFingerprint({
      headers: new Headers({ "user-agent": userAgent }),
    });
  }

  function verifiedAgo(ms: number): string {
    return new Date(NOW - ms).toISOString();
  }

  const cases: Array<[string, RecordedStagingVerification, string]> = [
    [
      "an unbound row with no User-Agent hash",
      { userAgentHash: null, verifiedAt: verifiedAgo(HOUR_MS) },
      INVITEE_UA,
    ],
    [
      "an unbound row with no verified_at",
      { userAgentHash: boundHash, verifiedAt: null },
      INVITEE_UA,
    ],
    [
      "a verified_at that does not parse",
      { userAgentHash: boundHash, verifiedAt: "not-a-date" },
      INVITEE_UA,
    ],
    [
      "a verification 12 h + 1 s old",
      {
        userAgentHash: boundHash,
        verifiedAt: verifiedAgo(STAGING_VERIFICATION_TTL_MS + 1000),
      },
      INVITEE_UA,
    ],
    [
      "a different browser's User-Agent",
      { userAgentHash: boundHash, verifiedAt: verifiedAgo(HOUR_MS) },
      FORWARDEE_UA,
    ],
    [
      "the verifying browser within the TTL",
      { userAgentHash: boundHash, verifiedAt: verifiedAgo(HOUR_MS) },
      INVITEE_UA,
    ],
  ];

  it.each(cases)("agrees on %s", (_label, recorded, userAgent) => {
    const presented = fingerprintFor(userAgent);

    expect(checkStagingDeviceBinding(recorded, presented, NOW)).toEqual(
      checkStagingDeviceBindingHttp(recorded, presented, NOW),
    );
  });

  it("admits the verifying browser on both sides (guard against agreeing on 'no')", () => {
    const recorded = {
      userAgentHash: boundHash,
      verifiedAt: verifiedAgo(HOUR_MS),
    };
    const presented = fingerprintFor(INVITEE_UA);

    expect(checkStagingDeviceBindingHttp(recorded, presented, NOW)).toEqual({
      ok: true,
    });
    expect(checkStagingDeviceBinding(recorded, presented, NOW)).toEqual({
      ok: true,
    });
  });

  it("refuses a forwarded link on both sides as a device mismatch", () => {
    const recorded = {
      userAgentHash: boundHash,
      verifiedAt: verifiedAgo(HOUR_MS),
    };

    expect(
      checkStagingDeviceBinding(recorded, fingerprintFor(FORWARDEE_UA), NOW),
    ).toEqual({ ok: false, reason: "device_mismatch" });
  });
});

describe("User-Agent hash parity", () => {
  const cases: Array<[string, string | null | undefined]> = [
    ["a desktop browser", "Mozilla/5.0 (Macintosh) Chrome/120"],
    [
      "a mobile browser",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1",
    ],
    ["non-ASCII text", "Navigateur/1.0 (éditeur — 編集)"],
    ["an empty User-Agent", ""],
    ["a null User-Agent", null],
    ["an undefined User-Agent", undefined],
  ];

  it.each(cases)("hashes %s identically", (_label, userAgent) => {
    expect(hashUserAgent(userAgent)).toBe(hashUserAgentHttp(userAgent));
  });

  it("hashes a missing User-Agent like an empty one, on both sides", () => {
    // A socket handshake with no User-Agent header must land on the same hash
    // HTTP recorded for a fetch with none — otherwise the two sides would
    // disagree about the one browser that sends nothing.
    expect(hashUserAgent(null)).toBe(hashUserAgent(""));
    expect(hashUserAgentHttp(null)).toBe(hashUserAgentHttp(""));
  });
});

/**
 * s68c review — the staging grant, end to end, on both sides.
 *
 * The rows above pin the duplicated HELPERS. What an editor actually meets is
 * the whole validator: the row lookup, the verified flag, the device binding,
 * the directory revocation and how each read's failure is answered. The review
 * found the helpers agreeing while the validators did not — the socket's
 * `site_editors` read discarded its `error`, so a failed lookup read as "no
 * directory row" and admitted a removed editor (MAJOR 1), where HTTP's
 * `isEditorRevoked` fails closed.
 *
 * So each row here is one set of in-memory tables, fed to the REAL HTTP
 * validator (`StagingAccessManager.validateStagingAccess`, through the mocked
 * service-role client) and to the REAL socket resolver (`resolveGrant`). The
 * verdicts are compared to each other and to the expected admission, so the
 * table cannot pass by both sides agreeing on "no".
 */
describe("staging grant parity — both real validators on the same rows", () => {
  const SITE = "site-staging-parity";
  const OTHER_SITE = "site-staging-elsewhere";
  const TOKEN = "staging-token-parity";
  const HOUR_MS = 60 * 60 * 1000;
  const INVITEE_UA = "Mozilla/5.0 (Macintosh) Chrome/120";
  const FORWARDEE_UA = "Mozilla/5.0 (Windows NT 10.0) Firefox/121";

  interface Fixture {
    /** Overrides on the one staging_access row. */
    access?: Row;
    editors?: Row[];
    failingReads?: string[];
    /** The User-Agent presented now; undefined sends none at all. */
    userAgent?: string;
  }

  function ago(ms: number): string {
    return new Date(Date.now() - ms).toISOString();
  }

  function stagingRow(overrides: Row = {}): Row {
    return {
      id: "access-parity",
      token: TOKEN,
      site_id: SITE,
      access_type: "invite",
      email: "john@example.com",
      email_verified: true,
      permissions: ["view", "edit"],
      is_active: true,
      revoked_at: null,
      expires_at: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
      verified_user_agent_hash: hashUserAgentHttp(INVITEE_UA),
      verified_at: ago(HOUR_MS),
      ...overrides,
    };
  }

  function removedEditor(overrides: Row = {}): Row {
    return {
      id: "editor-parity",
      site_id: SITE,
      email: "john@example.com",
      revoked_at: ago(60 * 1000),
      ...overrides,
    };
  }

  function tables(fixture: Fixture): RecordingSupabase {
    const db = new RecordingSupabase({
      staging_access: [stagingRow(fixture.access)],
      site_editors: fixture.editors ?? [],
    });
    for (const table of fixture.failingReads ?? []) {
      db.failingReads.add(table);
    }
    return db;
  }

  type Verdict = { admitted: boolean; permissions?: string[] };

  async function httpVerdict(fixture: Fixture): Promise<Verdict> {
    jest
      .mocked(createServiceRoleClient)
      .mockReturnValue(
        tables(fixture) as unknown as ReturnType<
          typeof createServiceRoleClient
        >,
      );
    const headers = new Headers();
    if (fixture.userAgent !== undefined) {
      headers.set("user-agent", fixture.userAgent);
    }
    const result = await StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE,
      readStagingDeviceFingerprint({ headers }),
    );
    // `valid` alone is not admission over HTTP: an unbound or unverified token
    // answers `{ valid: true, verified: false }` — "enter a code" — and grants
    // nothing. The socket has no such middle state; it refuses.
    return result.valid && result.verified
      ? {
          admitted: true,
          permissions: normalizePermissionsHttp(result.permissions),
        }
      : { admitted: false };
  }

  async function socketVerdict(fixture: Fixture): Promise<Verdict> {
    const grant = await resolveGrant({
      supabase: tables(fixture),
      siteId: SITE,
      stagingToken: TOKEN,
      userAgent: fixture.userAgent,
    });
    return grant.valid && "permissions" in grant
      ? { admitted: true, permissions: grant.permissions }
      : { admitted: false };
  }

  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const cases: Array<[string, Fixture, boolean]> = [
    [
      "a bound row presented by the verifying browser",
      { userAgent: INVITEE_UA },
      true,
    ],
    [
      "a bound row presented by another browser",
      { userAgent: FORWARDEE_UA },
      false,
    ],
    [
      "a verification 12 h + 1 s old",
      {
        access: { verified_at: ago(STAGING_VERIFICATION_TTL_MS + 1000) },
        userAgent: INVITEE_UA,
      },
      false,
    ],
    [
      "a verified row with no User-Agent hash",
      { access: { verified_user_agent_hash: null }, userAgent: INVITEE_UA },
      false,
    ],
    [
      "a verified row with no verified_at",
      { access: { verified_at: null }, userAgent: INVITEE_UA },
      false,
    ],
    [
      // The binding fields are left in place on purpose: with them cleared the
      // device check refuses on its own, and a side that ignored the flag
      // would still agree. This row is about the flag alone.
      "an unverified row, even one carrying a device binding",
      { access: { email_verified: false }, userAgent: INVITEE_UA },
      false,
    ],
    [
      "no User-Agent at verification and none now",
      { access: { verified_user_agent_hash: hashUserAgentHttp(null) } },
      true,
    ],
    [
      "an invite typed John@Example.com whose editor was removed",
      {
        access: { email: "John@Example.com" },
        editors: [removedEditor()],
        userAgent: INVITEE_UA,
      },
      false,
    ],
    [
      'an invite typed "  JOHN@EXAMPLE.COM " whose editor was removed',
      {
        access: { email: "  JOHN@EXAMPLE.COM " },
        editors: [removedEditor()],
        userAgent: INVITEE_UA,
      },
      false,
    ],
    [
      "a removal recorded on another site",
      {
        editors: [removedEditor({ site_id: OTHER_SITE })],
        userAgent: INVITEE_UA,
      },
      true,
    ],
    [
      "a directory row that stands",
      { editors: [removedEditor({ revoked_at: null })], userAgent: INVITEE_UA },
      true,
    ],
    ["no directory row", { editors: [], userAgent: INVITEE_UA }, true],
    [
      "a removed editor whose site_editors read fails",
      {
        editors: [removedEditor()],
        failingReads: ["site_editors"],
        userAgent: INVITEE_UA,
      },
      false,
    ],
  ];

  it.each(cases)("agrees on %s", async (_label, fixture, admitted) => {
    const http = await httpVerdict(fixture);
    const socket = await socketVerdict(fixture);

    expect(socket).toEqual(http);
    expect(http.admitted).toBe(admitted);
  });

  it("grants the row's permissions on both sides when admitted (guard against agreeing on 'no')", async () => {
    const fixture = { userAgent: INVITEE_UA };
    const expected = { admitted: true, permissions: ["view", "edit"] };

    expect(await httpVerdict(fixture)).toEqual(expected);
    expect(await socketVerdict(fixture)).toEqual(expected);
  });
});

/**
 * s68c — ADR 047 on the socket. An edit session carries no authority of its
 * own: what it grants is the session's permissions intersected with the
 * holder's LIVE direct `site_permissions` row, read at every validation, within
 * 24 h of `created_at` (5 min of clock skew tolerated ahead, an undatable
 * session refused).
 *
 * s68a applied this to HTTP (`validateEditSessionAccess`, editor-access.ts).
 * `resolveEditSessionGrant` (server/auth.js) still returned the row's own
 * permissions, so a demoted or removed member's open socket kept receiving
 * staged copy. Each row is fed, as the same tables, to s68a's HTTP validator
 * and to the socket's resolver, and their verdicts are compared.
 */
describe("edit-session authority parity (ADR 047)", () => {
  const SITE = "site-edit-parity";
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;

  function minutesFromNow(minutes: number): string {
    return new Date(Date.now() + minutes * MINUTE_MS).toISOString();
  }

  function session(token: string, overrides: Row): Row {
    return {
      id: `session-${token}`,
      token,
      site_id: SITE,
      is_active: true,
      revoked_at: null,
      created_at: minutesFromNow(-60),
      expires_at: minutesFromNow(60),
      ...overrides,
    };
  }

  function seed(): Record<string, Row[]> {
    return {
      edit_sessions: [
        session("admin-row-edit-member", {
          user_id: "editor",
          permissions: ["admin"],
        }),
        session("admin-holder-narrow-row", {
          user_id: "admin",
          permissions: ["edit"],
        }),
        session("removed-member", {
          user_id: "removed",
          permissions: ["edit"],
        }),
        session("no-holder", { user_id: null, permissions: ["edit"] }),
        session("nothing-known", {
          user_id: "editor",
          permissions: ["owner"],
        }),
        session("created-25h-ago", {
          user_id: "admin",
          permissions: ["edit"],
          created_at: new Date(Date.now() - 25 * HOUR_MS).toISOString(),
          expires_at: minutesFromNow(30 * 24 * 60),
        }),
        session("created-6-min-ahead", {
          user_id: "editor",
          permissions: ["edit"],
          created_at: minutesFromNow(6),
        }),
        session("created-in-2099", {
          user_id: "editor",
          permissions: ["edit"],
          created_at: "2099-01-01T00:00:00.000Z",
          expires_at: "2099-01-01T12:00:00.000Z",
        }),
        session("created-4-min-ahead", {
          user_id: "editor",
          permissions: ["edit"],
          created_at: minutesFromNow(4),
        }),
        session("created-at-null", {
          user_id: "editor",
          permissions: ["edit"],
          created_at: null,
        }),
      ],
      site_permissions: [
        { site_id: SITE, user_id: "editor", permission: "edit" },
        { site_id: SITE, user_id: "admin", permission: "admin" },
        // A team grant has no `user_id`. A lookup that matched a NULL holder
        // against it would hand "no-holder" admin.
        {
          site_id: SITE,
          user_id: null,
          team_id: "team-1",
          permission: "admin",
        },
        // The removed member still holds a row — on ANOTHER site.
        { site_id: "site-other", user_id: "removed", permission: "admin" },
      ],
    };
  }

  type Verdict = { valid: boolean; permissions?: string[] };

  async function httpVerdict(token: string): Promise<Verdict> {
    jest
      .mocked(createServiceRoleClient)
      .mockReturnValue(
        new RecordingSupabase(seed()) as unknown as ReturnType<
          typeof createServiceRoleClient
        >,
      );
    const result = await validateEditorAccess({
      siteId: SITE,
      token: { kind: "edit-session", token },
    });
    return result.valid && result.access
      ? { valid: true, permissions: result.access.permissions }
      : { valid: false };
  }

  async function socketVerdict(token: string): Promise<Verdict> {
    const grant = await resolveGrant({
      supabase: new RecordingSupabase(seed()),
      siteId: SITE,
      editToken: token,
    });
    return grant.valid && "permissions" in grant
      ? { valid: true, permissions: grant.permissions }
      : { valid: false };
  }

  const cases: Array<[string, string]> = [
    [
      "an admin-stamped session held by a live edit member",
      "admin-row-edit-member",
    ],
    ["a live admin's deliberately narrow session", "admin-holder-narrow-row"],
    ["a holder with no live grant on this site", "removed-member"],
    ["a session with no holder (NULL user_id)", "no-holder"],
    ["a session whose permissions name nothing known", "nothing-known"],
    ["a session created 25 h ago, expiry pushed out", "created-25h-ago"],
    ["a created_at more than 5 min in the future", "created-6-min-ahead"],
    ["a created_at in 2099", "created-in-2099"],
    ["a created_at 4 min ahead, within the clock skew", "created-4-min-ahead"],
    ["a NULL created_at", "created-at-null"],
  ];

  it.each(cases)("agrees on %s", async (_label, token) => {
    expect(await socketVerdict(token)).toEqual(await httpVerdict(token));
  });

  it("bounds an admin-stamped session by the holder's live edit grant (guard against agreeing on 'no')", async () => {
    const expected = { valid: true, permissions: ["view", "edit"] };

    expect(await httpVerdict("admin-row-edit-member")).toEqual(expected);
    expect(await socketVerdict("admin-row-edit-member")).toEqual(expected);
  });

  it("admits a session dated within the clock skew on both sides", async () => {
    expect(await httpVerdict("created-4-min-ahead")).toMatchObject({
      valid: true,
    });
    expect(await socketVerdict("created-4-min-ahead")).toMatchObject({
      valid: true,
    });
  });
});
