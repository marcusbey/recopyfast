/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { describeDb } from "./db-harness";

/**
 * s125 (audit H1, ADR 075): a signed-in customer can change nothing on their
 * own `credit_purchases` row except spending `credits_remaining` down.
 *
 * Before 20261027120000 `authenticated` held table-wide UPDATE (Supabase
 * default grants) and the only guard was the "may only decrease" trigger, so a
 * buyer could rewrite `stripe_payment_intent_id` and the refund / dispute
 * clawback — which looks the row up by that column — found nothing to claw
 * back. Two walls now: the column grant, and the trigger that refuses any other
 * column change by a non-service role even if a broader grant comes back.
 */

interface Runner {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

const EMAIL_PREFIX = "dbtest-s125-purchase-";

const SPEND_SQL = `SELECT outcome, from_purchased, remaining
                   FROM public.spend_credits($1, $2, $3, $4, $5, $6)`;

/** Every column a web role must never change, with a value that differs. */
const FROZEN_COLUMNS: ReadonlyArray<[string, string]> = [
  ["stripe_payment_intent_id", "'pi_rewritten_by_buyer'"],
  ["price_cents", "1"],
  ["credits_purchased", "credits_purchased + 100"],
  ["created_at", "created_at - INTERVAL '1 day'"],
  ["expires_at", "NOW() + INTERVAL '10 years'"],
  ["user_id", "user_id"],
];

const ONLY_REMAINING = /only credits_remaining may change/;

type TablePrivilege =
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "TRUNCATE"
  | "REFERENCES"
  | "TRIGGER";

/** TRUNCATE ignores RLS and fires no row trigger, so it bypasses both walls. */
const NON_DML_PRIVILEGES: ReadonlyArray<TablePrivilege> = [
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
];

describeDb(
  "credit_purchases column boundary for web roles (s125)",
  ({ query, withClient }) => {
    async function cleanup(): Promise<void> {
      // FK cascade removes the users' credit_purchases and credit_usage rows.
      await query("DELETE FROM auth.users WHERE email LIKE $1", [
        `${EMAIL_PREFIX}%`,
      ]);
    }

    // afterEach, not afterAll: the harness's afterAll ends the pool first.
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

    async function addPurchase(userId: string, credits = 10): Promise<string> {
      const { rows } = await query<{ id: string }>(
        `INSERT INTO credit_purchases (
           user_id, credits_purchased, credits_remaining, price_cents,
           stripe_payment_intent_id
         )
         VALUES ($1, $2, $2, 900, $3)
         RETURNING id`,
        [userId, credits, `pi_dbtest_s125_${randomUUID()}`],
      );
      return rows[0].id;
    }

    async function row(purchaseId: string) {
      const { rows } = await query<Record<string, unknown>>(
        "SELECT * FROM credit_purchases WHERE id = $1",
        [purchaseId],
      );
      return rows[0];
    }

    /**
     * One transaction as `role` with the user's JWT claims, the way PostgREST
     * runs it. `setup` runs first as the connecting superuser — that is where a
     * negative control restores a dangerous grant — and everything is rolled
     * back, so nothing a test does here outlives it.
     */
    async function inRolledBackTx<T>(
      role: "anon" | "authenticated" | "service_role",
      subject: string | null,
      work: (runner: Runner) => Promise<T>,
      setup?: (runner: Runner) => Promise<void>,
    ): Promise<T> {
      return withClient(async (client) => {
        await client.query("BEGIN");
        try {
          if (setup) await setup(client);
          await client.query(`SET LOCAL ROLE ${role}`);
          if (subject) {
            await client.query(
              "SELECT set_config('request.jwt.claims', $1, true)",
              [JSON.stringify({ sub: subject, role })],
            );
          }
          return await work(client);
        } finally {
          await client.query("ROLLBACK");
        }
      });
    }

    /** Like `inRolledBackTx`, but commits so the effect can be read back. */
    async function asRoleCommitted<T>(
      role: "authenticated" | "service_role",
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

    async function effectiveColumns(
      role: string,
      privilege: "INSERT" | "UPDATE",
    ): Promise<string[]> {
      const { rows } = await query<{ column_name: string }>(
        `SELECT c.column_name
           FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'credit_purchases'
            AND has_column_privilege($1, 'public.credit_purchases', c.column_name, $2)
          ORDER BY c.ordinal_position`,
        [role, privilege],
      );
      return rows.map((r) => r.column_name);
    }

    async function hasTablePrivilege(
      role: string,
      privilege: TablePrivilege,
    ): Promise<boolean> {
      const { rows } = await query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1, 'public.credit_purchases', $2) AS allowed",
        [role, privilege],
      );
      return rows[0].allowed;
    }

    test("authenticated may UPDATE credits_remaining only; anon may UPDATE nothing", async () => {
      expect(await effectiveColumns("authenticated", "UPDATE")).toEqual([
        "credits_remaining",
      ]);
      expect(await effectiveColumns("anon", "UPDATE")).toEqual([]);
    });

    test.each(["anon", "authenticated"])(
      "%s holds no INSERT or DELETE on credit_purchases",
      async (role) => {
        expect(await effectiveColumns(role, "INSERT")).toEqual([]);
        expect(await hasTablePrivilege(role, "INSERT")).toBe(false);
        expect(await hasTablePrivilege(role, "DELETE")).toBe(false);
      },
    );

    test.each(["anon", "authenticated"])(
      "%s holds no TRUNCATE, REFERENCES or TRIGGER on credit_purchases",
      async (role) => {
        for (const privilege of NON_DML_PRIVILEGES) {
          expect([privilege, await hasTablePrivilege(role, privilege)]).toEqual(
            [privilege, false],
          );
        }
      },
    );

    test("authenticated cannot TRUNCATE credit_purchases", async () => {
      const userId = await createUser("truncate");
      const purchaseId = await addPurchase(userId);

      await expect(
        inRolledBackTx("authenticated", userId, (runner) =>
          runner.query("TRUNCATE public.credit_purchases CASCADE"),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      expect(await row(purchaseId)).toBeDefined();
    });

    test("service_role keeps TRUNCATE, REFERENCES and TRIGGER", async () => {
      for (const privilege of NON_DML_PRIVILEGES) {
        expect([
          privilege,
          await hasTablePrivilege("service_role", privilege),
        ]).toEqual([privilege, true]);
      }
    });

    test("service_role keeps INSERT, UPDATE and DELETE", async () => {
      expect(await hasTablePrivilege("service_role", "INSERT")).toBe(true);
      expect(await hasTablePrivilege("service_role", "UPDATE")).toBe(true);
      expect(await hasTablePrivilege("service_role", "DELETE")).toBe(true);
    });

    test.each(FROZEN_COLUMNS)(
      "the row's owner cannot change %s",
      async (column, value) => {
        const userId = await createUser(`frozen-${column}`);
        const purchaseId = await addPurchase(userId);
        const before = await row(purchaseId);

        await expect(
          inRolledBackTx("authenticated", userId, (runner) =>
            runner.query(
              `UPDATE credit_purchases SET ${column} = ${value} WHERE id = $1`,
              [purchaseId],
            ),
          ),
        ).rejects.toMatchObject({ code: "42501" });
        expect(await row(purchaseId)).toEqual(before);
      },
    );

    test("the owner cannot insert or delete a purchase row", async () => {
      const userId = await createUser("insert-delete");
      const purchaseId = await addPurchase(userId);

      await expect(
        inRolledBackTx("authenticated", userId, (runner) =>
          runner.query(
            `INSERT INTO credit_purchases (user_id, credits_purchased, credits_remaining)
             VALUES ($1, 1000, 1000)`,
            [userId],
          ),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        inRolledBackTx("authenticated", userId, (runner) =>
          runner.query("DELETE FROM credit_purchases WHERE id = $1", [
            purchaseId,
          ]),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      expect(await row(purchaseId)).toBeDefined();
    });

    test("negative control: with UPDATE (stripe_payment_intent_id) restored, the trigger still refuses the rewrite", async () => {
      const userId = await createUser("restored-column-grant");
      const purchaseId = await addPurchase(userId);
      const before = await row(purchaseId);

      await expect(
        inRolledBackTx(
          "authenticated",
          userId,
          async (runner) => {
            // Prove the restored grant is live, so the refusal below can only
            // come from the trigger.
            const { rows } = await runner.query<{ allowed: boolean }>(
              `SELECT has_column_privilege('public.credit_purchases',
                        'stripe_payment_intent_id', 'UPDATE') AS allowed`,
            );
            expect(rows[0].allowed).toBe(true);
            return runner.query(
              `UPDATE credit_purchases
                  SET stripe_payment_intent_id = 'pi_rewritten_by_buyer'
                WHERE id = $1`,
              [purchaseId],
            );
          },
          async (runner) => {
            await runner.query(
              "GRANT UPDATE (stripe_payment_intent_id) ON public.credit_purchases TO authenticated",
            );
          },
        ),
      ).rejects.toMatchObject({
        message: expect.stringMatching(ONLY_REMAINING),
      });
      expect(await row(purchaseId)).toEqual(before);
      expect(await effectiveColumns("authenticated", "UPDATE")).toEqual([
        "credits_remaining",
      ]);
    });

    test.each(FROZEN_COLUMNS.filter(([column]) => column !== "user_id"))(
      "negative control: with table-wide UPDATE restored, the trigger still refuses a change to %s",
      async (column, value) => {
        const userId = await createUser(`restored-table-${column}`);
        const purchaseId = await addPurchase(userId);

        await expect(
          inRolledBackTx(
            "authenticated",
            userId,
            (runner) =>
              runner.query(
                `UPDATE credit_purchases SET ${column} = ${value} WHERE id = $1`,
                [purchaseId],
              ),
            async (runner) => {
              await runner.query(
                "GRANT UPDATE ON public.credit_purchases TO authenticated",
              );
            },
          ),
        ).rejects.toMatchObject({
          message: expect.stringMatching(ONLY_REMAINING),
        });
      },
    );

    test("the owner still spends down credits_remaining directly and through spend_credits", async () => {
      const userId = await createUser("spend");
      const purchaseId = await addPurchase(userId, 10);

      await asRoleCommitted("authenticated", userId, (runner) =>
        runner.query(
          "UPDATE credit_purchases SET credits_remaining = credits_remaining - 1 WHERE id = $1",
          [purchaseId],
        ),
      );
      const result = await asRoleCommitted(
        "authenticated",
        userId,
        async (runner) => {
          const { rows } = await runner.query<{
            outcome: string;
            from_purchased: number;
            remaining: number;
          }>(SPEND_SQL, [
            userId,
            4,
            0,
            new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            "translation",
            "{}",
          ]);
          return rows[0];
        },
      );

      expect(result).toMatchObject({
        outcome: "charged",
        from_purchased: 4,
        remaining: 5,
      });
      expect((await row(purchaseId)).credits_remaining).toBe(5);
    });

    test("service_role still zeroes, restores and rewrites the row (clawback and restore paths)", async () => {
      const userId = await createUser("service");
      const purchaseId = await addPurchase(userId, 10);
      const intent = `pi_dbtest_s125_service_${randomUUID()}`;

      await asRoleCommitted("service_role", null, async (runner) => {
        await runner.query(
          "UPDATE credit_purchases SET credits_remaining = 0 WHERE id = $1",
          [purchaseId],
        );
        await runner.query(
          `UPDATE credit_purchases
              SET credits_remaining = 7, stripe_payment_intent_id = $2,
                  expires_at = NOW() + INTERVAL '1 day'
            WHERE id = $1`,
          [purchaseId, intent],
        );
      });

      const { rows } = await query<{ id: string; credits_remaining: number }>(
        "SELECT id, credits_remaining FROM credit_purchases WHERE stripe_payment_intent_id = $1",
        [intent],
      );
      expect(rows).toEqual([{ id: purchaseId, credits_remaining: 7 }]);
    });
  },
);
