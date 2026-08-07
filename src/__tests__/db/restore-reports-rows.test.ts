/**
 * A-16 — rollback reports success while restoring nothing.
 *
 * `restore_content_version` loops `UPDATE content_elements … WHERE site_id = …
 * AND element_id = …` over the snapshot and then returns an unconditional
 * `RETURN TRUE` (20260804150000:76-85). A zero-row UPDATE is not an error in
 * plpgsql, so neither the function nor the route above it can tell "restored
 * 40 elements" from "matched none".
 *
 * That is not a hypothetical mismatch. Element ids are derived from the DOM
 * structure, and the widget concedes as much at recopyfast.src.js:814-816 — any
 * redesign changes them. So the first rollback after a redesign shows a green
 * toast, leaves the page exactly as it was, and raises nothing anybody could
 * act on. It is the one operation a customer reaches for when something has
 * already gone wrong.
 *
 * The failing test asserts only that the call must not claim plain success when
 * it matched nothing. It deliberately does not prescribe the fix: raising,
 * returning `false`, or returning a row count all satisfy it, because all three
 * let the caller tell the two outcomes apart.
 */

import { describeDb } from "./db-harness";

const ORIGINAL_ELEMENT_IDS = ["rcf-legacy-hero", "rcf-legacy-subhead"];

describeDb(
  "restore_content_version must report what it restored (A-16)",
  ({ query, createSite }) => {
    async function seedSite(label: string): Promise<string> {
      const siteId = await createSite(label);
      for (const elementId of ORIGINAL_ELEMENT_IDS) {
        await query(
          `INSERT INTO content_elements
           (site_id, element_id, selector, original_content, current_content)
         VALUES ($1, $2, 'h1', $3, $3)`,
          [siteId, elementId, `authored copy for ${elementId}`],
        );
      }
      return siteId;
    }

    async function snapshot(
      siteId: string,
      description: string,
    ): Promise<string> {
      const { rows } = await query<{ version_id: string }>(
        "SELECT create_content_version($1, 'db-test', $2, 'manual') AS version_id",
        [siteId, description],
      );
      return rows[0].version_id;
    }

    // This doubles as the guard for the `test.failing` below: it walks the same
    // path (seed, snapshot, restore, read back) and would fail loudly if the pool,
    // the seed or the RPC were broken — which is what stops a mistake in this file
    // from reading as a confirmed A-16, since `test.failing` passes on any throw.
    test("guard: a restore whose element ids still exist actually writes staging_content", async () => {
      const siteId = await seedSite("restore-hit");
      const versionId = await snapshot(siteId, "before edit");

      await query(
        "UPDATE content_elements SET staging_content = 'EDITED' WHERE site_id = $1",
        [siteId],
      );

      await query("SELECT restore_content_version($1, 'db-test')", [versionId]);

      const { rows } = await query<{
        element_id: string;
        staging_content: string | null;
      }>(
        `SELECT element_id, staging_content
         FROM content_elements
        WHERE site_id = $1
        ORDER BY element_id`,
        [siteId],
      );

      expect(rows).toEqual(
        [...ORIGINAL_ELEMENT_IDS].sort().map((elementId) => ({
          element_id: elementId,
          staging_content: `authored copy for ${elementId}`,
        })),
      );
    });

    test.failing(
      "a restore that matches no element must not report success",
      async () => {
        const siteId = await seedSite("restore-miss");
        const versionId = await snapshot(siteId, "before redesign");

        // The customer redesigns. Structural ids change, so nothing in the
        // snapshot matches any live row any more.
        await query(
          `UPDATE content_elements
            SET element_id = replace(element_id, 'rcf-legacy-', 'rcf-redesigned-'),
                staging_content = 'POST REDESIGN'
          WHERE site_id = $1`,
          [siteId],
        );

        let reported: unknown;
        let raised = false;
        try {
          const { rows } = await query<{ restored: unknown }>(
            "SELECT restore_content_version($1, 'db-test') AS restored",
            [versionId],
          );
          reported = rows[0].restored;
        } catch {
          raised = true;
        }

        const { rows: after } = await query<{ staging_content: string | null }>(
          "SELECT staging_content FROM content_elements WHERE site_id = $1",
          [siteId],
        );

        // Nothing was restored — that part is simply true, and stays true after
        // the fix. The defect is that the caller is not told.
        expect(after.map((row) => row.staging_content)).toEqual([
          "POST REDESIGN",
          "POST REDESIGN",
        ]);

        // `true` is the one answer that cannot be acted on: it is what the
        // function returns when it restores forty elements. Raising, `false`, or
        // a count all pass.
        expect(raised || reported !== true).toBe(true);
      },
    );
  },
);
