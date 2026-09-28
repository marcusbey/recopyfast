import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describeDb, resolveDbTarget } from "./db-harness";

/**
 * s48 — AI credits are spent and refunded by database functions.
 *
 * What broke (`.omx/qa-20260927/REPORT.md`, defects 2 and 3):
 *
 *   P4  `deductPurchasedCredits` ran one compare-and-swap per purchase row and,
 *       on a collision, restarted with the FULL amount without undoing the rows
 *       it had already decremented. Twelve concurrent 5-credit charges lost 2–9
 *       credits per round and refused 3–6 requests the wallet covered.
 *   P2  A refund could not say where a charge came from, so it minted a new
 *       never-expiring "purchased" row — even for a charge the monthly
 *       allowance had paid, which then stayed counted as used as well.
 *   P3  That minted row is an entitlement: a lapsed, never-paying trial with one
 *       refunded failure resolved to `credits` and passed the paywall.
 *
 * Money arithmetic and exclusion are database properties, so they are proved
 * here, on real Postgres, against `spend_credits` and `refund_credit_usage`
 * (migration 20260928110000). The TypeScript side is only ever tested as a
 * contract with these functions.
 */

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

// `pg` intentionally has no type package in this repository. The DB harness
// uses the same structural boundary so real-Postgres tests do not expand the
// production dependency surface just for test declarations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("pg") as { Client: PgClientConstructor };

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../supabase/migrations/20260928110000_atomic_credit_spend_and_refund.sql",
);

const SPEND_SIGNATURE =
  "public.spend_credits(uuid,integer,integer,timestamp with time zone,text,jsonb)";
const REFUND_SIGNATURE = "public.refund_credit_usage(uuid,uuid,integer)";

const EMAIL_PREFIX = "dbtest-credits-";

interface SpendResult {
  outcome: string;
  usage_id: string | null;
  from_allowance: number;
  from_purchased: number;
  remaining: number;
}

interface RefundResult {
  refunded: number;
  to_purchased: number;
  to_allowance: number;
}

interface UsageRow {
  id: string;
  credits_used: number;
  credits_from_purchased: number;
  credits_refunded: number;
  purchase_debits: Array<{ purchase_id: string; credits: number }>;
  operation: string;
  metadata: Record<string, unknown>;
}

interface Runner {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

const SPEND_SQL = `SELECT outcome, usage_id, from_allowance, from_purchased, remaining
                   FROM public.spend_credits($1, $2, $3, $4, $5, $6)`;
const REFUND_SQL = `SELECT refunded, to_purchased, to_allowance
                    FROM public.refund_credit_usage($1, $2, $3)`;

/** An hour of margin swamps any clock skew between this host and the DB. */
function anHourAgo(): string {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString();
}

/** Deterministic, well-separated creation times so spend order is explicit. */
function day(n: number): string {
  return new Date(Date.UTC(2026, 0, n)).toISOString();
}

describeDb("AI credit spend and refund (s48)", ({ query, withClient }) => {
  beforeAll(async () => {
    const { rows } = await query<{
      spend_rpc: string | null;
      refund_rpc: string | null;
      columns: number;
    }>(
      `SELECT to_regprocedure($1)::text AS spend_rpc,
              to_regprocedure($2)::text AS refund_rpc,
              (SELECT COUNT(*)::INTEGER
                 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'credit_usage'
                  AND column_name IN (
                    'credits_from_purchased',
                    'purchase_debits',
                    'credits_refunded'
                  )) AS columns`,
      [SPEND_SIGNATURE, REFUND_SIGNATURE],
    );

    // The harness probe only proves a ReCopyFast database answered. Without
    // this, a database that never had the story migration applied would fail
    // every test here with "function does not exist" — or, worse, a later
    // edit could make some of them pass vacuously. Fail closed, by name.
    expect(rows[0]).toEqual({
      spend_rpc: expect.any(String),
      refund_rpc: expect.any(String),
      columns: 3,
    });
  });

  async function cleanup(): Promise<void> {
    // Only the users this suite created. The FK cascade removes their
    // credit_purchases, credit_usage and plan_entitlements rows.
    await query("DELETE FROM auth.users WHERE email LIKE $1", [
      `${EMAIL_PREFIX}%`,
    ]);
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  async function createUser(label: string): Promise<string> {
    const id = randomUUID();
    await query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
      id,
      `${EMAIL_PREFIX}${label}-${id}@example.invalid`,
    ]);
    return id;
  }

  async function addPurchase(
    userId: string,
    credits: number,
    options: {
      createdAt: string;
      remaining?: number;
      isExpired?: boolean;
      paymentIntentId?: string;
      priceCents?: number | null;
    },
  ): Promise<string> {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO credit_purchases (
         user_id, credits_purchased, credits_remaining, price_cents,
         stripe_payment_intent_id, expires_at, created_at
       )
       VALUES (
         $1, $2, $3, $4, $5,
         CASE WHEN $6 THEN NOW() - INTERVAL '1 day' ELSE NULL END,
         $7
       )
       RETURNING id`,
      [
        userId,
        credits,
        options.remaining ?? credits,
        options.priceCents === undefined ? 900 : options.priceCents,
        options.paymentIntentId ?? `pi_dbtest_credits_${randomUUID()}`,
        options.isExpired ?? false,
        options.createdAt,
      ],
    );
    return rows[0].id;
  }

  /**
   * Runs `work` in one transaction as `role`, the way PostgREST would: the
   * service role with no subject, or `authenticated` with the user's claims.
   * SET LOCAL keeps the role and claims from leaking into the pooled
   * connection after COMMIT.
   */
  async function asRole<T>(
    role: "service_role" | "authenticated",
    subject: string | null,
    work: (runner: Runner) => Promise<T>,
  ): Promise<T> {
    return withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL ROLE ${role}`);
        if (subject) {
          await client.query(
            "SELECT set_config('request.jwt.claims', $1, true)",
            [JSON.stringify({ sub: subject, role })],
          );
        }
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  async function spend(
    userId: string,
    credits: number,
    included: number,
    windowStart: string,
    operation = "ai_suggestion",
    metadata: Record<string, unknown> = {},
  ): Promise<SpendResult> {
    return asRole("service_role", null, async (runner) => {
      const { rows } = await runner.query<SpendResult>(SPEND_SQL, [
        userId,
        credits,
        included,
        windowStart,
        operation,
        JSON.stringify(metadata),
      ]);
      return rows[0];
    });
  }

  async function refund(
    usageId: string,
    userId: string,
    credits: number,
  ): Promise<RefundResult> {
    return asRole("service_role", null, async (runner) => {
      const { rows } = await runner.query<RefundResult>(REFUND_SQL, [
        usageId,
        userId,
        credits,
      ]);
      return rows[0];
    });
  }

  /** `credits_remaining` per purchase row, oldest first. */
  async function wallet(userId: string): Promise<number[]> {
    const { rows } = await query<{ credits_remaining: number }>(
      `SELECT credits_remaining FROM credit_purchases
        WHERE user_id = $1 ORDER BY created_at, id`,
      [userId],
    );
    return rows.map((row) => row.credits_remaining);
  }

  async function remainingOf(purchaseId: string): Promise<number> {
    const { rows } = await query<{ credits_remaining: number }>(
      "SELECT credits_remaining FROM credit_purchases WHERE id = $1",
      [purchaseId],
    );
    return rows[0].credits_remaining;
  }

  async function usageRows(userId: string): Promise<UsageRow[]> {
    const { rows } = await query<UsageRow>(
      `SELECT id, credits_used, credits_from_purchased, credits_refunded,
              purchase_debits, operation, metadata
         FROM credit_usage WHERE user_id = $1 ORDER BY created_at, id`,
      [userId],
    );
    return rows;
  }

  async function usedSince(userId: string, windowStart: string) {
    const { rows } = await query<{ used: number }>(
      `SELECT COALESCE(SUM(credits_used), 0)::INTEGER AS used
         FROM credit_usage WHERE user_id = $1 AND created_at >= $2`,
      [userId, windowStart],
    );
    return rows[0].used;
  }

  async function purchaseRowCount(userId: string): Promise<number> {
    const { rows } = await query<{ count: number }>(
      "SELECT COUNT(*)::INTEGER AS count FROM credit_purchases WHERE user_id = $1",
      [userId],
    );
    return rows[0].count;
  }

  test("the migration re-applies twice inside one transaction", async () => {
    // A deploy that retries after losing its connection runs the file again.
    // BEGIN/ROLLBACK keeps the probe from touching the live schema.
    const migration = readFileSync(MIGRATION_PATH, "utf8");

    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(migration);
        await client.query(migration);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  test("a charge the allowance covers debits no purchase row and records from_purchased 0", async () => {
    const userId = await createUser("allowance");
    await addPurchase(userId, 10, { createdAt: day(1) });

    const result = await spend(userId, 1, 500, anHourAgo(), "ai_suggestion", {
      siteId: "site-a",
    });

    expect(result).toEqual({
      outcome: "charged",
      usage_id: expect.any(String),
      from_allowance: 1,
      from_purchased: 0,
      remaining: 499 + 10,
    });
    expect(await wallet(userId)).toEqual([10]);
    expect(await usageRows(userId)).toEqual([
      {
        id: result.usage_id,
        credits_used: 1,
        credits_from_purchased: 0,
        credits_refunded: 0,
        purchase_debits: [],
        operation: "ai_suggestion",
        metadata: { siteId: "site-a" },
      },
    ]);
  });

  test("a charge past the allowance debits purchase rows oldest first and records each debit in spend order", async () => {
    const userId = await createUser("oldest-first");
    // Inserted out of order: the function must order by created_at, not by
    // insertion or id.
    const newest = await addPurchase(userId, 4, { createdAt: day(3) });
    const oldest = await addPurchase(userId, 2, { createdAt: day(1) });
    const middle = await addPurchase(userId, 3, { createdAt: day(2) });

    // The window is inclusive at its start (`gte` in system.ts), and nothing
    // before it counts. 1 of the 4 included credits is therefore used.
    const windowStart = anHourAgo();
    await query(
      `INSERT INTO credit_usage (user_id, credits_used, operation, created_at)
       VALUES ($1, 1, 'ai_suggestion', $2::timestamptz),
              ($1, 10, 'ai_suggestion', $2::timestamptz - INTERVAL '1 second')`,
      [userId, windowStart],
    );

    const result = await spend(userId, 9, 4, windowStart);

    expect(result).toMatchObject({
      outcome: "charged",
      from_allowance: 3,
      from_purchased: 6,
      remaining: 0 + 3,
    });
    expect(await remainingOf(oldest)).toBe(0);
    expect(await remainingOf(middle)).toBe(0);
    expect(await remainingOf(newest)).toBe(3);

    const charge = (await usageRows(userId)).find(
      (row) => row.id === result.usage_id,
    );
    expect(charge).toMatchObject({
      credits_used: 9,
      credits_from_purchased: 6,
      credits_refunded: 0,
      purchase_debits: [
        { purchase_id: oldest, credits: 2 },
        { purchase_id: middle, credits: 3 },
        { purchase_id: newest, credits: 1 },
      ],
    });
  });

  test("expired rows are neither spent nor counted; a legacy refund_ row is spent like any other", async () => {
    // Parity with spendable.ts: NULL or future expiry, credits_remaining > 0.
    // A legacy refund_ row stays spendable (s48 decision: no data migration);
    // it only stops counting as an entitlement and as "purchased".
    const userId = await createUser("expiry");
    const expired = await addPurchase(userId, 10, {
      createdAt: day(1),
      isExpired: true,
    });
    const legacyRefund = await addPurchase(userId, 2, {
      createdAt: day(2),
      priceCents: 0,
      paymentIntentId: `refund_ai_suggestion_failed_${userId}_${randomUUID()}`,
    });
    const paid = await addPurchase(userId, 10, { createdAt: day(3) });

    const charged = await spend(userId, 5, 0, anHourAgo());
    expect(charged).toMatchObject({
      outcome: "charged",
      from_allowance: 0,
      from_purchased: 5,
      remaining: 7,
    });
    expect(await remainingOf(expired)).toBe(10);
    expect(await remainingOf(legacyRefund)).toBe(0);
    expect(await remainingOf(paid)).toBe(7);

    const refused = await spend(userId, 8, 0, anHourAgo());
    expect(refused).toMatchObject({ outcome: "insufficient", remaining: 7 });
  });

  test("an unaffordable charge returns insufficient with the available amount and writes nothing", async () => {
    const userId = await createUser("insufficient");
    await addPurchase(userId, 1, { createdAt: day(1) });
    await addPurchase(userId, 1, { createdAt: day(2) });

    const result = await spend(userId, 5, 2, anHourAgo());

    expect(result).toEqual({
      outcome: "insufficient",
      usage_id: null,
      from_allowance: 0,
      from_purchased: 0,
      remaining: 4,
    });
    expect(await wallet(userId)).toEqual([1, 1]);
    expect(await usageRows(userId)).toEqual([]);
  });

  test("a charge that exactly empties the wallet succeeds", async () => {
    const userId = await createUser("exact");
    await addPurchase(userId, 1, { createdAt: day(1) });
    await addPurchase(userId, 1, { createdAt: day(2) });

    const result = await spend(userId, 4, 2, anHourAgo());

    expect(result).toMatchObject({
      outcome: "charged",
      from_allowance: 2,
      from_purchased: 2,
      remaining: 0,
    });
    expect(await wallet(userId)).toEqual([0, 0]);
  });

  test("invalid input raises 22023", async () => {
    const userId = await createUser("invalid");
    const cases: Array<[number, number, string | null]> = [
      [0, 0, anHourAgo()],
      [-1, 0, anHourAgo()],
      [1, -1, anHourAgo()],
      [1, 0, null],
    ];

    for (const [credits, included, windowStart] of cases) {
      await expect(
        query(SPEND_SQL, [
          userId,
          credits,
          included,
          windowStart,
          "ai_suggestion",
          "{}",
        ]),
      ).rejects.toMatchObject({ code: "22023" });
    }
    expect(await usageRows(userId)).toEqual([]);
  });

  test("an AI charge does not wait on the same user's checkout lock", async () => {
    // Checkout claims lock the bare hashtextextended(user_id::text, 0)
    // (20260924020000, 20260924050000, 20260925100000). Sharing that key would
    // queue every AI charge behind the user's checkout; the spend lock is
    // namespaced 'credits:' for exactly that reason.
    const userId = await createUser("checkout-lock");
    await addPurchase(userId, 10, { createdAt: day(1) });

    const holder = new Client({
      connectionString: resolveDbTarget().connectionString,
    });
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
      [userId],
    );

    try {
      const result = await withClient(async (client) => {
        await client.query("BEGIN");
        try {
          await client.query("SET LOCAL statement_timeout = '2s'");
          const { rows } = await client.query<SpendResult>(SPEND_SQL, [
            userId,
            5,
            0,
            anHourAgo(),
            "ai_suggestion",
            "{}",
          ]);
          await client.query("COMMIT");
          return rows[0];
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      });

      expect(result.outcome).toBe("charged");
    } finally {
      await holder.query("COMMIT");
      await holder.end();
    }
  });

  test("as authenticated, a caller charges its own wallet through RLS and the trigger", async () => {
    // The cookie path (translate, ab-tests) runs as the user's JWT: RLS and
    // the "may only decrease" trigger both apply. SECURITY INVOKER keeps it so.
    const userId = await createUser("jwt-own");
    await addPurchase(userId, 3, { createdAt: day(1) });
    await addPurchase(userId, 10, { createdAt: day(2) });

    const result = await asRole("authenticated", userId, async (runner) => {
      const { rows } = await runner.query<SpendResult>(SPEND_SQL, [
        userId,
        5,
        0,
        anHourAgo(),
        "translation",
        "{}",
      ]);
      return rows[0];
    });

    expect(result).toMatchObject({
      outcome: "charged",
      from_purchased: 5,
      remaining: 8,
    });
    expect(await wallet(userId)).toEqual([0, 8]);
    expect(await usageRows(userId)).toHaveLength(1);
  });

  test("as authenticated, naming another user's id is refused with the function's own message", async () => {
    // Without the function's own check the RLS insert check would still
    // refuse, but only after the wallet read came back empty — so the caller
    // would be told "insufficient", which hides a bug in the caller.
    const caller = await createUser("jwt-caller");
    const victim = await createUser("jwt-victim");
    await addPurchase(victim, 10, { createdAt: day(1) });

    await expect(
      asRole("authenticated", caller, (runner) =>
        runner.query(SPEND_SQL, [
          victim,
          5,
          0,
          anHourAgo(),
          "translation",
          "{}",
        ]),
      ),
    ).rejects.toMatchObject({
      code: "42501",
      message: expect.stringMatching(/may only spend its own credits/),
    });
    expect(await wallet(victim)).toEqual([10]);
    expect(await usageRows(victim)).toEqual([]);
  });

  test("the monotonicity trigger still refuses an authenticated self-refill", async () => {
    const userId = await createUser("self-refill");
    const purchaseId = await addPurchase(userId, 10, {
      createdAt: day(1),
      remaining: 4,
    });

    await expect(
      asRole("authenticated", userId, (runner) =>
        runner.query(
          `UPDATE credit_purchases
              SET credits_remaining = credits_remaining + 1
            WHERE id = $1`,
          [purchaseId],
        ),
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/may only decrease/),
    });
    expect(await remainingOf(purchaseId)).toBe(4);
  });

  test("EXECUTE: anon holds neither function, authenticated holds spend_credits only, service_role holds both", async () => {
    const { rows } = await query<{
      fn: string;
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
      is_definer: boolean;
    }>(
      `SELECT f.fn,
              has_function_privilege('anon', f.fn, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', f.fn, 'EXECUTE') AS authenticated,
              has_function_privilege('service_role', f.fn, 'EXECUTE') AS service_role,
              (SELECT prosecdef FROM pg_proc WHERE oid = f.fn::regprocedure) AS is_definer
         FROM (VALUES ($1::text), ($2::text)) AS f(fn)
        ORDER BY f.fn`,
      [SPEND_SIGNATURE, REFUND_SIGNATURE],
    );

    expect(rows).toEqual([
      {
        fn: REFUND_SIGNATURE,
        anon: false,
        authenticated: false,
        service_role: true,
        is_definer: false,
      },
      {
        fn: SPEND_SIGNATURE,
        anon: false,
        authenticated: true,
        service_role: true,
        is_definer: false,
      },
    ]);
  });

  test("neither function is SECURITY DEFINER", async () => {
    const { rows } = await query<{ definers: number }>(
      `SELECT COUNT(*)::INTEGER AS definers FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('spend_credits', 'refund_credit_usage')
          AND prosecdef`,
    );
    expect(rows[0].definers).toBe(0);
  });

  test("a full refund of an allowance-funded charge restores the allowance and writes no credit_purchases row", async () => {
    // Probe P2: the old refund minted a purchased credit AND left the usage
    // counted, so the customer ended one credit up and the allowance one down.
    const userId = await createUser("p2");
    const windowStart = anHourAgo();
    const charge = await spend(userId, 1, 500, windowStart);

    const refunded = await refund(charge.usage_id!, userId, 1);

    expect(refunded).toEqual({ refunded: 1, to_purchased: 0, to_allowance: 1 });
    expect(await purchaseRowCount(userId)).toBe(0);
    expect(await usedSince(userId, windowStart)).toBe(0);
    expect(await usageRows(userId)).toMatchObject([
      { credits_used: 0, credits_refunded: 1, credits_from_purchased: 0 },
    ]);
  });

  test("a full refund of a charge that straddled the allowance returns the purchased share to the exact rows it came from, then the allowance", async () => {
    const userId = await createUser("straddle-refund");
    const first = await addPurchase(userId, 2, { createdAt: day(1) });
    const second = await addPurchase(userId, 10, { createdAt: day(2) });
    const windowStart = anHourAgo();

    const charge = await spend(userId, 5, 2, windowStart);
    expect(charge).toMatchObject({ from_allowance: 2, from_purchased: 3 });
    expect([await remainingOf(first), await remainingOf(second)]).toEqual([
      0, 9,
    ]);

    const refunded = await refund(charge.usage_id!, userId, 5);

    expect(refunded).toEqual({ refunded: 5, to_purchased: 3, to_allowance: 2 });
    expect([await remainingOf(first), await remainingOf(second)]).toEqual([
      2, 10,
    ]);
    expect(await purchaseRowCount(userId)).toBe(2);
    expect(await usedSince(userId, windowStart)).toBe(0);
  });

  /**
   * A subject charged `charge` then refunded `refunds` must end exactly where a
   * control user charged only the kept amount ends: same rows, same usage in
   * the window. That is what "refunded to its source" means, and it only holds
   * because a refund returns purchased credits first, in reverse spend order —
   * the exact reverse of a spend that draws the allowance first.
   */
  async function compareWithControl(charge: number, refunds: number[]) {
    const windowStart = anHourAgo();
    const seed = async (label: string) => {
      const userId = await createUser(label);
      await addPurchase(userId, 2, { createdAt: day(1) });
      await addPurchase(userId, 10, { createdAt: day(2) });
      return userId;
    };

    const subject = await seed("partial-subject");
    const control = await seed("partial-control");

    const charged = await spend(subject, charge, 2, windowStart);
    for (const amount of refunds) {
      await refund(charged.usage_id!, subject, amount);
    }
    const kept = charge - refunds.reduce((sum, amount) => sum + amount, 0);
    await spend(control, kept, 2, windowStart);

    return {
      subject: {
        wallet: await wallet(subject),
        used: await usedSince(subject, windowStart),
      },
      control: {
        wallet: await wallet(control),
        used: await usedSince(control, windowStart),
      },
    };
  }

  test("a partial refund leaves wallet and usage exactly as a single charge of the kept amount (refund >= purchased share)", async () => {
    // 5 = 2 allowance + 3 purchased; refunding 4 keeps 1.
    const { subject, control } = await compareWithControl(5, [4]);
    expect(subject).toEqual(control);
    expect(subject).toEqual({ wallet: [2, 10], used: 1 });
  });

  test("a partial refund leaves wallet and usage exactly as a single charge of the kept amount (refund < purchased share)", async () => {
    // 5 = 2 allowance + 3 purchased (2 from the first row, 1 from the second);
    // refunding 2 keeps 3, which is 2 allowance + 1 from the first row.
    const { subject, control } = await compareWithControl(5, [2]);
    expect(subject).toEqual(control);
    expect(subject).toEqual({ wallet: [1, 10], used: 3 });
  });

  test("two partial refunds equal one refund of their sum", async () => {
    const windowStart = anHourAgo();
    const seed = async (label: string) => {
      const userId = await createUser(label);
      await addPurchase(userId, 2, { createdAt: day(1) });
      await addPurchase(userId, 10, { createdAt: day(2) });
      return userId;
    };
    const twice = await seed("two-refunds");
    const once = await seed("one-refund");

    const twiceCharge = await spend(twice, 5, 2, windowStart);
    await refund(twiceCharge.usage_id!, twice, 1);
    await refund(twiceCharge.usage_id!, twice, 2);

    const onceCharge = await spend(once, 5, 2, windowStart);
    await refund(onceCharge.usage_id!, once, 3);

    const shape = async (userId: string) => ({
      wallet: await wallet(userId),
      usage: (await usageRows(userId)).map((row) => ({
        credits_used: row.credits_used,
        credits_refunded: row.credits_refunded,
      })),
    });
    expect(await shape(twice)).toEqual(await shape(once));
    expect(await shape(once)).toEqual({
      wallet: [2, 10],
      usage: [{ credits_used: 2, credits_refunded: 3 }],
    });
  });

  test("a refund is capped at the charge's net credits: a second full refund returns 0", async () => {
    // The suggest route refunds on a provider failure and again in its catch;
    // translate refunds a partial share and then possibly the rest. However
    // often a receipt is refunded, it can return at most what it charged.
    const userId = await createUser("cap");
    await addPurchase(userId, 10, { createdAt: day(1) });
    const charge = await spend(userId, 5, 0, anHourAgo());

    const first = await refund(charge.usage_id!, userId, 5);
    const second = await refund(charge.usage_id!, userId, 5);

    expect(first).toEqual({ refunded: 5, to_purchased: 5, to_allowance: 0 });
    expect(second).toEqual({ refunded: 0, to_purchased: 0, to_allowance: 0 });
    expect(await wallet(userId)).toEqual([10]);
    expect(await usageRows(userId)).toMatchObject([
      { credits_used: 0, credits_refunded: 5 },
    ]);
  });

  test("a refund never raises a row above credits_purchased", async () => {
    const userId = await createUser("row-cap");
    const purchaseId = await addPurchase(userId, 10, { createdAt: day(1) });
    const charge = await spend(userId, 3, 0, anHourAgo());
    expect(await remainingOf(purchaseId)).toBe(7);

    // Something else already put the row back to full (a dispute restore, say).
    await query(
      "UPDATE credit_purchases SET credits_remaining = 10 WHERE id = $1",
      [purchaseId],
    );
    await refund(charge.usage_id!, userId, 3);

    expect(await remainingOf(purchaseId)).toBe(10);
  });

  test("a refund naming the wrong user raises and changes nothing", async () => {
    const owner = await createUser("refund-owner");
    const stranger = await createUser("refund-stranger");
    await addPurchase(owner, 10, { createdAt: day(1) });
    const charge = await spend(owner, 5, 0, anHourAgo());

    await expect(refund(charge.usage_id!, stranger, 5)).rejects.toMatchObject({
      code: "P0002",
    });
    await expect(refund(randomUUID(), owner, 5)).rejects.toMatchObject({
      code: "P0002",
    });

    expect(await wallet(owner)).toEqual([5]);
    expect(await usageRows(owner)).toMatchObject([
      { credits_used: 5, credits_refunded: 0 },
    ]);
  });

  test("P3 (data): a trial's allowance-funded charge, refunded, then the trial lapses: no live plan row and zero spendable purchased credits remain", async () => {
    // The resolver half of P3 is lapsed-trial-refund.test.ts: these are the
    // rows it resolves.
    const userId = await createUser("p3");
    const { rows: trial } = await query<{ granted_at: string }>(
      `INSERT INTO plan_entitlements (user_id, plan_id, source, granted_at, expires_at)
       VALUES ($1, 'pro', 'trial', NOW() - INTERVAL '1 day', NOW() + INTERVAL '13 days')
       RETURNING granted_at::text`,
      [userId],
    );

    // system.ts:200 passes an active trial's granted_at as the window, and
    // Pro includes 500 credits.
    const charge = await spend(userId, 1, 500, trial[0].granted_at);
    expect(charge).toMatchObject({ from_allowance: 1, from_purchased: 0 });
    await refund(charge.usage_id!, userId, 1);

    await query(
      `UPDATE plan_entitlements SET expires_at = NOW() - INTERVAL '1 second'
        WHERE user_id = $1 AND source = 'trial'`,
      [userId],
    );

    const { rows } = await query<{ live_plans: number; spendable: number }>(
      `SELECT
         (SELECT COUNT(*)::INTEGER FROM plan_entitlements
           WHERE user_id = $1 AND revoked_at IS NULL
             AND (expires_at IS NULL OR expires_at > NOW()))
         + (SELECT COUNT(*)::INTEGER FROM billing_subscriptions
             WHERE user_id = $1) AS live_plans,
         (SELECT COALESCE(SUM(credits_remaining), 0)::INTEGER FROM credit_purchases
           WHERE user_id = $1 AND credits_remaining > 0
             AND (expires_at IS NULL OR expires_at > NOW())) AS spendable`,
      [userId],
    );
    expect(rows[0]).toEqual({ live_plans: 0, spendable: 0 });
  });

  // ── Concurrency: the P4 shape, proved rather than sampled ────────────────

  const RACERS = 12;
  const COST = 5;

  /** P4's wallet: eight 3-credit rows and one of 100, so a 5 spans rows. */
  async function seedP4Wallet(userId: string): Promise<number> {
    for (let index = 0; index < 8; index++) {
      await addPurchase(userId, 3, { createdAt: day(index + 1) });
    }
    await addPurchase(userId, 100, { createdAt: day(20) });
    return 8 * 3 + 100;
  }

  /**
   * Conservation, row by row: what each purchase row lost equals the sum of
   * the debits usage rows recorded against it, and what the wallet lost in
   * total equals the recorded purchased usage. P4's loss was exactly a row
   * dropping without a matching debit.
   */
  async function conservation(userId: string, granted: number) {
    const { rows } = await query<{
      id: string;
      dropped: number;
      debited: number;
    }>(
      `SELECT cp.id,
              (cp.credits_purchased - cp.credits_remaining)::INTEGER AS dropped,
              COALESCE((
                SELECT SUM((debit ->> 'credits')::INTEGER)
                  FROM credit_usage AS cu,
                       jsonb_array_elements(cu.purchase_debits) AS debit
                 WHERE cu.user_id = cp.user_id
                   AND (debit ->> 'purchase_id')::UUID = cp.id
              ), 0)::INTEGER AS debited
         FROM credit_purchases AS cp
        WHERE cp.user_id = $1`,
      [userId],
    );
    const { rows: totals } = await query<{
      used: number;
      from_purchased: number;
      charges: number;
    }>(
      `SELECT COALESCE(SUM(credits_used), 0)::INTEGER AS used,
              COALESCE(SUM(credits_from_purchased), 0)::INTEGER AS from_purchased,
              COUNT(*)::INTEGER AS charges
         FROM credit_usage WHERE user_id = $1`,
      [userId],
    );
    const remaining = (await wallet(userId)).reduce(
      (sum, credits) => sum + credits,
      0,
    );

    return {
      mismatchedRows: rows.filter((row) => row.dropped !== row.debited),
      takenFromWallet: granted - remaining,
      recordedPurchased: totals[0].from_purchased,
      recordedUsed: totals[0].used,
      charges: totals[0].charges,
    };
  }

  /**
   * The founding-agency barrier (founding-agency-cap.test.ts): hold the
   * function's own advisory key, start every racer, wait until all of them are
   * blocked on it, then release. Removing the lock from spend_credits makes
   * racers resolve while the barrier is still held, so the waiter assertion
   * fails before a scheduler-dependent count can hide the mutation.
   */
  async function barrierRace(
    userId: string,
    included: number,
    windowStart: string,
    role: "service_role" | "authenticated",
  ) {
    const connectionString = resolveDbTarget().connectionString;
    const barrier = new Client({ connectionString });
    await barrier.connect();
    await barrier.query("BEGIN");
    await barrier.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('credits:' || $1::text, 0))",
      [userId],
    );

    const clients = Array.from(
      { length: RACERS },
      () => new Client({ connectionString }),
    );
    await Promise.all(clients.map((client) => client.connect()));
    const backendPids = await Promise.all(
      clients.map(async (client) => {
        await client.query(`SET ROLE ${role}`);
        if (role === "authenticated") {
          await client.query(
            "SELECT set_config('request.jwt.claims', $1, false)",
            [JSON.stringify({ sub: userId, role })],
          );
        }
        const { rows } = await client.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        );
        return rows[0].pid;
      }),
    );

    let resolved = 0;
    const charges = clients.map(async (client, index) => {
      const { rows } = await client.query<SpendResult>(SPEND_SQL, [
        userId,
        COST,
        included,
        windowStart,
        "ai_suggestion",
        JSON.stringify({ racer: index }),
      ]);
      resolved += 1;
      return rows[0];
    });

    let waiters = 0;
    let resolvedWhileHeld = 0;
    try {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && waiters < RACERS && resolved === 0) {
        // The barrier stays in one transaction, and PostgreSQL caches
        // cumulative-statistics reads until transaction end: refresh it.
        await barrier.query("SELECT pg_stat_clear_snapshot()");
        const { rows } = await barrier.query<{ waiters: number }>(
          `SELECT COUNT(*)::INTEGER AS waiters
             FROM pg_stat_activity
            WHERE pid = ANY($1::INTEGER[])
              AND wait_event_type = 'Lock'`,
          [backendPids],
        );
        waiters = rows[0].waiters;
        if (waiters < RACERS && resolved === 0) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      resolvedWhileHeld = resolved;
    } finally {
      await barrier.query("COMMIT");
      await barrier.end();
    }

    try {
      const outcomes = await Promise.all(charges);
      return { waiters, resolvedWhileHeld, outcomes };
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  }

  test("12 barrier-synchronised charges over a multi-row wallet, 5 rounds: 12 charged, 0 refused, wallet taken equals recorded purchased usage", async () => {
    for (let round = 0; round < 5; round++) {
      const userId = await createUser(`race-${round}`);
      const granted = await seedP4Wallet(userId);

      const race = await barrierRace(userId, 0, anHourAgo(), "service_role");

      expect({
        waiters: race.waiters,
        resolvedWhileHeld: race.resolvedWhileHeld,
      }).toEqual({ waiters: RACERS, resolvedWhileHeld: 0 });
      expect(race.outcomes.map((outcome) => outcome.outcome)).toEqual(
        Array(RACERS).fill("charged"),
      );
      expect(await conservation(userId, granted)).toEqual({
        mismatchedRows: [],
        takenFromWallet: RACERS * COST,
        recordedPurchased: RACERS * COST,
        recordedUsed: RACERS * COST,
        charges: RACERS,
      });
    }
  }, 60_000);

  test("the same race as authenticated, one round", async () => {
    const userId = await createUser("race-jwt");
    const granted = await seedP4Wallet(userId);

    const race = await barrierRace(userId, 0, anHourAgo(), "authenticated");

    expect({
      waiters: race.waiters,
      resolvedWhileHeld: race.resolvedWhileHeld,
    }).toEqual({ waiters: RACERS, resolvedWhileHeld: 0 });
    expect(race.outcomes.map((outcome) => outcome.outcome)).toEqual(
      Array(RACERS).fill("charged"),
    );
    expect(await conservation(userId, granted)).toEqual({
      mismatchedRows: [],
      takenFromWallet: RACERS * COST,
      recordedPurchased: RACERS * COST,
      recordedUsed: RACERS * COST,
      charges: RACERS,
    });
  }, 30_000);

  test("12 charges straddling the end of the allowance draw it exactly once", async () => {
    // P4 used accounts with no allowance. Read from system.ts, two concurrent
    // charges both saw the same remaining allowance and both drew it — the
    // customer was under-charged. Under the lock the 12 included credits are
    // drawn once, and the other 48 come out of the wallet.
    const userId = await createUser("race-straddle");
    const granted = await seedP4Wallet(userId);

    const race = await barrierRace(userId, 12, anHourAgo(), "service_role");

    expect({
      waiters: race.waiters,
      resolvedWhileHeld: race.resolvedWhileHeld,
    }).toEqual({ waiters: RACERS, resolvedWhileHeld: 0 });
    expect(race.outcomes.map((outcome) => outcome.outcome)).toEqual(
      Array(RACERS).fill("charged"),
    );
    expect(
      race.outcomes.reduce((sum, outcome) => sum + outcome.from_allowance, 0),
    ).toBe(12);
    expect(await conservation(userId, granted)).toEqual({
      mismatchedRows: [],
      takenFromWallet: 48,
      recordedPurchased: 48,
      recordedUsed: RACERS * COST,
      charges: RACERS,
    });
  }, 30_000);

  test("12 charges against a wallet of exactly 60: all charged, a 13th is insufficient and writes nothing", async () => {
    const userId = await createUser("race-exact");
    for (let index = 0; index < 8; index++) {
      await addPurchase(userId, 3, { createdAt: day(index + 1) });
    }
    await addPurchase(userId, 36, { createdAt: day(20) });
    const granted = 60;

    const race = await barrierRace(userId, 0, anHourAgo(), "service_role");

    expect({
      waiters: race.waiters,
      resolvedWhileHeld: race.resolvedWhileHeld,
    }).toEqual({ waiters: RACERS, resolvedWhileHeld: 0 });
    expect(race.outcomes.map((outcome) => outcome.outcome)).toEqual(
      Array(RACERS).fill("charged"),
    );

    const thirteenth = await spend(userId, COST, 0, anHourAgo());
    expect(thirteenth).toEqual({
      outcome: "insufficient",
      usage_id: null,
      from_allowance: 0,
      from_purchased: 0,
      remaining: 0,
    });
    expect(await conservation(userId, granted)).toEqual({
      mismatchedRows: [],
      takenFromWallet: 60,
      recordedPurchased: 60,
      recordedUsed: 60,
      charges: RACERS,
    });
  }, 30_000);

  test("12 unsynchronised charges, 10 rounds: conservation holds and nothing is refused", async () => {
    // No barrier: the shape closest to probe P4, where the scheduler decides
    // the interleaving.
    for (let round = 0; round < 10; round++) {
      const userId = await createUser(`stress-${round}`);
      const granted = await seedP4Wallet(userId);
      const windowStart = anHourAgo();

      const outcomes = await Promise.all(
        Array.from({ length: RACERS }, () =>
          spend(userId, COST, 0, windowStart),
        ),
      );

      expect(outcomes.map((outcome) => outcome.outcome)).toEqual(
        Array(RACERS).fill("charged"),
      );
      expect(await conservation(userId, granted)).toEqual({
        mismatchedRows: [],
        takenFromWallet: RACERS * COST,
        recordedPurchased: RACERS * COST,
        recordedUsed: RACERS * COST,
        charges: RACERS,
      });
    }
  }, 60_000);
});
