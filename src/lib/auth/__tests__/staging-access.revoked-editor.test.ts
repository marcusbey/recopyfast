/**
 * @jest-environment node
 */

/*
 * s68c — HTTP honours "remove this editor" for staging tokens.
 *
 * `revokeSiteEditor` stamps `site_editors.revoked_at` and sweeps the editor's
 * device grants, but `validateStagingAccess` never read `site_editors` at all.
 * A removed editor's verified staging token kept saving staged copy over HTTP
 * until the 12 h verification TTL, and then re-verified with a code sent to the
 * mailbox they still own (`verifyEmail` / `resendVerificationCode` had no
 * directory check either) until the invite row itself expired. The realtime
 * check was the only place the removal reached a staging token — and it
 * compared e-mail case-sensitively.
 *
 * `site_editors.email` is always lower-cased (`normalizeEmail`); a staging
 * invite keeps the case it was typed with, so every case below presents the
 * invite address in a different case from the directory row.
 *
 * The fake applies every `.eq()` / `.gte()` it is given, so a lookup that drops
 * the site filter or compares the raw address finds the wrong row and goes red.
 */

import { createServiceRoleClient } from "@/lib/supabase/service";
import { StagingAccessManager } from "../staging-access";
import { readStagingDeviceFingerprint } from "../staging-device";

jest.mock("@/lib/supabase/service");

const SITE_ID = "site-revoked-editor";
const OTHER_SITE_ID = "site-elsewhere";
const TOKEN = "staging-token-revoked-editor";
const CODE = "482913";
const HOUR_MS = 60 * 60 * 1000;
const REFUSED_MESSAGE = "Invalid or expired staging token";

type Row = Record<string, unknown>;

interface FakeState {
  tables: Record<string, Row[]>;
  updates: Array<{ table: string; payload: Row }>;
  failingReads: string[];
}

const invitee = readStagingDeviceFingerprint({
  headers: new Headers({
    "user-agent": "Mozilla/5.0 (Macintosh) Chrome/120",
    origin: "https://customer.example",
  }),
});

function fakeClient(state: FakeState) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let pendingUpdate: Row | null = null;
      const matching = () =>
        (state.tables[table] ?? []).filter((row) =>
          filters.every((filter) => filter(row)),
        );

      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return chain;
        },
        gte: (column: string, value: string) => {
          filters.push((row) => String(row[column]) >= value);
          return chain;
        },
        update: (payload: Row) => {
          pendingUpdate = payload;
          state.updates.push({ table, payload });
          return chain;
        },
        single: async () => {
          const found = matching();
          if (found.length !== 1) {
            return { data: null, error: { message: "no rows" } };
          }
          return {
            data: { ...found[0], ...(pendingUpdate ?? {}) },
            error: null,
          };
        },
        maybeSingle: async () => {
          if (state.failingReads.includes(table)) {
            return { data: null, error: { message: "connection reset" } };
          }
          const found = matching();
          return found.length > 1
            ? { data: null, error: { message: "multiple rows" } }
            : { data: found[0] ?? null, error: null };
        },
        then: (
          onFulfilled: (value: { data: null; error: null }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) =>
          Promise.resolve({ data: null, error: null }).then(
            onFulfilled,
            onRejected,
          ),
      };
      return chain;
    },
  };
}

function stagingRow(overrides: Row = {}): Row {
  return {
    id: "access-1",
    site_id: SITE_ID,
    access_type: "invite",
    email: "John@Example.com",
    email_verified: true,
    token: TOKEN,
    permissions: ["view", "edit"],
    label: "John",
    created_by: "owner-1",
    expires_at: new Date(Date.now() + 7 * 24 * HOUR_MS).toISOString(),
    is_active: true,
    last_used_at: null,
    created_at: new Date().toISOString(),
    verified_user_agent_hash: invitee.userAgentHash,
    verified_origin_hash: invitee.originHash,
    verified_ip_prefix: null,
    verified_at: new Date(Date.now() - HOUR_MS).toISOString(),
    ...overrides,
  };
}

function unverifiedRow(): Row {
  return stagingRow({
    email_verified: false,
    verified_user_agent_hash: null,
    verified_at: null,
    verification_code: CODE,
    verification_expires_at: new Date(
      Date.now() + 10 * 60 * 1000,
    ).toISOString(),
  });
}

function directoryRow(overrides: Row = {}): Row {
  return {
    id: "editor-1",
    site_id: SITE_ID,
    email: "john@example.com",
    permissions: ["edit"],
    revoked_at: new Date(Date.now() - 60 * 1000).toISOString(),
    ...overrides,
  };
}

function useTables(tables: Record<string, Row[]>, failingReads: string[] = []) {
  const state: FakeState = { tables, updates: [], failingReads };
  jest
    .mocked(createServiceRoleClient)
    .mockReturnValue(
      fakeClient(state) as unknown as ReturnType<
        typeof createServiceRoleClient
      >,
    );
  return state;
}

function stagingWrites(state: FakeState) {
  return state.updates.filter((update) => update.table === "staging_access");
}

describe("validateStagingAccess — a removed editor's staging token", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ["typed in mixed case", "John@Example.com"],
    ["typed in lower case", "john@example.com"],
    ["typed in upper case with stray spaces", "  JOHN@EXAMPLE.COM "],
  ])(
    "refuses a verified, device-bound token whose invite was %s",
    async (_label, inviteEmail) => {
      useTables({
        staging_access: [stagingRow({ email: inviteEmail })],
        site_editors: [directoryRow()],
      });

      const result = await StagingAccessManager.validateStagingAccess(
        TOKEN,
        SITE_ID,
        invitee,
      );

      expect(result).toMatchObject({
        valid: false,
        verified: false,
        permissions: [],
        error: REFUSED_MESSAGE,
      });
    },
  );

  it("changes nothing when the address has no directory row (absent is not revoked)", async () => {
    useTables({ staging_access: [stagingRow()], site_editors: [] });

    const result = await StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE_ID,
      invitee,
    );

    expect(result).toMatchObject({
      valid: true,
      verified: true,
      permissions: ["view", "edit"],
    });
  });

  it("admits an editor whose directory row stands (control)", async () => {
    useTables({
      staging_access: [stagingRow()],
      site_editors: [directoryRow({ revoked_at: null })],
    });

    const result = await StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE_ID,
      invitee,
    );

    expect(result).toMatchObject({ valid: true, verified: true });
  });

  it("ignores a revocation on another site", async () => {
    useTables({
      staging_access: [stagingRow()],
      site_editors: [directoryRow({ site_id: OTHER_SITE_ID })],
    });

    const result = await StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE_ID,
      invitee,
    );

    expect(result).toMatchObject({ valid: true, verified: true });
  });

  it("fails closed when the directory cannot be read", async () => {
    // A database that cannot answer "was this editor removed" has not
    // answered "no".
    useTables({ staging_access: [stagingRow()], site_editors: [] }, [
      "site_editors",
    ]);

    const result = await StagingAccessManager.validateStagingAccess(
      TOKEN,
      SITE_ID,
      invitee,
    );

    expect(result).toMatchObject({
      valid: false,
      verified: false,
      permissions: [],
    });
  });
});

describe("verification refuses a removed editor's staging token", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("verifyEmail does not verify, or bind a device, with the right code", async () => {
    const state = useTables({
      staging_access: [unverifiedRow()],
      site_editors: [directoryRow()],
    });

    const result = await StagingAccessManager.verifyEmail(TOKEN, CODE, invitee);

    expect(result.success).toBe(false);
    expect(result.access).toBeUndefined();
    expect(stagingWrites(state)).toEqual([]);
  });

  it("resendVerificationCode issues no code", async () => {
    const state = useTables({
      staging_access: [unverifiedRow()],
      site_editors: [directoryRow()],
    });

    const result = await StagingAccessManager.resendVerificationCode(TOKEN);

    expect(result.success).toBe(false);
    expect(result.verificationCode).toBeUndefined();
    expect(result.email).toBeUndefined();
    expect(stagingWrites(state)).toEqual([]);
  });

  it("still verifies and resends for an editor with no directory row (control)", async () => {
    const resendState = useTables({
      staging_access: [unverifiedRow()],
      site_editors: [],
    });
    const resent = await StagingAccessManager.resendVerificationCode(TOKEN);
    expect(resent.success).toBe(true);
    expect(stagingWrites(resendState)).toHaveLength(1);

    const verifyState = useTables({
      staging_access: [unverifiedRow()],
      site_editors: [],
    });
    const verified = await StagingAccessManager.verifyEmail(
      TOKEN,
      CODE,
      invitee,
    );
    expect(verified.success).toBe(true);
    expect(stagingWrites(verifyState)).toHaveLength(1);
  });
});
