/**
 * A-3 / A-5 — the invariant, in full:
 *
 *   1. NO SECURITY DEFINER function in `public` may grant EXECUTE to `anon` or
 *      to PUBLIC. No exceptions, for any function, ever.
 *   2. The ONLY functions that may grant EXECUTE to `authenticated` are the
 *      three RLS predicates in RLS_PREDICATE_ALLOWLIST below, matched on full
 *      identity — name AND argument types.
 *
 * `anon` is the published anon key: rule 1 is what keeps a browser out. PUBLIC
 * is every role including future ones. `authenticated` is any signed-in user of
 * any tenant, which is why rule 2 is an allowlist rather than a blanket permit.
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
 * migrations only ever intended `authenticated, service_role` on these three
 * (20260731008000:83-85, 20260801200000:149), and PUBLIC is a wildcard that
 * silently covers every role added in future.
 *
 * WHY THE ALLOWLIST IS KEYED ON IDENTITY AND NOT ON NAME
 * -----------------------------------------------------
 * Postgres overloads on argument types, and an exemption keyed on `proname`
 * exempts every overload of that name. A later
 * `user_has_team_role(uuid, text[], boolean)` — or a one-argument
 * `user_is_team_member()` reading the team from a session variable — would
 * inherit the exemption of a function somebody measured years earlier, and the
 * catalogue check could not see it either, because it counted DISTINCT names.
 * Both checks therefore compare `proname(argtype, …)`, built by IDENTITY_SQL
 * below: a new overload is a new decision, made deliberately, or it fails.
 */

import { describeDb } from "./db-harness";

/**
 * The only functions permitted to grant EXECUTE to `authenticated`, keyed on
 * full identity. `args` must be spelled the way IDENTITY_SQL renders it —
 * `format_type` output, comma-space separated, no parameter names — because
 * that is what both queries below compare against. Get it wrong and the
 * catalogue test fails loudly rather than exempting the wrong thing quietly.
 */
const RLS_PREDICATE_ALLOWLIST: readonly { name: string; args: string }[] = [
  { name: "user_has_site_permission", args: "uuid, text[]" },
  { name: "user_is_team_member", args: "uuid" },
  { name: "user_has_team_role", args: "uuid, text[]" },
];

/** `user_has_site_permission(uuid, text[])` — the form both queries emit. */
const AUTHENTICATED_ALLOWED_IDENTITIES = new Set(
  RLS_PREDICATE_ALLOWLIST.map((entry) => `${entry.name}(${entry.args})`),
);

const ALLOWLISTED_NAMES = RLS_PREDICATE_ALLOWLIST.map((entry) => entry.name);

/** Grantees no function may hold EXECUTE as — allowlisted or not. */
const NEVER_ALLOWED_GRANTEES = new Set(["anon", "PUBLIC"]);

interface GrantRow {
  identity: string;
  proname: string;
  grantee: string;
}

/**
 * `proname(argtype, argtype)` — the identity a REVOKE has to name, and the one
 * Postgres resolves overloads on.
 *
 * Deliberately NOT `pg_get_function_identity_arguments`, which prints parameter
 * names and OUT parameters: it renders `aclexplode` as
 * `acl aclitem[], OUT grantor oid, …`, so this schema's
 * `user_has_site_permission(p_site_id UUID, p_levels TEXT[])` would come back as
 * `p_site_id uuid, p_levels text[]` — and renaming a parameter, which changes
 * nothing about who may execute the function, would silently move it off the
 * allowlist. `proargtypes` holds the input types and nothing else.
 *
 * Correlated on `p`, so both queries below must alias pg_proc as `p`.
 */
const IDENTITY_SQL = `
    p.proname || '(' || COALESCE(
      (SELECT string_agg(format_type(a.t, NULL), ', ' ORDER BY a.ord)
         FROM unnest(p.proargtypes) WITH ORDINALITY AS a(t, ord)),
      ''
    ) || ')'`;

const EXECUTE_GRANTS_SQL = `
  SELECT p.proname AS proname,
         ${IDENTITY_SQL} AS identity,
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
  ORDER BY identity, grantee
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
        expect(row.identity.startsWith(`${row.proname}(`)).toBe(true);
        expect(row.identity.endsWith(")")).toBe(true);
        expect(["anon", "authenticated", "PUBLIC"]).toContain(row.grantee);
      }
    });

    test.failing(
      "anon and PUBLIC hold no EXECUTE, and only the allowlisted RLS predicates are executable by authenticated",
      async () => {
        const { rows } = await query<GrantRow>(EXECUTE_GRANTS_SQL);

        const offenders = rows.filter((row) => {
          // Rule 1: `anon` and PUBLIC are refused for every function, the
          // allowlisted RLS predicates included.
          if (NEVER_ALLOWED_GRANTEES.has(row.grantee)) return true;
          // Rule 2: the query selects no grantee but `authenticated` here, and
          // only the exact allowlisted identities may hold it. An overload of
          // an allowlisted name is a different identity, so it offends.
          return !AUTHENTICATED_ALLOWED_IDENTITIES.has(row.identity);
        });

        // Rendered as `identity -> grantee` so the failure output names every
        // grant that has to be revoked, in the form the REVOKE is written in.
        expect(
          offenders.map((row) => `${row.identity} -> ${row.grantee}`),
        ).toEqual([]);
      },
    );

    test("the RLS-predicate allowlist still matches the catalogue", async () => {
      const { rows } = await query<{ identity: string }>(
        `
      SELECT ${IDENTITY_SQL} AS identity
      FROM pg_proc p
      WHERE p.prosecdef
        AND p.pronamespace = 'public'::regnamespace
        AND p.proname = ANY($1::text[])
      ORDER BY identity
    `,
        [ALLOWLISTED_NAMES],
      );

      // Selected by NAME and compared by IDENTITY, so this fails in both
      // directions. Missing: the allowlist exempts something nobody can see —
      // rename or drop the function and the exemption silently follows the old
      // identity. Extra: a new overload of an allowlisted name exists that
      // nobody has measured, and the assertion above is already refusing it —
      // this is where that shows up as a decision to make rather than a
      // mystery failure.
      const found = rows.map((row) => row.identity).sort();
      expect(found).toEqual([...AUTHENTICATED_ALLOWED_IDENTITIES].sort());
    });
  },
);
