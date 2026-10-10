/**
 * s62 — a public payload revision changes in the same transaction as every
 * content_elements mutation that can affect a cache generation.
 *
 * These are real PostgreSQL tests because statement transition tables, trigger
 * event ordering, row locks, cascades and rollback cannot be represented by a
 * Supabase mock without merely restating the implementation.
 */
import { randomUUID } from "node:crypto";
import { describeDb, type QueryResult } from "./db-harness";

type Query = <R = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<QueryResult<R>>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function revisionOf(query: Query, siteId: string): Promise<string> {
  const { rows } = await query<{ revision: string }>(
    `SELECT public_content_revision::text AS revision
       FROM public.sites
      WHERE id = $1`,
    [siteId],
  );
  return rows[0]?.revision;
}

async function insertElement(
  query: Query,
  siteId: string,
  elementId = `element-${randomUUID()}`,
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO public.content_elements (
       site_id, element_id, selector, original_content, current_content,
       published_content, language, variant, metadata
     ) VALUES ($1, $2, $3, 'Original', 'Original', 'Original', 'en', 'default', '{}'::jsonb)
     RETURNING id`,
    [siteId, elementId, `[data-element-id="${elementId}"]`],
  );
  return rows[0].id;
}

function expectRotated(before: string, after: string): void {
  expect(before).toMatch(UUID_PATTERN);
  expect(after).toMatch(UUID_PATTERN);
  expect(after).not.toBe(before);
}

describeDb(
  "s62 transactional public-content revision",
  ({ query, withClient, createSite }) => {
    test("new and existing sites carry a UUID revision", async () => {
      const siteId = await createSite("revision-default");

      expect(await revisionOf(query, siteId)).toMatch(UUID_PATTERN);
      const { rows } = await query<{ nullable: string }>(`
        SELECT is_nullable AS nullable
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'sites'
           AND column_name = 'public_content_revision'
      `);
      expect(rows).toEqual([{ nullable: "NO" }]);
    });

    test("revision functions are invoker-safe, fixed-path and not web-callable", async () => {
      const signatures = [
        "public.rotate_public_content_revisions(uuid[])",
        "public.rotate_public_content_revision_after_insert()",
        "public.rotate_public_content_revision_after_update()",
        "public.rotate_public_content_revision_after_delete()",
        "public.rotate_public_content_revision_after_truncate()",
      ];

      for (const signature of signatures) {
        const { rows } = await query<{
          is_definer: boolean;
          config: string[];
          anon_execute: boolean;
          authenticated_execute: boolean;
        }>(
          `SELECT p.prosecdef AS is_definer,
                  COALESCE(p.proconfig, ARRAY[]::text[]) AS config,
                  has_function_privilege('anon', $1, 'EXECUTE') AS anon_execute,
                  has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated_execute
             FROM pg_proc p
            WHERE p.oid = $1::regprocedure`,
          [signature],
        );

        expect(rows[0]).toMatchObject({
          is_definer: false,
          anon_execute: false,
          authenticated_execute: false,
        });
        expect(rows[0].config).toContain("search_path=public, pg_temp");
      }
    });

    test("insert, conservative update and delete each rotate in their transaction", async () => {
      const siteId = await createSite("all-dml");
      const beforeInsert = await revisionOf(query, siteId);
      const { rows: beforeTimestampRows } = await query<{
        updated_at: Date;
      }>("SELECT updated_at FROM public.sites WHERE id = $1", [siteId]);
      const elementId = await insertElement(query, siteId);
      const afterInsert = await revisionOf(query, siteId);
      expectRotated(beforeInsert, afterInsert);
      expect(beforeTimestampRows[0].updated_at).toBeInstanceOf(Date);

      await query("SELECT pg_sleep(0.01)");

      await query(
        `UPDATE public.content_elements
            SET staging_content = staging_content
          WHERE id = $1`,
        [elementId],
      );
      const afterNoOpDraftUpdate = await revisionOf(query, siteId);
      expectRotated(afterInsert, afterNoOpDraftUpdate);
      const { rows: afterTimestampRows } = await query<{ updated_at: Date }>(
        "SELECT updated_at FROM public.sites WHERE id = $1",
        [siteId],
      );
      expect(afterTimestampRows[0].updated_at.getTime()).toBeGreaterThan(
        beforeTimestampRows[0].updated_at.getTime(),
      );

      await query("DELETE FROM public.content_elements WHERE id = $1", [
        elementId,
      ]);
      expectRotated(afterNoOpDraftUpdate, await revisionOf(query, siteId));
    });

    test("one multi-row statement touches each affected site once per event", async () => {
      await withClient(async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(`
            CREATE TABLE public.rcf_s62_revision_audit (
              site_id UUID NOT NULL,
              recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE FUNCTION public.rcf_s62_capture_revision_change()
            RETURNS TRIGGER
            LANGUAGE plpgsql
            AS $$
            BEGIN
              IF OLD.public_content_revision IS DISTINCT FROM NEW.public_content_revision THEN
                INSERT INTO public.rcf_s62_revision_audit(site_id) VALUES (NEW.id);
              END IF;
              RETURN NEW;
            END;
            $$;
            CREATE TRIGGER rcf_s62_capture_revision_change
            AFTER UPDATE ON public.sites
            FOR EACH ROW
            EXECUTE FUNCTION public.rcf_s62_capture_revision_change();
          `);
          const { rows: sites } = await client.query<{ id: string }>(`
            INSERT INTO public.sites(domain, name) VALUES
              ('rcf-s62-once-a.invalid', 'Once A'),
              ('rcf-s62-once-b.invalid', 'Once B')
            RETURNING id
          `);
          const [firstSite, secondSite] = sites;

          await client.query(
            `INSERT INTO public.content_elements (
               site_id, element_id, selector, original_content, current_content,
               published_content, language, variant, metadata
             ) VALUES
               ($1, $3, 'p', 'A', 'A', 'A', 'en', 'default', '{}'::jsonb),
               ($1, $4, 'p', 'A2', 'A2', 'A2', 'en', 'default', '{}'::jsonb),
               ($2, $5, 'p', 'B', 'B', 'B', 'en', 'default', '{}'::jsonb)`,
            [
              firstSite.id,
              secondSite.id,
              `once-a1-${randomUUID()}`,
              `once-a2-${randomUUID()}`,
              `once-b-${randomUUID()}`,
            ],
          );

          const { rows: counts } = await client.query<{
            site_id: string;
            touches: number;
          }>(`
            SELECT site_id, count(*)::int AS touches
            FROM public.rcf_s62_revision_audit
            GROUP BY site_id
            ORDER BY site_id
          `);
          expect(counts).toEqual(
            [firstSite.id, secondSite.id]
              .sort()
              .map((site_id) => ({ site_id, touches: 1 })),
          );
        } finally {
          await client.query("ROLLBACK");
        }
      });
    });

    test("an empty statement rotates no site", async () => {
      const siteId = await createSite("empty-update");
      const before = await revisionOf(query, siteId);

      await query(
        "UPDATE public.content_elements SET updated_at = updated_at WHERE false",
      );

      expect(await revisionOf(query, siteId)).toBe(before);
    });

    test("moving a row rotates both its old and new site revisions", async () => {
      const oldSiteId = await createSite("move-old");
      const newSiteId = await createSite("move-new");
      const elementId = await insertElement(query, oldSiteId);
      const oldBefore = await revisionOf(query, oldSiteId);
      const newBefore = await revisionOf(query, newSiteId);

      await query(
        "UPDATE public.content_elements SET site_id = $1 WHERE id = $2",
        [newSiteId, elementId],
      );

      expectRotated(oldBefore, await revisionOf(query, oldSiteId));
      expectRotated(newBefore, await revisionOf(query, newSiteId));
    });

    test("a rolled-back mutation rolls back its revision", async () => {
      const siteId = await createSite("rollback");
      const before = await revisionOf(query, siteId);

      await withClient(async (client) => {
        await client.query("BEGIN");
        try {
          await insertElement(client.query.bind(client), siteId);
          expect(await revisionOf(client.query.bind(client), siteId)).not.toBe(
            before,
          );
        } finally {
          await client.query("ROLLBACK");
        }
      });

      expect(await revisionOf(query, siteId)).toBe(before);
    });

    test("an upsert conflict rotates and leaves one current generation", async () => {
      const siteId = await createSite("upsert");
      const elementId = `upsert-${randomUUID()}`;
      await insertElement(query, siteId, elementId);
      const before = await revisionOf(query, siteId);

      await query(
        `INSERT INTO public.content_elements (
           site_id, element_id, selector, original_content, current_content,
           published_content, language, variant, metadata
         ) VALUES ($1, $2, 'p', 'Original', 'Changed', 'Changed', 'en', 'default', '{}'::jsonb)
         ON CONFLICT (site_id, element_id, language, variant)
         DO UPDATE SET published_content = EXCLUDED.published_content,
                       current_content = EXCLUDED.current_content`,
        [siteId, elementId],
      );

      expectRotated(before, await revisionOf(query, siteId));
    });

    test("a site deletion cascade does not recreate the site or fail cleanup", async () => {
      const siteId = await createSite("cascade");
      await insertElement(query, siteId);

      await query("DELETE FROM public.sites WHERE id = $1", [siteId]);

      const { rows } = await query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.sites WHERE id = $1",
        [siteId],
      );
      expect(rows).toEqual([{ count: "0" }]);
    });

    test("truncate rotates every remaining site without recreating content", async () => {
      const firstSiteId = await createSite("truncate-a");
      const secondSiteId = await createSite("truncate-b");
      await insertElement(query, firstSiteId);
      await insertElement(query, secondSiteId);
      const firstBefore = await revisionOf(query, firstSiteId);
      const secondBefore = await revisionOf(query, secondSiteId);

      await query("TRUNCATE TABLE public.content_elements CASCADE");

      expectRotated(firstBefore, await revisionOf(query, firstSiteId));
      expectRotated(secondBefore, await revisionOf(query, secondSiteId));
      const { rows } = await query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.content_elements",
      );
      expect(rows).toEqual([{ count: "0" }]);
    });

    test("opposite-order two-site statements converge after ordered lock contention", async () => {
      const firstSiteId = await createSite("ordered-a");
      const secondSiteId = await createSite("ordered-b");
      const firstBefore = await revisionOf(query, firstSiteId);
      const secondBefore = await revisionOf(query, secondSiteId);

      await withClient(async (first) => {
        await withClient(async (second) => {
          await first.query("BEGIN");
          await second.query("BEGIN");
          try {
            await first.query(
              `INSERT INTO public.content_elements (
                 site_id, element_id, selector, original_content, current_content,
                 published_content, language, variant, metadata
               ) VALUES
                 ($1, $3, 'p', 'A', 'A', 'A', 'en', 'default', '{}'::jsonb),
                 ($2, $4, 'p', 'B', 'B', 'B', 'en', 'default', '{}'::jsonb)`,
              [
                firstSiteId,
                secondSiteId,
                `first-a-${randomUUID()}`,
                `first-b-${randomUUID()}`,
              ],
            );

            let secondSettled = false;
            const secondInsert = second
              .query(
                `INSERT INTO public.content_elements (
                   site_id, element_id, selector, original_content, current_content,
                   published_content, language, variant, metadata
                 ) VALUES
                   ($2, $3, 'p', 'B2', 'B2', 'B2', 'en', 'default', '{}'::jsonb),
                   ($1, $4, 'p', 'A2', 'A2', 'A2', 'en', 'default', '{}'::jsonb)`,
                [
                  firstSiteId,
                  secondSiteId,
                  `second-b-${randomUUID()}`,
                  `second-a-${randomUUID()}`,
                ],
              )
              .then(() => {
                secondSettled = true;
              });

            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(secondSettled).toBe(false);
            await first.query("COMMIT");
            await secondInsert;
            await second.query("COMMIT");
          } catch (error) {
            await first.query("ROLLBACK").catch(() => undefined);
            await second.query("ROLLBACK").catch(() => undefined);
            throw error;
          }
        });
      });

      expectRotated(firstBefore, await revisionOf(query, firstSiteId));
      expectRotated(secondBefore, await revisionOf(query, secondSiteId));
    });

    test("a liveness-style sites update serializes with revision rotation", async () => {
      const siteId = await createSite("liveness-contention");
      const elementId = await insertElement(query, siteId);
      const before = await revisionOf(query, siteId);

      await withClient(async (liveness) => {
        await withClient(async (content) => {
          await liveness.query("BEGIN");
          await content.query("BEGIN");
          try {
            await liveness.query(
              "UPDATE public.sites SET last_reported_at = now() WHERE id = $1",
              [siteId],
            );

            let contentSettled = false;
            const contentUpdate = content
              .query(
                `UPDATE public.content_elements
                    SET staging_content = 'draft'
                  WHERE id = $1`,
                [elementId],
              )
              .then(() => {
                contentSettled = true;
              });

            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(contentSettled).toBe(false);
            await liveness.query("COMMIT");
            await contentUpdate;
            await content.query("COMMIT");
          } catch (error) {
            await liveness.query("ROLLBACK").catch(() => undefined);
            await content.query("ROLLBACK").catch(() => undefined);
            throw error;
          }
        });
      });

      expectRotated(before, await revisionOf(query, siteId));
    });
  },
);
