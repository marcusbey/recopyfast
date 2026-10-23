/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { describeDb } from "./db-harness";

/**
 * ADR 074: `datafast_visitors` is service-role only. No web principal may read
 * which DataFast visitor an account is, or write one; the CHECK keeps the
 * stored value inside the cookie charset the app validates.
 */
describeDb(
  "datafast_visitors privileges and shape",
  ({ query, withClient }) => {
    // Nested so these hooks run before the harness closes its pool.
    describe("isolated fixtures", () => {
      const user = randomUUID();

      beforeAll(async () => {
        await query("insert into auth.users(id) values ($1)", [user]);
      });
      afterAll(async () => {
        await query("delete from auth.users where id=$1", [user]);
      });

      test.each(["anon", "authenticated"])(
        "%s holds no privilege and is refused by PostgreSQL",
        async (role) => {
          const { rows } = await query<{ ok: boolean }>(
            "select has_table_privilege($1,'public.datafast_visitors','SELECT') or has_table_privilege($1,'public.datafast_visitors','INSERT') or has_table_privilege($1,'public.datafast_visitors','UPDATE') as ok",
            [role],
          );
          expect(rows[0].ok).toBe(false);
          await withClient(async (c) => {
            await c.query("begin");
            try {
              await c.query(`set local role ${role}`);
              await expect(
                c.query("select * from public.datafast_visitors"),
              ).rejects.toMatchObject({ code: "42501" });
            } finally {
              await c.query("rollback");
            }
          });
        },
      );

      test("one row per account, overwritten, deleted with the account", async () => {
        const upsert =
          "insert into public.datafast_visitors(user_id,visitor_id) values ($1,$2) on conflict (user_id) do update set visitor_id=excluded.visitor_id, updated_at=clock_timestamp()";
        await query(upsert, [user, "a3ab2331-989f-4cfa-91c6-2461c9e3c6bd"]);
        await query(upsert, [user, "b4bc3442-090a-4dfb-a2d7-3572daf4d7ce"]);
        const { rows } = await query<{ visitor_id: string }>(
          "select visitor_id from public.datafast_visitors where user_id=$1",
          [user],
        );
        expect(rows).toEqual([
          { visitor_id: "b4bc3442-090a-4dfb-a2d7-3572daf4d7ce" },
        ]);
      });

      test("rejects a value outside the cookie charset", async () => {
        await expect(
          query(
            "insert into public.datafast_visitors(user_id,visitor_id) values ($1,$2) on conflict (user_id) do update set visitor_id=excluded.visitor_id",
            [user, "x@y.z"],
          ),
        ).rejects.toMatchObject({ code: "23514" });
      });

      test("cascades with auth.users", async () => {
        const other = randomUUID();
        await query("insert into auth.users(id) values ($1)", [other]);
        await query(
          "insert into public.datafast_visitors(user_id,visitor_id) values ($1,'v1')",
          [other],
        );
        await query("delete from auth.users where id=$1", [other]);
        const { rows } = await query(
          "select 1 from public.datafast_visitors where user_id=$1",
          [other],
        );
        expect(rows).toHaveLength(0);
      });
    });
  },
);
