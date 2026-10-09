/**
 * s70a — the cleanup migration deletes exactly the rows the embed's own UI
 * left behind, and nothing anyone edited.
 *
 * Until s70a the embed's discovery mapped three of its own surfaces as site
 * copy: the Edit Board panel (the skip list named `#rcf-edit-board`, an id no
 * element has), the AI suggestions modal and the form-field popover (no
 * marker). Their labels were POSTed and upserted with `ignoreDuplicates`, so
 * the rows stayed — the History tab's "by <editor email>" among them, served
 * by `GET /api/published/<site>` to anyone with the site id. The editor bar's
 * buttons (`#rcf-editor-banner`) were recorded the same way before they gained
 * `data-rcf-ignore`. docs/research/s70-content-changes.md, fact 1.
 *
 * The seed is the plan's (docs/plans/s70a-embed-ui-not-content.md, Task 2):
 * the seven certain rows, lookalikes that are real copy on real sites
 * ("Close", "Generate Suggestions" outside the modal's shape), an embed row an
 * owner published, one with a draft, and an AI suggestion paragraph — the
 * review tier, listed for the owner, never deleted by pattern. The migration
 * file itself is executed, inside a transaction rolled back at the end, so
 * the statement under test is the one that ships.
 *
 * Four kept rows were added at review (s70a, F5): with the plan's seed alone,
 * deleting any of four guards from the predicate stayed green. One row per
 * guard: an embed row published as discovered (`published_at IS NULL`), one
 * holding only an attribute draft (`staging_attributes`), and customer copy
 * in the popover's and the AI modal footer's selector shapes (the popover's
 * text list, the footer's `= 'Close'`).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describeDb } from "./db-harness";

const MIGRATION_PATH = path.resolve(
  __dirname,
  "../../../supabase/migrations/20261008120000_delete_embed_ui_discovery_rows.sql",
);

interface SeedRow {
  selector: string;
  original: string;
  /** Defaults to the original: discovery writes both (content route :172-174). */
  published?: string;
  staging?: string;
  /** Set by a publish, even one that left the text as discovered. */
  publishedAt?: string;
  /** Defaults to `{"type":"span"}`, what discovery stores. */
  metadata?: Record<string, unknown>;
}

const DELETED: SeedRow[] = [
  {
    selector: "#rcf-edit-board-panel > div:nth-child(2) > button:nth-child(1)",
    original: "Elements",
  },
  {
    selector:
      "#rcf-eb-content > div:nth-child(1) > div:nth-child(2) > div:nth-child(3) > span:nth-child(2)",
    original: "by owner@example.com",
  },
  {
    selector: "#rcf-editor-banner > button:nth-child(5)",
    original: "All sites",
  },
  {
    selector:
      "div:nth-child(7) > div > button:nth-child(3) > span:nth-child(1)",
    original: "🪄",
  },
  {
    selector: "div:nth-child(5) > div > div:nth-child(4) > p",
    original: "Failed to generate suggestions. Please try again.",
  },
  {
    selector: "div:nth-child(5) > div > div:nth-child(5) > button",
    original: "Close",
  },
  {
    selector: "div:nth-child(10) > div:nth-child(6) > button:nth-child(2)",
    original: "Save",
  },
];

const KEPT: SeedRow[] = [
  // Real copy that happens to share a label with the embed's UI.
  { selector: "#site-nav > button", original: "Close" },
  { selector: "#hero > button", original: "Generate Suggestions" },
  { selector: "div:nth-child(2) > div > p", original: "Close" },
  // Embed UI an owner touched: never deleted, whatever its selector.
  {
    selector: "#rcf-edit-board-panel > div:nth-child(1) > div:nth-child(1)",
    original: "Edit Board",
    published: "Our board",
  },
  {
    selector: "#rcf-edit-board-panel > div:nth-child(2) > button:nth-child(3)",
    original: "History",
    staging: "Past versions",
  },
  // Published as discovered: the live text still equals the original, so only
  // `published_at` says someone touched it.
  {
    selector: "#rcf-edit-board-panel > div:nth-child(2) > button:nth-child(2)",
    original: "Elements",
    publishedAt: "2026-10-01T12:00:00Z",
  },
  // An attribute-only draft (an image's alt, a link's href): the text is
  // untouched, only `metadata.staging_attributes` holds the edit.
  {
    selector: "#rcf-editor-banner > a:nth-child(2)",
    original: "Open dashboard",
    metadata: {
      type: "a",
      staging_attributes: { href: "https://example.com/next" },
    },
  },
  // Customer copy in the shape of an embed root, with text that is not the
  // embed's: the shape alone never deletes. The popover's first paragraph
  // and the AI modal's footer button share these selectors.
  { selector: "div:nth-child(3) > p:nth-child(1)", original: "Our story" },
  {
    selector: "div:nth-child(5) > div > div:nth-child(5) > button",
    original: "Contact sales",
  },
  // Review tier: an AI suggestion's text is arbitrary, so it is listed for the
  // owner by the read-only count, not deleted by pattern.
  {
    selector:
      "div:nth-child(5) > div > div:nth-child(4) > div:nth-child(1) > p",
    original: "Start free today.",
  },
];

describeDb("s70a: the embed-UI cleanup migration", ({ withClient }) => {
  test("deletes exactly the seven embed-UI rows and keeps every lookalike, edited and review row", async () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");

    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        const { rows: sites } = await client.query<{ id: string }>(
          "INSERT INTO sites (domain, name) VALUES ($1, $2) RETURNING id",
          [`rcf-dbtest-s70a-${suffix}.invalid`, "rcf-dbtest s70a"],
        );
        const siteId = sites[0].id;

        const seed = [...DELETED, ...KEPT];
        for (const [index, row] of seed.entries()) {
          await client.query(
            `INSERT INTO content_elements
                 (site_id, element_id, selector, original_content, current_content,
                  published_content, staging_content, published_at, metadata)
               VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8::jsonb)`,
            [
              siteId,
              `rcf-s70a-${index}`,
              row.selector,
              row.original,
              row.published ?? row.original,
              row.staging ?? null,
              row.publishedAt ?? null,
              JSON.stringify(row.metadata ?? { type: "span" }),
            ],
          );
        }

        // Sorted here, not by ORDER BY: the expected lists are sorted by
        // JavaScript, and a database collation (en_US skips `#`) would not
        // agree with it.
        const selectorsOf = async (): Promise<string[]> => {
          const { rows } = await client.query<{ selector: string }>(
            "SELECT selector FROM content_elements WHERE site_id = $1",
            [siteId],
          );
          return rows.map((row) => row.selector).sort();
        };

        // GUARD: every seeded row is there before the migration runs, so the
        // rows missing afterwards were deleted by it, not never inserted.
        expect(await selectorsOf()).toEqual(
          seed.map((row) => row.selector).sort(),
        );

        await client.query(migration);

        expect(await selectorsOf()).toEqual(
          KEPT.map((row) => row.selector).sort(),
        );
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });
});
