/** @jest-environment node */
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describeDb } from "./db-harness";

describeDb(
  "signup delivery frozen source and dispatch authority",
  ({ query, withClient }) => {
    describe("owned fixtures", () => {
      const users: string[] = [];
      const contexts: unknown[] = [];
      const account = async (confirmed = true) => {
        const id = randomUUID();
        users.push(id);
        await query(
          "insert into auth.users(id,email_confirmed_at) values($1,case when $2 then clock_timestamp() else null end)",
          [id, confirmed],
        );
        return id;
      };
      const context = async () => {
        const hash = createHash("sha256").update(randomUUID()).digest("hex");
        const { rows } = await query(
          "select public.capture_analytics_context($1,'123.456','explicit',clock_timestamp()+interval '30 days',false) as id",
          [hash],
        );
        contexts.push(rows[0].id);
        return { hash, id: rows[0].id };
      };
      const freeze = async (
        user: string,
        hash: string | null,
        proven = true,
        consent = "eligible",
      ) =>
        (
          await query(
            "select * from public.freeze_analytics_signup($1,$2,$3,$4)",
            [user, hash, proven, consent],
          )
        ).rows[0];
      afterAll(async () => {
        await query("delete from auth.users where id=any($1::uuid[])", [users]);
        await query("delete from analytics_contexts where id=any($1::uuid[])", [
          contexts,
        ]);
      });

      test("actual browser capability freezes once; later login cannot replace attribution", async () => {
        const a = await context(),
          user = await account(),
          b = await context();
        const first = await freeze(user, a.hash);
        expect(first.state).toBe("pending");
        expect(await freeze(user, b.hash, false)).toEqual(first);
        const { rows } = await query(
          "select context_id,frozen_context_id,payload from analytics_delivery_events where user_id=$1",
          [user],
        );
        expect(rows).toEqual([
          {
            context_id: a.id,
            frozen_context_id: a.id,
            payload: { method: "email" },
          },
        ]);
      });
      test.each(["eligible", "denied", "ineligible"])(
        "missing context stays absent after a later grant (%s)",
        async (consent) => {
          const user = await account();
          const absent = await freeze(user, null, true, consent);
          expect(absent.state).toBe("suppressed");
          const c = await context();
          expect(await freeze(user, c.hash)).toEqual(absent);
        },
      );
      test("generic or PKCE proof is never inferred from timestamp proximity", async () => {
        const c = await context(),
          user = await account();
        const r = await freeze(user, c.hash, false);
        expect(r).toMatchObject({
          state: "suppressed",
          reason: "initial_confirmation_unproven",
        });
        expect(await freeze(user, c.hash, true)).toEqual(r);
      });
      test("unconfirmed and nonexistent accounts cannot create dispositions", async () => {
        expect((await freeze(await account(false), null)).state).toBe(
          "unconfirmed",
        );
        expect((await freeze(randomUUID(), null)).state).toBe(
          "account_missing",
        );
      });
      test("pre-occurrence, different-account and revoked contexts cannot be rescued", async () => {
        const user = await account(),
          late = await context();
        expect((await freeze(user, late.hash)).state).toBe("suppressed");
        const shared = await context(),
          owner = await account(),
          other = await account();
        await query("select bind_analytics_context($1,$2)", [
          shared.hash,
          owner,
        ]);
        expect((await freeze(other, shared.hash)).state).toBe("suppressed");
        const revoked = await context(),
          u = await account();
        await query("select revoke_analytics_context($1,null)", [revoked.hash]);
        expect((await freeze(u, revoked.hash)).state).toBe("suppressed");
      });
      test("concurrent proven callbacks preserve one frozen source", async () => {
        const a = await context(),
          b = await context(),
          user = await account();
        const result = await Promise.all([
          freeze(user, a.hash),
          freeze(user, b.hash),
        ]);
        expect(result[0]).toEqual(result[1]);
        expect(
          (
            await query(
              "select id from analytics_delivery_events where user_id=$1",
              [user],
            )
          ).rows,
        ).toHaveLength(1);
      });
      test("lost freeze acknowledgement recovers unchanged; total write rollback cannot be attributed by later login", async () => {
        const c = await context(),
          user = await account();
        await withClient(async (db) => {
          await db.query("begin");
          await db.query(
            "select freeze_analytics_signup($1,$2,true,'eligible')",
            [user, c.hash],
          );
          await db.query("rollback");
        });
        expect((await freeze(user, c.hash, false)).reason).toBe(
          "initial_confirmation_unproven",
        );
        const d = await context(),
          u = await account();
        const committed = await freeze(u, d.hash);
        expect(await freeze(u, null, false)).toEqual(committed);
      });
      test("context purge retains source tombstone; account deletion forbids reconstruction", async () => {
        const c = await context(),
          user = await account();
        const first = await freeze(user, c.hash);
        await query("delete from analytics_contexts where id=$1", [c.id]);
        expect(
          (
            await query(
              "select context_id,frozen_context_id from analytics_delivery_events where user_id=$1",
              [user],
            )
          ).rows[0],
        ).toEqual({ context_id: null, frozen_context_id: c.id });
        expect(await freeze(user, null, false)).toEqual(first);
        await query("delete from auth.users where id=$1", [user]);
        expect((await freeze(user, null)).state).toBe("account_missing");
      });
      test("claim is the in-flight boundary; finalize never makes an uncertain event retryable", async () => {
        // Discard prior test pending fixtures so this test owns the oldest claim.
        await query(
          "update analytics_delivery_events set state='suppressed',reason='context_unavailable',payload=null where state='pending'",
        );
        const c = await context(),
          user = await account();
        await freeze(user, c.hash);
        const claim = (await query("select * from claim_analytics_delivery() "))
          .rows[0];
        expect(claim).toMatchObject({ client_id: "123.456" });
        await query("select revoke_analytics_context($1,$2)", [c.hash, user]);
        expect(
          (await query("select * from claim_analytics_delivery() ")).rows,
        ).toEqual([]);
        await query(
          "select finalize_analytics_delivery($1,$2,'uncertain','transport_error')",
          [claim.id, claim.claim_token],
        );
        expect(
          (
            await query(
              "select state,payload from analytics_delivery_events where id=$1",
              [claim.id],
            )
          ).rows[0],
        ).toEqual({ state: "uncertain", payload: null });
        expect(
          (await query("select * from claim_analytics_delivery() ")).rows,
        ).toEqual([]);
      });
      test("revoke committed before a waiting claim suppresses it", async () => {
        const c = await context(),
          user = await account();
        await freeze(user, c.hash);
        let pending: Promise<unknown> | undefined;
        await withClient(async (db) => {
          await db.query("begin");
          await db.query("select pg_advisory_xact_lock(710110)");
          pending = query("select * from claim_analytics_delivery()");
          await db.query("select revoke_analytics_context($1,$2)", [
            c.hash,
            user,
          ]);
          await db.query("commit");
        });
        expect(((await pending) as { rows: unknown[] }).rows).toEqual([]);
        expect(
          (
            await query(
              "select state from analytics_delivery_events where user_id=$1",
              [user],
            )
          ).rows[0].state,
        ).toBe("suppressed");
      });
      test("stale in-flight claim becomes uncertain; 72-hour candidates expire without timestamp repair", async () => {
        const c = await context(),
          user = await account();
        await freeze(user, c.hash);
        const claim = (await query("select * from claim_analytics_delivery()"))
          .rows[0];
        await query(
          "update analytics_delivery_events set claimed_at=now()-interval '6 minutes' where id=$1",
          [claim.id],
        );
        await query("select * from reconcile_analytics_delivery(100)");
        expect(
          (
            await query(
              "select state,payload from analytics_delivery_events where id=$1",
              [claim.id],
            )
          ).rows[0],
        ).toEqual({ state: "uncertain", payload: null });
        const d = await context(),
          u = await account();
        await freeze(u, d.hash);
        await query(
          "update analytics_delivery_events set occurred_at=now()-interval '73 hours' where user_id=$1",
          [u],
        );
        await query("select * from reconcile_analytics_delivery(100)");
        expect(
          (
            await query(
              "select state from analytics_delivery_events where user_id=$1",
              [u],
            )
          ).rows[0].state,
        ).toBe("expired");
      });
      test("service role freezes, claims and finalizes while web execute fails", async () => {
        await query(
          "update analytics_delivery_events set state='suppressed',reason='context_unavailable',payload=null where state='pending'",
        );
        const c = await context(),
          user = await account();
        await withClient(async (db) => {
          await db.query("begin");
          try {
            await db.query("set local role service_role");
            expect(
              (
                await db.query(
                  "select * from freeze_analytics_signup($1,$2,true,'eligible')",
                  [user, c.hash],
                )
              ).rows[0].state,
            ).toBe("pending");
            const claim = (
              await db.query("select * from claim_analytics_delivery()")
            ).rows[0];
            expect(claim.client_id).toBe("123.456");
            expect(
              (
                await db.query(
                  "select finalize_analytics_delivery($1,$2,'accepted_http','http_2xx') as ok",
                  [claim.id, claim.claim_token],
                )
              ).rows[0].ok,
            ).toBe(true);
          } finally {
            await db.query("rollback");
          }
        });
        await withClient(async (db) => {
          await db.query("begin");
          try {
            await db.query("set local role authenticated");
            await expect(
              db.query(
                "select * from freeze_analytics_signup($1,$2,true,'eligible')",
                [user, c.hash],
              ),
            ).rejects.toMatchObject({ code: "42501" });
          } finally {
            await db.query("rollback");
          }
        });
      });
      test("unknown confirmation racing a proven callback preserves the first committed absence", async () => {
        const c = await context(),
          user = await account();
        let later: Promise<unknown> | undefined;
        let first: unknown;
        await withClient(async (db) => {
          await db.query("begin");
          await db.query("select pg_advisory_xact_lock(710110)");
          later = freeze(user, c.hash, true);
          first = (
            await db.query(
              "select * from freeze_analytics_signup($1,$2,false,'eligible')",
              [user, c.hash],
            )
          ).rows[0];
          await db.query("commit");
        });
        expect(first).toMatchObject({
          state: "suppressed",
          reason: "initial_confirmation_unproven",
        });
        expect(await later).toEqual(first);
      });
      test("web roles have no table, column or RPC privileges", async () => {
        for (const role of ["anon", "authenticated"]) {
          expect(
            (
              await query(
                "select has_table_privilege($1,'analytics_delivery_events','select') as ok",
                [role],
              )
            ).rows[0].ok,
          ).toBe(false);
          expect(
            (
              await query(
                "select a.attname from pg_attribute a where a.attrelid='analytics_delivery_events'::regclass and a.attnum>0 and not a.attisdropped and has_column_privilege($1,a.attrelid,a.attname,'select')",
                [role],
              )
            ).rows,
          ).toEqual([]);
          expect(
            (
              await query(
                "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('freeze_analytics_signup','claim_analytics_delivery','finalize_analytics_delivery','reconcile_analytics_delivery','analytics_signup_activation') and has_function_privilege($1,p.oid,'execute')",
                [role],
              )
            ).rows,
          ).toEqual([]);
        }
      });
      test("migration baseline survives mutable confirmation timestamps; pending old account can later confirm", async () => {
        const old = await account(),
          pending = await account(false);
        const sql = readFileSync(
          path.join(
            process.cwd(),
            "supabase/migrations/20261012232824_analytics_delivery_outbox.sql",
          ),
          "utf8",
        ).replace(/^BEGIN;\s*|COMMIT;\s*$/g, "");
        await withClient(async (db) => {
          await db.query("begin");
          try {
            await db.query(
              "drop table analytics_delivery_events cascade; drop function freeze_analytics_signup(uuid,text,boolean,text); drop function claim_analytics_delivery(); drop function finalize_analytics_delivery(uuid,uuid,text,text); drop function reconcile_analytics_delivery(integer); drop function analytics_signup_activation();",
            );
            await db.query(sql);
            await db.query(
              "update auth.users set email_confirmed_at=clock_timestamp() where id=$1",
              [old],
            );
            expect(
              (
                await db.query(
                  "select * from freeze_analytics_signup($1,null,true,'eligible')",
                  [old],
                )
              ).rows[0],
            ).toMatchObject({
              state: "suppressed",
              reason: "preexisting_confirmed",
            });
            const hash = createHash("sha256")
              .update(randomUUID())
              .digest("hex");
            await db.query(
              "select capture_analytics_context($1,'1.2','explicit',now()+interval '1 day',false)",
              [hash],
            );
            await db.query(
              "update auth.users set email_confirmed_at=clock_timestamp() where id=$1",
              [pending],
            );
            expect(
              (
                await db.query(
                  "select * from freeze_analytics_signup($1,$2,true,'eligible')",
                  [pending, hash],
                )
              ).rows[0].state,
            ).toBe("pending");
          } finally {
            await db.query("rollback");
          }
        });
      });
    });
  },
);
