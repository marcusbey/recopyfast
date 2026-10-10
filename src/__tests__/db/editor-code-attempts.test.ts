/**
 * @jest-environment node
 */

/**
 * s68b M3 — the per-code attempt charge holds under real concurrency.
 *
 * `consumeVerificationCode` charges each guess with a compare-and-set through
 * PostgREST (`UPDATE … WHERE id = ? AND attempts = k AND consumed_at IS NULL`,
 * returning the row) before it compares. The unit suite proves the logic with a
 * fake store; this one proves the premise the logic rests on: that PostgREST
 * reports zero rows to the loser of a conditional UPDATE, so twenty concurrent
 * wrong guesses land exactly MAX_CODE_ATTEMPTS charges and burn the code. It
 * runs the real function, the real service client and the local PostgREST,
 * against a code row inserted with plain SQL.
 *
 * Gated like published-snapshot-freshness: no database → a "[gated]" pass; a
 * database but no PostgREST target → a "[gated]" pass, unless
 * RCF_REQUIRE_TEST_DB=1, which turns either absence into a failure.
 */

import { describeDb, readConfiguredApiPort } from "./db-harness";

const POSTGREST_BASE_URL = process.env.RCF_TEST_POSTGREST_URL;
const POSTGREST_SERVICE_ROLE_KEY =
  process.env.RCF_TEST_POSTGREST_SERVICE_ROLE_KEY;
const hasPostgrestTarget = Boolean(
  POSTGREST_BASE_URL && POSTGREST_SERVICE_ROLE_KEY,
);

if (process.env.RCF_REQUIRE_TEST_DB === "1" && !hasPostgrestTarget) {
  throw new Error(
    "RCF_REQUIRE_TEST_DB=1 but RCF_TEST_POSTGREST_URL or RCF_TEST_POSTGREST_SERVICE_ROLE_KEY is missing: the editor-code attempt proof cannot run, and it must not pass unrun.",
  );
}

// Same pin as the other PostgREST suites: a service key is in play, so only
// this project's local stack is an acceptable target.
if (POSTGREST_BASE_URL) {
  const target = new URL(POSTGREST_BASE_URL);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    target.hostname,
  );
  if (
    target.protocol !== "http:" ||
    !isLoopback ||
    target.port !== String(readConfiguredApiPort()) ||
    target.pathname !== "/"
  ) {
    throw new Error(
      `Refusing PostgREST integration target outside this project's local Supabase: ${target.origin}`,
    );
  }
}

// `@/lib/supabase/service` reads these once, at load: set them before the
// module under test is imported in beforeAll. The code hash is keyed, so the
// test and the function must agree on the key.
if (hasPostgrestTarget) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = POSTGREST_BASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = POSTGREST_SERVICE_ROLE_KEY;
}
process.env.EDITOR_GRANT_SECRET =
  "s68b-editor-code-attempts-test-secret-32-chars-min";

const CODE = "482913";
const GUESSES = 20;

describeDb("s68b editor-code attempts against real Postgres", (suite) => {
  if (!hasPostgrestTarget) {
    test("[gated] no PostgREST target configured — attempt charge not checked", () => {
      console.warn(
        "Set RCF_TEST_POSTGREST_URL and RCF_TEST_POSTGREST_SERVICE_ROLE_KEY to charge editor-code attempts through PostgREST (RCF_REQUIRE_TEST_DB=1 makes their absence a failure).",
      );
      expect(hasPostgrestTarget).toBe(false);
    });
    return;
  }

  let consumeVerificationCode: typeof import("@/lib/auth/editor-verification").consumeVerificationCode;
  let maxCodeAttempts: number;
  let hashVerificationCode: typeof import("@/lib/auth/editor-crypto").hashVerificationCode;

  beforeAll(async () => {
    const verification = await import("@/lib/auth/editor-verification");
    consumeVerificationCode = verification.consumeVerificationCode;
    maxCodeAttempts = verification.MAX_CODE_ATTEMPTS;
    ({ hashVerificationCode } = await import("@/lib/auth/editor-crypto"));
  });

  async function seedCode(siteId: string, email: string): Promise<string> {
    const { rows } = await suite.query<{ id: string }>(
      `INSERT INTO public.editor_verification_codes (email, site_id, code_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '10 minutes')
       RETURNING id`,
      [email, siteId, hashVerificationCode(email, CODE)],
    );
    return rows[0].id;
  }

  test("20 concurrent wrong guesses land exactly MAX_CODE_ATTEMPTS charges and burn the code", async () => {
    const siteId = await suite.createSite("s68b-code-attempts");
    const email = `s68b-${siteId}@recopyfast.local`;
    const codeId = await seedCode(siteId, email);

    const results = await Promise.all(
      Array.from({ length: GUESSES }, (_, i) =>
        consumeVerificationCode({
          email,
          siteId,
          code: String(100000 + i),
        }),
      ),
    );

    expect(results.every((result) => !result.ok)).toBe(true);

    const { rows } = await suite.query<{
      attempts: number;
      consumed_at: string | null;
    }>(
      "SELECT attempts, consumed_at FROM public.editor_verification_codes WHERE id = $1",
      [codeId],
    );
    expect(rows[0].attempts).toBe(maxCodeAttempts);
    expect(rows[0].consumed_at).not.toBeNull();

    await expect(
      consumeVerificationCode({ email, siteId, code: CODE }),
    ).resolves.toEqual({ ok: false, reason: "no_code" });
  });

  test("the correct code on the first try is accepted once and consumed", async () => {
    const siteId = await suite.createSite("s68b-code-success");
    const email = `s68b-ok-${siteId}@recopyfast.local`;
    const codeId = await seedCode(siteId, email);

    const [first, second] = await Promise.all([
      consumeVerificationCode({ email, siteId, code: CODE }),
      consumeVerificationCode({ email, siteId, code: CODE }),
    ]);

    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    const { rows } = await suite.query<{ consumed_at: string | null }>(
      "SELECT consumed_at FROM public.editor_verification_codes WHERE id = $1",
      [codeId],
    );
    expect(rows[0].consumed_at).not.toBeNull();
  });
});
