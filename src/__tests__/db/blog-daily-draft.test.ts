/**
 * s89 — one cron draft per UTC day is a database fact, not a pre-check.
 *
 * Vercel delivers a cron at least once, and occasionally twice for the same
 * scheduled run (docs/research/s89-blog-drafts-only.md, fact 6). The daily blog
 * job spends ~30 s in the model call between "is there a draft for today?" and
 * its insert, so two deliveries both see "no" and both insert unless the
 * database refuses the second row. `blog_posts.generated_on` carries the UTC
 * day for cron rows only; on-demand drafts and every older row leave it NULL,
 * and a unique index treats NULLs as distinct, so they stay unconstrained.
 *
 * The last case pins the read side the public pages rely on: `anon` sees
 * published rows and nothing else (20260818000000, "Published blog posts are
 * public").
 *
 * Every case runs inside a transaction that is rolled back.
 */

import { describeDb } from "./db-harness";

const DAY = "2026-10-09";

function slug(label: string): string {
  return `rcf-dbtest-s89-${label}-${Math.random().toString(36).slice(2, 10)}`;
}

describeDb("s89: blog_posts daily draft key", ({ withClient }) => {
  test("a second cron row for the same UTC day is refused with 23505", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          `INSERT INTO blog_posts (title, slug, content, category, status, generated_on)
           VALUES ('First', $1, 'Body', 'development', 'draft', $2)`,
          [slug("first"), DAY],
        );

        await client.query("SAVEPOINT second_insert");
        let code: string | undefined;
        try {
          await client.query(
            `INSERT INTO blog_posts (title, slug, content, category, status, generated_on)
             VALUES ('Second', $1, 'Body', 'development', 'draft', $2)`,
            [slug("second"), DAY],
          );
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        await client.query("ROLLBACK TO SAVEPOINT second_insert");

        expect(code).toBe("23505");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  test("rows without a day are unconstrained, and another day is a new key", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        for (const label of ["manual-a", "manual-b"]) {
          await client.query(
            `INSERT INTO blog_posts (title, slug, content, category, status)
             VALUES ('Manual', $1, 'Body', 'development', 'draft')`,
            [slug(label)],
          );
        }
        await client.query(
          `INSERT INTO blog_posts (title, slug, content, category, status, generated_on)
           VALUES ('Today', $1, 'Body', 'development', 'draft', $2),
                  ('Tomorrow', $3, 'Body', 'development', 'draft', $4)`,
          [slug("today"), DAY, slug("tomorrow"), "2026-10-10"],
        );

        const { rows } = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM blog_posts WHERE slug LIKE 'rcf-dbtest-s89-%'",
        );
        expect(rows[0].count).toBe("4");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  test("anon reads published posts and no draft", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const draftSlug = slug("draft");
        const publishedSlug = slug("published");
        await client.query(
          `INSERT INTO blog_posts (title, slug, content, category, status, published_at, generated_on)
           VALUES ('Draft', $1, 'Body', 'development', 'draft', NULL, $3),
                  ('Live', $2, 'Body', 'development', 'published', now(), NULL)`,
          [draftSlug, publishedSlug, DAY],
        );

        await client.query("SET LOCAL ROLE anon");
        const { rows } = await client.query<{ slug: string }>(
          "SELECT slug FROM blog_posts WHERE slug = ANY($1::text[]) ORDER BY slug",
          [[draftSlug, publishedSlug]],
        );

        expect(rows.map((row) => row.slug)).toEqual([publishedSlug]);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });
});
