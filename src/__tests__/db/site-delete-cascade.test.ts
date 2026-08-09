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

import { describeDb } from "./db-harness";

interface TriggerRow {
  trigger_name: string;
  action_timing: string;
  event_manipulation: string;
}

describeDb("deleting a site with content (A-35)", ({ query, createSite }) => {
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
