/** @jest-environment node */
import { randomUUID, createHash } from "node:crypto";
import { describeDb } from "./db-harness";

describeDb(
  "payment source receipts and frozen commerce delivery",
  ({ query, withClient }) => {
    describe("owned fixtures", () => {
      const users: string[] = [];
      const events: string[] = [];
      async function fixture(processed = true) {
        const user = randomUUID(),
          event = `evt_${randomUUID().replaceAll("-", "")}`;
        users.push(user);
        events.push(event);
        await query("insert into auth.users(id) values($1)", [user]);
        await query(
          "insert into billing_events(user_id,stripe_event_id,event_type,data,processed,created_at) values($1,$2,'payment_intent.succeeded','{}',$3,now()-interval '100 days')",
          [user, event, processed],
        );
        return { user, event };
      }
      async function context(user: string) {
        const hash = createHash("sha256").update(randomUUID()).digest("hex");
        const c = (
          await query(
            "select capture_analytics_context($1,'123.456','explicit',now()+interval '30 days',false) id",
            [hash],
          )
        ).rows[0].id;
        await query("select bind_analytics_context($1,$2)", [hash, user]);
        // Deterministic pre-occurrence evidence; JS millisecond truncation must not
        // accidentally place this fixture after its supposed payment timestamp.
        await query(
          "update analytics_contexts set captured_at=now()-interval '1 second',consent_at=now()-interval '1 second',bound_at=now()-interval '1 second',expires_at=now()+interval '29 days' where id=$1",
          [c],
        );
        return c;
      }
      async function claim() {
        return (await query("select * from claim_analytics_payment_sources(4)"))
          .rows;
      }
      async function claimFor(event: string) {
        const row = (await claim()).find((r) => r.stripe_event_id === event);
        if (!row) throw new Error("expected source claim");
        return row;
      }
      async function finish(
        event: string,
        token: unknown,
        candidates: unknown[],
        state = "complete",
      ) {
        return query(
          "select finish_analytics_payment_source($1,$2,$3,'normalized',$4::jsonb)",
          [event, token, state, JSON.stringify(candidates)],
        );
      }
      const candidate = (
        user: string,
        suffix = randomUUID().replaceAll("-", ""),
      ) => ({
        kind: "purchase",
        source_key: `purchase:live:payment_intent:pi_${suffix}`,
        user_id: user,
        occurred_at: new Date().toISOString(),
        payload: {
          mode: "live",
          value_minor: 1900,
          tax_minor: 0,
          item_id: "pro",
          quantity: 1,
        },
      });
      afterAll(async () => {
        await query(
          "delete from billing_events where stripe_event_id=any($1::text[])",
          [events],
        );
        await query("delete from auth.users where id=any($1::uuid[])", [users]);
      });
      test("discovers late processed sources without an age cutoff and claims once", async () => {
        const f = await fixture(false);
        expect((await claim()).some((r) => r.stripe_event_id === f.event)).toBe(
          false,
        );
        await query(
          "update billing_events set processed=true where stripe_event_id=$1",
          [f.event],
        );
        const found = await claimFor(f.event);
        expect(found).toBeDefined();
        expect((await claim()).some((r) => r.stripe_event_id === f.event)).toBe(
          false,
        );
        await finish(f.event, found.claim_token, []);
      });
      test("freezes latest eligible pre-payment context and deduplicates distinct event sources", async () => {
        const a = await fixture();
        const first = await context(a.user);
        const c = candidate(a.user);
        const claimed = await claimFor(a.event);
        await finish(a.event, claimed.claim_token, [c]);
        await context(a.user);
        expect(
          (
            await query(
              "select context_id,transaction_id,state from analytics_delivery_events where source_key=$1",
              [c.source_key],
            )
          ).rows[0],
        ).toMatchObject({ context_id: first, state: "pending" });
        const before = (
          await query(
            "select transaction_id from analytics_delivery_events where source_key=$1",
            [c.source_key],
          )
        ).rows[0];
        expect(
          (await finish(a.event, claimed.claim_token, [c])).rows[0]
            .finish_analytics_payment_source,
        ).toBe(false);
        expect(
          (
            await query(
              "select transaction_id from analytics_delivery_events where source_key=$1",
              [c.source_key],
            )
          ).rows[0],
        ).toEqual(before);
      });
      test("absent disposition cannot acquire later consent", async () => {
        const a = await fixture();
        const c = candidate(a.user);
        const claimed = await claimFor(a.event);
        await finish(a.event, claimed.claim_token, [c]);
        await context(a.user);
        expect(
          (
            await query(
              "select state,context_id from analytics_delivery_events where source_key=$1",
              [c.source_key],
            )
          ).rows[0],
        ).toEqual({ state: "suppressed", context_id: null });
      });
      test("retry normalization claims expire safely but no outbox send is reset", async () => {
        const f = await fixture();
        const a = await claimFor(f.event);
        await query(
          "update analytics_delivery_sources set claimed_at=now()-interval '6 minutes' where stripe_event_id=$1",
          [f.event],
        );
        const b = await claimFor(f.event);
        expect(b.claim_token).not.toBe(a.claim_token);
        expect(
          (await finish(f.event, a.claim_token, [])).rows[0]
            .finish_analytics_payment_source,
        ).toBe(false);
        await finish(f.event, b.claim_token, []);
      });
      test.each(["anon", "authenticated"])(
        "%s has no effective source table or RPC privileges",
        async (role) => {
          expect(
            (
              await query(
                "select has_table_privilege($1,'analytics_delivery_sources','SELECT') s,has_function_privilege($1,'claim_analytics_payment_sources(integer)','EXECUTE') e",
                [role],
              )
            ).rows[0],
          ).toEqual({ s: false, e: false });
        },
      );
      test("two concurrent claimants cannot both own one source", async () => {
        const f = await fixture();
        const both = await Promise.all([
          withClient((c) =>
            c.query("select * from claim_analytics_payment_sources(4)"),
          ),
          withClient((c) =>
            c.query("select * from claim_analytics_payment_sources(4)"),
          ),
        ]);
        expect(
          both
            .flatMap((r) => r.rows)
            .filter((r) => r.stripe_event_id === f.event),
        ).toHaveLength(1);
      });

      test.each(["pending", "accepted_http", "uncertain"])(
        "automatic return preserves %s parent semantics and frozen context",
        async (parentState) => {
          const f = await fixture();
          const ctx = await context(f.user);
          const p = candidate(f.user);
          const source = await claimFor(f.event);
          await finish(f.event, source.claim_token, [p]);
          const parent = (
            await query(
              "select id,transaction_id from analytics_delivery_events where source_key=$1",
              [p.source_key],
            )
          ).rows[0];
          if (parentState !== "pending")
            await query(
              "update analytics_delivery_events set state=$2,reason=$3,payload=null where id=$1",
              [
                parent.id,
                parentState,
                parentState === "accepted_http"
                  ? "http_2xx"
                  : "transport_error",
              ],
            );
          const refundEvent = `evt_${randomUUID().replaceAll("-", "")}`;
          events.push(refundEvent);
          await query(
            "insert into billing_events(user_id,stripe_event_id,event_type,data,processed) values($1,$2,'charge.refunded','{}',true)",
            [f.user, refundEvent],
          );
          const second = await claimFor(refundEvent);
          const refund = {
            ...p,
            kind: "refund",
            source_key: `refund:live:re_${randomUUID().replaceAll("-", "")}:${p.source_key.replace("purchase:live:", "")}`,
            parent_source_key: p.source_key,
            only_existing_parent: true,
            occurred_at: new Date().toISOString(),
          };
          await finish(refundEvent, second.claim_token, [
            { ...p, kind: "exclude_purchase" },
            refund,
          ]);
          const row = (
            await query(
              "select state,reason,context_id,transaction_id from analytics_delivery_events where source_key=$1",
              [refund.source_key],
            )
          ).rows[0];
          expect(row.transaction_id).toBe(parent.transaction_id);
          if (parentState === "pending")
            expect(row).toMatchObject({
              state: "suppressed",
              reason: "purchase_unsent",
            });
          else
            expect(row).toMatchObject({
              state: "pending",
              context_id: ctx,
              reason:
                parentState === "uncertain"
                  ? "reconciliation_required"
                  : "eligible",
            });
          expect(
            (
              await query(
                "select state from analytics_delivery_events where id=$1",
                [parent.id],
              )
            ).rows[0].state,
          ).toBe(parentState === "pending" ? "suppressed" : parentState);
        },
      );
      test("day-14 attribution works without session data; late grant and expired context cannot rescue source", async () => {
        const f = await fixture();
        const ctx = await context(f.user);
        await query(
          "update analytics_contexts set captured_at=now()-interval '14 days',bound_at=now()-interval '14 days',consent_at=now()-interval '14 days',expires_at=now()+interval '16 days' where id=$1",
          [ctx],
        );
        const c = candidate(f.user);
        const source = await claimFor(f.event);
        await finish(f.event, source.claim_token, [c]);
        expect(
          (
            await query(
              "select state,context_id from analytics_delivery_events where source_key=$1",
              [c.source_key],
            )
          ).rows[0],
        ).toEqual({ state: "pending", context_id: ctx });
        await query("select revoke_analytics_context(null,$1)", [f.user]);
        await context(f.user);
        await query("select reconcile_analytics_delivery(100)");
        expect(
          (
            await query(
              "select state from analytics_delivery_events where source_key=$1",
              [c.source_key],
            )
          ).rows[0].state,
        ).toBe("suppressed");
      });
      test("source table RLS and service RPC execute are effective under actual role", async () => {
        const f = await fixture();
        await withClient(async (client) => {
          await client.query("begin");
          try {
            await client.query("set local role service_role");
            const r = await client.query(
              "select * from claim_analytics_payment_sources(4)",
            );
            expect(r.rows.some((row) => row.stripe_event_id === f.event)).toBe(
              true,
            );
          } finally {
            await client.query("rollback");
          }
        });
      });

      test.each([
        "mode",
        "value_minor",
        "tax_minor",
        "item_id",
        "quantity",
        "customer_type",
      ])("JSON null %s cannot bypass commerce constraints", async (key) => {
        const payload = {
          mode: "live",
          value_minor: 1900,
          tax_minor: 0,
          item_id: "pro",
          quantity: 1,
          [key]: null,
        };
        expect(
          (
            await query(
              "select valid_analytics_commerce_payload($1::jsonb) valid",
              [JSON.stringify(payload)],
            )
          ).rows[0].valid,
        ).toBe(false);
      });

      test("fair batches include both a due retry and fresh source", async () => {
        const retry = await fixture();
        const fresh = await fixture();
        await query(
          "insert into analytics_delivery_sources(stripe_event_id,user_id,state,reason,next_attempt_at) values($1,$2,'pending','provider_read_failed',now()-interval '1 day')",
          [retry.event, retry.user],
        );
        const rows = await claim();
        expect(rows.some((r) => r.stripe_event_id === retry.event)).toBe(true);
        expect(rows.some((r) => r.stripe_event_id === fresh.event)).toBe(true);
      });
      test("account deletion removes source/dedupe records without later recreation", async () => {
        const f = await fixture();
        await context(f.user);
        const c = candidate(f.user);
        const owned = await claimFor(f.event);
        await finish(f.event, owned.claim_token, [c]);
        await query("delete from auth.users where id=$1", [f.user]);
        expect(
          (
            await query(
              "select count(*) n from analytics_delivery_sources where stripe_event_id=$1",
              [f.event],
            )
          ).rows[0].n,
        ).toBe("0");
        expect(
          (
            await query(
              "select count(*) n from analytics_delivery_events where source_key=$1",
              [c.source_key],
            )
          ).rows[0].n,
        ).toBe("0");
        expect((await claim()).some((r) => r.stripe_event_id === f.event)).toBe(
          false,
        );
      });
      test("expired context cannot be replaced by a post-payment grant", async () => {
        const f = await fixture();
        const old = await context(f.user);
        await query(
          "update analytics_contexts set captured_at=now()-interval '31 days',consent_at=now()-interval '31 days',bound_at=now()-interval '31 days',expires_at=now()-interval '1 day' where id=$1",
          [old],
        );
        const c = candidate(f.user);
        const owned = await claimFor(f.event);
        await finish(f.event, owned.claim_token, [c]);
        await context(f.user);
        expect(
          (
            await query(
              "select state,context_id from analytics_delivery_events where source_key=$1",
              [c.source_key],
            )
          ).rows[0],
        ).toEqual({ state: "suppressed", context_id: null });
      });
      test("all payment-only functions keep effective execute private", async () => {
        for (const role of ["anon", "authenticated"])
          for (const signature of [
            "valid_analytics_commerce_payload(jsonb)",
            "finish_analytics_payment_source(text,uuid,text,text,jsonb)",
            "analytics_payment_history(uuid,integer)",
            "analytics_payment_diagnostics()",
            "claim_analytics_delivery_version(boolean)",
          ]) {
            expect(
              (
                await query(
                  "select has_function_privilege($1,$2,'EXECUTE') allowed",
                  [role, signature],
                )
              ).rows[0].allowed,
            ).toBe(false);
          }
        expect(
          (
            await query(
              "select relrowsecurity enabled from pg_class where oid='analytics_delivery_sources'::regclass",
            )
          ).rows[0].enabled,
        ).toBe(true);
      });

      test("legacy signup workers cannot claim commerce while v2 workers can", async () => {
        await query(
          "update analytics_delivery_events set state='suppressed',reason='context_unavailable',payload=null where state='pending'",
        );
        const f = await fixture();
        await context(f.user);
        const c = candidate(f.user);
        const owned = await claimFor(f.event);
        await finish(f.event, owned.claim_token, [c]);
        expect(
          (await query("select * from claim_analytics_delivery()")).rows,
        ).toEqual([]);
        expect(
          (await query("select * from claim_analytics_delivery_v2()")).rows[0],
        ).toMatchObject({ kind: "purchase" });
        for (const role of ["anon", "authenticated"])
          expect(
            (
              await query(
                "select has_function_privilege($1,'claim_analytics_delivery_v2()','EXECUTE') allowed",
                [role],
              )
            ).rows[0].allowed,
          ).toBe(false);
      });

      test("current paid references exclude trial-only access and revoked grants", async () => {
        const f = await fixture(),
          customer = randomUUID(),
          subscription = randomUUID();
        await query(
          "insert into billing_customers(id,user_id,email) values($1,$2,'fixture@example.invalid')",
          [customer, f.user],
        );
        await query(
          "insert into billing_subscriptions(id,user_id,customer_id,plan,status) values($1,$2,$3,'pro','trialing')",
          [subscription, f.user, customer],
        );
        await query(
          "insert into billing_invoices(customer_id,subscription_id,stripe_invoice_id,amount_paid,amount_due,status) values($1,$2,$3,1900,0,'paid')",
          [customer, subscription, `in_${customer.replaceAll("-", "")}`],
        );
        const snapshot = async () =>
          (
            await query("select analytics_payment_history($1,25) data", [
              f.user,
            ])
          ).rows[0].data as { current_paid_reference_keys: string[] };
        try {
          expect((await snapshot()).current_paid_reference_keys).toEqual([]);
          await query(
            "update billing_subscriptions set status='active' where id=$1",
            [subscription],
          );
          expect((await snapshot()).current_paid_reference_keys).toHaveLength(
            1,
          );
          const grant = (
            await query(
              "insert into plan_entitlements(user_id,plan_id,source,stripe_payment_intent_id) values($1,'pro','lifetime_purchase',$2) returning id",
              [f.user, `pi_${customer.replaceAll("-", "")}`],
            )
          ).rows[0].id;
          expect((await snapshot()).current_paid_reference_keys).toHaveLength(
            2,
          );
          await query(
            "update plan_entitlements set revoked_at=now() where id=$1",
            [grant],
          );
          expect((await snapshot()).current_paid_reference_keys).toHaveLength(
            1,
          );
        } finally {
          await query("delete from billing_invoices where customer_id=$1", [
            customer,
          ]);
          await query("delete from billing_subscriptions where id=$1", [
            subscription,
          ]);
          await query("delete from billing_customers where id=$1", [customer]);
        }
      });

      test("automatic exclusion before stale purchase completion persists a canonical tombstone", async () => {
        const f = await fixture();
        await context(f.user);
        const stale = await claimFor(f.event);
        const p = candidate(f.user);
        const refundEvent = `evt_${randomUUID().replaceAll("-", "")}`;
        events.push(refundEvent);
        await query(
          "insert into billing_events(user_id,stripe_event_id,event_type,data,processed) values($1,$2,'charge.refunded','{}',true)",
          [f.user, refundEvent],
        );
        const exclusion = await claimFor(refundEvent);
        await finish(refundEvent, exclusion.claim_token, [
          { ...p, kind: "exclude_purchase" },
        ]);
        await finish(f.event, stale.claim_token, [p]);
        const rows = (
          await query(
            "select state,reason,context_id,frozen_context_id from analytics_delivery_events where source_key=$1",
            [p.source_key],
          )
        ).rows;
        expect(rows).toEqual([
          {
            state: "suppressed",
            reason: "purchase_unsent",
            context_id: null,
            frozen_context_id: null,
          },
        ]);
      });
      test("an exclusion cannot silently collide with another account's canonical purchase", async () => {
        const owner = await fixture();
        const p = candidate(owner.user);
        const a = await claimFor(owner.event);
        await finish(owner.event, a.claim_token, [p]);
        const other = await fixture();
        const b = await claimFor(other.event);
        await expect(
          finish(other.event, b.claim_token, [
            { ...p, kind: "exclude_purchase", user_id: other.user },
          ]),
        ).rejects.toMatchObject({ code: "22023" });
      });
      test("an automatic exclusion never recalls an already claimed sending purchase", async () => {
        const f = await fixture();
        await context(f.user);
        const p = candidate(f.user);
        const a = await claimFor(f.event);
        await finish(f.event, a.claim_token, [p]);
        await query(
          "update analytics_delivery_events set state='sending',claim_token=gen_random_uuid(),claimed_at=now() where source_key=$1",
          [p.source_key],
        );
        const event = `evt_${randomUUID().replaceAll("-", "")}`;
        events.push(event);
        await query(
          "insert into billing_events(user_id,stripe_event_id,event_type,data,processed) values($1,$2,'charge.refunded','{}',true)",
          [f.user, event],
        );
        const b = await claimFor(event);
        await finish(event, b.claim_token, [
          { ...p, kind: "exclude_purchase" },
        ]);
        expect(
          (
            await query(
              "select state,payload is not null as has_payload,claim_token is not null as has_token from analytics_delivery_events where source_key=$1",
              [p.source_key],
            )
          ).rows[0],
        ).toEqual({ state: "sending", has_payload: true, has_token: true });
      });
    });
  },
);
