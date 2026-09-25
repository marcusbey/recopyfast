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

// `pg` intentionally has no type package in this repository. The DB harness
// uses the same structural boundary so real-Postgres tests do not expand the
// production dependency surface just for test declarations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require("pg") as { Client: PgClientConstructor };

describeDb("Founding Agency capacity", ({ query }) => {
  const userIds: string[] = [];
  const marker = `dbtest-founding-${Date.now()}`;

  beforeAll(async () => {
    const { rows } = await query<{
      reservations: string | null;
      reserve_rpc: string | null;
      bind_rpc: string | null;
      bind_with_expiry_rpc: string | null;
      release_rpc: string | null;
      complete_rpc: string | null;
      availability_rpc: string | null;
      subscription_claim_rpc: string | null;
      unresolved_release_rpc: string | null;
      duplicate_refund_rpc: string | null;
      duplicate_refund_bind_rpc: string | null;
    }>(`
      SELECT to_regclass('public.founding_agency_reservations')::text AS reservations,
             to_regprocedure('public.reserve_founding_agency_spot(uuid)')::text AS reserve_rpc,
             to_regprocedure('public.bind_founding_agency_checkout(uuid,uuid,text)')::text AS bind_rpc,
             to_regprocedure('public.bind_founding_agency_checkout(uuid,uuid,text,bigint)')::text AS bind_with_expiry_rpc,
             to_regprocedure('public.release_founding_agency_checkout(uuid,uuid,text)')::text AS release_rpc,
             to_regprocedure('public.complete_founding_agency_purchase(uuid,uuid,text)')::text AS complete_rpc,
             to_regprocedure('public.get_founding_agency_availability()')::text AS availability_rpc,
             to_regprocedure(
               'public.claim_subscription_checkout_intent(uuid,timestamp with time zone,text,text,text)'
             )::text AS subscription_claim_rpc,
             to_regprocedure(
               'public.release_unresolved_founding_agency_checkout(uuid,text)'
             )::text AS unresolved_release_rpc,
             to_regprocedure(
               'public.mark_founding_agency_duplicate_refunded(uuid,uuid,text,text)'
             )::text AS duplicate_refund_rpc,
             to_regprocedure(
               'public.bind_founding_agency_duplicate_refund_session(uuid,uuid,text,text)'
             )::text AS duplicate_refund_bind_rpc
    `);

    // RCF_TEST_DB_URL only proves CI reached a ReCopyFast database. This suite
    // must additionally fail closed when the story migration was not applied;
    // otherwise the generic harness probe could let a missing cap schema look
    // like a skipped or unrelated database lane.
    expect(Object.values(rows[0])).not.toContain(null);
  });

  async function createUser(label: string): Promise<string> {
    const id = randomUUID();
    userIds.push(id);
    await query("INSERT INTO auth.users(id, email) VALUES ($1, $2)", [
      id,
      `${marker}-${label}@example.invalid`,
    ]);
    return id;
  }

  async function seedCompletedSales(count: number): Promise<void> {
    await query(
      `INSERT INTO founding_agency_reservations(
         user_id, status, stripe_payment_intent_id, completed_at
       )
       SELECT NULL, 'completed', $1 || '-' || n, NOW()
       FROM generate_series(1, $2) AS n`,
      [marker, count],
    );
  }

  async function cleanup(): Promise<void> {
    await query(
      `DELETE FROM checkout_pending_intents
       WHERE user_id IN (
         SELECT id FROM auth.users WHERE email LIKE 'dbtest-founding-%'
       )`,
    );
    await query(
      `DELETE FROM billing_subscriptions
       WHERE user_id IN (
         SELECT id FROM auth.users WHERE email LIKE 'dbtest-founding-%'
       )`,
    );
    await query(
      `DELETE FROM founding_agency_reservations
       WHERE stripe_payment_intent_id LIKE $1
          OR stripe_checkout_session_id LIKE $1
          OR user_id IN (
            SELECT id FROM auth.users WHERE email LIKE 'dbtest-founding-%'
          )`,
      [`dbtest-founding-%`],
    );
    await query(
      "DELETE FROM plan_entitlements WHERE stripe_payment_intent_id LIKE $1",
      [`dbtest-founding-%`],
    );
    await query("DELETE FROM auth.users WHERE email LIKE 'dbtest-founding-%'");
    userIds.splice(0);
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  test("49 completed sales allow exactly one more reservation", async () => {
    await seedCompletedSales(49);
    const userId = await createUser("sale-50");

    const { rows } = await query<{ outcome: string }>(
      "SELECT outcome FROM reserve_founding_agency_spot($1)",
      [userId],
    );

    expect(rows[0].outcome).toBe("reserved");
  });

  test("removes the unused two-argument subscription claim overload", async () => {
    const { rows } = await query<{ legacy_claim: string | null }>(
      `SELECT to_regprocedure(
         'public.claim_subscription_checkout_intent(uuid,timestamp with time zone)'
       )::text AS legacy_claim`,
    );

    expect(rows[0].legacy_claim).toBeNull();
  });

  test("50 completed sales refuse checkout as sold out", async () => {
    await seedCompletedSales(50);
    const userId = await createUser("sale-51");

    const { rows } = await query<{ outcome: string }>(
      "SELECT outcome FROM reserve_founding_agency_spot($1)",
      [userId],
    );

    expect(rows[0].outcome).toBe("sold_out");
  });

  test("20 barrier-synchronised buyers at 45 sold cannot oversell", async () => {
    await seedCompletedSales(45);
    const buyers = await Promise.all(
      Array.from({ length: 20 }, (_, index) => createUser(`race-${index}`)),
    );
    const barrier = new Client({
      connectionString: resolveDbTarget().connectionString,
    });
    await barrier.connect();
    await barrier.query("BEGIN");
    await barrier.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('founding_agency_capacity', 0))",
    );

    const clients = buyers.map(
      () =>
        new Client({
          connectionString: resolveDbTarget().connectionString,
        }),
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
    const claims = buyers.map(async (userId, index) => {
      const client = clients[index];
      const { rows } = await client.query<{ outcome: string }>(
        "SELECT outcome FROM reserve_founding_agency_spot($1)",
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
        waiters < buyers.length &&
        resolvedClaims === 0
      ) {
        // PostgreSQL caches cumulative-statistics reads until transaction end.
        // The barrier deliberately stays in one transaction, so refresh that
        // snapshot or later waiters can remain invisible on PostgreSQL 14.
        await barrier.query("SELECT pg_stat_clear_snapshot()");
        const { rows } = await barrier.query<{ waiters: number }>(
          `SELECT COUNT(*)::INTEGER AS waiters
           FROM pg_stat_activity
           WHERE pid = ANY($1::INTEGER[])
             AND wait_event_type = 'Lock'`,
          [backendPids],
        );
        waiters = rows[0].waiters;
        if (waiters < buyers.length && resolvedClaims === 0) {
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

    // Holding the exact production advisory key turns the coordinator into a
    // deterministic start barrier. Removing the lock from the RPC makes claims
    // resolve while the barrier is still held, so this assertion fails before
    // a scheduler-dependent oversell count can hide the mutation.
    expect({ waiters, resolvedClaims: resolvedWhileHeld }).toEqual({
      waiters: buyers.length,
      resolvedClaims: 0,
    });
    expect(outcomes.filter((outcome) => outcome === "reserved")).toHaveLength(
      5,
    );
    expect(
      outcomes.filter((outcome) => outcome === "capacity_busy"),
    ).toHaveLength(15);
    const { rows } = await query<{ live: number }>(
      `SELECT COUNT(*)::INTEGER AS live
       FROM founding_agency_reservations
       WHERE status IN ('reserved', 'completed')`,
    );
    expect(rows[0].live).toBe(50);
  }, 20_000);

  test("two ordinary concurrent attempts at the last spot admit one buyer", async () => {
    await seedCompletedSales(49);
    const [firstUser, secondUser] = await Promise.all([
      createUser("ordinary-race-a"),
      createUser("ordinary-race-b"),
    ]);

    const outcomes = await Promise.all(
      [firstUser, secondUser].map(async (userId) => {
        const { rows } = await query<{ outcome: string }>(
          "SELECT outcome FROM reserve_founding_agency_spot($1)",
          [userId],
        );
        return rows[0].outcome;
      }),
    );

    expect(outcomes.sort()).toEqual(["capacity_busy", "reserved"]);
  });

  test("a completed sale remains counted after revocation and account deletion", async () => {
    const userId = await createUser("durable");
    const reserved = await query<{
      reservation_id: string;
      outcome: string;
    }>("SELECT reservation_id, outcome FROM reserve_founding_agency_spot($1)", [
      userId,
    ]);
    const reservationId = reserved.rows[0].reservation_id;
    const paymentIntentId = `${marker}-durable`;

    await query("SELECT complete_founding_agency_purchase($1, $2, $3)", [
      reservationId,
      userId,
      paymentIntentId,
    ]);
    await query(
      "UPDATE plan_entitlements SET revoked_at = NOW() WHERE stripe_payment_intent_id = $1",
      [paymentIntentId],
    );
    await query("DELETE FROM auth.users WHERE id = $1", [userId]);
    userIds.splice(userIds.indexOf(userId), 1);

    const { rows } = await query<{
      remaining: number;
      completed: number;
      durable_user_id: string | null;
    }>(
      `SELECT a.remaining, a.completed, r.user_id AS durable_user_id
       FROM get_founding_agency_availability() a
       JOIN founding_agency_reservations r ON r.id = $1`,
      [reservationId],
    );

    expect(rows[0]).toMatchObject({
      completed: 1,
      remaining: 49,
      durable_user_id: null,
    });
  });

  test("completion is idempotent for one payment and grants Agency once", async () => {
    const userId = await createUser("duplicate-completion");
    const reserved = await query<{ reservation_id: string }>(
      "SELECT reservation_id FROM reserve_founding_agency_spot($1)",
      [userId],
    );
    const reservationId = reserved.rows[0].reservation_id;
    const paymentIntentId = `${marker}-duplicate`;

    const first = await query<{ result: string }>(
      "SELECT complete_founding_agency_purchase($1, $2, $3) AS result",
      [reservationId, userId, paymentIntentId],
    );
    const retry = await query<{ result: string }>(
      "SELECT complete_founding_agency_purchase($1, $2, $3) AS result",
      [reservationId, userId, paymentIntentId],
    );
    const grants = await query<{ count: number }>(
      `SELECT COUNT(*)::INTEGER AS count
       FROM plan_entitlements
       WHERE user_id = $1
         AND plan_id = 'agency'
         AND stripe_payment_intent_id = $2`,
      [userId, paymentIntentId],
    );

    expect(first.rows[0].result).toBe("granted");
    expect(retry.rows[0].result).toBe("duplicate");
    expect(grants.rows[0].count).toBe(1);
  });

  test("expired holds remain capacity-bound until provider-verified release", async () => {
    await seedCompletedSales(49);
    const firstUser = await createUser("expired");
    const secondUser = await createUser("while-expired");
    const thirdUser = await createUser("after-release");
    const reserved = await query<{ reservation_id: string }>(
      "SELECT reservation_id FROM reserve_founding_agency_spot($1)",
      [firstUser],
    );
    const reservationId = reserved.rows[0].reservation_id;

    await query(
      `UPDATE founding_agency_reservations
       SET checkout_expires_at = FLOOR(EXTRACT(EPOCH FROM NOW()))::BIGINT - 60
       WHERE id = $1`,
      [reservationId],
    );
    const unboundAttempt = await query<{
      reservation_id: string;
      outcome: string;
    }>("SELECT reservation_id, outcome FROM reserve_founding_agency_spot($1)", [
      secondUser,
    ]);

    expect(unboundAttempt.rows[0].outcome).toBe("capacity_busy");

    await query("SELECT release_founding_agency_checkout($1, $2, $3)", [
      reservationId,
      firstUser,
      null,
    ]);

    const boundReservation = await query<{ reservation_id: string }>(
      "SELECT reservation_id FROM reserve_founding_agency_spot($1)",
      [secondUser],
    );
    const boundReservationId = boundReservation.rows[0].reservation_id;

    await query("SELECT bind_founding_agency_checkout($1, $2, $3)", [
      boundReservationId,
      secondUser,
      "cs_expired_signed",
    ]);
    await query(
      `UPDATE founding_agency_reservations
       SET checkout_expires_at = FLOOR(EXTRACT(EPOCH FROM NOW()))::BIGINT - 60
       WHERE id = $1`,
      [boundReservationId],
    );
    const boundAttempt = await query<{ outcome: string }>(
      "SELECT outcome FROM reserve_founding_agency_spot($1)",
      [thirdUser],
    );

    expect(boundAttempt.rows[0].outcome).toBe("capacity_busy");

    await query("SELECT release_founding_agency_checkout($1, $2, $3)", [
      boundReservationId,
      secondUser,
      "cs_expired_signed",
    ]);
    const next = await query<{ outcome: string }>(
      "SELECT outcome FROM reserve_founding_agency_spot($1)",
      [thirdUser],
    );

    expect(next.rows[0].outcome).toBe("reserved");
  });

  test("a concurrent claim cannot steal an expired ambiguous paid hold", async () => {
    await seedCompletedSales(49);
    const paidUser = await createUser("ambiguous-paid");
    const waitingUser = await createUser("ambiguous-waiting");
    const reserved = await query<{ reservation_id: string }>(
      "SELECT reservation_id FROM reserve_founding_agency_spot($1)",
      [paidUser],
    );
    const expiredAt = Math.floor(Date.now() / 1000) - 5;
    await query(
      `UPDATE founding_agency_reservations
       SET checkout_expires_at = $2
       WHERE id = $1`,
      [reserved.rows[0].reservation_id, expiredAt],
    );

    const [bindResult, claimResult] = await Promise.all([
      query<{ bound: boolean }>(
        "SELECT bind_founding_agency_checkout($1, $2, $3, $4) AS bound",
        [
          reserved.rows[0].reservation_id,
          paidUser,
          "cs_ambiguous_paid",
          expiredAt,
        ],
      ),
      query<{ outcome: string }>(
        "SELECT outcome FROM reserve_founding_agency_spot($1)",
        [waitingUser],
      ),
    ]);

    expect(bindResult.rows[0].bound).toBe(true);
    expect(claimResult.rows[0].outcome).toBe("capacity_busy");
    const retained = await query<{ status: string; session_id: string | null }>(
      `SELECT status, stripe_checkout_session_id AS session_id
       FROM founding_agency_reservations
       WHERE id = $1`,
      [reserved.rows[0].reservation_id],
    );
    expect(retained.rows[0]).toEqual({
      status: "reserved",
      session_id: "cs_ambiguous_paid",
    });
  });

  test("a hold uses Stripe's 30-minute minimum and one live hold per account", async () => {
    const userId = await createUser("one-hold");
    // The push coverage gate twice measured 1812 seconds here because it
    // compared the Mac's Date.now() with a container database clock across RPC
    // scheduling. NOW() in this same SQL statement shares the transaction
    // clock used by the column default, so exact +1810 both removes clock skew
    // and strengthens the intended 30-minute-plus-transit contract.
    const first = await query<{
      reservation_id: string;
      checkout_expires_at: string;
      database_epoch_ceil: string;
    }>(
      `SELECT reservation_id,
              checkout_expires_at,
              CEIL(EXTRACT(EPOCH FROM NOW()))::BIGINT AS database_epoch_ceil
       FROM reserve_founding_agency_spot($1)`,
      [userId],
    );
    const second = await query<{
      reservation_id: string;
      checkout_expires_at: string;
    }>(
      "SELECT reservation_id, checkout_expires_at FROM reserve_founding_agency_spot($1)",
      [userId],
    );

    expect(second.rows[0]).toEqual({
      reservation_id: first.rows[0].reservation_id,
      checkout_expires_at: first.rows[0].checkout_expires_at,
    });
    expect(
      Number(first.rows[0].checkout_expires_at) -
        Number(first.rows[0].database_epoch_ceil),
    ).toBe(1810);

    const stripeExpiresAt = Number(first.rows[0].checkout_expires_at) - 5;
    const bound = await query<{ bound: boolean }>(
      `SELECT bind_founding_agency_checkout(
         p_reservation_id => $1,
         p_user_id => $2,
         p_stripe_checkout_session_id => $3,
         p_stripe_checkout_expires_at => $4
       ) AS bound`,
      [
        first.rows[0].reservation_id,
        userId,
        "cs_exact_expiry",
        stripeExpiresAt,
      ],
    );
    const stored = await query<{ checkout_expires_at: string }>(
      `SELECT checkout_expires_at
       FROM founding_agency_reservations
       WHERE id = $1`,
      [first.rows[0].reservation_id],
    );
    expect(bound.rows[0].bound).toBe(true);
    expect(Number(stored.rows[0].checkout_expires_at)).toBe(stripeExpiresAt);
  });

  test("provider reconciliation can bind a paid session after the local deadline", async () => {
    const userId = await createUser("delayed-paid-session");
    const reserved = await query<{
      reservation_id: string;
      checkout_expires_at: string;
    }>(
      "SELECT reservation_id, checkout_expires_at FROM reserve_founding_agency_spot($1)",
      [userId],
    );
    const expiredAt = Math.floor(Date.now() / 1000) - 5;
    await query(
      `UPDATE founding_agency_reservations
       SET checkout_expires_at = $2
       WHERE id = $1`,
      [reserved.rows[0].reservation_id, expiredAt],
    );

    const bound = await query<{ bound: boolean }>(
      "SELECT bind_founding_agency_checkout($1, $2, $3, $4) AS bound",
      [reserved.rows[0].reservation_id, userId, "cs_delayed_paid", expiredAt],
    );

    expect(bound.rows[0].bound).toBe(true);
  });

  test("provider reconciliation can close an orphaned account hold", async () => {
    const userId = await createUser("deleted-before-reconciliation");
    const reserved = await query<{
      reservation_id: string;
      checkout_expires_at: string;
    }>(
      "SELECT reservation_id, checkout_expires_at FROM reserve_founding_agency_spot($1)",
      [userId],
    );
    const sessionId = `${marker}-orphaned-session`;
    await query("SELECT bind_founding_agency_checkout($1, $2, $3, $4)", [
      reserved.rows[0].reservation_id,
      userId,
      sessionId,
      Number(reserved.rows[0].checkout_expires_at),
    ]);
    await query("DELETE FROM auth.users WHERE id = $1", [userId]);

    const bound = await query<{ bound: boolean }>(
      "SELECT bind_founding_agency_checkout($1, $2, $3, $4) AS bound",
      [
        reserved.rows[0].reservation_id,
        null,
        sessionId,
        Number(reserved.rows[0].checkout_expires_at),
      ],
    );
    const released = await query<{ released: boolean }>(
      "SELECT release_founding_agency_checkout($1, $2, $3) AS released",
      [reserved.rows[0].reservation_id, null, sessionId],
    );

    expect(bound.rows[0].bound).toBe(true);
    expect(released.rows[0].released).toBe(true);
  });

  test("only an overdue unresolved hold is atomically released and flagged", async () => {
    await seedCompletedSales(49);
    const heldUser = await createUser("unresolved-held");
    const waitingUser = await createUser("unresolved-waiting");
    const reserved = await query<{ reservation_id: string }>(
      "SELECT reservation_id FROM reserve_founding_agency_spot($1)",
      [heldUser],
    );
    const reservationId = reserved.rows[0].reservation_id;

    await query(
      `UPDATE founding_agency_reservations
       SET checkout_expires_at = FLOOR(EXTRACT(EPOCH FROM NOW()))::BIGINT - 300
       WHERE id = $1`,
      [reservationId],
    );
    const insideGrace = await query<{ released: boolean }>(
      "SELECT release_unresolved_founding_agency_checkout($1, $2) AS released",
      [reservationId, "stripe_session_lookup_failed"],
    );
    expect(insideGrace.rows[0].released).toBe(false);

    await query(
      `UPDATE founding_agency_reservations
       SET checkout_expires_at = FLOOR(EXTRACT(EPOCH FROM NOW()))::BIGINT - 601
       WHERE id = $1`,
      [reservationId],
    );
    const afterGrace = await query<{ released: boolean }>(
      "SELECT release_unresolved_founding_agency_checkout($1, $2) AS released",
      [reservationId, "stripe_session_lookup_failed"],
    );
    const flagged = await query<{
      status: string;
      reconciliation_reason: string | null;
      reconciliation_required_at: string | null;
    }>(
      `SELECT status, reconciliation_reason, reconciliation_required_at
       FROM founding_agency_reservations WHERE id = $1`,
      [reservationId],
    );
    const successor = await query<{ outcome: string }>(
      "SELECT outcome FROM reserve_founding_agency_spot($1)",
      [waitingUser],
    );

    expect(afterGrace.rows[0].released).toBe(true);
    expect(flagged.rows[0]).toMatchObject({
      status: "released",
      reconciliation_reason: "stripe_session_lookup_failed",
      reconciliation_required_at: expect.anything(),
    });
    expect(successor.rows[0].outcome).toBe("reserved");
  });

  test("a late paid completion grants a released hold even beyond the ordinary cap", async () => {
    await seedCompletedSales(49);
    const lateUser = await createUser("late-paid");
    const replacementUser = await createUser("replacement-sale");
    const late = await query<{ reservation_id: string }>(
      "SELECT reservation_id FROM reserve_founding_agency_spot($1)",
      [lateUser],
    );
    await query(
      `UPDATE founding_agency_reservations
       SET checkout_expires_at = FLOOR(EXTRACT(EPOCH FROM NOW()))::BIGINT - 601
       WHERE id = $1`,
      [late.rows[0].reservation_id],
    );
    await query("SELECT release_unresolved_founding_agency_checkout($1, $2)", [
      late.rows[0].reservation_id,
      "stripe_history_no_session",
    ]);
    const replacement = await query<{ reservation_id: string }>(
      "SELECT reservation_id FROM reserve_founding_agency_spot($1)",
      [replacementUser],
    );
    await query("SELECT complete_founding_agency_purchase($1, $2, $3)", [
      replacement.rows[0].reservation_id,
      replacementUser,
      `${marker}-replacement-payment`,
    ]);

    const first = await query<{ result: string }>(
      "SELECT complete_founding_agency_purchase($1, $2, $3) AS result",
      [late.rows[0].reservation_id, lateUser, `${marker}-late-payment`],
    );
    const retry = await query<{ result: string }>(
      "SELECT complete_founding_agency_purchase($1, $2, $3) AS result",
      [late.rows[0].reservation_id, lateUser, `${marker}-late-payment`],
    );
    const count = await query<{ completed: number }>(
      `SELECT COUNT(*)::INTEGER AS completed
       FROM founding_agency_reservations WHERE status = 'completed'`,
    );
    const lateGrant = await query<{
      grants: number;
      reconciliation_required_at: string | null;
      reconciliation_reason: string | null;
    }>(
      `SELECT COUNT(entitlement.id)::INTEGER AS grants,
              reservation.reconciliation_required_at,
              reservation.reconciliation_reason
       FROM founding_agency_reservations reservation
       LEFT JOIN plan_entitlements entitlement
         ON entitlement.user_id = reservation.user_id
        AND entitlement.plan_id = 'agency'
        AND entitlement.stripe_payment_intent_id = $3
       WHERE reservation.id = $1 AND reservation.user_id = $2
       GROUP BY reservation.reconciliation_required_at,
                reservation.reconciliation_reason`,
      [late.rows[0].reservation_id, lateUser, `${marker}-late-payment`],
    );

    expect(first.rows[0].result).toBe("granted");
    expect(retry.rows[0].result).toBe("duplicate");
    expect(count.rows[0].completed).toBe(51);
    expect(lateGrant.rows[0]).toMatchObject({
      grants: 1,
      reconciliation_required_at: expect.anything(),
      reconciliation_reason: "stripe_history_no_session",
    });
  });

  test("two paid founding reservations for one account atomically grant one and refund one", async () => {
    const userId = await createUser("duplicate-account");
    const first = await query<{ reservation_id: string }>(
      "SELECT reservation_id FROM reserve_founding_agency_spot($1)",
      [userId],
    );
    await query("SELECT release_founding_agency_checkout($1, $2, $3)", [
      first.rows[0].reservation_id,
      userId,
      `${marker}-session-first`,
    ]);
    const second = await query<{ reservation_id: string }>(
      "SELECT reservation_id FROM reserve_founding_agency_spot($1)",
      [userId],
    );
    await query("SELECT bind_founding_agency_checkout($1, $2, $3)", [
      second.rows[0].reservation_id,
      userId,
      `${marker}-session-second`,
    ]);

    const attempts = [
      {
        reservationId: first.rows[0].reservation_id,
        paymentIntentId: `${marker}-payment-first`,
      },
      {
        reservationId: second.rows[0].reservation_id,
        paymentIntentId: `${marker}-payment-second`,
      },
    ];
    const outcomes = await Promise.all(
      attempts.map(async (attempt) => ({
        ...attempt,
        response: await query<{ result: string }>(
          "SELECT complete_founding_agency_purchase($1, $2, $3) AS result",
          [attempt.reservationId, userId, attempt.paymentIntentId],
        ),
      })),
    );
    const refundAttempt = outcomes.find(
      ({ response }) => response.rows[0].result === "refund_required",
    );
    expect(refundAttempt).toBeDefined();
    const retry = await query<{ result: string }>(
      "SELECT complete_founding_agency_purchase($1, $2, $3) AS result",
      [refundAttempt!.reservationId, userId, refundAttempt!.paymentIntentId],
    );
    const marked = await query<{ marked: boolean }>(
      `SELECT mark_founding_agency_duplicate_refunded($1, $2, $3, $4)
         AS marked`,
      [
        refundAttempt!.reservationId,
        userId,
        refundAttempt!.paymentIntentId,
        `${marker}-refund`,
      ],
    );
    const afterRefund = await query<{ result: string }>(
      "SELECT complete_founding_agency_purchase($1, $2, $3) AS result",
      [refundAttempt!.reservationId, userId, refundAttempt!.paymentIntentId],
    );
    const durable = await query<{
      completed: number;
      released: number;
      entitlements: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed')::INTEGER AS completed,
         COUNT(*) FILTER (
           WHERE status = 'released' AND stripe_payment_intent_id IS NOT NULL
         )::INTEGER AS released,
         (
           SELECT COUNT(*)::INTEGER FROM plan_entitlements
           WHERE user_id = $1 AND plan_id = 'agency' AND revoked_at IS NULL
         ) AS entitlements
       FROM founding_agency_reservations
       WHERE user_id = $1 AND product_id = 'lifetime_agency'`,
      [userId],
    );

    expect(
      outcomes.map(({ response }) => response.rows[0].result).sort(),
    ).toEqual(["granted", "refund_required"]);
    expect(retry.rows[0].result).toBe("refund_required");
    expect(marked.rows[0].marked).toBe(true);
    expect(afterRefund.rows[0].result).toBe("refunded");
    expect(durable.rows[0]).toEqual({
      completed: 1,
      released: 1,
      entitlements: 1,
    });
  });

  test("a paid duplicate with a lost bind remains refundable by its verified session", async () => {
    const userId = await createUser("duplicate-lost-bind");
    const first = await query<{ reservation_id: string }>(
      "SELECT reservation_id FROM reserve_founding_agency_spot($1)",
      [userId],
    );
    await query("SELECT release_founding_agency_checkout($1, $2, $3)", [
      first.rows[0].reservation_id,
      userId,
      `${marker}-original-session`,
    ]);
    const second = await query<{ reservation_id: string }>(
      "SELECT reservation_id FROM reserve_founding_agency_spot($1)",
      [userId],
    );
    await query("SELECT complete_founding_agency_purchase($1, $2, $3)", [
      first.rows[0].reservation_id,
      userId,
      `${marker}-original-payment`,
    ]);

    const duplicate = await query<{ result: string }>(
      "SELECT complete_founding_agency_purchase($1, $2, $3) AS result",
      [second.rows[0].reservation_id, userId, `${marker}-duplicate-payment`],
    );
    const bound = await query<{ bound: boolean }>(
      `SELECT bind_founding_agency_duplicate_refund_session($1, $2, $3, $4)
         AS bound`,
      [
        second.rows[0].reservation_id,
        userId,
        `${marker}-duplicate-payment`,
        `${marker}-recovered-session`,
      ],
    );
    const row = await query<{
      status: string;
      stripe_checkout_session_id: string | null;
    }>(
      `SELECT status, stripe_checkout_session_id
       FROM founding_agency_reservations WHERE id = $1`,
      [second.rows[0].reservation_id],
    );

    expect(duplicate.rows[0].result).toBe("refund_required");
    expect(bound.rows[0].bound).toBe(true);
    expect(row.rows[0]).toEqual({
      status: "released",
      stripe_checkout_session_id: `${marker}-recovered-session`,
    });
  });

  test.each(["incomplete", "unpaid", "paused"])(
    "claim refuses a %s subscription even when a pending intent already exists",
    async (status) => {
      const userId = await createUser(`recoverable-${status}`);
      const expiresAt = new Date(Date.now() + 31 * 60_000);
      await query(
        "SELECT * FROM claim_subscription_checkout_intent($1, $2, $3, $4, $5)",
        [userId, expiresAt, "price_pro_monthly", "pro", "monthly"],
      );
      await query(
        `INSERT INTO billing_subscriptions(
           user_id, stripe_subscription_id, plan, status
         ) VALUES ($1, $2, 'pro', $3)`,
        [userId, `${marker}-${status}`, status],
      );

      await expect(
        query(
          "SELECT * FROM claim_subscription_checkout_intent($1, $2, $3, $4, $5)",
          [userId, expiresAt, "price_pro_monthly", "pro", "monthly"],
        ),
      ).rejects.toMatchObject({ code: "P0001" });
    },
  );

  test("a refunded founding buyer is not reported as an active owner", async () => {
    const userId = await createUser("refunded");
    const reserved = await query<{ reservation_id: string }>(
      "SELECT reservation_id FROM reserve_founding_agency_spot($1)",
      [userId],
    );
    const paymentIntentId = `${marker}-refunded`;
    await query("SELECT complete_founding_agency_purchase($1, $2, $3)", [
      reserved.rows[0].reservation_id,
      userId,
      paymentIntentId,
    ]);
    await query(
      "UPDATE plan_entitlements SET revoked_at = NOW() WHERE stripe_payment_intent_id = $1",
      [paymentIntentId],
    );

    const retry = await query<{ outcome: string }>(
      "SELECT outcome FROM reserve_founding_agency_spot($1)",
      [userId],
    );

    expect(retry.rows[0].outcome).toBe("refunded");
  });

  test("subscription checkout choices come from the active paid catalogue", async () => {
    const monthlyUser = await createUser("agency-monthly");
    const yearlyUser = await createUser("agency-yearly");
    const expiresAt = new Date(Date.now() + 31 * 60_000);

    const monthly = await query<{ plan_id: string; billing_period: string }>(
      `SELECT plan_id, billing_period
       FROM claim_subscription_checkout_intent($1, $2, $3, $4, $5)`,
      [monthlyUser, expiresAt, "price_agency_monthly", "agency", "monthly"],
    );
    const yearly = await query<{ plan_id: string; billing_period: string }>(
      `SELECT plan_id, billing_period
       FROM claim_subscription_checkout_intent($1, $2, $3, $4, $5)`,
      [yearlyUser, expiresAt, "price_agency_yearly", "agency", "yearly"],
    );

    expect(monthly.rows[0]).toEqual({
      plan_id: "agency",
      billing_period: "monthly",
    });
    expect(yearly.rows[0]).toEqual({
      plan_id: "agency",
      billing_period: "yearly",
    });

    for (const [planId, period] of [
      ["free", "monthly"],
      ["lifetime_pro", "monthly"],
      ["missing_plan", "monthly"],
      ["agency", "weekly"],
    ]) {
      const userId = await createUser(`invalid-${planId}-${period}`);
      await expect(
        query(
          "SELECT * FROM claim_subscription_checkout_intent($1, $2, $3, $4, $5)",
          [userId, expiresAt, "price_invalid", planId, period],
        ),
      ).rejects.toMatchObject({ code: "22023" });
    }

    const priceGuardClient = new Client({
      connectionString: resolveDbTarget().connectionString,
    });
    await priceGuardClient.connect();
    try {
      await priceGuardClient.query("BEGIN");
      await priceGuardClient.query(
        "UPDATE plans SET price_monthly = 0 WHERE id = 'agency'",
      );
      const freeAgencyUser = randomUUID();
      await priceGuardClient.query(
        "INSERT INTO auth.users(id, email) VALUES ($1, $2)",
        [freeAgencyUser, `${marker}-active-zero-price@example.invalid`],
      );
      await expect(
        priceGuardClient.query(
          "SELECT * FROM claim_subscription_checkout_intent($1, $2, $3, $4, $5)",
          [freeAgencyUser, expiresAt, "price_zero", "agency", "monthly"],
        ),
      ).rejects.toMatchObject({ code: "22023" });
    } finally {
      await priceGuardClient.query("ROLLBACK");
      await priceGuardClient.end();
    }

    try {
      await query("UPDATE plans SET is_active = FALSE WHERE id = 'agency'");
      const inactiveUser = await createUser("inactive-agency");
      await expect(
        query(
          "SELECT * FROM claim_subscription_checkout_intent($1, $2, $3, $4, $5)",
          [inactiveUser, expiresAt, "price_inactive", "agency", "monthly"],
        ),
      ).rejects.toMatchObject({ code: "22023" });
    } finally {
      await query("UPDATE plans SET is_active = TRUE WHERE id = 'agency'");
    }

    try {
      await query(
        `UPDATE plans
         SET price_yearly_total = NULL,
             price_yearly_monthly_equivalent = NULL
         WHERE id = 'agency'`,
      );
      const noYearlyUser = await createUser("agency-without-yearly-price");
      await expect(
        query(
          "SELECT * FROM claim_subscription_checkout_intent($1, $2, $3, $4, $5)",
          [noYearlyUser, expiresAt, "price_no_yearly", "agency", "yearly"],
        ),
      ).rejects.toMatchObject({ code: "22023" });
    } finally {
      await query(
        `UPDATE plans
         SET price_yearly_total = 490,
             price_yearly_monthly_equivalent = 40.83
         WHERE id = 'agency'`,
      );
    }
  });

  test("checkout intent plan ids have a catalogue foreign key", async () => {
    const { rows } = await query<{ count: number }>(`
      SELECT COUNT(*)::INTEGER AS count
      FROM pg_constraint
      WHERE conrelid = 'public.checkout_pending_intents'::regclass
        AND contype = 'f'
        AND confrelid = 'public.plans'::regclass
        AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (plan_id)%'
    `);

    expect(rows[0].count).toBe(1);
  });

  test("only service_role can execute capacity RPCs", async () => {
    const { rows } = await query<{
      identity: string;
      anon: boolean;
      authenticated: boolean;
      service_role: boolean;
    }>(`
      SELECT p.oid::regprocedure::text AS identity,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN (
          'reserve_founding_agency_spot',
          'bind_founding_agency_checkout',
          'release_founding_agency_checkout',
          'complete_founding_agency_purchase',
          'get_founding_agency_availability',
          'release_unresolved_founding_agency_checkout',
          'mark_founding_agency_duplicate_refunded',
          'bind_founding_agency_duplicate_refund_session'
        )
      ORDER BY identity
    `);

    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row).toMatchObject({
        anon: false,
        authenticated: false,
        service_role: true,
      });
    }
  });
});
