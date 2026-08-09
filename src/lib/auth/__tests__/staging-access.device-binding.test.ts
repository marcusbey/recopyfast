/**
 * The regression test for the forwarded-invite-URL vulnerability.
 *
 * Before this fix, `staging_access.email_verified` was a permanent boolean on a
 * row keyed by a token that travels in a URL, so `validateStagingAccess` handed
 * full permissions to ANY later bearer once the real invitee had verified once.
 * Forwarding the link forwarded the authorisation, for up to 30 days.
 *
 * The load-bearing assertion here is "a different device gets verified:false and
 * an empty permission set". If someone later relaxes the binding, this fails.
 */

import { StagingAccessManager } from "../staging-access";
import { readStagingDeviceFingerprint } from "../staging-device";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/supabase/service");

const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;

const SITE_ID = "site-123";
const TOKEN = "staging-token-abc";

function fingerprintFor(userAgent: string) {
  return readStagingDeviceFingerprint({
    headers: new Headers({
      "user-agent": userAgent,
      origin: "https://customer.example",
    }),
  });
}

const invitee = fingerprintFor("Mozilla/5.0 (Macintosh) Chrome/120");
const forwardedTo = fingerprintFor("Mozilla/5.0 (Windows NT 10.0) Firefox/121");

/**
 * Minimal stand-in for the PostgREST builder.
 *
 * `validateStagingAccess` chains select/eq/gte/single to read and then
 * update/eq to touch `last_used_at`; both shapes resolve from the same object.
 */
function mockSupabaseReturning(row: Record<string, unknown> | null) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  Object.assign(builder, {
    select: jest.fn(chain),
    eq: jest.fn(chain),
    gte: jest.fn(chain),
    update: jest.fn(chain),
    single: jest.fn().mockResolvedValue({
      data: row,
      error: row ? null : { message: "not found" },
    }),
    maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }),
  });

  return { from: jest.fn(() => builder) };
}

function verifiedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "access-1",
    site_id: SITE_ID,
    access_type: "invite",
    email: "bob@corp.example",
    email_verified: true,
    token: TOKEN,
    permissions: ["view", "edit"],
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

describe("validateStagingAccess — device binding", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("grants access to the device that actually verified", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      mockSupabaseReturning(verifiedRow()) as unknown as ReturnType<
        typeof createServiceRoleClient
      >,
    );

    const result = await StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE_ID,
      invitee,
    );

    expect(result.valid).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.permissions).toEqual(["view", "edit"]);
  });

  it("refuses a forwarded URL opened in someone else's browser", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      mockSupabaseReturning(verifiedRow()) as unknown as ReturnType<
        typeof createServiceRoleClient
      >,
    );

    const result = await StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE_ID,
      forwardedTo,
    );

    expect(result.verified).toBe(false);
    expect(result.requiresVerification).toBe(true);
    // The whole point: no permissions leak to the forwardee.
    expect(result.permissions).toEqual([]);
  });

  it("refuses a caller that presents no fingerprint", async () => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    mockCreateServiceRoleClient.mockReturnValue(
      mockSupabaseReturning(verifiedRow()) as unknown as ReturnType<
        typeof createServiceRoleClient
      >,
    );

    const result = await StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE_ID,
    );

    expect(result.verified).toBe(false);
    expect(result.requiresVerification).toBe(true);
    expect(result.permissions).toEqual([]);
    // Refused loudly, and as a caller bug rather than as a device mismatch.
    // Substituting an empty fingerprint and letting the hash comparison fail
    // produced the same refusal while logging `device_mismatch`, which is what
    // let fifteen Edit Board call sites sit broken and look correct (A-10).
    expect(errorLog.mock.calls.flat().join(" ")).toContain(
      "without a device fingerprint",
    );
  });

  it("refuses a row verified before the binding existed", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      mockSupabaseReturning(
        verifiedRow({
          verified_user_agent_hash: null,
          verified_at: null,
        }),
      ) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    const result = await StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE_ID,
      invitee,
    );

    expect(result.verified).toBe(false);
    expect(result.requiresVerification).toBe(true);
    expect(result.permissions).toEqual([]);
  });

  it("refuses the original device once the binding goes stale", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      mockSupabaseReturning(
        verifiedRow({
          verified_at: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
        }),
      ) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    const result = await StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE_ID,
      invitee,
    );

    expect(result.verified).toBe(false);
    expect(result.requiresVerification).toBe(true);
  });

  it("still reports an unverified row as needing verification", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      mockSupabaseReturning(
        verifiedRow({
          email_verified: false,
          verified_user_agent_hash: null,
          verified_at: null,
        }),
      ) as unknown as ReturnType<typeof createServiceRoleClient>,
    );

    const result = await StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE_ID,
      invitee,
    );

    expect(result.valid).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.requiresVerification).toBe(true);
  });
});
