/**
 * A-3 / A-5 — no SECURITY DEFINER function in `public` may be executable by a
 * caller holding only the published anon key, or by any signed-in user.
 *
 * This is deliberately ONE list-wide assertion rather than one test per
 * function. PostgREST publishes every function in `public` as an RPC endpoint,
 * and Supabase's default privileges grant EXECUTE on every newly created
 * function to `anon` and `authenticated` — so the next SECURITY DEFINER
 * function anybody adds is exposed the moment it is created, with no migration
 * saying so. A per-function test would have to be remembered; this one fails by
 * default.
 *
 * What A-3 and A-5 look like through this lens:
 *   A-3  revert_staging_content / publish_staging_content /
 *        publish_staging_content_atomic — overwrite or publish any tenant's
 *        content, and none of them asks who is calling.
 *   A-5  add_tickets / consume_tickets — mint your own wallet balance or zero
 *        someone else's; `user_uuid` is caller-supplied and never compared to
 *        `auth.uid()`.
 * Both are the same defect, so both are closed by the same assertion.
 *
 * WHY `proacl` IS COALESCED WITH `acldefault`
 * -------------------------------------------
 * `pg_proc.proacl` is NULL when nothing has ever touched the function's
 * privileges — and Postgres' default for a function is EXECUTE to PUBLIC. A
 * NULL ACL is therefore the *most* open state, not the safest, and
 * `aclexplode(NULL)` returns no rows. `acldefault('f', proowner)` materialises
 * what NULL means so the query cannot read a wide-open function as clean.
 *
 * WHY THERE IS AN ALLOWLIST
 * -------------------------
 * `user_has_site_permission`, `user_is_team_member` and `user_has_team_role`
 * are the SECURITY DEFINER predicates that the RLS policies themselves call
 * (see supabase/README.md, "RLS gotchas"). An RLS policy expression is
 * evaluated with the querying role's privileges, so revoking EXECUTE from
 * `authenticated` does not harden them — it breaks every site-scoped policy in
 * the schema. Measured, not assumed:
 *
 *     REVOKE EXECUTE ON FUNCTION public.user_has_site_permission(uuid, text[])
 *       FROM PUBLIC, anon, authenticated;
 *     SET ROLE authenticated;
 *     SELECT count(*) FROM site_editors;
 *     -- ERROR: permission denied for function user_has_site_permission
 *
 * They are therefore allowed to grant EXECUTE to `authenticated` and to
 * nothing else. `anon` and PUBLIC are never allowed, for any function: the
 * migrations only ever intended `authenticated, service_role` on these three,
 * and PUBLIC is a wildcard that silently covers every role added in future.
 */

import { describeDb } from "./db-harness";

/**
 * Functions permitted to grant EXECUTE to `authenticated`. Keyed on name
 * because these three have no overloads; an overload appearing later would be
 * covered by the same entry, which is why the second test asserts the
 * allowlist still describes exactly what is in the catalogue.
 */
const RLS_PREDICATE_ALLOWLIST = new Set([
  "user_has_site_permission",
  "user_is_team_member",
  "user_has_team_role",
]);

/** Roles an allowlisted RLS predicate may still not be granted to. */
const NEVER_ALLOWED_GRANTEES = ["anon", "PUBLIC"];

interface GrantRow {
  signature: string;
  proname: string;
  grantee: string;
}

const EXECUTE_GRANTS_SQL = `
  SELECT p.proname AS proname,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS signature,
         CASE WHEN a.grantee = 0
              THEN 'PUBLIC'
              ELSE pg_get_userbyid(a.grantee)
         END AS grantee
  FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
  WHERE p.prosecdef
    AND p.pronamespace = 'public'::regnamespace
    AND a.privilege_type = 'EXECUTE'
    AND (
      a.grantee = 0
      OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
    )
  ORDER BY signature, grantee
`;

describeDb(
  "SECURITY DEFINER function grants in public (A-3, A-5)",
  ({ query }) => {
    // Guard for the `test.failing` below. `test.failing` passes on ANY throw,
    // including a connection that never opened or SQL that does not parse — so
    // without this, a mistake in this file would read as a confirmed defect.
    // This runs the same query and asserts only things that are true whether or
    // not A-3/A-5 are fixed.
    test("guard: the grant query runs and returns well-formed rows", async () => {
      const { rows: definers } = await query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM pg_proc
        WHERE prosecdef AND pronamespace = 'public'::regnamespace
      `);
      // If this schema has no SECURITY DEFINER functions at all, the assertion
      // below is vacuous and the failing test would be meaningless.
      expect(Number(definers[0].count)).toBeGreaterThan(0);

      const { rows } = await query<GrantRow>(EXECUTE_GRANTS_SQL);
      for (const row of rows) {
        expect(row.proname).toBeTruthy();
        expect(row.signature.startsWith(`${row.proname}(`)).toBe(true);
        expect(["anon", "authenticated", "PUBLIC"]).toContain(row.grantee);
      }
    });

    test.failing(
      "no SECURITY DEFINER function is executable by anon, authenticated or PUBLIC",
      async () => {
        const { rows } = await query<GrantRow>(EXECUTE_GRANTS_SQL);

        const offenders = rows.filter((row) => {
          if (!RLS_PREDICATE_ALLOWLIST.has(row.proname)) return true;
          return NEVER_ALLOWED_GRANTEES.includes(row.grantee);
        });

        // Rendered as `signature -> grantee` so the failure output names every
        // function that has to be revoked, in the form the fix is written in.
        expect(
          offenders.map((row) => `${row.signature} -> ${row.grantee}`),
        ).toEqual([]);
      },
    );

    test("the RLS-predicate allowlist still matches the catalogue", async () => {
      const { rows } = await query<{ proname: string }>(
        `
      SELECT DISTINCT p.proname AS proname
      FROM pg_proc p
      WHERE p.prosecdef
        AND p.pronamespace = 'public'::regnamespace
        AND p.proname = ANY($1::text[])
    `,
        [[...RLS_PREDICATE_ALLOWLIST]],
      );

      // A stale entry is an allowlist that exempts a function nobody can see —
      // rename the function and the exemption silently follows the old name.
      const found = rows.map((row) => row.proname).sort();
      expect(found).toEqual([...RLS_PREDICATE_ALLOWLIST].sort());
    });
  },
);
