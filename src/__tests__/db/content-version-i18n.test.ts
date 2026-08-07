/**
 * A-15 — version snapshot and rollback collapse every language and A/B variant
 * of an element into a single value.
 *
 * `content_elements` is unique on `(site_id, element_id, language, variant)`
 * (20250817000000:38), so one `element_id` legitimately names N rows. But
 * `create_content_version` aggregates with
 * `jsonb_object_agg(element_id, …)` and no language or variant predicate
 * (20260805120000:66-75), and `jsonb_object_agg` keeps the last value it sees
 * for a duplicate key — the scan order decides which one, and the scan order is
 * not stable. `restore_content_version` then writes that single value back with
 * `WHERE site_id = … AND element_id = …` (20260804150000:78-82), which matches
 * every one of the N rows.
 *
 * Publish that and the French site serves German. The "Pre-restore snapshot"
 * taken inside the restore collapses identically, so undo cannot recover it
 * either.
 *
 * Both tests below are `test.failing`: they document the defect and turn red
 * the moment it is fixed, which is the signal to delete the marker.
 *
 * The assertions are written against the *values that must survive*, not
 * against a particular snapshot key shape, because the fix could reasonably key
 * on `element_id|language|variant`, or nest per language, or add columns. Any
 * of those passes; today's collapse does not.
 */

import { describeDb } from "./db-harness";

interface SeededElement {
  language: string;
  variant: string;
  content: string;
}

/** Same element_id across three languages and two variants: 4 rows, 4 values. */
const ELEMENT_ID = "rcf-hero-headline";
const SEED: SeededElement[] = [
  {
    language: "en",
    variant: "default",
    content: "Ship copy changes instantly",
  },
  {
    language: "fr",
    variant: "default",
    content: "Modifiez vos textes en direct",
  },
  {
    language: "de",
    variant: "default",
    content: "Texte sofort veroeffentlichen",
  },
  { language: "en", variant: "challenger", content: "Edit your site, live" },
];

/**
 * Every string stored under a `content` key anywhere in the snapshot, however
 * the snapshot is shaped.
 */
function collectSnapshotContents(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(collectSnapshotContents);
  if (node === null || typeof node !== "object") return [];

  const record = node as Record<string, unknown>;
  return Object.entries(record).flatMap(([key, value]) =>
    key === "content" && typeof value === "string"
      ? [value]
      : collectSnapshotContents(value),
  );
}

describeDb(
  "content version snapshots across languages and variants (A-15)",
  ({ query, createSite }) => {
    async function seedSite(label: string): Promise<string> {
      const siteId = await createSite(label);
      for (const row of SEED) {
        await query(
          `INSERT INTO content_elements
           (site_id, element_id, selector, language, variant,
            original_content, current_content, staging_content)
         VALUES ($1, $2, 'h1.hero', $3, $4, $5, $5, $5)`,
          [siteId, ELEMENT_ID, row.language, row.variant, row.content],
        );
      }
      return siteId;
    }

    // Guards for the two `test.failing` cases below. `test.failing` passes on
    // ANY throw — a bad INSERT, a pool that never connected, a typo in the RPC
    // name — so without these, a mistake in this file would read as a confirmed
    // A-15. Each guard walks the same path as its sibling and asserts only what
    // holds whether or not A-15 is fixed.
    test("guard: the four seeded rows exist and a version is written", async () => {
      const siteId = await seedSite("i18n-guard-snapshot");

      const { rows: seeded } = await query<{ count: string }>(
        "SELECT count(*)::text AS count FROM content_elements WHERE site_id = $1 AND element_id = $2",
        [siteId, ELEMENT_ID],
      );
      expect(Number(seeded[0].count)).toBe(SEED.length);

      const { rows: created } = await query<{ version_id: string }>(
        "SELECT create_content_version($1, 'db-test', 'guard snapshot', 'manual') AS version_id",
        [siteId],
      );
      expect(created[0].version_id).toBeTruthy();

      const { rows: versions } = await query<{ snapshot: unknown }>(
        "SELECT snapshot FROM content_versions WHERE id = $1",
        [created[0].version_id],
      );
      expect(versions).toHaveLength(1);

      // At least one seeded value survives into the snapshot. Today exactly one
      // does (that is A-15); after the fix, all four do.
      const stored = collectSnapshotContents(versions[0].snapshot);
      expect(stored.length).toBeGreaterThan(0);
      for (const content of stored) {
        expect(SEED.map((row) => row.content)).toContain(content);
      }
    });

    test("guard: restore overwrites the clobbered rows with snapshot values", async () => {
      const siteId = await seedSite("i18n-guard-restore");

      const { rows: created } = await query<{ version_id: string }>(
        "SELECT create_content_version($1, 'db-test', 'guard before clobber', 'manual') AS version_id",
        [siteId],
      );

      await query(
        `UPDATE content_elements
            SET staging_content = 'CLOBBERED'
          WHERE site_id = $1 AND element_id = $2`,
        [siteId, ELEMENT_ID],
      );

      await query("SELECT restore_content_version($1, 'db-test')", [
        created[0].version_id,
      ]);

      const { rows: restored } = await query<{
        staging_content: string | null;
      }>(
        "SELECT staging_content FROM content_elements WHERE site_id = $1 AND element_id = $2",
        [siteId, ELEMENT_ID],
      );

      // The restore ran and wrote every row. Which value each row got is the
      // defect the sibling test asserts on; that it wrote a seeded value at all
      // is true both before and after the fix.
      expect(restored).toHaveLength(SEED.length);
      for (const row of restored) {
        expect(row.staging_content).not.toBe("CLOBBERED");
        expect(SEED.map((seed) => seed.content)).toContain(row.staging_content);
      }
    });

    test.failing(
      "create_content_version keeps every language and variant of one element_id",
      async () => {
        const siteId = await seedSite("i18n-snapshot");

        const { rows: created } = await query<{ version_id: string }>(
          "SELECT create_content_version($1, 'db-test', 'i18n snapshot', 'manual') AS version_id",
          [siteId],
        );

        const { rows: versions } = await query<{ snapshot: unknown }>(
          "SELECT snapshot FROM content_versions WHERE id = $1",
          [created[0].version_id],
        );

        const stored = collectSnapshotContents(versions[0].snapshot).sort();
        expect(stored).toEqual(SEED.map((row) => row.content).sort());
      },
    );

    test.failing(
      "restore_content_version puts each language and variant back to its own value",
      async () => {
        const siteId = await seedSite("i18n-restore");

        const { rows: created } = await query<{ version_id: string }>(
          "SELECT create_content_version($1, 'db-test', 'before clobber', 'manual') AS version_id",
          [siteId],
        );

        // Something goes wrong after the version was taken — every translation is
        // overwritten with the same string.
        await query(
          `UPDATE content_elements
            SET staging_content = 'CLOBBERED'
          WHERE site_id = $1 AND element_id = $2`,
          [siteId, ELEMENT_ID],
        );

        await query("SELECT restore_content_version($1, 'db-test')", [
          created[0].version_id,
        ]);

        const { rows: restored } = await query<{
          language: string;
          variant: string;
          staging_content: string | null;
        }>(
          `SELECT language, variant, staging_content
           FROM content_elements
          WHERE site_id = $1 AND element_id = $2
          ORDER BY language, variant`,
          [siteId, ELEMENT_ID],
        );

        const expected = [...SEED]
          .sort((a, b) =>
            a.language === b.language
              ? a.variant.localeCompare(b.variant)
              : a.language.localeCompare(b.language),
          )
          .map((row) => ({
            language: row.language,
            variant: row.variant,
            staging_content: row.content,
          }));

        expect(restored).toEqual(expected);
      },
    );
  },
);
