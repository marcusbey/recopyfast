/** @jest-environment node */
import { describeDb } from "./db-harness";

/**
 * s122: `site_install_emails` is the idempotency key for the owner's one
 * "Install detected" email. The primary key on `site_id` is what makes two
 * concurrent claims produce one send; no web principal may read it or plant a
 * row that would suppress a send; it goes with the site.
 */
describeDb(
  "site_install_emails ledger",
  ({ query, withClient, createSite }) => {
    const claim =
      "insert into public.site_install_emails(site_id,status) values ($1,'pending') on conflict (site_id) do nothing returning site_id";

    test.each(["anon", "authenticated"])(
      "%s holds no privilege and is refused by PostgreSQL",
      async (role) => {
        const { rows } = await query<{ ok: boolean }>(
          "select has_table_privilege($1,'public.site_install_emails','SELECT') or has_table_privilege($1,'public.site_install_emails','INSERT') or has_table_privilege($1,'public.site_install_emails','UPDATE') or has_table_privilege($1,'public.site_install_emails','DELETE') as ok",
          [role],
        );
        expect(rows[0].ok).toBe(false);
        await withClient(async (c) => {
          await c.query("begin");
          try {
            await c.query(`set local role ${role}`);
            await expect(
              c.query("select * from public.site_install_emails"),
            ).rejects.toMatchObject({ code: "42501" });
          } finally {
            await c.query("rollback");
          }
        });
      },
    );

    test("RLS is enabled", async () => {
      const { rows } = await query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where oid='public.site_install_emails'::regclass",
      );
      expect(rows[0].relrowsecurity).toBe(true);
    });

    test("concurrent claims for one site: exactly one wins", async () => {
      const siteId = await createSite("install-email-race");
      const results = await Promise.all(
        Array.from({ length: 6 }, () => query(claim, [siteId])),
      );
      expect(results.filter((r) => r.rowCount === 1)).toHaveLength(1);
      const { rows } = await query(
        "select 1 from public.site_install_emails where site_id=$1",
        [siteId],
      );
      expect(rows).toHaveLength(1);
    });

    test("a failed row still blocks a second claim", async () => {
      const siteId = await createSite("install-email-failed");
      await query(claim, [siteId]);
      await query(
        "update public.site_install_emails set status='failed', error_code='provider_rejected' where site_id=$1 and status='pending'",
        [siteId],
      );
      const again = await query(claim, [siteId]);
      expect(again.rowCount).toBe(0);
    });

    test("state and error code are constrained", async () => {
      const siteId = await createSite("install-email-check");
      await query(claim, [siteId]);
      // sent without sent_at
      await expect(
        query(
          "update public.site_install_emails set status='sent' where site_id=$1",
          [siteId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      // an error code that could carry an address
      await expect(
        query(
          "update public.site_install_emails set status='failed', error_code='owner@example.test' where site_id=$1",
          [siteId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    test("cascades with the site", async () => {
      const siteId = await createSite("install-email-cascade");
      await query(claim, [siteId]);
      await query("delete from public.sites where id=$1", [siteId]);
      const { rows } = await query(
        "select 1 from public.site_install_emails where site_id=$1",
        [siteId],
      );
      expect(rows).toHaveLength(0);
    });
  },
);
