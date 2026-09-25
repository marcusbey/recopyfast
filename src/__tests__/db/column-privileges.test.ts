/**
 * s38 — secrets in row-readable tables need column allowlists.
 *
 * PostgreSQL privileges are additive: REVOKE SELECT(secret) cannot subtract a
 * table-level SELECT inherited from Supabase defaults. These assertions inspect
 * effective privileges, exercise the RLS boundary with real JWT claims, and
 * deliberately restore each dangerous grant shape to prove the catalogue guard
 * notices it.
 *
 * PostgreSQL superusers, relation owners and the predefined pg_read_all_data
 * family can read regardless of column ACLs. Protected relations must therefore
 * stay owned by the explicitly approved postgres/service_role boundary; owning
 * any one table never exempts an arbitrary role from checks on another. The
 * only application exception is service_role.
 * Predefined pg_* roles are PostgreSQL infrastructure, not login/application
 * principals. No arbitrary future superuser or login role is exempted.
 */

import { describeDb, type QueryResult } from "./db-harness";

type Query = <R = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<QueryResult<R>>;

const COLUMN_ALLOWLISTS = {
  sites: [
    "id",
    "domain",
    "name",
    "created_at",
    "updated_at",
    "status",
    "live_at",
    "last_reported_at",
    "last_mismatch_domain",
    "last_mismatch_at",
  ],
  webhooks: [
    "id",
    "site_id",
    "url",
    "events",
    "is_active",
    "last_triggered_at",
    "failure_count",
    "max_failures",
    "created_by",
    "created_at",
    "updated_at",
    "secret_prefix",
    "coalesce_window_seconds",
    "pending_event_type",
    "pending_payload",
    "pending_dispatch_at",
  ],
  api_keys: [
    "id",
    "user_id",
    "name",
    "key_prefix",
    "scopes",
    "rate_limit_per_minute",
    "is_active",
    "last_used_at",
    "expires_at",
    "created_at",
    "updated_at",
    "site_id",
  ],
  editor_device_grants: [
    "id",
    "site_editor_id",
    "ip_prefix",
    "expires_at",
    "revoked_at",
    "revoked_reason",
    "rotated_from",
    "last_used_at",
    "created_at",
  ],
} as const;

const HIDDEN_COLUMNS = [
  ["sites", "api_key"],
  ["webhooks", "secret"],
  ["api_keys", "key_hash"],
  ["editor_device_grants", "grant_hash"],
  ["editor_device_grants", "user_agent_hash"],
  ["editor_device_grants", "origin_hash"],
] as const;

const INFRASTRUCTURE_ROLE_SQL = `
  r.rolname IN ('postgres', 'service_role')
  OR r.rolname LIKE 'pg\\_%' ESCAPE '\\'
`;

async function effectiveColumns(query: Query, role: string, table: string) {
  const { rows } = await query<{ column_name: string }>(
    `
      SELECT c.column_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = $2
        AND has_column_privilege(
          $1,
          format('%I.%I', c.table_schema, c.table_name),
          c.column_name,
          'SELECT'
        )
      ORDER BY c.ordinal_position
    `,
    [role, table],
  );
  return rows.map((row) => row.column_name);
}

async function reviewedSchemaColumns(query: Query, table: string) {
  const hidden = HIDDEN_COLUMNS.filter(([hiddenTable]) => hiddenTable === table)
    .map(([, column]) => column)
    .sort();
  const { rows } = await query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND NOT (column_name = ANY($2::text[]))
      ORDER BY ordinal_position
    `,
    [table, hidden],
  );
  return rows.map((row) => row.column_name);
}

async function hiddenPrivilegeOffenders(query: Query) {
  const { rows } = await query<{ offender: string }>(`
    WITH hidden(table_name, column_name) AS (
      VALUES ${HIDDEN_COLUMNS.map(
        ([table, column]) => `('${table}', '${column}')`,
      ).join(",\n             ")}
    )
    SELECT r.rolname || ' -> ' || h.table_name || '.' || h.column_name AS offender
    FROM pg_roles r
    CROSS JOIN hidden h
    WHERE NOT (${INFRASTRUCTURE_ROLE_SQL})
      AND has_column_privilege(
        r.rolname,
        format('public.%I', h.table_name),
        h.column_name,
        'SELECT'
      )
    ORDER BY 1
  `);
  return rows.map((row) => row.offender);
}

describeDb(
  "s38 secret-column privilege invariants",
  ({ query, withClient, createSite }) => {
    test("authenticated receives exactly the reviewed nonsecret columns, while anon receives none", async () => {
      for (const [table, expected] of Object.entries(COLUMN_ALLOWLISTS)) {
        expect(await reviewedSchemaColumns(query, table)).toEqual(expected);
        expect(await effectiveColumns(query, "authenticated", table)).toEqual(
          expected,
        );
        expect(await effectiveColumns(query, "anon", table)).toEqual([]);
      }
    });

    test("every non-infrastructure role is denied every hidden column", async () => {
      expect(await hiddenPrivilegeOffenders(query)).toEqual([]);
    });

    test("protected relations are owned only by an approved infrastructure role", async () => {
      const { rows } = await query<{ offender: string }>(`
        SELECT c.relname || ' -> ' || pg_get_userbyid(c.relowner) AS offender
        FROM pg_class c
        WHERE c.oid IN (
          'public.sites'::regclass,
          'public.webhooks'::regclass,
          'public.api_keys'::regclass,
          'public.editor_device_grants'::regclass
        )
          AND pg_get_userbyid(c.relowner) NOT IN ('postgres', 'service_role')
        ORDER BY 1
      `);
      expect(rows.map((row) => row.offender)).toEqual([]);
    });

    test("anon and authenticated cannot inherit a hidden-column reader or a PostgreSQL privilege bypass", async () => {
      const { rows } = await query<{ offender: string }>(`
        WITH RECURSIVE inherited(member, parent) AS (
          SELECT m.member, m.roleid
          FROM pg_auth_members m
          UNION
          SELECT i.member, m.roleid
          FROM inherited i
          JOIN pg_auth_members m ON m.member = i.parent
        ), app_roles AS (
          SELECT oid, rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
        ), dangerous AS (
          SELECT r.oid, r.rolname
          FROM pg_roles r
          WHERE r.rolsuper OR r.rolbypassrls OR r.rolname = 'pg_read_all_data'
          UNION
          SELECT DISTINCT r.oid, r.rolname
          FROM pg_roles r
          CROSS JOIN (VALUES
            ('sites', 'api_key'),
            ('webhooks', 'secret'),
            ('api_keys', 'key_hash'),
            ('editor_device_grants', 'grant_hash'),
            ('editor_device_grants', 'user_agent_hash'),
            ('editor_device_grants', 'origin_hash')
          ) hidden(table_name, column_name)
          WHERE has_column_privilege(
            r.rolname,
            format('public.%I', hidden.table_name),
            hidden.column_name,
            'SELECT'
          )
        )
        SELECT a.rolname || ' inherits ' || d.rolname AS offender
        FROM app_roles a
        JOIN inherited i ON i.member = a.oid
        JOIN dangerous d ON d.oid = i.parent
        ORDER BY 1
      `);
      expect(rows.map((row) => row.offender)).toEqual([]);
    });

    test("sites has no residual table or column mutation privilege for PUBLIC, anon or authenticated", async () => {
      const { rows } = await query<{ offender: string }>(`
        WITH acl AS (
          SELECT grantee, privilege_type
          FROM information_schema.table_privileges
          WHERE table_schema = 'public' AND table_name = 'sites'
          UNION ALL
          SELECT grantee, privilege_type
          FROM information_schema.column_privileges
          WHERE table_schema = 'public' AND table_name = 'sites'
        )
        SELECT grantee || ' -> ' || privilege_type AS offender
        FROM acl
        WHERE grantee IN ('PUBLIC', 'anon', 'authenticated')
          AND privilege_type IN (
            'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES'
          )
        ORDER BY 1
      `);
      expect(rows.map((row) => row.offender)).toEqual([]);
    });

    test("an authenticated view collaborator reads reviewed metadata, sees no other tenant, and cannot read api_key or mutate sites", async () => {
      const userId = "10000000-0000-4000-8000-000000000038";
      const allowedSite = await createSite("s38-allowed");
      await createSite("s38-other");
      await query(
        "INSERT INTO auth.users (id, email) VALUES ($1, 's38-view@example.invalid') ON CONFLICT (id) DO NOTHING",
        [userId],
      );
      await query(
        "INSERT INTO site_permissions (site_id, user_id, permission) VALUES ($1, $2, 'view')",
        [allowedSite, userId],
      );

      await withClient(async (client) => {
        await client.query("BEGIN");
        try {
          await client.query("SET LOCAL ROLE authenticated");
          await client.query(
            "SELECT set_config('request.jwt.claims', $1, true)",
            [JSON.stringify({ sub: userId, role: "authenticated" })],
          );
          const { rows } = await client.query<{ id: string }>(`
            SELECT id, domain, name, created_at, updated_at, status, live_at,
                   last_reported_at, last_mismatch_domain, last_mismatch_at
            FROM public.sites
            ORDER BY id
          `);
          expect(rows.map((row) => row.id)).toEqual([allowedSite]);

          await client.query("SAVEPOINT hidden_column_probe");
          await expect(
            client.query("SELECT api_key FROM public.sites"),
          ).rejects.toMatchObject({ code: "42501" });
          await client.query("ROLLBACK TO SAVEPOINT hidden_column_probe");

          await client.query("SAVEPOINT wildcard_probe");
          await expect(
            client.query("SELECT * FROM public.sites"),
          ).rejects.toMatchObject({ code: "42501" });
          await client.query("ROLLBACK TO SAVEPOINT wildcard_probe");

          await client.query("SAVEPOINT mutation_probe");
          await expect(
            client.query(
              "UPDATE public.sites SET name = 'forbidden' WHERE id = $1",
              [allowedSite],
            ),
          ).rejects.toMatchObject({ code: "42501" });
          await client.query("ROLLBACK TO SAVEPOINT mutation_probe");
        } finally {
          await client.query("ROLLBACK");
        }
      });
    });

    test("service_role retains full site secret reads and writes", async () => {
      await withClient(async (client) => {
        await client.query("BEGIN");
        try {
          await client.query("SET LOCAL ROLE service_role");
          const { rows } = await client.query<{ api_key: string }>(`
            INSERT INTO public.sites (domain, name)
            VALUES ('rcf-s38-service.invalid', 'service role probe')
            RETURNING api_key
          `);
          expect(rows[0].api_key).toHaveLength(64);
          await client.query(
            "UPDATE public.sites SET name = 'service role updated' WHERE domain = 'rcf-s38-service.invalid'",
          );
          await client.query(
            "DELETE FROM public.sites WHERE domain = 'rcf-s38-service.invalid'",
          );
        } finally {
          await client.query("ROLLBACK");
        }
      });
    });

    test("negative controls catch table, PUBLIC, inherited and direct-column grants", async () => {
      const probes: Array<{
        apply: string;
        cleanup: string;
        expected: string;
      }> = [
        {
          apply: "GRANT SELECT ON public.sites TO authenticated",
          cleanup:
            "REVOKE SELECT ON public.sites FROM authenticated; GRANT SELECT (id, domain, name, created_at, updated_at, status, live_at, last_reported_at, last_mismatch_domain, last_mismatch_at) ON public.sites TO authenticated",
          expected: "authenticated -> sites.api_key",
        },
        {
          apply: "GRANT SELECT ON public.webhooks TO PUBLIC",
          cleanup: "REVOKE SELECT ON public.webhooks FROM PUBLIC",
          expected: "anon -> webhooks.secret",
        },
        {
          apply:
            "CREATE ROLE rcf_s38_reader NOLOGIN; GRANT SELECT (key_hash) ON public.api_keys TO rcf_s38_reader; GRANT rcf_s38_reader TO authenticated",
          cleanup:
            "REVOKE rcf_s38_reader FROM authenticated; REVOKE ALL PRIVILEGES ON public.api_keys FROM rcf_s38_reader; DROP ROLE rcf_s38_reader",
          expected: "authenticated -> api_keys.key_hash",
        },
        {
          apply:
            "GRANT SELECT (grant_hash) ON public.editor_device_grants TO authenticated",
          cleanup:
            "REVOKE SELECT (grant_hash) ON public.editor_device_grants FROM authenticated",
          expected: "authenticated -> editor_device_grants.grant_hash",
        },
      ];

      for (const probe of probes) {
        await query(probe.apply);
        try {
          expect(await hiddenPrivilegeOffenders(query)).toContain(
            probe.expected,
          );
        } finally {
          await query(probe.cleanup);
        }
      }
    });

    test("negative control: owning one protected table does not exempt a role from another table's hidden-column guard", async () => {
      const { rows } = await query<{ owner: string }>(`
        SELECT pg_get_userbyid(relowner) AS owner
        FROM pg_class
        WHERE oid = 'public.sites'::regclass
      `);
      const originalOwner = `"${rows[0].owner.replaceAll('"', '""')}"`;

      await query("CREATE ROLE rcf_s38_unexpected_owner NOLOGIN");
      try {
        await query(
          "ALTER TABLE public.sites OWNER TO rcf_s38_unexpected_owner",
        );
        await query(
          "GRANT SELECT (secret) ON public.webhooks TO rcf_s38_unexpected_owner",
        );
        expect(await hiddenPrivilegeOffenders(query)).toContain(
          "rcf_s38_unexpected_owner -> webhooks.secret",
        );
      } finally {
        await query(`ALTER TABLE public.sites OWNER TO ${originalOwner}`);
        await query(
          "REVOKE ALL PRIVILEGES ON public.webhooks FROM rcf_s38_unexpected_owner",
        );
        await query("DROP ROLE rcf_s38_unexpected_owner");
      }
    });

    test("negative control: an unexpected future superuser is not treated as infrastructure", async () => {
      await query("CREATE ROLE rcf_s38_unexpected_super SUPERUSER NOLOGIN");
      try {
        expect(await hiddenPrivilegeOffenders(query)).toContain(
          "rcf_s38_unexpected_super -> sites.api_key",
        );
      } finally {
        await query("DROP ROLE rcf_s38_unexpected_super");
      }
    });

    test("negative control: a new column fails the exact authenticated allowlist until reviewed", async () => {
      await query(
        "ALTER TABLE public.sites ADD COLUMN rcf_s38_unreviewed TEXT",
      );
      try {
        expect(await reviewedSchemaColumns(query, "sites")).not.toEqual(
          COLUMN_ALLOWLISTS.sites,
        );
      } finally {
        await query("ALTER TABLE public.sites DROP COLUMN rcf_s38_unreviewed");
      }
    });
  },
);
