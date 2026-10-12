/**
 * @jest-environment node
 */

/**
 * s81 — Discard's compare-and-set boundary in real PostgreSQL.
 *
 * The HTTP regression proves routing and status mapping. These checks prove the
 * property the mock cannot: two independent database clients quoting one row
 * version serialize on the row lock, exactly one writes, the loser reports a
 * conflict, and the loser appends no staging_history row. The version is the
 * row-wide content_elements.updated_at, not staging_updated_at: publish and
 * attribute writers can change the reviewed row without moving the latter.
 * A nullable legacy row is never an unversioned escape hatch: both the stored
 * token and the expected token must be non-null before equality can save.
 */

import { describeDb } from "./db-harness";

const FUNCTION_IDENTITY =
  "public.save_staging_content_compare_and_set(uuid,text,text,text,text,timestamp with time zone,jsonb,uuid,text)";
const EXPECTED = "2026-10-08T10:00:00.123456+00:00";

interface SaveRow {
  save_status: "saved" | "missing" | "conflict";
  content_element_id: string | null;
}

interface VersionedSaveRow extends SaveRow {
  version: string | null;
}

interface LegacySaveRow {
  content_element_id: string;
  version: string;
}

const saveSql = `
  SELECT save_status, content_element_id
  FROM public.save_staging_content_compare_and_set(
    $1::uuid, $2::text, 'en'::text, 'default'::text, $3::text,
    $4::timestamptz, $5::jsonb, NULL::uuid, $6::text
  )
`;

const versionedSaveSql = `
  SELECT save_status, content_element_id, updated_at::text AS version
  FROM public.save_staging_content_compare_and_set(
    $1::uuid, $2::text, 'en'::text, 'default'::text, $3::text,
    $4::timestamptz, $5::jsonb, NULL::uuid, $6::text
  )
`;

const legacySaveSql = `
  SELECT content_element_id, updated_at::text AS version
  FROM public.save_staging_content_atomic(
    $1::uuid, $2::text, 'en'::text, 'default'::text, $3::text,
    $4::jsonb, NULL::uuid, $5::text
  )
`;

describeDb(
  "s81 staging content compare-and-set",
  ({ query, withClient, createSite }) => {
    async function seed(label: string, updatedAt: string | null = EXPECTED) {
      const siteId = await createSite(`s81-${label}`);
      const elementId = `s81-${label}`;
      const { rows } = await query<{ id: string }>(
        `INSERT INTO content_elements
           (site_id, element_id, selector, language, variant,
            original_content, current_content, published_content,
            staging_content, staging_updated_at, metadata, updated_at)
         VALUES ($1, $2, '#s81', 'en', 'default',
                 'Original', 'Live', 'Live', 'Draft A', $3,
                 '{"type":"a","href":"/live","staging_attributes":{"href":"/draft"}}'::jsonb,
                 $4)
         RETURNING id`,
        [siteId, elementId, EXPECTED, updatedAt],
      );
      return { siteId, elementId, rowId: rows[0].id };
    }

    test("is a pinned SECURITY DEFINER function executable only by service_role", async () => {
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
        [FUNCTION_IDENTITY],
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
    });

    test("content_elements alone uses the monotonic invoker trigger with no direct web execution grant", async () => {
      const triggerIdentity =
        "public.set_content_element_updated_at_monotonic()";
      const { rows } = await query<{
        function_name: string;
        is_definer: boolean;
        config: string[] | null;
        public_exec: boolean;
        anon_exec: boolean;
        authenticated_exec: boolean;
        service_exec: boolean;
      }>(
        `SELECT p.proname AS function_name,
                p.prosecdef AS is_definer,
                p.proconfig AS config,
                has_function_privilege('public', $1, 'EXECUTE') AS public_exec,
                has_function_privilege('anon', $1, 'EXECUTE') AS anon_exec,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS authenticated_exec,
                has_function_privilege('service_role', $1, 'EXECUTE') AS service_exec
         FROM pg_trigger t
         JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE t.tgrelid = 'public.content_elements'::regclass
           AND t.tgname = 'update_content_elements_updated_at'
           AND NOT t.tgisinternal`,
        [triggerIdentity],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        function_name: "set_content_element_updated_at_monotonic",
        is_definer: false,
        public_exec: false,
        anon_exec: false,
        authenticated_exec: false,
        service_exec: false,
      });
      expect(rows[0].config ?? []).toContain("search_path=pg_catalog, pg_temp");
    });

    test("a metadata writer moves row-wide updated_at and writes no draft or history on conflict", async () => {
      const seeded = await seed("row-version");
      // A writer changed metadata but deliberately did not touch the staging
      // timestamp. The table trigger must still invalidate the reviewed token.
      await query(
        `UPDATE content_elements
         SET metadata = jsonb_set(metadata, '{alt}', '"changed elsewhere"'::jsonb)
         WHERE id = $1`,
        [seeded.rowId],
      );

      const { rows } = await query<SaveRow>(saveSql, [
        seeded.siteId,
        seeded.elementId,
        "Discarded text",
        EXPECTED,
        JSON.stringify({ href: "/live" }),
        "owner@example.com",
      ]);
      const { rows: held } = await query<{
        staging_content: string | null;
        history_count: string;
      }>(
        `SELECT ce.staging_content,
                (SELECT count(*)::text FROM staging_history sh
                 WHERE sh.content_element_id = ce.id) AS history_count
         FROM content_elements ce WHERE ce.id = $1`,
        [seeded.rowId],
      );

      expect(rows).toEqual([
        { save_status: "conflict", content_element_id: seeded.rowId },
      ]);
      expect(held[0]).toEqual({
        staging_content: "Draft A",
        history_count: "0",
      });
    });

    test("a publish invalidates the reviewed token and the later conflict adds no history", async () => {
      const seeded = await seed("published-version");
      await query(
        "SELECT * FROM public.publish_staging_content_with_attributes_atomic($1, ARRAY[$2]::text[], NULL, 'publisher@example.com', NULL)",
        [seeded.siteId, seeded.elementId],
      );
      const { rows: before } = await query<{
        updated_at: string;
        history_count: string;
      }>(
        `SELECT updated_at::text,
                (SELECT count(*)::text FROM staging_history WHERE content_element_id = $1) AS history_count
         FROM content_elements WHERE id = $1`,
        [seeded.rowId],
      );

      const { rows } = await query<SaveRow>(saveSql, [
        seeded.siteId,
        seeded.elementId,
        "Stale discard",
        EXPECTED,
        JSON.stringify({ href: "/live" }),
        "owner@example.com",
      ]);
      const { rows: after } = await query<{ history_count: string }>(
        "SELECT count(*)::text AS history_count FROM staging_history WHERE content_element_id = $1",
        [seeded.rowId],
      );

      expect(before[0].updated_at).not.toBe(EXPECTED);
      expect(before[0].history_count).toBe("1");
      expect(rows).toEqual([
        { save_status: "conflict", content_element_id: seeded.rowId },
      ]);
      expect(after[0].history_count).toBe("1");
    });

    test("two clients quoting one version yield one save, one conflict and one history row", async () => {
      const seeded = await seed("two-clients");

      const [first, second] = await withClient(async (clientA) =>
        withClient(async (clientB) =>
          Promise.all([
            clientA.query<SaveRow>(saveSql, [
              seeded.siteId,
              seeded.elementId,
              "Version B",
              EXPECTED,
              JSON.stringify({ href: "/live" }),
              "first@example.com",
            ]),
            clientB.query<SaveRow>(saveSql, [
              seeded.siteId,
              seeded.elementId,
              "Version C",
              EXPECTED,
              JSON.stringify({ href: "/live" }),
              "second@example.com",
            ]),
          ]),
        ),
      );
      const { rows: held } = await query<{
        staging_content: string;
        history_count: string;
      }>(
        `SELECT ce.staging_content,
                (SELECT count(*)::text FROM staging_history sh
                 WHERE sh.content_element_id = ce.id) AS history_count
         FROM content_elements ce WHERE ce.id = $1`,
        [seeded.rowId],
      );

      expect(
        [first.rows[0].save_status, second.rows[0].save_status].sort(),
      ).toEqual(["conflict", "saved"]);
      expect(["Version B", "Version C"]).toContain(held[0].staging_content);
      expect(held[0].history_count).toBe("1");
    });

    test("moves the row token on every successful call, even twice in one transaction", async () => {
      const seeded = await seed("monotonic-token");

      await withClient(async (client) => {
        await client.query("BEGIN");
        try {
          const first = await client.query<VersionedSaveRow>(versionedSaveSql, [
            seeded.siteId,
            seeded.elementId,
            "Version B",
            EXPECTED,
            JSON.stringify({ href: "/live" }),
            "owner@example.com",
          ]);
          const second = await client.query<VersionedSaveRow>(
            versionedSaveSql,
            [
              seeded.siteId,
              seeded.elementId,
              "Version C",
              first.rows[0].version,
              JSON.stringify({ href: "/live" }),
              "owner@example.com",
            ],
          );

          expect(first.rows[0].save_status).toBe("saved");
          expect(second.rows[0].save_status).toBe("saved");
          expect(first.rows[0].version).not.toBe(second.rows[0].version);
        } finally {
          await client.query("ROLLBACK");
        }
      });
    });

    test("the legacy RPC returns the actual post-trigger token and that token can start a conditional save", async () => {
      const seeded = await seed("legacy-token");

      const legacy = await query<LegacySaveRow>(legacySaveSql, [
        seeded.siteId,
        seeded.elementId,
        "Legacy save",
        JSON.stringify({ href: "/live" }),
        "legacy@example.com",
      ]);
      const { rows: held } = await query<{ version: string }>(
        "SELECT updated_at::text AS version FROM content_elements WHERE id = $1",
        [seeded.rowId],
      );
      const conditional = await query<SaveRow>(saveSql, [
        seeded.siteId,
        seeded.elementId,
        "Conditional after legacy",
        legacy.rows[0].version,
        JSON.stringify({ href: "/live" }),
        "owner@example.com",
      ]);

      expect(legacy.rows[0]).toEqual({
        content_element_id: seeded.rowId,
        version: held[0].version,
      });
      expect(conditional.rows[0].save_status).toBe("saved");
    });

    test.each([
      {
        label: "a NULL row and NULL expected version",
        seedLabel: "null-null",
        rowVersion: null,
        expectedVersion: null,
      },
      {
        label: "a NULL row and non-NULL expected version",
        seedLabel: "null-value",
        rowVersion: null,
        expectedVersion: EXPECTED,
      },
      {
        label: "a non-NULL row and NULL expected version",
        seedLabel: "value-null",
        rowVersion: EXPECTED,
        expectedVersion: null,
      },
    ])(
      "$label conflicts without updating the row or history",
      async ({ seedLabel, rowVersion, expectedVersion }) => {
        const seeded = await seed(seedLabel, rowVersion);
        const readHeld = () =>
          query<{
            staging_content: string;
            metadata: Record<string, unknown>;
            version: string | null;
            history_count: string;
          }>(
            `SELECT ce.staging_content,
                    ce.metadata,
                    ce.updated_at::text AS version,
                    (SELECT count(*)::text FROM staging_history sh
                     WHERE sh.content_element_id = ce.id) AS history_count
             FROM content_elements ce WHERE ce.id = $1`,
            [seeded.rowId],
          );
        const { rows: before } = await readHeld();

        const { rows } = await query<SaveRow>(saveSql, [
          seeded.siteId,
          seeded.elementId,
          "Version B",
          expectedVersion,
          JSON.stringify({ href: "/live" }),
          "owner@example.com",
        ]);
        const { rows: after } = await readHeld();

        expect(rows).toEqual([
          { save_status: "conflict", content_element_id: seeded.rowId },
        ]);
        expect(before[0]).toMatchObject({
          staging_content: "Draft A",
          metadata: {
            type: "a",
            href: "/live",
            staging_attributes: { href: "/draft" },
          },
          history_count: "0",
        });
        expect(after[0]).toEqual(before[0]);
      },
    );

    test("returns missing distinctly from a version conflict", async () => {
      const siteId = await createSite("s81-missing");

      const { rows } = await query<SaveRow>(saveSql, [
        siteId,
        "does-not-exist",
        "Discarded text",
        EXPECTED,
        JSON.stringify({}),
        "owner@example.com",
      ]);

      expect(rows).toEqual([
        { save_status: "missing", content_element_id: null },
      ]);
    });
  },
);
