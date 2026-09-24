import { randomUUID } from "node:crypto";
import { describeDb } from "./db-harness";

describeDb("Founding Agency capacity", ({ query }) => {
  const userIds: string[] = [];
  const marker = `dbtest-founding-${Date.now()}`;

  beforeAll(async () => {
    const { rows } = await query<{
      reservations: string | null;
      reserve_rpc: string | null;
      bind_rpc: string | null;
      release_rpc: string | null;
      complete_rpc: string | null;
      availability_rpc: string | null;
    }>(`
      SELECT to_regclass('public.founding_agency_reservations')::text AS reservations,
             to_regprocedure('public.reserve_founding_agency_spot(uuid)')::text AS reserve_rpc,
             to_regprocedure('public.bind_founding_agency_checkout(uuid,uuid,text)')::text AS bind_rpc,
             to_regprocedure('public.release_founding_agency_checkout(uuid,uuid,text)')::text AS release_rpc,
             to_regprocedure('public.complete_founding_agency_purchase(uuid,uuid,text)')::text AS complete_rpc,
             to_regprocedure('public.get_founding_agency_availability()')::text AS availability_rpc
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
      `DELETE FROM founding_agency_reservations
       WHERE stripe_payment_intent_id LIKE $1
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

  test("50 completed sales refuse checkout as sold out", async () => {
    await seedCompletedSales(50);
    const userId = await createUser("sale-51");

    const { rows } = await query<{ outcome: string }>(
      "SELECT outcome FROM reserve_founding_agency_spot($1)",
      [userId],
    );

    expect(rows[0].outcome).toBe("sold_out");
  });

  test("two concurrent attempts at the last spot cannot oversell", async () => {
    await seedCompletedSales(49);
    const [firstUser, secondUser] = await Promise.all([
      createUser("race-a"),
      createUser("race-b"),
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
    const { rows } = await query<{ live: number }>(
      `SELECT COUNT(*)::INTEGER AS live
       FROM founding_agency_reservations
       WHERE status IN ('reserved', 'completed')`,
    );
    expect(rows[0].live).toBe(50);
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

  test("an expired reservation stays capacity-bound until a verified release", async () => {
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
    const unboundAttempt = await query<{ outcome: string }>(
      "SELECT outcome FROM reserve_founding_agency_spot($1)",
      [secondUser],
    );

    expect(unboundAttempt.rows[0].outcome).toBe("capacity_busy");

    await query("SELECT bind_founding_agency_checkout($1, $2, $3)", [
      reservationId,
      firstUser,
      "cs_expired_signed",
    ]);
    const boundAttempt = await query<{ outcome: string }>(
      "SELECT outcome FROM reserve_founding_agency_spot($1)",
      [secondUser],
    );

    expect(boundAttempt.rows[0].outcome).toBe("capacity_busy");

    await query("SELECT release_founding_agency_checkout($1, $2, $3)", [
      reservationId,
      firstUser,
      "cs_expired_signed",
    ]);
    const next = await query<{ outcome: string }>(
      "SELECT outcome FROM reserve_founding_agency_spot($1)",
      [thirdUser],
    );

    expect(next.rows[0].outcome).toBe("reserved");
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
          'get_founding_agency_availability'
        )
      ORDER BY identity
    `);

    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row).toMatchObject({
        anon: false,
        authenticated: false,
        service_role: true,
      });
    }
  });
});
