/**
 * A-35 — deleting a site that holds content must succeed.
 *
 * `content_change_trigger` was declared AFTER INSERT OR UPDATE OR DELETE on
 * `content_elements` (20250817000000_complete_database_setup.sql:542-544), and its
 * DELETE branch inserts into `content_history`, whose FK requires the
 * `content_elements` row to still exist (`:44`, ON DELETE CASCADE). AFTER DELETE
 * means it does not, so every content element delete raised
 *
 *   ERROR: insert or update on table "content_history" violates foreign key
 *          constraint "content_history_content_element_id_fkey"
 *   CONTEXT: PL/pgSQL function log_content_change() line 10
 *
 * and `content_elements.site_id`'s ON DELETE CASCADE from `sites` (`:28`)
 * inherited it. No customer could delete a site they had actually used — which is
 * every site with a widget on it, since installing the widget is what creates the
 * rows. A site with *no* content elements deleted cleanly, which is why this file
 * seeds content: an empty site passed even before the fix.
 *
 * 20260809130000_content_history_definer_and_delete_split.sql splits the trigger
 * by timing — AFTER INSERT OR UPDATE, plus a separate BEFORE DELETE — so the
 * history insert happens while the parent row is still there.
 *
 * WHAT THE END STATE ACTUALLY IS, AND WHY IT IS ASSERTED THAT WAY
 * --------------------------------------------------------------
 * The delete-branch history row is written and then removed by the very cascade
 * that triggered it, inside the same statement: `content_history` rows follow
 * their `content_elements` parent. So a successful site delete leaves NO history
 * behind, and the delete row is unobservable from outside the transaction by
 * design. Asserting that it survives would be asserting something this schema
 * does not do.
 *
 * That leaves the delete branch provable only structurally, so it is pinned both
 * ways: the catalogue check below fixes the trigger's timing and events, and the
 * behavioural check fixes the outcome that timing buys — a delete that completes
 * instead of raising 23503.
 */

import { describeDb, type QueryResult } from "./db-harness";

interface PgClient {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

interface TriggerRow {
  trigger_name: string;
  action_timing: string;
  event_manipulation: string;
}

describeDb("deleting a site with content (A-35)", (db) => {
  const { query, withClient, createSite } = db;
  /** A site with one content element, i.e. the case that used to be undeletable. */
  async function seedSiteWithContent(label: string): Promise<{
    siteId: string;
    elementId: string;
  }> {
    const siteId = await createSite(label);
    const { rows } = await query<{ id: string }>(
      `INSERT INTO content_elements
         (site_id, element_id, selector, original_content, current_content)
       VALUES ($1, 'rcf-a35-headline', 'h1', 'Before', 'Before')
       RETURNING id`,
      [siteId],
    );
    return { siteId, elementId: rows[0].id };
  }

  async function countHistory(elementId: string): Promise<number> {
    const { rows } = await query<{ count: string }>(
      "SELECT count(*)::text AS count FROM content_history WHERE content_element_id = $1",
      [elementId],
    );
    return Number(rows[0].count);
  }

  async function waitForLock(
    backendPid: number,
    blockerPid: number,
  ): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const { rows } = await query<{
        wait_event_type: string | null;
        blocking_pids: number[];
      }>(
        `SELECT wait_event_type, pg_blocking_pids(pid) AS blocking_pids
           FROM pg_stat_activity
          WHERE pid = $1`,
        [backendPid],
      );
      if (
        rows[0]?.wait_event_type === "Lock" &&
        rows[0].blocking_pids.includes(blockerPid)
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(
      `Timed out waiting for PostgreSQL backend ${backendPid} to block behind editor ${blockerPid}`,
    );
  }

  async function rollbackIfOpen(client: PgClient): Promise<void> {
    await client.query("ROLLBACK").catch(() => undefined);
  }

  // Guard for everything below: proves the seed reached the database and that the
  // INSERT branch of the trigger fired. Without it, a delete that "succeeded"
  // because nothing was ever inserted would read as A-35 fixed.
  test("guard: the seeded element exists and its create was logged", async () => {
    const { elementId } = await seedSiteWithContent("delete-guard");

    const { rows } = await query<{ change_type: string }>(
      "SELECT change_type FROM content_history WHERE content_element_id = $1",
      [elementId],
    );

    expect(rows.map((row) => row.change_type)).toEqual(["create"]);
  });

  test("the trigger is split by timing, so the DELETE branch runs BEFORE the row goes", async () => {
    const { rows } = await query<TriggerRow>(`
      SELECT trigger_name, action_timing, event_manipulation
      FROM information_schema.triggers
      WHERE event_object_table = 'content_elements'
        AND action_statement ILIKE '%log_content_change%'
      ORDER BY event_manipulation, trigger_name
    `);

    // One row per event, so the AFTER trigger appears twice. DELETE must be
    // BEFORE — that is the entire fix — and INSERT/UPDATE must stay AFTER, where
    // they record the row as committed rather than as proposed.
    expect(rows).toEqual([
      {
        trigger_name: "content_change_delete_trigger",
        action_timing: "BEFORE",
        event_manipulation: "DELETE",
      },
      {
        trigger_name: "content_change_trigger",
        action_timing: "AFTER",
        event_manipulation: "INSERT",
      },
      {
        trigger_name: "content_change_trigger",
        action_timing: "AFTER",
        event_manipulation: "UPDATE",
      },
    ]);
  });

  test("DELETE FROM sites succeeds and takes the whole tree with it", async () => {
    const { siteId, elementId } = await seedSiteWithContent("delete-cascade");
    expect(await countHistory(elementId)).toBe(1);

    // The statement the product issues (src/app/api/sites/[siteId]/route.ts).
    // Before the fix this raised 23503 from inside log_content_change().
    const deleted = await query("DELETE FROM sites WHERE id = $1", [siteId]);
    expect(deleted.rowCount).toBe(1);

    const { rows: survivors } = await query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM content_elements WHERE site_id = $1`,
      [siteId],
    );
    expect(Number(survivors[0].count)).toBe(0);

    // Zero, not one. The BEFORE DELETE trigger did insert a 'delete' row, and
    // ON DELETE CASCADE then removed it along with the 'create' row seeded above
    // — see the header. This asserts the cascade is complete rather than that the
    // audit trail survives, because in this schema it cannot.
    expect(await countHistory(elementId)).toBe(0);
  });

  test("a product-shaped site delete waits for an in-flight draft write and both complete without deadlock", async () => {
    const { siteId, elementId } = await seedSiteWithContent(
      "delete-draft-overlap",
    );

    await withClient(async (editor) => {
      await withClient(async (deleter) => {
        let editorOpen = false;
        let deleterOpen = false;
        let deleteAttempt:
          | Promise<
              | { ok: true; rowCount: number | null }
              | { ok: false; error: unknown }
            >
          | undefined;

        try {
          await editor.query("BEGIN");
          editorOpen = true;
          await deleter.query("BEGIN");
          deleterOpen = true;
          await editor.query("SET LOCAL lock_timeout = '5s'");
          await editor.query("SET LOCAL statement_timeout = '10s'");
          await editor.query("SET LOCAL deadlock_timeout = '100ms'");
          await deleter.query("SET LOCAL lock_timeout = '5s'");
          await deleter.query("SET LOCAL statement_timeout = '10s'");
          await deleter.query("SET LOCAL deadlock_timeout = '100ms'");

          // save_staging_content_atomic begins with this exact row lock. Hold
          // it long enough to place the product's one-statement site delete
          // behind the cascade, then observe that lock wait in PostgreSQL
          // before allowing the draft update to proceed. The s62 revision
          // trigger used to make that update ask for the already-held site
          // row, completing a deterministic child -> parent / parent -> child
          // cycle and raising 40P01.
          await editor.query(
            "SELECT id FROM public.content_elements WHERE id = $1 FOR UPDATE",
            [elementId],
          );
          const { rows: editorBackendRows } = await editor.query<{
            pid: number;
          }>("SELECT pg_backend_pid() AS pid");
          const { rows: backendRows } = await deleter.query<{ pid: number }>(
            "SELECT pg_backend_pid() AS pid",
          );

          deleteAttempt = deleter
            .query("DELETE FROM public.sites WHERE id = $1", [siteId])
            .then((result) => ({
              ok: true as const,
              rowCount: result.rowCount,
            }))
            .catch((error: unknown) => ({ ok: false as const, error }));
          await waitForLock(backendRows[0].pid, editorBackendRows[0].pid);

          const saved = await editor.query(
            `SELECT * FROM public.save_staging_content_atomic(
               $1, 'rcf-a35-headline', 'en', 'default', 'Concurrent draft',
               '{}'::jsonb, NULL, 's65b@example.invalid'
             )`,
            [siteId],
          );
          expect(saved.rowCount).toBe(1);
          await editor.query("COMMIT");
          editorOpen = false;

          const deleteOutcome = await deleteAttempt;
          if (!deleteOutcome.ok) throw deleteOutcome.error;
          expect(deleteOutcome.rowCount).toBe(1);
          await deleter.query("COMMIT");
          deleterOpen = false;
        } catch (error) {
          // Attach a rejection handler when the DELETE starts, then settle it
          // before rollback. Otherwise whichever backend PostgreSQL selects
          // as a deadlock victim can escape as an unhandled rejection and
          // conceal the actual 40P01 regression.
          if (editorOpen) await rollbackIfOpen(editor);
          if (deleteAttempt) await deleteAttempt;
          if (deleterOpen) await rollbackIfOpen(deleter);
          throw error;
        }
      });
    });

    const { rows } = await query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.sites WHERE id = $1",
      [siteId],
    );
    expect(rows).toEqual([{ count: "0" }]);
  }, 15_000);

  test("log_content_change() runs as its owner on a pinned search_path (A-13)", async () => {
    const { rows } = await query<{
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `SELECT prosecdef, proconfig
         FROM pg_proc
        WHERE proname = 'log_content_change'
          AND pronamespace = 'public'::regnamespace`,
    );

    expect(rows).toHaveLength(1);
    // SECURITY DEFINER is what makes the audit write independent of the calling
    // role's policy set, so a missing `authenticated` INSERT policy on
    // content_history can no longer abort a customer's UPDATE (A-13 / B-3).
    expect(rows[0].prosecdef).toBe(true);
    // And a definer function without a pinned search_path lets the caller choose
    // which `content_history` receives the row. Matched on shape rather than on
    // an exact string: Postgres normalises and may quote the value in proconfig,
    // and how it spells the list is not the property being asserted.
    const searchPath = (rows[0].proconfig ?? []).find((entry) =>
      entry.startsWith("search_path="),
    );
    expect(searchPath).toBeDefined();
    expect(searchPath).toContain("public");
    expect(searchPath).toContain("pg_temp");
  });

  // The split must not have cost the branches that already worked.
  test("INSERT and UPDATE are still logged", async () => {
    const { elementId } = await seedSiteWithContent("delete-regression");

    await query(
      "UPDATE content_elements SET current_content = 'After' WHERE id = $1",
      [elementId],
    );

    const { rows } = await query<{ change_type: string; content: string }>(
      `SELECT change_type, content
         FROM content_history
        WHERE content_element_id = $1
        ORDER BY created_at, change_type`,
      [elementId],
    );

    expect(rows).toEqual([
      { change_type: "create", content: "Before" },
      { change_type: "update", content: "After" },
    ]);
  });
});
