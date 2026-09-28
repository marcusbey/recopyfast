/**
 * s47a — the founding offer: the first 20 accounts get Pro free for 90 days.
 *
 * The offer is the account's one trial row (ADR 039), written by
 * `claim_founding_offer_spot` together with a claim row, under its own
 * advisory lock. Capacity, eligibility and "claim and grant succeed or fail
 * together" are properties of the database, so they are proved here against a
 * real Postgres rather than a double.
 *
 * The suite owns every row it touches: its accounts carry the `dbtest-offer-`
 * email prefix, and claims it orphaned by deleting an account are tracked by
 * id. It never deletes a claim it did not create — a ledger holding someone
 * else's claims fails the suite closed instead, because the capacity
 * assertions below would be counting spots that are not the suite's.
 */

import { randomUUID } from "node:crypto";
import { describeDb, resolveDbTarget } from "./db-harness";

interface PgClient {
  connect(): Promise<void>;
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}

interface PgClientConstructor {
  new (config: { connectionString: string }): PgClient;
}

// `pg` intentionally has no type package in this repository; same structural
// boundary as founding-agency-cap.test.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("pg") as { Client: PgClientConstructor };

const EMAIL_PREFIX = "dbtest-offer-";
const OFFER_ID = "founding_20";
const SPOT_LIMIT = 20;
const OFFER_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(hashtextextended('founding_offer_capacity', 0))";

interface ClaimRow {
  outcome: string;
  entitlement_id: string | null;
  expires_at: Date | null;
}

interface AvailabilityRow {
  spot_limit: number;
  claimed: number;
  remaining: number;
  sold_out: boolean;
}

describeDb("Founding offer capacity", ({ query }) => {
  const marker = `${EMAIL_PREFIX}${Date.now()}`;
  /** Claims whose account this suite deleted: `user_id` is NULL on them. */
  const orphanedClaimIds: string[] = [];

  beforeAll(async () => {
    const { rows } = await query<{
      offers: string | null;
      claims: string | null;
      claim_rpc: string | null;
      availability_rpc: string | null;
      release_rpc: string | null;
    }>(`
      SELECT to_regclass('public.founding_offers')::text AS offers,
             to_regclass('public.founding_offer_claims')::text AS claims,
             to_regprocedure('public.claim_founding_offer_spot(uuid)')::text AS claim_rpc,
             to_regprocedure('public.get_founding_offer_availability()')::text AS availability_rpc,
             to_regprocedure('public.release_founding_offer_spot(uuid,text)')::text AS release_rpc
    `);

    // Fail closed: a database without the story migration must not look like
    // a lane that passed.
    expect(Object.values(rows[0])).not.toContain(null);

    const foreign = await query<{ foreign_claims: number }>(
      `SELECT COUNT(*)::INTEGER AS foreign_claims
       FROM founding_offer_claims c
       WHERE c.user_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM auth.users u
            WHERE u.id = c.user_id AND u.email LIKE $1
          )`,
      [`${EMAIL_PREFIX}%`],
    );
    if (foreign.rows[0].foreign_claims > 0) {
      throw new Error(
        `founding_offer_claims holds ${foreign.rows[0].foreign_claims} claim(s) this suite did not create. ` +
          "The capacity assertions would count them, and this suite never deletes rows it did not create. " +
          "Run it against a database whose founding offer ledger is empty.",
      );
    }
  });

  async function createUser(
    label: string,
    createdAt: "now" | "before_offer" | "null" = "now",
  ): Promise<string> {
    const id = randomUUID();
    // Real Supabase `auth.users.created_at` has no default, so eligibility
    // (created at or after the offer opened) is always set explicitly here.
    const createdAtSql = {
      now: "NOW()",
      before_offer:
        "(SELECT opened_at - INTERVAL '1 second' FROM founding_offers WHERE id = 'founding_20')",
      null: "NULL",
    }[createdAt];
    await query(
      `INSERT INTO auth.users(id, email, created_at) VALUES ($1, $2, ${createdAtSql})`,
      [id, `${marker}-${label}@example.invalid`],
    );
    return id;
  }

  async function claim(userId: string): Promise<ClaimRow> {
    const { rows } = await query<ClaimRow>(
      "SELECT outcome, entitlement_id, expires_at FROM claim_founding_offer_spot($1)",
      [userId],
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  async function availability(): Promise<AvailabilityRow> {
    const { rows } = await query<AvailabilityRow>(
      "SELECT spot_limit, claimed, remaining, sold_out FROM get_founding_offer_availability()",
    );
    return rows[0];
  }

  async function release(userId: string, reason = "qa"): Promise<string> {
    const { rows } = await query<{ result: string }>(
      "SELECT release_founding_offer_spot($1, $2) AS result",
      [userId, reason],
    );
    return rows[0].result;
  }

  async function trialRows(userId: string) {
    const { rows } = await query<{
      id: string;
      plan_id: string;
      source: string;
      offer_id: string | null;
      stripe_payment_intent_id: string | null;
      revoked_at: Date | null;
      granted_at: Date;
      expires_at: Date;
      span: string;
    }>(
      `SELECT id, plan_id, source, offer_id, stripe_payment_intent_id,
              revoked_at, granted_at, expires_at,
              (expires_at - granted_at)::text AS span
       FROM plan_entitlements
       WHERE user_id = $1`,
      [userId],
    );
    return rows;
  }

  async function claimRows(userId: string) {
    const { rows } = await query<{
      id: string;
      offer_id: string;
      entitlement_id: string | null;
      status: string;
      released_at: Date | null;
      release_reason: string | null;
    }>(
      `SELECT id, offer_id, entitlement_id, status, released_at, release_reason
       FROM founding_offer_claims
       WHERE user_id = $1`,
      [userId],
    );
    return rows;
  }

  async function cleanup(): Promise<void> {
    const suiteUsers = `SELECT id FROM auth.users WHERE email LIKE '${EMAIL_PREFIX}%'`;
    await query(
      `DELETE FROM founding_offer_claims
       WHERE user_id IN (${suiteUsers}) OR id = ANY($1::uuid[])`,
      [orphanedClaimIds],
    );
    orphanedClaimIds.splice(0);
    await query(
      `DELETE FROM billing_subscriptions WHERE user_id IN (${suiteUsers})`,
    );
    await query(
      `DELETE FROM credit_purchases WHERE user_id IN (${suiteUsers})`,
    );
    await query(
      `DELETE FROM plan_entitlements WHERE user_id IN (${suiteUsers})`,
    );
    await query(`DELETE FROM auth.users WHERE email LIKE '${EMAIL_PREFIX}%'`);
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  test("a first claim writes one Pro trial row for 90 days marked founding_20, and one claim row linked to it", async () => {
    const userId = await createUser("first");

    const result = await claim(userId);

    expect(result.outcome).toBe("claimed");
    const grants = await trialRows(userId);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      id: result.entitlement_id,
      plan_id: "pro",
      source: "trial",
      stripe_payment_intent_id: null,
      offer_id: OFFER_ID,
      revoked_at: null,
      span: "90 days",
    });
    expect(grants[0].expires_at.getTime()).toBe(
      (result.expires_at as Date).getTime(),
    );
    const claims = await claimRows(userId);
    expect(claims).toEqual([
      expect.objectContaining({
        offer_id: OFFER_ID,
        entitlement_id: grants[0].id,
        status: "claimed",
        released_at: null,
      }),
    ]);
  });

  test("a repeat claim by the same account is ineligible and writes nothing", async () => {
    const userId = await createUser("repeat");
    await claim(userId);

    const again = await claim(userId);

    expect(again).toEqual({
      outcome: "ineligible",
      entitlement_id: null,
      expires_at: null,
    });
    expect(await trialRows(userId)).toHaveLength(1);
    expect(await claimRows(userId)).toHaveLength(1);
  });

  test("an account created before the offer opened, or with NULL created_at, is ineligible", async () => {
    const older = await createUser("before-offer", "before_offer");
    const unknownAge = await createUser("null-created-at", "null");

    expect((await claim(older)).outcome).toBe("ineligible");
    expect((await claim(unknownAge)).outcome).toBe("ineligible");
    expect(await trialRows(older)).toHaveLength(0);
    expect(await trialRows(unknownAge)).toHaveLength(0);
    expect((await availability()).claimed).toBe(0);
  });

  test.each([
    [
      "live trial",
      "'pro', 'trial', NULL, NOW(), NOW() + INTERVAL '14 days', NULL",
    ],
    [
      "expired trial",
      "'pro', 'trial', NULL, NOW() - INTERVAL '20 days', NOW() - INTERVAL '6 days', NULL",
    ],
    [
      "revoked grant",
      "'pro', 'revoked:refund', $2, NOW() - INTERVAL '3 days', NULL, NOW()",
    ],
    ["lifetime purchase", "'pro', 'lifetime_purchase', $2, NOW(), NULL, NULL"],
  ])(
    "any prior plan_entitlements row makes the account ineligible (%s)",
    async (label, values) => {
      const userId = await createUser(`prior-${label.replace(/ /g, "-")}`);
      const params = values.includes("$2")
        ? [userId, `${marker}-pi-${label.replace(/ /g, "-")}`]
        : [userId];
      await query(
        `INSERT INTO plan_entitlements(
           user_id, plan_id, source, stripe_payment_intent_id,
           granted_at, expires_at, revoked_at
         ) VALUES ($1, ${values})`,
        params,
      );

      expect((await claim(userId)).outcome).toBe("ineligible");
      expect(await trialRows(userId)).toHaveLength(1);
      expect(await claimRows(userId)).toHaveLength(0);
    },
  );

  test.each(["active", "trialing", "canceled", "incomplete_expired", "unpaid"])(
    "any billing_subscriptions row, whatever its status, makes the account ineligible (%s)",
    async (status) => {
      const userId = await createUser(`subscription-${status}`);
      await query(
        `INSERT INTO billing_subscriptions(user_id, stripe_subscription_id, plan, status)
         VALUES ($1, $2, 'pro', $3)`,
        [userId, `${marker}-sub-${status}`, status],
      );

      expect((await claim(userId)).outcome).toBe("ineligible");
      expect(await trialRows(userId)).toHaveLength(0);
    },
  );

  test("any credit_purchases row makes the account ineligible", async () => {
    const userId = await createUser("credits");
    // Spent to zero: "ever" means any row, not a live balance.
    await query(
      `INSERT INTO credit_purchases(user_id, credits_purchased, credits_remaining, expires_at)
       VALUES ($1, 100, 0, NULL)`,
      [userId],
    );

    expect((await claim(userId)).outcome).toBe("ineligible");
    expect(await trialRows(userId)).toHaveLength(0);
  });

  test("an unknown user id is ineligible", async () => {
    expect((await claim(randomUUID())).outcome).toBe("ineligible");
    expect((await availability()).claimed).toBe(0);
  });

  test("at 20 claimed, the next eligible account is sold_out and gets no trial row", async () => {
    for (let index = 0; index < SPOT_LIMIT; index += 1) {
      const userId = await createUser(`spot-${index}`);
      expect((await claim(userId)).outcome).toBe("claimed");
    }
    const late = await createUser("spot-21");

    expect(await claim(late)).toEqual({
      outcome: "sold_out",
      entitlement_id: null,
      expires_at: null,
    });
    expect(await trialRows(late)).toHaveLength(0);
    expect(await claimRows(late)).toHaveLength(0);
  });

  test("availability reports spot_limit 20, remaining 20 − claimed, sold_out at 0, and does not count released claims", async () => {
    expect(await availability()).toEqual({
      spot_limit: SPOT_LIMIT,
      claimed: 0,
      remaining: SPOT_LIMIT,
      sold_out: false,
    });

    const users: string[] = [];
    for (let index = 0; index < SPOT_LIMIT; index += 1) {
      users.push(await createUser(`avail-${index}`));
      await claim(users[index]);
    }
    expect(await availability()).toEqual({
      spot_limit: SPOT_LIMIT,
      claimed: SPOT_LIMIT,
      remaining: 0,
      sold_out: true,
    });

    await release(users[0]);
    expect(await availability()).toEqual({
      spot_limit: SPOT_LIMIT,
      claimed: SPOT_LIMIT - 1,
      remaining: 1,
      sold_out: false,
    });
  });

  test("release sets revoked_at only", async () => {
    const userId = await createUser("release");
    await claim(userId);
    const [before] = await trialRows(userId);
    expect((await availability()).remaining).toBe(SPOT_LIMIT - 1);

    // A release with no reason leaves nothing behind to explain it.
    await expect(release(userId, "   ")).rejects.toMatchObject({
      code: "22023",
    });
    expect((await claimRows(userId))[0].status).toBe("claimed");

    expect(await release(userId, "qa account")).toBe("released");

    const [after] = await trialRows(userId);
    expect(after.revoked_at).not.toBeNull();
    expect({ ...after, revoked_at: null }).toEqual({
      ...before,
      revoked_at: null,
    });
    expect(after).toMatchObject({ source: "trial", offer_id: OFFER_ID });
    expect(await claimRows(userId)).toEqual([
      expect.objectContaining({
        status: "released",
        release_reason: "qa account",
        released_at: expect.any(Date),
      }),
    ]);
    expect((await availability()).remaining).toBe(SPOT_LIMIT);

    // A released QA account is spent: it neither re-claims nor gets a second,
    // 14-day trial through the one-trial index.
    expect((await claim(userId)).outcome).toBe("ineligible");
    await expect(
      query(
        `INSERT INTO plan_entitlements(user_id, plan_id, source, expires_at)
         VALUES ($1, 'pro', 'trial', NOW() + INTERVAL '14 days')`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  test("release of an unclaimed account returns not_claimed; a second release returns already_released", async () => {
    const unclaimed = await createUser("never-claimed");
    const claimed = await createUser("release-twice");
    await claim(claimed);

    expect(await release(unclaimed)).toBe("not_claimed");
    expect(await release(claimed)).toBe("released");
    const [firstRevocation] = await trialRows(claimed);
    expect(await release(claimed)).toBe("already_released");
    const [secondRevocation] = await trialRows(claimed);

    expect(secondRevocation.revoked_at).toEqual(firstRevocation.revoked_at);
    expect(await claimRows(claimed)).toHaveLength(1);
  });

  test("the table refuses rewriting an offer row's source", async () => {
    const userId = await createUser("rewrite-source");
    const { entitlement_id: entitlementId } = await claim(userId);

    // The house revocation shape (entitlements.ts). On an offer row it would
    // take the row out of the one-trial index and hand out a second trial.
    await expect(
      query(
        "UPDATE plan_entitlements SET source = 'revoked:qa', revoked_at = NOW() WHERE id = $1",
        [entitlementId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("deleting a claimed account keeps its spot consumed", async () => {
    const userId = await createUser("deleted");
    await claim(userId);
    const [claimRow] = await claimRows(userId);
    orphanedClaimIds.push(claimRow.id);

    await query("DELETE FROM auth.users WHERE id = $1", [userId]);

    const { rows } = await query<{
      user_id: string | null;
      entitlement_id: string | null;
      status: string;
    }>(
      "SELECT user_id, entitlement_id, status FROM founding_offer_claims WHERE id = $1",
      [claimRow.id],
    );
    expect(rows[0]).toEqual({
      user_id: null,
      entitlement_id: null,
      status: "claimed",
    });
    expect((await availability()).remaining).toBe(SPOT_LIMIT - 1);
  });

  test("only service_role executes the three functions", async () => {
    const { rows } = await query<{
      identity: string;
      is_definer: boolean;
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
      public_grant: boolean;
    }>(`
      SELECT p.oid::regprocedure::text AS identity,
             p.prosecdef AS is_definer,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role,
             EXISTS (
               SELECT 1
               FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
               WHERE a.grantee = 0
             ) AS public_grant
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN (
          'claim_founding_offer_spot',
          'get_founding_offer_availability',
          'release_founding_offer_spot'
        )
      ORDER BY identity
    `);

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        is_definer: true,
        anon: false,
        authenticated: false,
        service_role: true,
        public_grant: false,
      });
    }
  });

  test("both new tables have RLS, a service-role-only policy and no PUBLIC/anon/authenticated table privilege", async () => {
    for (const table of ["founding_offers", "founding_offer_claims"]) {
      const { rows } = await query<{
        rls: boolean;
        policy_roles: string[] | null;
        anon: boolean;
        authenticated: boolean;
        public_grant: boolean;
      }>(
        `SELECT c.relrowsecurity AS rls,
                ARRAY(
                  SELECT DISTINCT CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)::text END
                  FROM pg_policy p, unnest(p.polroles) r
                  WHERE p.polrelid = c.oid
                )::text[] AS policy_roles,
                has_table_privilege('anon', c.oid,
                  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon,
                has_table_privilege('authenticated', c.oid,
                  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS authenticated,
                EXISTS (
                  SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
                  WHERE a.grantee = 0
                ) AS public_grant
         FROM pg_class c
         WHERE c.oid = format('public.%I', $1::text)::regclass`,
        [table],
      );

      expect({ table, ...rows[0] }).toEqual({
        table,
        rls: true,
        policy_roles: ["service_role"],
        anon: false,
        authenticated: false,
        public_grant: false,
      });
    }
  });

  // Task 2 — concurrency. Kept in this file so CI runs one suite by name.
  test("30 barrier-synchronised first sign-ins claim exactly 20", async () => {
    const accounts = await Promise.all(
      Array.from({ length: 30 }, (_, index) => createUser(`race-${index}`)),
    );
    const barrier = new Client({
      connectionString: resolveDbTarget().connectionString,
    });
    await barrier.connect();
    await barrier.query("BEGIN");
    await barrier.query(OFFER_LOCK_SQL);

    const clients = accounts.map(
      () =>
        new Client({ connectionString: resolveDbTarget().connectionString }),
    );
    await Promise.all(clients.map((client) => client.connect()));
    const backendPids = await Promise.all(
      clients.map(async (client) => {
        const { rows } = await client.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        );
        return rows[0].pid;
      }),
    );
    let resolvedClaims = 0;
    const claims = accounts.map(async (userId, index) => {
      const { rows } = await clients[index].query<{ outcome: string }>(
        "SELECT outcome FROM claim_founding_offer_spot($1)",
        [userId],
      );
      resolvedClaims += 1;
      return rows[0].outcome;
    });

    let waiters = 0;
    let resolvedWhileHeld = 0;
    try {
      const deadline = Date.now() + 5_000;
      while (
        Date.now() < deadline &&
        waiters < accounts.length &&
        resolvedClaims === 0
      ) {
        // The barrier stays in one transaction; refresh the statistics
        // snapshot or later waiters stay invisible (see founding-agency-cap).
        await barrier.query("SELECT pg_stat_clear_snapshot()");
        const { rows } = await barrier.query<{ waiters: number }>(
          `SELECT COUNT(*)::INTEGER AS waiters
           FROM pg_stat_activity
           WHERE pid = ANY($1::INTEGER[])
             AND wait_event_type = 'Lock'`,
          [backendPids],
        );
        waiters = rows[0].waiters;
        if (waiters < accounts.length && resolvedClaims === 0) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      resolvedWhileHeld = resolvedClaims;
    } finally {
      await barrier.query("COMMIT");
      await barrier.end();
    }

    const outcomes = await Promise.all(claims);
    await Promise.all(clients.map((client) => client.end()));

    // Holding the production key turns the coordinator into a start barrier:
    // a claim function without the lock resolves while it is held, and this
    // fails before a scheduler-dependent count can hide the mutation.
    expect({ waiters, resolvedClaims: resolvedWhileHeld }).toEqual({
      waiters: accounts.length,
      resolvedClaims: 0,
    });
    expect(outcomes.filter((outcome) => outcome === "claimed")).toHaveLength(
      SPOT_LIMIT,
    );
    expect(outcomes.filter((outcome) => outcome === "sold_out")).toHaveLength(
      10,
    );

    const { rows } = await query<{
      claims: number;
      offer_rows: number;
      sold_out_with_rows: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::INTEGER FROM founding_offer_claims
           WHERE user_id = ANY($1::uuid[])) AS claims,
         (SELECT COUNT(*)::INTEGER FROM plan_entitlements
           WHERE user_id = ANY($1::uuid[]) AND offer_id = 'founding_20') AS offer_rows,
         (SELECT COUNT(*)::INTEGER FROM plan_entitlements
           WHERE user_id = ANY($2::uuid[])) AS sold_out_with_rows`,
      [accounts, accounts.filter((_, index) => outcomes[index] === "sold_out")],
    );
    expect(rows[0]).toEqual({
      claims: SPOT_LIMIT,
      offer_rows: SPOT_LIMIT,
      sold_out_with_rows: 0,
    });
    expect((await availability()).remaining).toBe(0);
  }, 30_000);

  test("claims racing a fallback 14-day trial insert for the same account never leave a claim without its row", async () => {
    const accounts = await Promise.all(
      Array.from({ length: 10 }, (_, index) => createUser(`fallback-${index}`)),
    );
    const clients = accounts.flatMap(() => [
      new Client({ connectionString: resolveDbTarget().connectionString }),
      new Client({ connectionString: resolveDbTarget().connectionString }),
    ]);
    await Promise.all(clients.map((client) => client.connect()));

    try {
      await Promise.allSettled(
        accounts.flatMap((userId, index) => [
          clients[index * 2].query(
            "SELECT outcome FROM claim_founding_offer_spot($1)",
            [userId],
          ),
          clients[index * 2 + 1].query(
            `INSERT INTO plan_entitlements(user_id, plan_id, source, expires_at)
             VALUES ($1, 'pro', 'trial', NOW() + INTERVAL '14 days')`,
            [userId],
          ),
        ]),
      );
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }

    const { rows } = await query<{
      user_id: string;
      trial_rows: number;
      offer_rows: number;
      claims: number;
      linked_claims: number;
    }>(
      `SELECT u.id AS user_id,
              (SELECT COUNT(*)::INTEGER FROM plan_entitlements pe
                WHERE pe.user_id = u.id AND pe.source = 'trial') AS trial_rows,
              (SELECT COUNT(*)::INTEGER FROM plan_entitlements pe
                WHERE pe.user_id = u.id AND pe.offer_id IS NOT NULL) AS offer_rows,
              (SELECT COUNT(*)::INTEGER FROM founding_offer_claims c
                WHERE c.user_id = u.id) AS claims,
              (SELECT COUNT(*)::INTEGER FROM founding_offer_claims c
                JOIN plan_entitlements pe ON pe.id = c.entitlement_id
                WHERE c.user_id = u.id AND pe.offer_id IS NOT NULL) AS linked_claims
       FROM auth.users u
       WHERE u.id = ANY($1::uuid[])`,
      [accounts],
    );

    expect(rows).toHaveLength(accounts.length);
    for (const row of rows) {
      expect(row.trial_rows).toBe(1);
      // A claim row exists if and only if the account's one trial row is the
      // offer's — and then it points at that row.
      expect(row.claims).toBe(row.offer_rows);
      expect(row.linked_claims).toBe(row.offer_rows);
    }
  }, 30_000);
});
