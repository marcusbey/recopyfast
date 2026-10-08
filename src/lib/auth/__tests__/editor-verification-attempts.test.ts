/**
 * s68b M3 — every guess is charged atomically BEFORE it is compared.
 *
 * `consumeVerificationCode` used to read `attempts = k`, compare, and only then
 * write `k + 1`. A burst of concurrent guesses all read the same `k`, were all
 * compared, and all wrote the same `k + 1`: twenty parallel requests bought
 * twenty comparisons against a 10^6-space code for the price of one recorded
 * attempt. The charge is now a compare-and-set (`… WHERE attempts = k AND
 * consumed_at IS NULL`) and only a request whose charge landed is compared.
 *
 * The store below honours conditional updates the way PostgREST does: a
 * filtered UPDATE changes, and returns, only the rows that match at the moment
 * it runs. Every statement is atomic; requests interleave between statements,
 * exactly where real concurrent HTTP requests interleave. The same property is
 * proven against real Postgres in src/__tests__/db/editor-code-attempts.test.ts.
 */

process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import {
  MAX_CODE_ATTEMPTS,
  consumeVerificationCode,
} from "@/lib/auth/editor-verification";
import {
  hashVerificationCode,
  resetSigningKeyCache,
  timingSafeEqualString,
} from "@/lib/auth/editor-crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/auth/editor-crypto", () => {
  const actual = jest.requireActual("@/lib/auth/editor-crypto");
  return {
    ...actual,
    timingSafeEqualString: jest.fn(actual.timingSafeEqualString),
  };
});

type Row = {
  id: string;
  email: string;
  site_id: string | null;
  code_hash: string;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

type Filter = (row: Row) => boolean;

/** In-memory `editor_verification_codes` with PostgREST's conditional-update semantics. */
function createStore(rows: Row[]) {
  const statements: string[] = [];

  function from(table: string) {
    if (table !== "editor_verification_codes") {
      throw new Error(`unexpected table ${table}`);
    }
    const filters: Filter[] = [];
    let patch: Partial<Row> | null = null;
    let returning = false;
    let limit = Infinity;
    let single = false;

    const execute = () => {
      const matched = rows.filter((row) => filters.every((f) => f(row)));
      if (patch) {
        statements.push("update");
        for (const row of matched) Object.assign(row, patch);
        return {
          data: returning ? matched.map((row) => ({ id: row.id })) : null,
          error: null,
        };
      }
      statements.push("select");
      const ordered = [...matched]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map((row) => ({ ...row }));
      return {
        data: single ? (ordered[0] ?? null) : ordered,
        error: null,
      };
    };

    const builder = {
      select() {
        if (patch) returning = true;
        return builder;
      },
      update(values: Partial<Row>) {
        patch = values;
        return builder;
      },
      eq(column: keyof Row, value: unknown) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      is(column: keyof Row, value: null) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      filter(column: keyof Row, operator: "eq" | "is", value: unknown) {
        filters.push((row) => row[column] === value);
        void operator;
        return builder;
      },
      order() {
        return builder;
      },
      limit(count: number) {
        limit = count;
        return builder;
      },
      maybeSingle() {
        single = true;
        return builder;
      },
      single() {
        single = true;
        return builder;
      },
      // Executes when awaited — after a hop, like a network round trip, so
      // concurrent callers interleave between statements.
      then(
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve()
          .then(() => execute())
          .then(resolve, reject);
      },
    };
    return builder;
  }

  return { client: { from }, statements };
}

const EMAIL = "editor@example.com";
const SITE_ID = "5f0c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f";
const CODE = "482913";
const compare = timingSafeEqualString as jest.MockedFunction<
  typeof timingSafeEqualString
>;

function liveCode(overrides: Partial<Row> = {}): Row {
  return {
    id: "code-1",
    email: EMAIL,
    site_id: SITE_ID,
    code_hash: hashVerificationCode(EMAIL, CODE),
    attempts: 0,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    consumed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function useStore(rows: Row[]) {
  const store = createStore(rows);
  (createServiceRoleClient as jest.Mock).mockReturnValue(store.client);
  return store;
}

describe("consumeVerificationCode — atomic attempt charge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
  });

  it("compares 20 concurrent wrong guesses at most MAX_CODE_ATTEMPTS times and burns the code", async () => {
    const row = liveCode();
    useStore([row]);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        consumeVerificationCode({
          email: EMAIL,
          siteId: SITE_ID,
          code: String(100000 + i),
        }),
      ),
    );

    expect(compare.mock.calls.length).toBeLessThanOrEqual(MAX_CODE_ATTEMPTS);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(row.attempts).toBe(MAX_CODE_ATTEMPTS);
    expect(row.consumed_at).not.toBeNull();

    // A burned code cannot be won afterwards, even with the right digits.
    await expect(
      consumeVerificationCode({ email: EMAIL, siteId: SITE_ID, code: CODE }),
    ).resolves.toEqual({ ok: false, reason: "no_code" });
  });

  it("answers a guess whose charge lands on a spent code as a mismatch, without comparing", async () => {
    const row = liveCode({ attempts: 2 });
    const store = useStore([row]);
    // Another request spends the code between this guess's read and its
    // charge — the race the compare-and-set exists for.
    const originalFrom = store.client.from;
    let reads = 0;
    (createServiceRoleClient as jest.Mock).mockReturnValue({
      from(table: string) {
        const builder = originalFrom(table);
        const originalThen = builder.then;
        builder.then = (resolve, reject) => {
          reads += 1;
          if (reads === 2) row.consumed_at = new Date().toISOString();
          return originalThen.call(builder, resolve, reject);
        };
        return builder;
      },
    });

    const result = await consumeVerificationCode({
      email: EMAIL,
      siteId: SITE_ID,
      code: CODE,
    });

    expect(result).toEqual({ ok: false, reason: "mismatch" });
    expect(compare).not.toHaveBeenCalled();
    expect(row.attempts).toBe(2);
  });

  it("accepts the correct code on the first try and consumes it exactly once", async () => {
    const row = liveCode();
    useStore([row]);

    const [first, second] = await Promise.all([
      consumeVerificationCode({ email: EMAIL, siteId: SITE_ID, code: CODE }),
      consumeVerificationCode({ email: EMAIL, siteId: SITE_ID, code: CODE }),
    ]);

    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect(row.consumed_at).not.toBeNull();
    expect(row.attempts).toBeGreaterThanOrEqual(1);
  });

  it("accepts the correct code on the last permitted attempt", async () => {
    const row = liveCode({ attempts: MAX_CODE_ATTEMPTS - 1 });
    useStore([row]);

    await expect(
      consumeVerificationCode({ email: EMAIL, siteId: SITE_ID, code: CODE }),
    ).resolves.toEqual({ ok: true });
    expect(row.attempts).toBe(MAX_CODE_ATTEMPTS);
    expect(row.consumed_at).not.toBeNull();
  });
});
