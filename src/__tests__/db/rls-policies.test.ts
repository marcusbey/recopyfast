/**
 * Row-level-security invariants for the `public` schema.
 *
 * Same shape of argument as function-grants.test.ts: assert the property
 * list-wide so a new table or a new policy is covered the day it is written,
 * rather than the day somebody remembers to add a test for it.
 *
 * All three assertions below hold on a database built from `supabase/migrations`
 * today — they are regression fences, not defect markers, so they are plain
 * `test` rather than `test.failing`. Each one has already been broken once in
 * this repo's history:
 *
 *   1. RLS enabled everywhere.
 *      `20260611010000_rls_hardening.sql` exists because it was not.
 *
 *   2. No unconditional write policy reachable by anon or authenticated.
 *      `20260611020000_tighten_permissive_policies.sql` removed four:
 *      `ab_test_results` and `visitor_buckets` were `FOR ALL USING (true)`,
 *      `staging_history` and `content_versions` were
 *      `FOR INSERT WITH CHECK (true)`. A permissive `true` policy is not a
 *      partial control — it is the absence of one, wearing the shape of one.
 *
 *   3. No table has RLS enabled and zero policies.
 *      From supabase/README.md: "ENABLE ROW LEVEL SECURITY without any policy
 *      denies everything. It is not a partial measure." This is how a whole
 *      feature dies silently — the writes return no error, they just never
 *      happen. It is the same failure mode as A-6 (billing_subscriptions with
 *      SELECT-only policies) and A-13 (content_history), one level coarser.
 *
 * These read the catalogue rather than switching role and probing, because the
 * question is "does any policy of this shape exist", which is a property of the
 * whole schema and not of one table a prober happened to pick.
 */

import { describeDb } from "./db-harness";

/** `pg_policy.polcmd` codes that let a caller change data. */
const WRITE_COMMANDS = "('a', 'w', 'd', '*')"; // INSERT, UPDATE, DELETE, ALL

describeDb(
  "RLS policy invariants for public (P2 permissive-policy class)",
  ({ query }) => {
    test("every table in public has row-level security enabled", async () => {
      const { rows } = await query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND NOT c.relrowsecurity
      ORDER BY 1
    `);

      expect(rows.map((row) => row.table_name)).toEqual([]);
    });

    test("no permissive policy grants an unconditional write to anon, authenticated or PUBLIC", async () => {
      const { rows } = await query<{ offender: string }>(`
      SELECT c.relname
             || ' :: ' || p.polname
             || ' [' || p.polcmd::text || ']'
             || ' to ' || CASE
                            WHEN p.polroles = '{0}' THEN 'PUBLIC'
                            ELSE array_to_string(
                                   ARRAY(SELECT pg_get_userbyid(r) FROM unnest(p.polroles) r),
                                   ','
                                 )
                          END AS offender
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND p.polpermissive
        AND p.polcmd IN ${WRITE_COMMANDS}
        -- '{0}' is PUBLIC, which reaches anon and authenticated too.
        AND (
          p.polroles = '{0}'
          OR EXISTS (
            SELECT 1 FROM unnest(p.polroles) r
            WHERE pg_get_userbyid(r) IN ('anon', 'authenticated')
          )
        )
        -- A missing USING/WITH CHECK is unconditional, so NULL reads as 'true'.
        AND COALESCE(pg_get_expr(p.polqual, p.polrelid), 'true') = 'true'
        AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), 'true') = 'true'
      ORDER BY 1
    `);

      expect(rows.map((row) => row.offender)).toEqual([]);
    });

    test("no table has RLS enabled with no policies at all", async () => {
      const { rows } = await query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
      ORDER BY 1
    `);

      expect(rows.map((row) => row.table_name)).toEqual([]);
    });
  },
);
