/**
 * @jest-environment node
 */

/**
 * s68a — only the service role writes `edit_sessions` (ADR 047, H1).
 *
 * WHAT BROKE. `edit_sessions` is a bearer credential, and the routes that
 * accept one (staging publish, staging content, staging validate, AI
 * suggest, edit-session extend and validate) used to grant exactly the
 * permissions written inside the row. The row was writable by its own holder:
 * "Users can create edit sessions for sites they have access to"
 * (20250817000000_complete_database_setup.sql:483-492) is `FOR INSERT` to
 * PUBLIC with `WITH CHECK (user_id = auth.uid() AND <an edit or admin row>)` —
 * it constrains WHO inserts, never WHAT. `anon` and `authenticated` also held
 * Supabase's default `arwdDxt`. On a fresh replay on 2026-10-08, an `edit`
 * member's own JWT inserted `{permissions: ['admin'], expires_at: '2099-01-01'}`
 * and the row was accepted; presented with no cookie it published to the live
 * site. The owner confirmed the same policy and grants in production.
 *
 * THE FIX IS A REVOKE AND A DATA STEP.
 * 20261008100000_edit_sessions_service_role_writes.sql drops the INSERT
 * policy, revokes every write privilege from PUBLIC, `anon` and
 * `authenticated` (SELECT from PUBLIC and `anon` too), keeps `authenticated`
 * SELECT under the own-rows policy, and deactivates every active row the
 * validator would now refuse (no holder, no `created_at`, a lifetime past 24 h
 * beyond 5 min of clock skew, a `created_at` more than 5 min in the future, or
 * permissions above the holder's live grant).
 *
 * WHAT THIS PROVES, AND HOW.
 * - The catalogue: table AND column privileges (ADR 033 — a column grant is a
 *   write grant that a table check misses), and every write policy.
 * - Role-switched SQL with real `request.jwt.claims`: the member's INSERT is
 *   refused with 42501; the holder still reads their own row and nobody
 *   else's; the service role still inserts (issuance moved there).
 * - The data step, by re-running the migration file itself over planted rows,
 *   twice: it must converge, never reach a legitimate session.
 * - Real PostgREST with a real GoTrue JWT, when a local stack is configured.
 *   Gated to a "[gated]" test only when RCF_TEST_POSTGREST_URL is absent: the
 *   bare PostgreSQL 17 runner (scripts/run-db-invariants.mjs) has no PostgREST
 *   and runs this file under RCF_REQUIRE_TEST_DB=1, so the catalogue and
 *   role-switched halves are what it enforces there.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describeDb, readConfiguredApiPort } from "./db-harness";

const MIGRATION_FILE = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20261008100000_edit_sessions_service_role_writes.sql",
);

/** `public` is how has_*_privilege names the PUBLIC pseudo-role. */
const WEB_PRINCIPALS = ["public", "anon", "authenticated"] as const;
const UNREADING_PRINCIPALS = ["public", "anon"] as const;
const TABLE_WRITE_PRIVILEGES = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;
/** The column-level privilege types that write or bind a table. */
const COLUMN_WRITE_PRIVILEGES = ["INSERT", "UPDATE", "REFERENCES"] as const;
const SERVICE_ROLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
] as const;

const POSTGREST_BASE_URL = process.env.RCF_TEST_POSTGREST_URL;
const POSTGREST_ANON_KEY = process.env.RCF_TEST_POSTGREST_ANON_KEY;

if (POSTGREST_BASE_URL && !POSTGREST_ANON_KEY) {
  throw new Error(
    "RCF_TEST_POSTGREST_URL is set but RCF_TEST_POSTGREST_ANON_KEY is missing: the PostgREST issuance proof cannot sign a user up, and it must not pass unrun.",
  );
}

// Same pin as content-write-privileges.test.ts: this suite signs users up, so
// it only ever talks to this project's local stack.
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

const hasPostgrestTarget = Boolean(POSTGREST_BASE_URL && POSTGREST_ANON_KEY);

interface PgClientLike {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

/** Switches the pinned connection to a signed-in user, for this transaction. */
async function actAs(client: PgClientLike, userId: string): Promise<void> {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

function newToken(): string {
  return `s68a-${randomUUID()}`;
}

describeDb(
  "s68a — only the service role writes edit_sessions (ADR 047)",
  ({ query, withClient, createSite }) => {
    describe("catalogue", () => {
      test("PUBLIC, anon and authenticated hold no table or column write privilege on edit_sessions", async () => {
        const offenders: string[] = [];
        for (const role of WEB_PRINCIPALS) {
          for (const privilege of TABLE_WRITE_PRIVILEGES) {
            const { rows } = await query<{ allowed: boolean }>(
              "SELECT has_table_privilege($1, 'public.edit_sessions', $2) AS allowed",
              [role, privilege],
            );
            if (rows[0]?.allowed) offenders.push(`${role} ${privilege}`);
          }
          for (const privilege of COLUMN_WRITE_PRIVILEGES) {
            const { rows } = await query<{ allowed: boolean }>(
              "SELECT has_any_column_privilege($1, 'public.edit_sessions', $2) AS allowed",
              [role, privilege],
            );
            if (rows[0]?.allowed) {
              offenders.push(`${role} ${privilege} (any column)`);
            }
          }
        }

        expect(offenders).toEqual([]);
      });

      test("PUBLIC and anon cannot read edit_sessions at all", async () => {
        const offenders: string[] = [];
        for (const role of UNREADING_PRINCIPALS) {
          const { rows } = await query<{ table: boolean; column: boolean }>(
            `SELECT has_table_privilege($1, 'public.edit_sessions', 'SELECT') AS table,
                    has_any_column_privilege($1, 'public.edit_sessions', 'SELECT') AS column`,
            [role],
          );
          if (rows[0]?.table) offenders.push(`${role} SELECT`);
          if (rows[0]?.column) offenders.push(`${role} SELECT (any column)`);
        }

        expect(offenders).toEqual([]);
      });

      test("no permissive write policy on edit_sessions targets PUBLIC, anon or authenticated, whatever its predicate", async () => {
        const { rows } = await query<{ offender: string }>(`
          SELECT p.polname || ' [' || p.polcmd::text || ']' AS offender
          FROM pg_policy p
          WHERE p.polrelid = 'public.edit_sessions'::regclass
            AND p.polpermissive
            AND p.polcmd IN ('a', 'w', 'd', '*')
            AND (
              p.polroles = '{0}'
              OR EXISTS (
                SELECT 1 FROM unnest(p.polroles) r
                WHERE r = 0 OR pg_get_userbyid(r) IN ('anon', 'authenticated')
              )
            )
          ORDER BY 1
        `);

        expect(rows.map((row) => row.offender)).toEqual([]);
      });

      test("guard: authenticated keeps SELECT and service_role keeps SELECT, INSERT, UPDATE and DELETE", async () => {
        const { rows: authenticated } = await query<{ allowed: boolean }>(
          "SELECT has_table_privilege('authenticated', 'public.edit_sessions', 'SELECT') AS allowed",
        );
        expect(authenticated[0]?.allowed).toBe(true);

        const missing: string[] = [];
        for (const privilege of SERVICE_ROLE_PRIVILEGES) {
          const { rows } = await query<{ allowed: boolean }>(
            "SELECT has_table_privilege('service_role', 'public.edit_sessions', $1) AS allowed",
            [privilege],
          );
          if (!rows[0]?.allowed) missing.push(privilege);
        }
        expect(missing).toEqual([]);
      });
    });

    describe("role-switched, with real JWT claims", () => {
      let siteId: string;
      const ownerId = randomUUID();
      const editorId = randomUUID();

      beforeAll(async () => {
        siteId = await createSite("s68a-sessions");
        await query(
          "INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)",
          [
            ownerId,
            `s68a-owner-${ownerId}@example.invalid`,
            editorId,
            `s68a-editor-${editorId}@example.invalid`,
          ],
        );
        await query(
          `INSERT INTO site_permissions (site_id, user_id, permission, granted_by)
           VALUES ($1, $2, 'admin', NULL), ($1, $3, 'edit', $2)`,
          [siteId, ownerId, editorId],
        );
      });

      afterAll(async () => {
        await query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [
          [ownerId, editorId],
        ]);
      });

      test("an edit member's own INSERT of an admin session expiring in 2099 is refused with 42501", async () => {
        await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            await actAs(client, editorId);
            await expect(
              client.query(
                `INSERT INTO public.edit_sessions (site_id, user_id, token, permissions, expires_at)
                 VALUES ($1, $2, $3, '{admin}', '2099-01-01T00:00:00Z')`,
                [siteId, editorId, newToken()],
              ),
            ).rejects.toMatchObject({ code: "42501" });
          } finally {
            await client.query("ROLLBACK");
          }
        });
      });

      test("guard: a holder reads their own session and not another user's", async () => {
        await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            const { rows: seeded } = await client.query<{
              id: string;
              user_id: string;
            }>(
              `INSERT INTO public.edit_sessions (site_id, user_id, token, permissions, expires_at)
               VALUES ($1, $2, $4, '{edit}', now() + interval '1 hour'),
                      ($1, $3, $5, '{admin}', now() + interval '1 hour')
               RETURNING id, user_id`,
              [siteId, editorId, ownerId, newToken(), newToken()],
            );
            const editorSession = seeded.find(
              (row) => row.user_id === editorId,
            )!;

            await actAs(client, editorId);
            const { rows } = await client.query<{ id: string }>(
              "SELECT id FROM public.edit_sessions WHERE site_id = $1",
              [siteId],
            );

            expect(rows.map((row) => row.id)).toEqual([editorSession.id]);
          } finally {
            await client.query("ROLLBACK");
          }
        });
      });

      test("guard: the service role still inserts a session", async () => {
        await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            await client.query("SET LOCAL ROLE service_role");
            const inserted = await client.query(
              `INSERT INTO public.edit_sessions (site_id, user_id, token, permissions, expires_at)
               VALUES ($1, $2, $3, '{edit}', now() + interval '2 hours')`,
              [siteId, editorId, newToken()],
            );

            expect(inserted.rowCount).toBe(1);
          } finally {
            await client.query("ROLLBACK");
          }
        });
      });

      test("the migration deactivates every session the validator would refuse, never a legitimate one, and converges", async () => {
        const migrationSql = readFileSync(MIGRATION_FILE, "utf8");

        await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            const plant = async (
              userId: string | null,
              permissions: string,
              lifetime: string,
            ): Promise<string> => {
              const {
                rows: [row],
              } = await client.query<{ id: string }>(
                `INSERT INTO public.edit_sessions
                   (site_id, user_id, token, permissions, created_at, expires_at)
                 VALUES ($1, $2, $3, $4::text[], now(), now() + $5::interval)
                 RETURNING id`,
                [siteId, userId, newToken(), permissions, lifetime],
              );
              return row.id;
            };

            const rogue = {
              noHolder: await plant(null, "{edit}", "1 hour"),
              thirtyDays: await plant(ownerId, "{edit}", "30 days"),
              aboveGrant: await plant(editorId, "{admin}", "1 hour"),
            };
            const legitimate = await plant(editorId, "{view,edit}", "2 hours");

            const stateOf = async () => {
              const { rows } = await client.query<{
                id: string;
                is_active: boolean;
                is_revoked: boolean;
              }>(
                `SELECT id, is_active, revoked_at IS NOT NULL AS is_revoked
                 FROM public.edit_sessions WHERE id = ANY($1::uuid[])`,
                [[...Object.values(rogue), legitimate]],
              );
              return Object.fromEntries(
                rows.map((row) => [
                  row.id,
                  { isActive: row.is_active, isRevoked: row.is_revoked },
                ]),
              );
            };

            const expected = {
              [rogue.noHolder]: { isActive: false, isRevoked: true },
              [rogue.thirtyDays]: { isActive: false, isRevoked: true },
              [rogue.aboveGrant]: { isActive: false, isRevoked: true },
              [legitimate]: { isActive: true, isRevoked: false },
            };

            // Second application (the replay was the first).
            await client.query(migrationSql);
            expect(await stateOf()).toEqual(expected);

            // Third: an operator retry after an uncertain connection result.
            await client.query(migrationSql);
            expect(await stateOf()).toEqual(expected);
          } finally {
            await client.query("ROLLBACK");
          }
        });
      });

      test("the migration deactivates a session created more than 5 min in the future or never dated, never one within the skew (review M1, n1)", async () => {
        const migrationSql = readFileSync(MIGRATION_FILE, "utf8");

        await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            // `expires_at` 12 h after `created_at`: inside the 24 h lifetime,
            // so only the future `created_at` can retire these rows.
            const plantCreatedAhead = async (
              ahead: string,
            ): Promise<string> => {
              const {
                rows: [row],
              } = await client.query<{ id: string }>(
                `INSERT INTO public.edit_sessions
                   (site_id, user_id, token, permissions, created_at, expires_at)
                 VALUES ($1, $2, $3, '{edit}', now() + $4::interval,
                         now() + $4::interval + interval '12 hours')
                 RETURNING id`,
                [siteId, editorId, newToken(), ahead],
              );
              return row.id;
            };

            // Review n1: `created_at` is nullable, and the holder could write
            // NULL too. Every date clause is then NULL, never true, so the row
            // survived the data step — while the HTTP validator refuses it.
            const plantUndated = async (): Promise<string> => {
              const {
                rows: [row],
              } = await client.query<{ id: string }>(
                `INSERT INTO public.edit_sessions
                   (site_id, user_id, token, permissions, created_at, expires_at)
                 VALUES ($1, $2, $3, '{edit}', NULL, now() + interval '12 hours')
                 RETURNING id`,
                [siteId, editorId, newToken()],
              );
              return row.id;
            };

            const rogue = {
              // The review's row: dated decades ahead, it never expired.
              decadesAhead: await plantCreatedAhead("73 years"),
              justPastSkew: await plantCreatedAhead("6 minutes"),
              neverDated: await plantUndated(),
            };
            const withinSkew = await plantCreatedAhead("4 minutes");

            await client.query(migrationSql);

            const { rows } = await client.query<{
              id: string;
              is_active: boolean;
              is_revoked: boolean;
            }>(
              `SELECT id, is_active, revoked_at IS NOT NULL AS is_revoked
               FROM public.edit_sessions WHERE id = ANY($1::uuid[])`,
              [[...Object.values(rogue), withinSkew]],
            );

            expect(
              Object.fromEntries(
                rows.map((row) => [
                  row.id,
                  { isActive: row.is_active, isRevoked: row.is_revoked },
                ]),
              ),
            ).toEqual({
              [rogue.decadesAhead]: { isActive: false, isRevoked: true },
              [rogue.justPastSkew]: { isActive: false, isRevoked: true },
              [rogue.neverDated]: { isActive: false, isRevoked: true },
              [withinSkew]: { isActive: true, isRevoked: false },
            });
          } finally {
            await client.query("ROLLBACK");
          }
        });
      });

      test("the migration tolerates the same 5 min of clock skew on the 24 h lifetime, never more (review m5)", async () => {
        const migrationSql = readFileSync(MIGRATION_FILE, "utf8");

        await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            // The database stamps `created_at`; the application computes
            // `expires_at` from its own clock. A full 24 h grant issued by an
            // app clock 2 min ahead lands 2 min past `created_at + 24 h`.
            const plantLifetime = async (lifetime: string): Promise<string> => {
              const {
                rows: [row],
              } = await client.query<{ id: string }>(
                `INSERT INTO public.edit_sessions
                   (site_id, user_id, token, permissions, created_at, expires_at)
                 VALUES ($1, $2, $3, '{edit}', now(), now() + $4::interval)
                 RETURNING id`,
                [siteId, editorId, newToken(), lifetime],
              );
              return row.id;
            };

            const withinSkew = await plantLifetime("24 hours 2 minutes");
            const pastSkew = await plantLifetime("24 hours 6 minutes");

            await client.query(migrationSql);

            const { rows } = await client.query<{
              id: string;
              is_active: boolean;
              is_revoked: boolean;
            }>(
              `SELECT id, is_active, revoked_at IS NOT NULL AS is_revoked
               FROM public.edit_sessions WHERE id = ANY($1::uuid[])`,
              [[withinSkew, pastSkew]],
            );

            expect(
              Object.fromEntries(
                rows.map((row) => [
                  row.id,
                  { isActive: row.is_active, isRevoked: row.is_revoked },
                ]),
              ),
            ).toEqual({
              [withinSkew]: { isActive: true, isRevoked: false },
              [pastSkew]: { isActive: false, isRevoked: true },
            });
          } finally {
            await client.query("ROLLBACK");
          }
        });
      });
    });

    if (!hasPostgrestTarget) {
      test("[gated] no PostgREST target configured — direct issuance not probed", () => {
        console.warn(
          "Set RCF_TEST_POSTGREST_URL and RCF_TEST_POSTGREST_ANON_KEY to probe PostgREST with a real GoTrue JWT.",
        );
        expect(hasPostgrestTarget).toBe(false);
      });
      return;
    }

    describe("through PostgREST with a real user JWT", () => {
      let member: { userId: string; accessToken: string; siteId: string };

      beforeAll(async () => {
        const email = `s68a-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
        const response = await fetch(`${POSTGREST_BASE_URL}/auth/v1/signup`, {
          method: "POST",
          headers: {
            apikey: POSTGREST_ANON_KEY!,
            Authorization: `Bearer ${POSTGREST_ANON_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email,
            password: `S68a-${randomUUID()}-Aa1!`,
          }),
        });
        const body = (await response.json()) as {
          access_token?: string;
          user?: { id?: string };
        };
        if (response.status !== 200 || !body.access_token || !body.user?.id) {
          throw new Error(`GoTrue signup answered ${response.status}`);
        }
        const siteId = await createSite("s68a-postgrest");
        await query(
          "INSERT INTO site_permissions (site_id, user_id, permission) VALUES ($1, $2, 'edit')",
          [siteId, body.user.id],
        );
        member = {
          userId: body.user.id,
          accessToken: body.access_token,
          siteId,
        };
      });

      afterAll(async () => {
        if (!member) return;
        await query("DELETE FROM auth.users WHERE id = $1", [member.userId]);
      });

      test("an edit member's POST /rest/v1/edit_sessions minting an admin session is refused and no row exists", async () => {
        const token = newToken();
        const response = await fetch(
          `${POSTGREST_BASE_URL}/rest/v1/edit_sessions`,
          {
            method: "POST",
            headers: {
              apikey: POSTGREST_ANON_KEY!,
              Authorization: `Bearer ${member.accessToken}`,
              "Content-Type": "application/json",
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              site_id: member.siteId,
              user_id: member.userId,
              token,
              permissions: ["admin"],
              expires_at: "2099-01-01T00:00:00Z",
            }),
          },
        );
        const text = await response.text();

        expect({
          status: response.status,
          body: text ? JSON.parse(text) : null,
        }).toEqual({
          status: 403,
          body: expect.objectContaining({ code: "42501" }),
        });
        const { rows } = await query(
          "SELECT id FROM edit_sessions WHERE token = $1",
          [token],
        );
        expect(rows).toEqual([]);
      });
    });
  },
);
