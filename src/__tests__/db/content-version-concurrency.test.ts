/**
 * A-23 — `create_content_version` races its own UNIQUE constraint.
 *
 * The function reads `COALESCE(MAX(version_number), 0) + 1` with no lock
 * (20260805120000:59-60) and inserts into a table declared
 * `UNIQUE(site_id, version_number)` (20251230100000:73). Between the read and
 * the insert sits the whole snapshot build — a `jsonb_object_agg` over every
 * content element of the site — so the window is not a few instructions, it is
 * however long it takes to aggregate the customer's entire content map.
 *
 * Two callers in that window compute the same version number and one of them
 * gets 23505. The one that matters is the rollback path:
 * `restore_content_version` takes its pre-restore snapshot *inside* the restore
 * (20260804150000:70-72), so a collision aborts the whole rollback — the
 * operation a customer reaches for when something has already gone wrong.
 *
 * The site is seeded with a realistic number of elements before the concurrent
 * calls, which is what makes this deterministic rather than a coin flip: every
 * caller is still aggregating when the others read `MAX(version_number)`.
 */

import { describeDb } from "./db-harness";

const CONCURRENT_CALLS = 20;
/** Wide enough that the snapshot build, not the MAX read, dominates. */
const SEEDED_ELEMENTS = 1_500;
const TEST_TIMEOUT_MS = 120_000;

describeDb(
  "create_content_version under concurrency (A-23)",
  ({ query, createSite }) => {
    async function seedElements(siteId: string, count: number): Promise<void> {
      await query(
        `INSERT INTO content_elements
           (site_id, element_id, selector, original_content, current_content)
         SELECT $1,
                'rcf-el-' || g,
                'main > div:nth-child(' || g || ')',
                'seeded copy ' || g,
                'seeded copy ' || g
           FROM generate_series(1, $2) AS g`,
        [siteId, count],
      );
    }

    // Guard for the `test.failing` below. `test.failing` passes on ANY throw,
    // so a broken seed or an unreachable pool would look exactly like a
    // confirmed race. This walks the same path — create a site, seed it, call
    // the RPC, read the version back — with one caller instead of twenty, and
    // asserts what is true whether or not A-23 is fixed.
    test("guard: a single create_content_version call writes one version", async () => {
      const siteId = await createSite("version-guard");
      await seedElements(siteId, 25);

      const { rows: called } = await query<{ version_id: string }>(
        "SELECT create_content_version($1, 'db-test', 'guard snapshot', 'manual') AS version_id",
        [siteId],
      );
      expect(called[0].version_id).toBeTruthy();

      const { rows } = await query<{
        version_number: number;
        elements_changed: number;
      }>(
        "SELECT version_number, elements_changed FROM content_versions WHERE site_id = $1",
        [siteId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].version_number).toBe(1);
      expect(rows[0].elements_changed).toBe(25);
    });

    test.failing(
      `${CONCURRENT_CALLS} concurrent calls yield ${CONCURRENT_CALLS} distinct version numbers`,
      async () => {
        const siteId = await createSite("version-race");

        await seedElements(siteId, SEEDED_ELEMENTS);

        const results = await Promise.allSettled(
          Array.from({ length: CONCURRENT_CALLS }, (_, index) =>
            query<{ version_id: string }>(
              "SELECT create_content_version($1, 'db-test', $2, 'manual') AS version_id",
              [siteId, `concurrent snapshot ${index}`],
            ),
          ),
        );

        const failures = results
          .filter(
            (result): result is PromiseRejectedResult =>
              result.status === "rejected",
          )
          .map((result) =>
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
          );

        const { rows } = await query<{ version_number: number }>(
          "SELECT version_number FROM content_versions WHERE site_id = $1 ORDER BY version_number",
          [siteId],
        );
        const versionNumbers = rows.map((row) => row.version_number);

        // Every rejection here is `duplicate key value violates unique
        // constraint "content_versions_site_id_version_number_key"`, and each one
        // is a snapshot a customer asked for and did not get.
        expect(failures).toEqual([]);
        expect(new Set(versionNumbers).size).toBe(CONCURRENT_CALLS);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
