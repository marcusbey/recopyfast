/**
 * A-10 — every Edit Board endpoint returns 401 to every caller.
 *
 * `validateStagingAccess` takes an optional device fingerprint and refuses any
 * caller that omits it. FIFTEEN Edit Board call sites omitted it — every route
 * called `validateStagingAccess(token, siteId)` with two arguments — so styles,
 * translation, themes and in-widget version history were dead for 100% of users,
 * and the widget rendered an empty list rather than an error
 * (`public/embed/recopyfast.src.js:5650-5653`), so it failed silently.
 *
 * The callee was never the bug. Failing closed on a missing fingerprint is the
 * documented, deliberate design — "I did not bring evidence must not be a
 * stronger position than bringing the wrong evidence" — and it has a passing
 * regression test at
 * `src/lib/auth/__tests__/staging-access.device-binding.test.ts`.
 *
 * What DID hide the defect was how that refusal was implemented: the callee
 * substituted `{ userAgentHash: "", originHash: "", ipPrefix: null }` and let the
 * comparison at `src/lib/auth/staging-device.ts:155` fail against a 32-character
 * digest. The rejection therefore logged `device_mismatch`, which reads as a
 * forwarded link rather than as a caller that brought nothing. The substitution
 * is gone; a missing fingerprint is now refused explicitly and logged as the
 * caller bug it is.
 *
 * This file therefore asserts on the CALL SITES, not on the callee's behaviour
 * with a missing argument — relaxing the callee would re-open the
 * forwarded-invite-URL hole that binding was written to close. The census in
 * Part 1 is what keeps the two-argument form from coming back: a sixteenth
 * endpoint cannot be added without it failing.
 */

import fs from "fs";
import path from "path";

import { NextRequest } from "next/server";

import { StagingAccessManager } from "@/lib/auth/staging-access";
import { readStagingDeviceFingerprint } from "@/lib/auth/staging-device";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/supabase/service");
// staging-access imports the SSR client for its admin-only methods. None of
// them run here, but the module must resolve under jsdom.
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(),
}));

const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

const SITE_ID = "site-123";
const TOKEN = "staging-token-abc";
const ORIGIN = "https://customer.example";
const USER_AGENT = "Mozilla/5.0 (Macintosh) Chrome/120";

// ---------------------------------------------------------------------------
// Part 1 — the census
// ---------------------------------------------------------------------------

const ROUTES_ROOT = path.join(process.cwd(), "src/app/api/edit-board");

/**
 * Every Edit Board route file, discovered rather than listed, so a new endpoint
 * is covered the day it is added instead of the day someone remembers this file.
 */
function editBoardRouteFiles(dir: string = ROUTES_ROOT): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return editBoardRouteFiles(full);
      return entry.name === "route.ts" ? [full] : [];
    })
    .sort();
}

interface CallSite {
  file: string;
  line: number;
  argCount: number;
}

/**
 * Locate each `validateStagingAccess(...)` call and count its arguments.
 *
 * The call always sits on its own statement and its arguments are plain
 * identifiers or member expressions (`token`, `siteId`, `version.site_id`), so
 * matching to the first `)` and splitting on commas is exact here. If that ever
 * stops being true the count comes out wrong and the census test below fails
 * loudly rather than silently under-reporting.
 */
function findCallSites(file: string): CallSite[] {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(process.cwd(), file);
  const pattern = /StagingAccessManager\.validateStagingAccess\(([^)]*)\)/g;
  const sites: CallSite[] = [];

  for (const match of source.matchAll(pattern)) {
    const args = match[1]
      .split(",")
      .map((arg) => arg.trim())
      .filter((arg) => arg.length > 0);

    sites.push({
      file: relative,
      line: source.slice(0, match.index).split("\n").length,
      argCount: args.length,
    });
  }

  return sites;
}

const callSites = editBoardRouteFiles().flatMap(findCallSites);

describe("A-10 — Edit Board call sites", () => {
  it("finds every validateStagingAccess call under /api/edit-board", () => {
    // The enumeration, pinned. A sixteenth endpoint cannot be added without
    // this failing and forcing a decision about whether it passes a device.
    const perFile = callSites.reduce<Record<string, number>>((acc, site) => {
      return { ...acc, [site.file]: (acc[site.file] ?? 0) + 1 };
    }, {});

    expect(perFile).toEqual({
      "src/app/api/edit-board/history/[versionId]/route.ts": 2,
      "src/app/api/edit-board/history/route.ts": 2,
      "src/app/api/edit-board/languages/route.ts": 4,
      "src/app/api/edit-board/styles/apply/route.ts": 1,
      "src/app/api/edit-board/styles/route.ts": 2,
      "src/app/api/edit-board/themes/route.ts": 4,
    });
    expect(callSites).toHaveLength(15);
  });

  it("parsed an argument list for every call site it found", () => {
    // Guard for the assertion below. `test.failing` passes on ANY throw, so an
    // unreadable directory, a regex that stopped matching, or an empty result
    // would all read as "fifteen unguarded call sites". This runs the same
    // parse and asserts only that it produced usable output.
    expect(callSites.length).toBeGreaterThan(0);
    expect(callSites.every((site) => site.argCount >= 2)).toBe(true);
    expect(callSites.every((site) => site.line > 0)).toBe(true);
  });

  it("every call site supplies a device fingerprint", () => {
    // `validateStagingAccess(token, siteId, device)` — three arguments. Two
    // means the empty-fingerprint branch, which is an unconditional refusal.
    const withoutDevice = callSites
      .filter((site) => site.argCount < 3)
      .map((site) => `${site.file}:${site.line}`);

    expect(withoutDevice).toEqual([]);
  });

  it("the non-Edit-Board caller shows what a correct call looks like", () => {
    // src/lib/auth/editor-access.ts is the only caller that passes one, so the
    // fix is a shape that already exists in the codebase, not a new design.
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/auth/editor-access.ts"),
      "utf8",
    );
    const match = source.match(
      /StagingAccessManager\.validateStagingAccess\(([^)]*)\)/,
    );

    expect(match).not.toBeNull();
    expect(
      match![1]
        .split(",")
        .map((arg) => arg.trim())
        .filter(Boolean),
    ).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — the mechanism, end to end through the real modules
// ---------------------------------------------------------------------------

function fingerprintFor(userAgent: string, origin: string = ORIGIN) {
  return readStagingDeviceFingerprint({
    headers: new Headers({ "user-agent": userAgent, origin }),
  });
}

const invitee = fingerprintFor(USER_AGENT);

function verifiedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "access-1",
    site_id: SITE_ID,
    access_type: "invite",
    email: "bob@corp.example",
    email_verified: true,
    token: TOKEN,
    permissions: ["view", "edit", "publish"],
    label: "Bob",
    created_by: "owner-1",
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    is_active: true,
    last_used_at: null,
    created_at: new Date().toISOString(),
    verified_user_agent_hash: invitee.userAgentHash,
    verified_origin_hash: invitee.originHash,
    verified_ip_prefix: null,
    verified_at: new Date().toISOString(),
    ...overrides,
  };
}

const PRESET_STYLE = {
  id: "style-1",
  name: "Concise",
  description: "Trim the copy",
  prompt: "Make it shorter",
  is_preset: true,
  created_at: new Date().toISOString(),
};

interface TableRead {
  table: string;
}

/**
 * A service-role client that answers for both tables this flow touches:
 * `staging_access` (read by the token validator) and `copy_styles` (read by the
 * route once it is past authorisation). Records which tables were actually
 * queried, which is how the route test observes that authorisation succeeded
 * without reading the status code.
 */
function makeServiceClient(accessRow: Record<string, unknown> = verifiedRow()) {
  const reads: TableRead[] = [];

  function from(table: string) {
    reads.push({ table });

    const result =
      table === "staging_access"
        ? { data: accessRow, error: null }
        : { data: [PRESET_STYLE], error: null };

    const builder: Record<string, unknown> = {
      select: () => builder,
      update: () => builder,
      eq: () => builder,
      gte: () => builder,
      order: () => Promise.resolve(result),
      single: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onOk, onErr),
    };

    return builder;
  }

  return {
    client: { from } as unknown as ReturnType<typeof createServiceRoleClient>,
    reads,
  };
}

describe("A-10 — what the two-argument call actually does", () => {
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts the token when the fingerprint is supplied", () => {
    // The control. The row is genuinely verified and the caller is genuinely
    // the verifying device, so nothing about the token or the row is at fault
    // in the case below — only the missing third argument.
    mockCreateServiceRoleClient.mockReturnValue(makeServiceClient().client);

    return StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE_ID,
      invitee,
    ).then((result) => {
      expect(result.verified).toBe(true);
      expect(result.permissions).toEqual(["view", "edit", "publish"]);
    });
  });

  it("refuses the same token when no fingerprint is passed", async () => {
    mockCreateServiceRoleClient.mockReturnValue(makeServiceClient().client);

    // The call every Edit Board route used to make. Kept as a test because the
    // callee must stay closed against it — the fix was at the call sites, and
    // relaxing this would re-open the forwarded-URL hole.
    const result = await StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE_ID,
    );

    expect(result.valid).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.requiresVerification).toBe(true);
    expect(result.permissions).toEqual([]);
  });

  it("reports a missing fingerprint as a caller error, not a device mismatch", async () => {
    // How this defect survived: substituting an empty fingerprint made the
    // refusal indistinguishable from a genuinely forwarded link, so the logs
    // read as the control working while it refused every legitimate request.
    mockCreateServiceRoleClient.mockReturnValue(makeServiceClient().client);

    await StagingAccessManager.validateStagingAccess(TOKEN, SITE_ID);

    const logged = errorLog.mock.calls.flat().join(" ");
    expect(logged).toContain("without a device fingerprint");
    expect(logged).not.toContain("device_mismatch");
  });

  it("refuses it for any User-Agent, so no client can work around it", async () => {
    // Not a property of one browser string: with no fingerprint presented there
    // is nothing to compare, so there is no request a user could make that
    // succeeds.
    for (const ua of [
      USER_AGENT,
      "Mozilla/5.0 (Windows NT 10.0) Firefox/121",
      "curl/8.4.0",
      "",
    ]) {
      const { client } = makeServiceClient(
        verifiedRow({
          verified_user_agent_hash: fingerprintFor(ua).userAgentHash,
        }),
      );
      mockCreateServiceRoleClient.mockReturnValue(client);

      const result = await StagingAccessManager.validateStagingAccess(
        TOKEN,
        SITE_ID,
      );

      expect(result.verified).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Part 3 — the endpoint, exercised for real
// ---------------------------------------------------------------------------

describe("A-10 — GET /api/edit-board/styles", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stylesRequest(): NextRequest {
    return new NextRequest(
      `https://api.recopyfast.test/api/edit-board/styles?siteId=${SITE_ID}`,
      {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          origin: ORIGIN,
          // The same browser that entered the verification code. There is
          // nothing wrong with this request.
          "user-agent": USER_AGENT,
        },
      },
    );
  }

  it("reaches the handler and validates the token", async () => {
    // Guard for the assertion below. Without it, a failed import of the route,
    // a mock that returned undefined, or a request the handler rejected as
    // malformed would all surface as "the Edit Board is dead" — which is the
    // very claim under test. This proves the handler ran and got as far as
    // reading `staging_access`; only what happens *after* that is in dispute.
    const { client, reads } = makeServiceClient();
    mockCreateServiceRoleClient.mockReturnValue(client);

    const { GET } = await import("@/app/api/edit-board/styles/route");
    const response = await GET(stylesRequest());

    expect(response).toBeDefined();
    expect(await response.json()).toBeDefined();
    expect(reads.map((read) => read.table)).toContain("staging_access");
  });

  it("serves the site's styles to the device that verified", async () => {
    const { client, reads } = makeServiceClient();
    mockCreateServiceRoleClient.mockReturnValue(client);

    const { GET } = await import("@/app/api/edit-board/styles/route");
    const response = await GET(stylesRequest());
    const body = await response.json();

    // Asserted on the data that came back and on the table that was read —
    // not on the status code. A route that authorises correctly reaches
    // `copy_styles`; a route that 401s never touches it.
    expect(reads.map((read) => read.table)).toContain("copy_styles");
    expect(body.presets).toEqual([PRESET_STYLE]);
  });
});
