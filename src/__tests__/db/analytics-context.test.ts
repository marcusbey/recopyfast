/** @jest-environment node */
import { randomUUID, createHash } from "node:crypto";
import { describeDb } from "./db-harness";

describeDb(
  "analytics context authority and retention",
  ({ query, withClient }) => {
    describe("isolated fixtures", () => {
      const userA = randomUUID(),
        userB = randomUUID();
      const hashes: string[] = [];
      const capture = async (
        existing = false,
        hash = createHash("sha256").update(randomUUID()).digest("hex"),
      ) => {
        hashes.push(hash);
        const { rows } = await query<{ id: string }>(
          "select public.capture_analytics_context($1,'123.456','explicit',now()+interval '180 days',$2) as id",
          [hash, existing],
        );
        return { id: rows[0].id, hash };
      };
      beforeAll(async () => {
        await query("insert into auth.users(id) values ($1),($2)", [
          userA,
          userB,
        ]);
      });
      afterAll(async () => {
        await query(
          "delete from public.analytics_contexts where capability_hash=ANY($1::text[])",
          [hashes],
        );
        await query("delete from auth.users where id=ANY($1::uuid[])", [
          [userA, userB],
        ]);
      });
      test.each(["anon", "authenticated"])(
        "%s cannot read or invoke privileged functions",
        async (role) => {
          const { rows } = await query<{ ok: boolean }>(
            "select has_table_privilege($1,'public.analytics_contexts','SELECT') or has_function_privilege($1,'public.revoke_analytics_context(text,uuid)','EXECUTE') as ok",
            [role],
          );
          expect(rows[0].ok).toBe(false);
          await withClient(async (c) => {
            await c.query("begin");
            try {
              await c.query(`set local role ${role}`);
              await expect(
                c.query("select * from public.analytics_contexts"),
              ).rejects.toMatchObject({ code: "42501" });
            } finally {
              await c.query("rollback");
            }
          });
        },
      );
      test("refresh creates immutable captures; capability-wide revoke erases all and stale refresh cannot resurrect", async () => {
        const a = await capture();
        const b = await capture(true, a.hash);
        expect(a.id).not.toBe(b.id);
        await query("select public.revoke_analytics_context($1,null)", [
          a.hash,
        ]);
        expect((await capture(true, a.hash)).id).toBeNull();
        expect(
          (
            await query(
              "select client_id,capability_hash from public.analytics_contexts where id=ANY($1::uuid[])",
              [[a.id, b.id]],
            )
          ).rows,
        ).toEqual([
          { client_id: null, capability_hash: null },
          { client_id: null, capability_hash: null },
        ]);
        await query(
          "delete from public.analytics_contexts where id=ANY($1::uuid[])",
          [[a.id, b.id]],
        );
      });
      test("verified binding cannot change account, even under competing binds", async () => {
        const a = await capture();
        const results = await Promise.all([
          query("select public.bind_analytics_context($1,$2) as n", [
            a.hash,
            userA,
          ]),
          query("select public.bind_analytics_context($1,$2) as n", [
            a.hash,
            userB,
          ]),
        ]);
        expect(results.map((r) => Number(r.rows[0].n)).sort()).toEqual([0, 1]);
        expect(
          (
            await query(
              "select distinct user_id from public.analytics_contexts where capability_hash=$1",
              [a.hash],
            )
          ).rows,
        ).toHaveLength(1);
      });
      test("day14 eligible, day31 and true occurrence before capture ineligible", async () => {
        const a = await capture();
        await query("delete from public.analytics_contexts where user_id=$1", [
          userA,
        ]);
        await query("select public.bind_analytics_context($1,$2)", [
          a.hash,
          userA,
        ]);
        await withClient(async (c) => {
          await c.query("begin");
          try {
            await c.query(
              "update public.analytics_contexts set captured_at=now()-interval '14 days',consent_at=now()-interval '14 days',bound_at=now()-interval '14 days',expires_at=now()+interval '16 days' where id=$1",
              [a.id],
            );
            expect(
              (
                await c.query(
                  "select id from public.eligible_analytics_context($1,now(),null)",
                  [userA],
                )
              ).rows.map((r) => r.id),
            ).toContain(a.id);
            await c.query(
              "update public.analytics_contexts set expires_at=now() where id=$1",
              [a.id],
            );
            expect(
              (
                await c.query(
                  "select id from public.eligible_analytics_context($1,now(),null)",
                  [userA],
                )
              ).rows.map((r) => r.id),
            ).not.toContain(a.id);
          } finally {
            await c.query("rollback");
          }
        });
        expect(
          (
            await query(
              "select id from public.eligible_analytics_context($1,now()-interval '1 day',null)",
              [userA],
            )
          ).rows,
        ).toEqual([]);
      });
      test("service role can capture and bind; effective web grants are absent for every function", async () => {
        const { rows } = await query(
          "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('capture_analytics_context','bind_analytics_context','revoke_analytics_context','eligible_analytics_context','cleanup_analytics_contexts') and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))",
        );
        expect(rows).toEqual([]);
        await withClient(async (c) => {
          await c.query("begin");
          try {
            await c.query("set local role service_role");
            const hash = createHash("sha256")
              .update(randomUUID())
              .digest("hex");
            const { rows: captured } = await c.query(
              "select public.capture_analytics_context($1,'1.2','explicit',clock_timestamp()+interval '1 day',false) as id",
              [hash],
            );
            expect(captured[0].id).toBeTruthy();
            expect(
              (
                await c.query(
                  "select public.bind_analytics_context($1,$2) as n",
                  [hash, userA],
                )
              ).rows[0].n,
            ).toBe(1);
            expect(
              (
                await c.query(
                  "select public.revoke_analytics_context($1,null) as n",
                  [hash],
                )
              ).rows[0].n,
            ).toBe(1);
          } finally {
            await c.query("rollback");
          }
        });
      });
      test("account withdrawal reaches multiple browser capabilities and cannot affect another account", async () => {
        const a = await capture(),
          b = await capture(),
          other = await capture();
        await query("select public.bind_analytics_context($1,$2)", [
          a.hash,
          userA,
        ]);
        await query("select public.bind_analytics_context($1,$2)", [
          b.hash,
          userA,
        ]);
        await query("select public.bind_analytics_context($1,$2)", [
          other.hash,
          userB,
        ]);
        await query("select public.revoke_analytics_context(null,$1)", [userA]);
        expect(
          (
            await query(
              "select id from public.eligible_analytics_context($1,clock_timestamp(),null)",
              [userA],
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await query(
              "select client_id from public.analytics_contexts where id=$1",
              [other.id],
            )
          ).rows[0].client_id,
        ).toBe("123.456");
      });
      test("revoke committed while a competing bind waits wins without resurrecting identity", async () => {
        const a = await capture();
        let binding: Promise<unknown> | undefined;
        await withClient(async (c) => {
          await c.query("begin");
          try {
            await c.query("select pg_advisory_xact_lock(710110)");
            binding = query(
              "select public.bind_analytics_context($1,$2) as n",
              [a.hash, userA],
            );
            await c.query("select public.revoke_analytics_context($1,null)", [
              a.hash,
            ]);
            await c.query("commit");
          } catch (error) {
            await c.query("rollback");
            throw error;
          }
        });
        expect(((await binding) as { rows: { n: number }[] }).rows[0].n).toBe(
          0,
        );
        await query("delete from public.analytics_contexts where id=$1", [
          a.id,
        ]);
      });
      test("choice expiry wins and account deletion removes context without recreating the account", async () => {
        const a = await capture();
        await withClient(async (c) => {
          await c.query("begin");
          try {
            await c.query("select public.bind_analytics_context($1,$2)", [
              a.hash,
              userA,
            ]);
            await c.query("delete from auth.users where id=$1", [userA]);
            expect(
              (
                await c.query(
                  "select id from public.analytics_contexts where id=$1",
                  [a.id],
                )
              ).rows,
            ).toEqual([]);
            expect(
              (
                await c.query(
                  "select public.bind_analytics_context($1,$2) as n",
                  [a.hash, userA],
                )
              ).rows[0].n,
            ).toBe(0);
            const hash = createHash("sha256")
              .update(randomUUID())
              .digest("hex");
            await c.query(
              "select public.capture_analytics_context($1,'1.2','explicit',clock_timestamp()+interval '1 hour',false)",
              [hash],
            );
            expect(
              (
                await c.query(
                  "select expires_at=consent_expires_at as capped from public.analytics_contexts where capability_hash=$1",
                  [hash],
                )
              ).rows[0].capped,
            ).toBe(true);
          } finally {
            await c.query("rollback");
          }
        });
      });
      test("cleanup before dispatcher exists, bounded and repeatable; SET NULL keeps dedupe metadata", async () => {
        const a = await capture();
        await withClient(async (c) => {
          await c.query("begin");
          try {
            await c.query(
              "create table public.analytics_test_disposition(source_key text primary key,context_id uuid references public.analytics_contexts(id) on delete set null)",
            );
            await c.query(
              "insert into analytics_test_disposition values ('signup-once',$1)",
              [a.id],
            );
            await c.query(
              "update public.analytics_contexts set captured_at=now()-interval '31 days',consent_at=now()-interval '31 days',expires_at=now()-interval '1 day' where id=$1",
              [a.id],
            );
            await c.query(
              "select * from public.cleanup_analytics_contexts(1000)",
            );
            expect(
              (await c.query("select * from analytics_test_disposition")).rows,
            ).toEqual([{ source_key: "signup-once", context_id: null }]);
            await c.query(
              "select * from public.cleanup_analytics_contexts(1000)",
            );
          } finally {
            await c.query("rollback");
          }
        });
      });
    });
  },
);
