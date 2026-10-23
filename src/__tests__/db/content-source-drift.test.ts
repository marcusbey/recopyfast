/**
 * @jest-environment node
 */

/**
 * s119 (ADR 075) — a developer's deploy that an override masks is recorded,
 * never silently won or lost, in real PostgreSQL.
 *
 * The scenario that motivated the story, reported on r/SideProject on
 * 2026-10-21: the page said "5 to 10", the client published "5 to 11", the
 * developer then deployed "5 to 9". The embed kept writing "5 to 11" and nobody
 * was told. These checks prove what a mock cannot:
 *
 * - `record_content_source_drift` records the deployed text on the edited row,
 *   once, and never touches what a visitor sees;
 * - it ignores unedited rows, unknown ids, other sites and other locales;
 * - a drift write does not move the row-wide `updated_at` CAS token, so an
 *   owner mid-review on the Changes page is not handed a spurious conflict by
 *   a visitor's page view (s81);
 * - `resolve_content_source_drift` keeps or drops exactly as ADR 075 §6 says,
 *   and refuses a stale observation and a pending draft;
 * - both are service-role only.
 */

import { describeDb } from "./db-harness";

const RECORD_IDENTITY = "public.record_content_source_drift(uuid,jsonb)";
const RESOLVE_IDENTITY =
  "public.resolve_content_source_drift(uuid,uuid,text,text,text,uuid)";

interface DriftRow {
  original_content: string | null;
  current_content: string | null;
  published_content: string | null;
  staging_content: string | null;
  source_baseline: string | null;
  source_drift_content: string | null;
  source_drift_detected_at: string | null;
  updated_at: string;
  published_at: string | null;
  published_by: string | null;
}

describeDb("s119 content source drift", ({ query, createSite }) => {
  async function seed(
    label: string,
    overrides: {
      elementId?: string;
      original?: string;
      published?: string;
      staging?: string | null;
      language?: string;
      variant?: string;
      siteId?: string;
      metadata?: Record<string, unknown>;
    } = {},
  ) {
    const siteId = overrides.siteId ?? (await createSite(`s119-${label}`));
    const elementId = overrides.elementId ?? `s119-${label}`;
    const original = overrides.original ?? "5 to 10";
    const published = overrides.published ?? "5 to 11";
    const { rows } = await query<{ id: string }>(
      `INSERT INTO content_elements
           (site_id, element_id, selector, language, variant,
            original_content, current_content, published_content,
            staging_content, published_at, metadata)
         VALUES ($1, $2, '#s119', $3, $4, $5, $6, $6, $7,
                 CASE WHEN $6 IS DISTINCT FROM $5 THEN now() END, $8::jsonb)
         RETURNING id`,
      [
        siteId,
        elementId,
        overrides.language ?? "en",
        overrides.variant ?? "default",
        original,
        published,
        overrides.staging ?? null,
        JSON.stringify(overrides.metadata ?? { type: "p" }),
      ],
    );
    return { siteId, elementId, rowId: rows[0].id };
  }

  async function read(rowId: string): Promise<DriftRow> {
    const { rows } = await query<DriftRow>(
      `SELECT original_content, current_content, published_content,
                staging_content, source_baseline, source_drift_content,
                source_drift_detected_at::text AS source_drift_detected_at,
                updated_at::text AS updated_at,
                published_at::text AS published_at,
                published_by::text AS published_by
         FROM content_elements WHERE id = $1`,
      [rowId],
    );
    return rows[0];
  }

  async function record(siteId: string, reports: unknown): Promise<number> {
    const { rows } = await query<{ changed: number }>(
      "SELECT public.record_content_source_drift($1::uuid, $2::jsonb) AS changed",
      [siteId, JSON.stringify(reports)],
    );
    return rows[0].changed;
  }

  async function resolve(
    siteId: string,
    rowId: string,
    resolution: string,
    expectedObserved: string | null,
    userId: string | null = null,
  ): Promise<string> {
    const { rows } = await query<{ status: string }>(
      `SELECT public.resolve_content_source_drift(
           $1::uuid, $2::uuid, $3::text, $4::text, 'dev@example.com'::text, $5::uuid
         ) AS status`,
      [siteId, rowId, resolution, expectedObserved, userId],
    );
    return rows[0].status;
  }

  async function historyFor(rowId: string) {
    const { rows } = await query<{
      action: string;
      previous_content: string | null;
      new_content: string | null;
      user_email: string;
    }>(
      `SELECT action, previous_content, new_content, user_email
         FROM staging_history WHERE content_element_id = $1
         ORDER BY created_at`,
      [rowId],
    );
    return rows;
  }

  async function createUser(): Promise<string> {
    const { rows } = await query<{ id: string }>(
      "INSERT INTO auth.users (id) VALUES (gen_random_uuid()) RETURNING id",
    );
    return rows[0].id;
  }

  describe("record_content_source_drift", () => {
    test("the three-value scenario: a deploy under an override is recorded and visitors still see the override", async () => {
      const seeded = await seed("three-value");
      const before = await read(seeded.rowId);

      const changed = await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 9" },
      ]);
      const after = await read(seeded.rowId);

      expect(changed).toBe(1);
      expect(after).toMatchObject({
        original_content: "5 to 10",
        published_content: "5 to 11",
        current_content: "5 to 11",
        source_baseline: null,
        source_drift_content: "5 to 9",
      });
      expect(after.source_drift_detected_at).not.toBeNull();
      // The CAS token an owner may be holding on the Changes page is not
      // moved by a visitor's report (see the migration's trigger comment).
      expect(after.updated_at).toBe(before.updated_at);
      expect(await historyFor(seeded.rowId)).toEqual([]);
    });

    test("a repeat report of the same drift is a no-op and keeps the first detection time", async () => {
      const seeded = await seed("repeat");
      await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 9" },
      ]);
      const first = await read(seeded.rowId);

      const changed = await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 9" },
      ]);
      const second = await read(seeded.rowId);

      expect(changed).toBe(0);
      expect(second.source_drift_detected_at).toBe(
        first.source_drift_detected_at,
      );
      expect(second.updated_at).toBe(first.updated_at);
    });

    test("a newer, different deploy replaces the recorded drift", async () => {
      const seeded = await seed("newer");
      await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 9" },
      ]);

      const changed = await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 8" },
      ]);

      expect(changed).toBe(1);
      expect((await read(seeded.rowId)).source_drift_content).toBe("5 to 8");
    });

    test("a report equal to the baseline clears the drift (the developer reverted)", async () => {
      const seeded = await seed("reverted");
      await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 9" },
      ]);

      const changed = await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 10" },
      ]);
      const after = await read(seeded.rowId);

      expect(changed).toBe(1);
      expect(after.source_drift_content).toBeNull();
      expect(after.source_drift_detected_at).toBeNull();
      expect(after.published_content).toBe("5 to 11");
    });

    test("a report equal to the baseline with no drift recorded writes nothing", async () => {
      const seeded = await seed("clean");
      const before = await read(seeded.rowId);

      const changed = await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 10" },
      ]);

      expect(changed).toBe(0);
      expect(await read(seeded.rowId)).toEqual(before);
    });

    test("an unedited row never drifts, and an unknown id is ignored", async () => {
      const seeded = await seed("unedited", { published: "5 to 10" });

      const changed = await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 9" },
        { element_id: "s119-not-a-row", content: "anything" },
      ]);
      const after = await read(seeded.rowId);
      const { rows: created } = await query(
        "SELECT 1 FROM content_elements WHERE site_id = $1 AND element_id = 's119-not-a-row'",
        [seeded.siteId],
      );

      expect(changed).toBe(0);
      expect(after.source_drift_content).toBeNull();
      expect(created).toEqual([]);
    });

    test("another site's row with the same element id is untouched", async () => {
      const mine = await seed("mine", { elementId: "s119-shared-id" });
      const theirs = await seed("theirs", { elementId: "s119-shared-id" });

      await record(mine.siteId, [
        { element_id: "s119-shared-id", content: "5 to 9" },
      ]);

      expect((await read(mine.rowId)).source_drift_content).toBe("5 to 9");
      expect((await read(theirs.rowId)).source_drift_content).toBeNull();
    });

    test("only the en/default row the widget writes is considered", async () => {
      const base = await seed("locale");
      const french = await seed("locale-fr", {
        siteId: base.siteId,
        elementId: base.elementId,
        language: "fr",
      });

      await record(base.siteId, [
        { element_id: base.elementId, content: "5 to 9" },
      ]);

      expect((await read(base.rowId)).source_drift_content).toBe("5 to 9");
      expect((await read(french.rowId)).source_drift_content).toBeNull();
    });

    test("a malformed report changes nothing and does not raise", async () => {
      const seeded = await seed("malformed");

      expect(await record(seeded.siteId, { not: "an array" })).toBe(0);
      expect(
        await record(seeded.siteId, [
          "a string",
          42,
          null,
          { element_id: seeded.elementId },
          { content: "5 to 9" },
        ]),
      ).toBe(0);
      expect((await read(seeded.rowId)).source_drift_content).toBeNull();
    });

    test("a drift write leaves the reviewed CAS token valid for a Discard", async () => {
      const seeded = await seed("cas", { staging: "Draft" });
      const reviewed = await read(seeded.rowId);

      await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 9" },
      ]);
      const { rows } = await query<{ save_status: string }>(
        `SELECT save_status FROM public.save_staging_content_compare_and_set(
             $1::uuid, $2::text, 'en'::text, 'default'::text, '5 to 11'::text,
             $3::timestamptz, '{}'::jsonb, NULL::uuid, 'owner@example.com'::text
           )`,
        [seeded.siteId, seeded.elementId, reviewed.updated_at],
      );

      expect(rows).toEqual([{ save_status: "saved" }]);
    });

    test("guard: an ordinary content write still moves the CAS token", async () => {
      const seeded = await seed("token-guard");
      const before = await read(seeded.rowId);

      await query(
        "UPDATE content_elements SET published_content = '5 to 12' WHERE id = $1",
        [seeded.rowId],
      );
      await query(
        "UPDATE content_elements SET published_content = published_content WHERE id = $1",
        [seeded.rowId],
      );

      const after = await read(seeded.rowId);
      expect(after.updated_at > before.updated_at).toBe(true);
    });
  });

  describe("resolve_content_source_drift", () => {
    async function drifted(label: string, staging: string | null = null) {
      const seeded = await seed(label, { staging });
      await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 9" },
      ]);
      return seeded;
    }

    test("keep: the baseline moves to the deployed text and the visitor copy is unchanged", async () => {
      const seeded = await drifted("keep");
      const before = await read(seeded.rowId);

      const status = await resolve(
        seeded.siteId,
        seeded.rowId,
        "keep",
        "5 to 9",
      );
      const after = await read(seeded.rowId);

      expect(status).toBe("resolved");
      expect(after).toMatchObject({
        original_content: "5 to 10",
        published_content: "5 to 11",
        current_content: "5 to 11",
        source_baseline: "5 to 9",
        source_drift_content: null,
        source_drift_detected_at: null,
      });
      expect(after.updated_at).toBe(before.updated_at);
      expect(await historyFor(seeded.rowId)).toEqual([]);

      // The next visitor still on "5 to 9" reports nothing new...
      expect(
        await record(seeded.siteId, [
          { element_id: seeded.elementId, content: "5 to 9" },
        ]),
      ).toBe(0);
      // ...and a later deploy is measured against the kept baseline.
      await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 10" },
      ]);
      expect((await read(seeded.rowId)).source_drift_content).toBe("5 to 10");
    });

    test("drop: the row is re-discovered at the deployed text and history records a revert", async () => {
      const seeded = await drifted("drop");
      const before = await read(seeded.rowId);
      const userId = await createUser();

      const status = await resolve(
        seeded.siteId,
        seeded.rowId,
        "drop",
        "5 to 9",
        userId,
      );
      const after = await read(seeded.rowId);

      expect(status).toBe("resolved");
      expect(after).toMatchObject({
        original_content: "5 to 9",
        published_content: "5 to 9",
        current_content: "5 to 9",
        source_baseline: null,
        source_drift_content: null,
        source_drift_detected_at: null,
        published_by: userId,
      });
      expect(after.published_at).not.toBeNull();
      expect(after.updated_at > before.updated_at).toBe(true);
      expect(await historyFor(seeded.rowId)).toEqual([
        {
          action: "revert",
          previous_content: "5 to 11",
          new_content: "5 to 9",
          user_email: "dev@example.com",
        },
      ]);

      // No longer edited: the widget stops writing it, and it never drifts.
      expect(
        await record(seeded.siteId, [
          { element_id: seeded.elementId, content: "5 to 8" },
        ]),
      ).toBe(0);
    });

    test("drop carries a non-pending draft along so it cannot re-publish the old override", async () => {
      const seeded = await drifted("drop-draft", "5 to 11");

      expect(await resolve(seeded.siteId, seeded.rowId, "drop", "5 to 9")).toBe(
        "resolved",
      );
      expect((await read(seeded.rowId)).staging_content).toBe("5 to 9");
    });

    test("drop is refused while a draft is pending, and nothing changes", async () => {
      const seeded = await drifted("pending", "5 to 12");
      const before = await read(seeded.rowId);

      const status = await resolve(
        seeded.siteId,
        seeded.rowId,
        "drop",
        "5 to 9",
      );

      expect(status).toBe("pending");
      expect(await read(seeded.rowId)).toEqual(before);
      expect(await historyFor(seeded.rowId)).toEqual([]);
    });

    test("drop is refused while an attribute draft is pending", async () => {
      const seeded = await seed("pending-attr", {
        metadata: { type: "a", href: "/a", staging_attributes: { href: "/b" } },
      });
      await record(seeded.siteId, [
        { element_id: seeded.elementId, content: "5 to 9" },
      ]);

      expect(await resolve(seeded.siteId, seeded.rowId, "drop", "5 to 9")).toBe(
        "pending",
      );
    });

    test("keep is allowed while a draft is pending (no content changes)", async () => {
      const seeded = await drifted("keep-pending", "5 to 12");

      expect(await resolve(seeded.siteId, seeded.rowId, "keep", "5 to 9")).toBe(
        "resolved",
      );
      expect((await read(seeded.rowId)).staging_content).toBe("5 to 12");
    });

    test("a stale observation is a conflict for both resolutions, and nothing changes", async () => {
      const seeded = await drifted("stale");
      const before = await read(seeded.rowId);

      expect(await resolve(seeded.siteId, seeded.rowId, "keep", "5 to 8")).toBe(
        "conflict",
      );
      expect(await resolve(seeded.siteId, seeded.rowId, "drop", "5 to 8")).toBe(
        "conflict",
      );
      expect(await resolve(seeded.siteId, seeded.rowId, "keep", null)).toBe(
        "conflict",
      );
      expect(await read(seeded.rowId)).toEqual(before);
    });

    test("missing: no drift, another site's row, or no row at all", async () => {
      const clean = await seed("missing-clean");
      const other = await drifted("missing-other");

      expect(await resolve(clean.siteId, clean.rowId, "keep", "5 to 9")).toBe(
        "missing",
      );
      expect(await resolve(clean.siteId, other.rowId, "drop", "5 to 9")).toBe(
        "missing",
      );
      expect(
        await resolve(
          clean.siteId,
          "00000000-0000-4000-8000-000000000000",
          "keep",
          "5 to 9",
        ),
      ).toBe("missing");
      expect((await read(other.rowId)).source_drift_content).toBe("5 to 9");
    });

    test("an unedited row carrying a stale drift has no open conflict", async () => {
      const seeded = await drifted("stale-unedited");
      await query(
        "UPDATE content_elements SET published_content = original_content, current_content = original_content WHERE id = $1",
        [seeded.rowId],
      );

      expect(await resolve(seeded.siteId, seeded.rowId, "keep", "5 to 9")).toBe(
        "missing",
      );
    });

    test("an unknown resolution is refused", async () => {
      const seeded = await drifted("bad-resolution");

      await expect(
        resolve(seeded.siteId, seeded.rowId, "delete", "5 to 9"),
      ).rejects.toThrow(/resolution/);
      expect((await read(seeded.rowId)).source_drift_content).toBe("5 to 9");
    });
  });

  test.each([RECORD_IDENTITY, RESOLVE_IDENTITY])(
    "%s is a pinned SECURITY DEFINER function executable only by service_role",
    async (identity) => {
      const { rows } = await query<{
        is_definer: boolean;
        config: string[] | null;
        public_exec: boolean;
        anon_exec: boolean;
        authenticated_exec: boolean;
        service_exec: boolean;
      }>(
        `SELECT p.prosecdef AS is_definer,
                  p.proconfig AS config,
                  has_function_privilege('public', $1, 'EXECUTE') AS public_exec,
                  has_function_privilege('anon', $1, 'EXECUTE') AS anon_exec,
                  has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated_exec,
                  has_function_privilege('service_role', $1, 'EXECUTE') AS service_exec
           FROM pg_proc p
           WHERE p.oid = to_regprocedure($1)`,
        [identity],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].is_definer).toBe(true);
      expect(rows[0].config ?? []).toContain("search_path=public, pg_temp");
      expect(rows[0]).toMatchObject({
        public_exec: false,
        anon_exec: false,
        authenticated_exec: false,
        service_exec: true,
      });
    },
  );

  test("the three columns are nullable with no default", async () => {
    const { rows } = await query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'content_elements'
           AND column_name LIKE 'source\\_%'
         ORDER BY column_name`,
    );

    expect(rows).toEqual([
      {
        column_name: "source_baseline",
        data_type: "text",
        is_nullable: "YES",
        column_default: null,
      },
      {
        column_name: "source_drift_content",
        data_type: "text",
        is_nullable: "YES",
        column_default: null,
      },
      {
        column_name: "source_drift_detected_at",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
        column_default: null,
      },
    ]);
  });
});
