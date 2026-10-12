/**
 * s65b — the retired public-content revision remains a private compatibility
 * column, but content writes no longer mutate the parent site row.
 *
 * s62 attached statement triggers to every content_elements mutation. Each
 * trigger locked and updated sites after the content write had already taken
 * child-row locks. A concurrent site delete takes those locks in the opposite
 * order through ON DELETE CASCADE, so PostgreSQL could abort either customer
 * action with 40P01. The public snapshot superseded the only planned runtime
 * consumer (ADR 046), making that lock edge pure risk.
 */
import { randomUUID } from "node:crypto";
import { describeDb, type QueryResult } from "./db-harness";

type Query = <R = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<QueryResult<R>>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SiteState {
  revision: string;
  updated_at: Date;
}

async function stateOf(query: Query, siteId: string): Promise<SiteState> {
  const { rows } = await query<SiteState>(
    `SELECT public_content_revision::text AS revision, updated_at
       FROM public.sites
      WHERE id = $1`,
    [siteId],
  );
  return rows[0];
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

describeDb("s65b reserved public-content revision", ({ query, createSite }) => {
  test("the reserved column remains non-null, UUID-backed and private", async () => {
    const siteId = await createSite("reserved-revision");
    const state = await stateOf(query, siteId);
    expect(state.revision).toMatch(UUID_PATTERN);

    const { rows } = await query<{
      is_nullable: string;
      column_default: string;
      comment: string;
      anon_select: boolean;
      authenticated_select: boolean;
      service_select: boolean;
    }>(`
        SELECT c.is_nullable,
               c.column_default,
               col_description('public.sites'::regclass, a.attnum) AS comment,
               has_column_privilege('anon', 'public.sites', 'public_content_revision', 'SELECT') AS anon_select,
               has_column_privilege('authenticated', 'public.sites', 'public_content_revision', 'SELECT') AS authenticated_select,
               has_column_privilege('service_role', 'public.sites', 'public_content_revision', 'SELECT') AS service_select
          FROM information_schema.columns c
          JOIN pg_attribute a
            ON a.attrelid = 'public.sites'::regclass
           AND a.attname = c.column_name
         WHERE c.table_schema = 'public'
           AND c.table_name = 'sites'
           AND c.column_name = 'public_content_revision'
      `);

    expect(rows).toEqual([
      expect.objectContaining({
        is_nullable: "NO",
        column_default: "gen_random_uuid()",
        comment:
          "Reserved server-only compatibility token. No current runtime consumes or rotates it; any future cache must introduce a reviewed lock order before reuse.",
        anon_select: false,
        authenticated_select: false,
        service_select: true,
      }),
    ]);
  });

  test("all revision triggers and helper functions are retired", async () => {
    const { rows: triggers } = await query<{ trigger_name: string }>(`
        SELECT tgname AS trigger_name
          FROM pg_trigger
         WHERE tgrelid = 'public.content_elements'::regclass
           AND NOT tgisinternal
           AND tgname LIKE 'rotate_public_content_revision%'
         ORDER BY tgname
      `);
    expect(triggers).toEqual([]);

    const signatures = [
      "public.rotate_public_content_revisions(uuid[])",
      "public.rotate_public_content_revision_after_insert()",
      "public.rotate_public_content_revision_after_update()",
      "public.rotate_public_content_revision_after_delete()",
      "public.rotate_public_content_revision_after_truncate()",
    ];
    const { rows: functions } = await query<{
      signature: string;
      resolved: string | null;
    }>(
      `SELECT signature, to_regprocedure(signature)::text AS resolved
           FROM unnest($1::text[]) AS signatures(signature)
          ORDER BY signature`,
      [signatures],
    );

    expect(functions).toEqual(
      [...signatures]
        .sort()
        .map((signature) => ({ signature, resolved: null })),
    );
  });

  test("content insert, update and delete leave the site revision and timestamp unchanged", async () => {
    const siteId = await createSite("content-does-not-touch-site");
    const before = await stateOf(query, siteId);

    const elementId = await insertElement(query, siteId);
    expect(await stateOf(query, siteId)).toEqual(before);

    await query(
      `UPDATE public.content_elements
            SET staging_content = 'Draft'
          WHERE id = $1`,
      [elementId],
    );
    expect(await stateOf(query, siteId)).toEqual(before);

    await query("DELETE FROM public.content_elements WHERE id = $1", [
      elementId,
    ]);
    expect(await stateOf(query, siteId)).toEqual(before);
  });

  test("ordinary site metadata updates still advance updated_at without rotating the reserved value", async () => {
    const siteId = await createSite("metadata-still-touches-site");
    const before = await stateOf(query, siteId);
    await query("SELECT pg_sleep(0.01)");

    await query("UPDATE public.sites SET name = $2 WHERE id = $1", [
      siteId,
      "Renamed site",
    ]);

    const after = await stateOf(query, siteId);
    expect(after.revision).toBe(before.revision);
    expect(after.updated_at.getTime()).toBeGreaterThan(
      before.updated_at.getTime(),
    );
  });
});
