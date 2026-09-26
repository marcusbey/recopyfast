/**
 * s38 — secrets in row-readable tables need column allowlists.
 *
 * PostgreSQL privileges are additive: REVOKE SELECT(secret) cannot subtract a
 * table-level SELECT inherited from Supabase defaults. These assertions inspect
 * effective privileges, exercise the RLS boundary with real JWT claims, and
 * deliberately restore each dangerous grant shape to prove the catalogue guard
 * notices it.
 *
 * The security boundary asserted here is the Data API's PUBLIC, anon and
 * authenticated principals. Supabase also installs operational roles with
 * intentional database-wide access: postgres and supabase_admin administer the
 * cluster, service_role bypasses RLS for trusted servers, supabase_etl_admin is
 * the replication/ETL principal, and supabase_read_only_user inherits
 * pg_read_all_data. Those roles are documented by Supabase and are deliberately
 * outside this web-principal assertion; treating their expected access as a
 * leak made this suite fail against a real `supabase start` stack. Sources:
 * https://supabase.com/docs/guides/database/postgres/roles and
 * https://github.com/supabase/postgres/blob/develop/migrations/db/init-scripts/00000000000000-initial-schema.sql#L37-L60
 */

import {
  describeDb,
  readConfiguredApiPort,
  type QueryResult,
} from "./db-harness";

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
  staging_access: [
    "id",
    "site_id",
    "access_type",
    "email",
    "email_verified",
    "verification_code",
    "verification_expires_at",
    "token",
    "permissions",
    "label",
    "created_by",
    "expires_at",
    "is_active",
    "last_used_at",
    "revoked_at",
    "revoked_by",
    "created_at",
    "updated_at",
    "verified_ip_prefix",
    "verified_at",
  ],
} as const;

const HIDDEN_COLUMNS = [
  ["sites", "api_key"],
  ["webhooks", "secret"],
  ["api_keys", "key_hash"],
  ["editor_device_grants", "grant_hash"],
  ["editor_device_grants", "user_agent_hash"],
  ["editor_device_grants", "origin_hash"],
  ["staging_access", "verified_user_agent_hash"],
  ["staging_access", "verified_origin_hash"],
] as const;

// Keep this list explicit and reviewable. Supabase documents postgres,
// service_role, supabase_admin and supabase_etl_admin as elevated platform
// roles; its initial-schema source gives supabase_read_only_user BYPASSRLS and
// pg_read_all_data. The web-principal checks deliberately make no hidden-column
// denial assertion about these managed roles.
const SUPABASE_MANAGED_PRIVILEGED_ROLES = [
  "postgres",
  "service_role",
  "supabase_admin",
  "supabase_etl_admin",
  "supabase_read_only_user",
] as const;

const APPROVED_PROTECTED_TABLE_OWNERS = [
  "postgres",
  "service_role",
  "supabase_admin",
] as const;

const POSTGREST_BASE_URL = process.env.RCF_TEST_POSTGREST_URL;
const POSTGREST_ANON_KEY = process.env.RCF_TEST_POSTGREST_ANON_KEY;

if (POSTGREST_BASE_URL) {
  const target = new URL(POSTGREST_BASE_URL);
  const expectedApiPort = String(readConfiguredApiPort());
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    target.hostname,
  );
  if (
    target.protocol !== "http:" ||
    !isLoopback ||
    target.port !== expectedApiPort ||
    target.pathname !== "/"
  ) {
    throw new Error(
      `Refusing PostgREST integration target outside this project's local Supabase: ${target.origin}`,
    );
  }
}

const testWithPostgrest =
  POSTGREST_BASE_URL && POSTGREST_ANON_KEY ? test : test.skip;

async function effectiveColumns(
  query: Query,
  role: string,
  table: string,
  privilege: "SELECT" | "INSERT" | "UPDATE" | "REFERENCES" = "SELECT",
) {
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
          $3
        )
      ORDER BY c.ordinal_position
    `,
    [role, table, privilege],
  );
  return rows.map((row) => row.column_name);
}

async function hasEffectiveTablePrivilege(
  query: Query,
  role: string,
  table: string,
  privilege: "DELETE" | "TRUNCATE" | "TRIGGER",
): Promise<boolean> {
  const { rows } = await query<{ allowed: boolean }>(
    "SELECT has_table_privilege($1, format('public.%I', $2::text), $3) AS allowed",
    [role, table, privilege],
  );
  return rows[0]?.allowed ?? false;
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

async function protectedHiddenPrivilegeOffenders(query: Query) {
  const { rows } = await query<{ offender: string }>(`
    WITH hidden(table_name, column_name) AS (
      VALUES ${HIDDEN_COLUMNS.map(
        ([table, column]) => `('${table}', '${column}')`,
      ).join(",\n             ")}
    )
    SELECT principal.rolname || ' -> ' || h.table_name || '.' || h.column_name AS offender
    FROM (VALUES ('anon'), ('authenticated')) principal(rolname)
    CROSS JOIN hidden h
    WHERE has_column_privilege(
        principal.rolname,
        format('public.%I', h.table_name),
        h.column_name,
        'SELECT'
      )
    UNION ALL
    SELECT 'PUBLIC -> ' || h.table_name || '.' || h.column_name AS offender
    FROM hidden h
    WHERE EXISTS (
      SELECT 1
      FROM information_schema.table_privileges tp
      WHERE tp.table_schema = 'public'
        AND tp.table_name = h.table_name
        AND tp.grantee = 'PUBLIC'
        AND tp.privilege_type = 'SELECT'
    ) OR EXISTS (
      SELECT 1
      FROM information_schema.column_privileges cp
      WHERE cp.table_schema = 'public'
        AND cp.table_name = h.table_name
        AND cp.column_name = h.column_name
        AND cp.grantee = 'PUBLIC'
        AND cp.privilege_type = 'SELECT'
    )
    ORDER BY 1
  `);
  return rows.map((row) => row.offender);
}

async function isSuperuser(query: Query): Promise<boolean> {
  const { rows } = await query<{ is_superuser: boolean }>(`
    SELECT rolsuper AS is_superuser
    FROM pg_roles
    WHERE rolname = current_user
  `);
  return rows[0]?.is_superuser ?? false;
}

async function unexpectedProtectedTableOwners(query: Query) {
  const { rows } = await query<{ offender: string }>(
    `
      SELECT c.relname || ' -> ' || pg_get_userbyid(c.relowner) AS offender
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
        AND pg_get_userbyid(c.relowner) <> ALL($2::text[])
      ORDER BY 1
    `,
    [
      [
        "sites",
        "webhooks",
        "api_keys",
        "editor_device_grants",
        "staging_access",
      ],
      APPROVED_PROTECTED_TABLE_OWNERS,
    ],
  );
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

    test("PUBLIC, anon and authenticated are denied every hidden column", async () => {
      expect(await protectedHiddenPrivilegeOffenders(query)).toEqual([]);
    });

    test("protected tables remain owned by an explicitly reviewed privileged role", async () => {
      expect(
        APPROVED_PROTECTED_TABLE_OWNERS.every((owner) =>
          SUPABASE_MANAGED_PRIVILEGED_ROLES.includes(owner),
        ),
      ).toBe(true);
      expect(await unexpectedProtectedTableOwners(query)).toEqual([]);
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

    test("web principals retain only the reviewed mutation columns", async () => {
      const tables = ["sites", "webhooks", "api_keys", "editor_device_grants"];
      for (const table of tables) {
        for (const role of ["anon", "authenticated"]) {
          expect(await effectiveColumns(query, role, table, "INSERT")).toEqual(
            [],
          );
          expect(
            await effectiveColumns(query, role, table, "REFERENCES"),
          ).toEqual([]);
          for (const privilege of ["DELETE", "TRUNCATE", "TRIGGER"] as const) {
            expect(
              await hasEffectiveTablePrivilege(query, role, table, privilege),
            ).toBe(false);
          }
        }
      }

      for (const table of ["sites", "webhooks", "api_keys"]) {
        expect(
          await effectiveColumns(query, "authenticated", table, "UPDATE"),
        ).toEqual([]);
        expect(await effectiveColumns(query, "anon", table, "UPDATE")).toEqual(
          [],
        );
      }

      const { rows: publicMutationGrants } = await query<{ grant: string }>(`
        SELECT table_name || ' -> ' || privilege_type AS grant
        FROM information_schema.table_privileges
        WHERE table_schema = 'public'
          AND table_name IN ('sites', 'webhooks', 'api_keys', 'editor_device_grants')
          AND grantee = 'PUBLIC'
          AND privilege_type IN (
            'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES'
          )
        UNION ALL
        SELECT table_name || '.' || column_name || ' -> ' || privilege_type AS grant
        FROM information_schema.column_privileges
        WHERE table_schema = 'public'
          AND table_name IN ('sites', 'webhooks', 'api_keys', 'editor_device_grants')
          AND grantee = 'PUBLIC'
          AND privilege_type IN ('INSERT', 'UPDATE', 'REFERENCES')
        ORDER BY 1
      `);
      expect(publicMutationGrants.map((row) => row.grant)).toEqual([]);

      expect(
        await effectiveColumns(
          query,
          "authenticated",
          "editor_device_grants",
          "UPDATE",
        ),
      ).toEqual(["revoked_at", "revoked_reason"]);
      expect(
        await effectiveColumns(query, "anon", "editor_device_grants", "UPDATE"),
      ).toEqual([]);
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

    test("s42: an API key is created, paused and deleted by the service role, never by the authenticated admin", async () => {
      // /api/api-keys used to write through the user-scoped client. This
      // database refuses that statement — SELECT-only RLS plus the s38 write
      // revokes — which is why every create/pause/delete failed in production.
      // The route now writes with the service role after its own admin check,
      // filtered by id AND user_id. Both halves are proven here against the
      // real policies and grants, with the route's exact column lists.
      const userId = "10000000-0000-4000-8000-000000000042";
      const otherUserId = "10000000-0000-4000-8000-000000000043";
      const responseColumns =
        "id, user_id, site_id, name, key_prefix, scopes, rate_limit_per_minute, " +
        "is_active, last_used_at, expires_at, created_at, updated_at";
      const listColumns =
        "id, name, key_prefix, site_id, scopes, rate_limit_per_minute, " +
        "is_active, last_used_at, expires_at, created_at, updated_at";

      await withClient(async (client) => {
        await client.query("BEGIN");
        try {
          await client.query(
            "INSERT INTO auth.users (id, email) VALUES ($1, 's42-admin@example.invalid')",
            [userId],
          );
          const {
            rows: [site],
          } = await client.query<{ id: string }>(
            "INSERT INTO public.sites (domain, name) VALUES ('rcf-s42-api-keys.invalid', 's42 probe') RETURNING id",
          );
          await client.query(
            "INSERT INTO site_permissions (site_id, user_id, permission) VALUES ($1, $2, 'admin')",
            [site.id, userId],
          );

          await client.query("SET LOCAL ROLE authenticated");
          await client.query(
            "SELECT set_config('request.jwt.claims', $1, true)",
            [JSON.stringify({ sub: userId, role: "authenticated" })],
          );
          await client.query("SAVEPOINT user_scoped_insert");
          await expect(
            client.query(
              `INSERT INTO public.api_keys
                 (user_id, site_id, name, key_hash, key_prefix, is_active)
               VALUES ($1, $2, 'denied', 's42-denied-hash', 'rcp_denied00', true)`,
              [userId, site.id],
            ),
          ).rejects.toMatchObject({ code: "42501" });
          await client.query("ROLLBACK TO SAVEPOINT user_scoped_insert");

          await client.query("SET LOCAL ROLE service_role");
          const {
            rows: [created],
          } = await client.query<Record<string, unknown>>(
            `INSERT INTO public.api_keys
               (user_id, site_id, name, key_hash, key_prefix, is_active)
             VALUES ($1, $2, 'Production', 's42-probe-hash', 'rcp_s42probe', true)
             RETURNING ${responseColumns}`,
            [userId, site.id],
          );
          expect(created).toMatchObject({
            user_id: userId,
            site_id: site.id,
            is_active: true,
          });
          expect(created).not.toHaveProperty("key_hash");

          await client.query("SET LOCAL ROLE authenticated");
          const { rows: listed } = await client.query<{ id: string }>(
            `SELECT ${listColumns} FROM public.api_keys
             WHERE site_id = $1 AND user_id = $2
             ORDER BY created_at DESC`,
            [site.id, userId],
          );
          expect(listed.map((row) => row.id)).toEqual([created.id]);

          await client.query("SET LOCAL ROLE service_role");
          const misdirected = await client.query(
            "UPDATE public.api_keys SET is_active = false WHERE id = $1 AND user_id = $2",
            [created.id, otherUserId],
          );
          expect(misdirected.rowCount).toBe(0);

          const {
            rows: [paused],
          } = await client.query<Record<string, unknown>>(
            `UPDATE public.api_keys SET is_active = false, updated_at = now()
             WHERE id = $1 AND user_id = $2
             RETURNING ${responseColumns}`,
            [created.id, userId],
          );
          expect(paused).toMatchObject({ id: created.id, is_active: false });

          const removed = await client.query(
            "DELETE FROM public.api_keys WHERE id = $1 AND user_id = $2",
            [created.id, userId],
          );
          expect(removed.rowCount).toBe(1);
        } finally {
          await client.query("ROLLBACK");
        }
      });
    });

    testWithPostgrest(
      "an authenticated dashboard embed reads safe site metadata through the real PostgREST API",
      async () => {
        const email = `s38-postgrest-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
        const password = `S38-${crypto.randomUUID()}-Aa1!`;
        const signup = await fetch(`${POSTGREST_BASE_URL}/auth/v1/signup`, {
          method: "POST",
          headers: {
            apikey: POSTGREST_ANON_KEY!,
            Authorization: `Bearer ${POSTGREST_ANON_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });
        const signupBody = (await signup.json()) as {
          access_token?: string;
          user?: { id?: string };
          msg?: string;
          error_description?: string;
        };
        expect(signup.status).toBe(200);
        expect(signupBody.access_token).toEqual(expect.any(String));
        expect(signupBody.user?.id).toEqual(expect.any(String));

        const userId = signupBody.user!.id!;
        const accessToken = signupBody.access_token!;
        const siteId = await createSite("s38-postgrest-embed");
        await query(
          "INSERT INTO site_permissions (site_id, user_id, permission) VALUES ($1, $2, 'view')",
          [siteId, userId],
        );

        try {
          const safeSelect = new URL(
            `${POSTGREST_BASE_URL}/rest/v1/site_permissions`,
          );
          safeSelect.searchParams.set(
            "select",
            "permission,sites(id,domain,name,created_at,updated_at,status,live_at,last_reported_at,last_mismatch_domain,last_mismatch_at)",
          );
          safeSelect.searchParams.set("user_id", `eq.${userId}`);
          const safeResponse = await fetch(safeSelect, {
            headers: {
              apikey: POSTGREST_ANON_KEY!,
              Authorization: `Bearer ${accessToken}`,
            },
          });
          expect(safeResponse.status).toBe(200);
          await expect(safeResponse.json()).resolves.toEqual([
            {
              permission: "view",
              sites: expect.objectContaining({ id: siteId }),
            },
          ]);

          const hiddenSelect = new URL(
            `${POSTGREST_BASE_URL}/rest/v1/site_permissions`,
          );
          hiddenSelect.searchParams.set(
            "select",
            "permission,sites(id,api_key)",
          );
          hiddenSelect.searchParams.set("user_id", `eq.${userId}`);
          const hiddenResponse = await fetch(hiddenSelect, {
            headers: {
              apikey: POSTGREST_ANON_KEY!,
              Authorization: `Bearer ${accessToken}`,
            },
          });
          expect(hiddenResponse.status).toBe(403);
          await expect(hiddenResponse.json()).resolves.toEqual(
            expect.objectContaining({ code: "42501" }),
          );
        } finally {
          await query("DELETE FROM auth.users WHERE id = $1", [userId]);
        }
      },
    );

    test("anon can run the public plans health probe without sites access", async () => {
      await withClient(async (client) => {
        await client.query("BEGIN");
        try {
          await client.query("SET LOCAL ROLE anon");
          await expect(
            client.query("SELECT id FROM public.plans LIMIT 1"),
          ).resolves.toMatchObject({ rows: expect.any(Array) });
          await expect(
            client.query("SELECT id FROM public.sites LIMIT 1"),
          ).rejects.toMatchObject({ code: "42501" });
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
          expect(await protectedHiddenPrivilegeOffenders(query)).toContain(
            probe.expected,
          );
        } finally {
          await query(probe.cleanup);
        }
      }
    });

    test("negative controls catch stale device-hash UPDATE and sibling TRUNCATE grants", async () => {
      await query(
        "GRANT UPDATE (grant_hash) ON public.editor_device_grants TO authenticated",
      );
      try {
        expect(
          await effectiveColumns(
            query,
            "authenticated",
            "editor_device_grants",
            "UPDATE",
          ),
        ).toContain("grant_hash");
      } finally {
        await query(
          "REVOKE UPDATE (grant_hash) ON public.editor_device_grants FROM authenticated",
        );
      }

      await query("GRANT TRUNCATE ON public.webhooks TO authenticated");
      try {
        expect(
          await hasEffectiveTablePrivilege(
            query,
            "authenticated",
            "webhooks",
            "TRUNCATE",
          ),
        ).toBe(true);
      } finally {
        await query("REVOKE TRUNCATE ON public.webhooks FROM authenticated");
      }
    });

    const superuserTest = test;

    superuserTest(
      "negative control: owning one protected table does not exempt an application role",
      async () => {
        if (!(await isSuperuser(query))) {
          console.warn(
            "Skipping owner-transfer negative control: Supabase's postgres login is intentionally not a superuser and cannot ALTER TABLE OWNER.",
          );
          return;
        }
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
          expect(await unexpectedProtectedTableOwners(query)).toContain(
            "sites -> rcf_s38_unexpected_owner",
          );
        } finally {
          await query(`ALTER TABLE public.sites OWNER TO ${originalOwner}`);
          await query(
            "REVOKE ALL PRIVILEGES ON public.webhooks FROM rcf_s38_unexpected_owner",
          );
          await query("DROP ROLE rcf_s38_unexpected_owner");
        }
      },
    );

    superuserTest(
      "negative control: an unexpected future superuser can bypass column ACLs",
      async () => {
        if (!(await isSuperuser(query))) {
          console.warn(
            "Skipping superuser-creation negative control: Supabase's postgres login is intentionally not a superuser and cannot CREATE ROLE SUPERUSER.",
          );
          return;
        }
        await query("CREATE ROLE rcf_s38_unexpected_super SUPERUSER NOLOGIN");
        try {
          expect(
            await effectiveColumns(query, "rcf_s38_unexpected_super", "sites"),
          ).toContain("api_key");
        } finally {
          await query("DROP ROLE rcf_s38_unexpected_super");
        }
      },
    );

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
