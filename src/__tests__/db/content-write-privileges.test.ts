/**
 * @jest-environment node
 */

/**
 * s56 — no web principal writes a content table (ADR 042).
 *
 * WHAT BROKE. s51 put the owner-plan gate (`checkOwnerCanEdit`) on every
 * application write, but the database still took the same write without asking
 * the application. `content_elements` carried a `FOR ALL` policy for any
 * `edit`/`admin` member, `ab_tests` and `ab_test_variants` carried INSERT,
 * UPDATE and DELETE policies of the same shape, and `anon`/`authenticated`
 * held Supabase's default DML grants on all of them. The s51 review (finding 1)
 * signed up, took the `admin` row of a site whose owner had no plan, and sent
 * `PATCH /rest/v1/content_elements` with the member's own JWT: 200, and the
 * live `published_content` changed. The route gate was never on that path.
 *
 * THE FIX IS A REVOKE, NOT A PREDICATE. Restating `resolveEntitlement`'s plan
 * rule in a policy is what ADR 040 refused: the rule would exist twice and
 * drift, and the SQL copy could refuse a paying owner the TypeScript gate had
 * admitted. No product surface writes these tables directly, so none keeps a
 * write grant: every content write is a route running the service client after
 * authorization and the gate. A paying member's direct write is refused too.
 *
 * WHAT THIS PROVES, AND HOW.
 * - The catalogue, list-wide over the nine content, history and A/B tables, so
 *   a new write grant or write policy fails here the day it is written.
 * - Real PostgREST with real GoTrue JWTs, for a lapsed owner AND a paying one.
 *   Every refusal is read back through `pg`: with only the policy gone, a
 *   PATCH or DELETE answers 200 with an empty body while changing nothing, so
 *   a status alone proves nothing either way (research trap 8).
 * - Guards that hold before and after the fix: the member SELECT policies and
 *   grants survive (public reads and the dashboard depend on them), and
 *   `service_role` holds the DML every moved route now leans on.
 *
 * REQUIRED, NEVER SKIPPED, IN CI. `column-privileges.test.ts` skips its
 * PostgREST case when the env is missing. Here a missing PostgREST target
 * under `RCF_REQUIRE_TEST_DB=1` fails the suite, so an env typo in CI cannot
 * turn this proof into a pass.
 */

import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { describeDb, readConfiguredApiPort } from "./db-harness";

// The bulk handlers run for real below, against this stack: the real
// NextRequest (cookies included), the real GoTrue session, the real owner gate
// and the real clients. Only the limiter admits, because there is no Redis;
// the limiter itself is proved in update-limiter.test.ts and import.test.ts.
jest.unmock("next/server");
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
}));

const CONTENT_TABLES = [
  "content_elements",
  "content_versions",
  "content_history",
  "staging_history",
  "ab_tests",
  "ab_test_variants",
  "ab_test_results",
  "visitor_buckets",
  "conversion_events",
] as const;

const WEB_ROLES = ["anon", "authenticated"] as const;
const TABLE_WRITE_PRIVILEGES = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
] as const;
/** ADR 033: a column grant is a write grant too, and table checks miss it. */
const COLUMN_WRITE_PRIVILEGES = ["INSERT", "UPDATE"] as const;
const SERVICE_ROLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
] as const;

/** Member reads the dashboard and the A/B screens depend on. */
const MEMBER_SELECT_POLICIES = [
  ["content_elements", "Users can view content for authorized sites"],
  ["ab_tests", "Site members can view ab_tests"],
  ["ab_test_variants", "Site members can view ab_test_variants"],
] as const;

const POSTGREST_BASE_URL = process.env.RCF_TEST_POSTGREST_URL;
const POSTGREST_ANON_KEY = process.env.RCF_TEST_POSTGREST_ANON_KEY;
const POSTGREST_SERVICE_ROLE_KEY =
  process.env.RCF_TEST_POSTGREST_SERVICE_ROLE_KEY;

const hasPostgrestTarget = Boolean(
  POSTGREST_BASE_URL && POSTGREST_ANON_KEY && POSTGREST_SERVICE_ROLE_KEY,
);

if (process.env.RCF_REQUIRE_TEST_DB === "1" && !hasPostgrestTarget) {
  throw new Error(
    "RCF_REQUIRE_TEST_DB=1 but RCF_TEST_POSTGREST_URL, RCF_TEST_POSTGREST_ANON_KEY or RCF_TEST_POSTGREST_SERVICE_ROLE_KEY is missing: the direct-write proof cannot run, and it must not pass unrun.",
  );
}

// Same pin as column-privileges.test.ts: this suite signs users up and writes
// with a service key, so it only ever talks to this project's local stack.
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

// The handlers build their clients from these. Set before any handler module
// is imported: `@/lib/supabase/service` reads them once, at load.
if (hasPostgrestTarget) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = POSTGREST_BASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = POSTGREST_ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = POSTGREST_SERVICE_ROLE_KEY;
}

const PASSWORD = `S56-${crypto.randomUUID()}-Aa1!`;
const SEEDED = "seeded by s56";
const INJECTED = "injected by s56";

interface Member {
  userId: string;
  email: string;
  accessToken: string;
  siteId: string;
  elementRowId: string;
  testId: string;
  variantId: string;
  /** Rows only the bulk handlers touch. */
  bulkRowId: string;
  importRowId: string;
}

interface Fixture {
  lapsed: Member;
  paying: Member;
  /** A row on the lapsed site that only the service-key write touches. */
  serviceElementRowId: string;
}

type ActorKey = "lapsed" | "paying";
const ACTORS: Array<[string, ActorKey]> = [
  ["a member of a lapsed owner's site", "lapsed"],
  ["a member of a paying owner's site", "paying"],
];

async function signUp(
  label: string,
): Promise<{ userId: string; email: string; accessToken: string }> {
  const email = `s56-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await fetch(`${POSTGREST_BASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: POSTGREST_ANON_KEY!,
      Authorization: `Bearer ${POSTGREST_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = (await response.json()) as {
    access_token?: string;
    user?: { id?: string };
  };
  if (response.status !== 200 || !body.access_token || !body.user?.id) {
    throw new Error(
      `GoTrue signup for the ${label} fixture answered ${response.status}`,
    );
  }
  return { userId: body.user.id, email, accessToken: body.access_token };
}

function restUrl(table: string, filters: Record<string, string> = {}): URL {
  const url = new URL(`${POSTGREST_BASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function rest(
  bearer: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: URL,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method,
    headers: {
      apikey: POSTGREST_ANON_KEY!,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

describeDb(
  "s56 — content tables take no direct writes (ADR 042)",
  ({ query, createSite }) => {
    describe("catalogue, list-wide over the nine content tables", () => {
      test("anon and authenticated hold no table or column write privilege", async () => {
        const offenders: string[] = [];
        for (const table of CONTENT_TABLES) {
          for (const role of WEB_ROLES) {
            for (const privilege of TABLE_WRITE_PRIVILEGES) {
              const { rows } = await query<{ allowed: boolean }>(
                "SELECT has_table_privilege($1, format('public.%I', $2::text), $3) AS allowed",
                [role, table, privilege],
              );
              if (rows[0]?.allowed)
                offenders.push(`${role} ${privilege} ${table}`);
            }
            for (const privilege of COLUMN_WRITE_PRIVILEGES) {
              const { rows } = await query<{ allowed: boolean }>(
                "SELECT has_any_column_privilege($1, format('public.%I', $2::text), $3) AS allowed",
                [role, table, privilege],
              );
              if (rows[0]?.allowed) {
                offenders.push(`${role} ${privilege} (any column) ${table}`);
              }
            }
          }
        }

        expect(offenders).toEqual([]);
      });

      test("PUBLIC holds no table write grant", async () => {
        const { rows } = await query<{ offender: string }>(
          `
            SELECT c.relname || ' ' || acl.privilege_type AS offender
            FROM pg_class c
            CROSS JOIN LATERAL aclexplode(c.relacl) acl
            WHERE c.relnamespace = 'public'::regnamespace
              AND c.relname = ANY($1::text[])
              AND acl.grantee = 0
              AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
            ORDER BY 1
          `,
          [CONTENT_TABLES],
        );

        expect(rows.map((row) => row.offender)).toEqual([]);
      });

      test("no permissive write policy targets anon, authenticated or PUBLIC, whatever its predicate", async () => {
        const { rows } = await query<{ offender: string }>(
          `
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
            WHERE c.relnamespace = 'public'::regnamespace
              AND c.relname = ANY($1::text[])
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
          `,
          [CONTENT_TABLES],
        );

        expect(rows.map((row) => row.offender)).toEqual([]);
      });

      test("guard: the member SELECT policies survive", async () => {
        const { rows } = await query<{ table_name: string; polname: string }>(
          `
            SELECT c.relname AS table_name, p.polname
            FROM pg_policy p
            JOIN pg_class c ON c.oid = p.polrelid
            WHERE c.relnamespace = 'public'::regnamespace
              AND p.polcmd = 'r'
          `,
        );
        const present = rows.map(
          (row) => `${row.table_name} :: ${row.polname}`,
        );

        for (const [table, policy] of MEMBER_SELECT_POLICIES) {
          expect(present).toContain(`${table} :: ${policy}`);
        }
      });

      test("guard: authenticated keeps SELECT where members read content and A/B data", async () => {
        for (const [table] of MEMBER_SELECT_POLICIES) {
          const { rows } = await query<{ allowed: boolean }>(
            "SELECT has_table_privilege('authenticated', format('public.%I', $1::text), 'SELECT') AS allowed",
            [table],
          );
          expect({ table, allowed: rows[0]?.allowed }).toEqual({
            table,
            allowed: true,
          });
        }
      });

      test("guard: service_role holds SELECT, INSERT, UPDATE and DELETE on all nine", async () => {
        const missing: string[] = [];
        for (const table of CONTENT_TABLES) {
          for (const privilege of SERVICE_ROLE_PRIVILEGES) {
            const { rows } = await query<{ allowed: boolean }>(
              "SELECT has_table_privilege('service_role', format('public.%I', $1::text), $2) AS allowed",
              [table, privilege],
            );
            if (!rows[0]?.allowed) missing.push(`${privilege} ${table}`);
          }
        }

        expect(missing).toEqual([]);
      });
    });

    if (!hasPostgrestTarget) {
      test("[gated] no PostgREST target configured — direct writes not probed", () => {
        console.warn(
          "Set RCF_TEST_POSTGREST_URL, RCF_TEST_POSTGREST_ANON_KEY and RCF_TEST_POSTGREST_SERVICE_ROLE_KEY to probe PostgREST (RCF_REQUIRE_TEST_DB=1 makes their absence a failure).",
        );
        expect(hasPostgrestTarget).toBe(false);
      });
      return;
    }

    describe("through PostgREST with real user JWTs", () => {
      let fixture: Fixture;

      const seedMember = async (
        label: ActorKey,
        withPlan: boolean,
      ): Promise<Member> => {
        const user = await signUp(label);
        const siteId = await createSite(`s56-${label}`);
        await query(
          "INSERT INTO site_permissions (site_id, user_id, permission) VALUES ($1, $2, 'admin')",
          [siteId, user.userId],
        );
        if (withPlan) {
          // The e2e fixture shape (share-edit-publish.spec.ts).
          await query(
            "INSERT INTO plan_entitlements (user_id, plan_id, source) VALUES ($1, 'pro', 'e2e')",
            [user.userId],
          );
        }
        const {
          rows: [element],
        } = await query<{ id: string }>(
          `INSERT INTO content_elements
             (site_id, element_id, selector, original_content, current_content, published_content)
           VALUES ($1, 's56-probe', '.s56-probe', $2, $2, $2)
           RETURNING id`,
          [siteId, SEEDED],
        );
        const {
          rows: [abTest],
        } = await query<{ id: string }>(
          "INSERT INTO ab_tests (site_id, name, status) VALUES ($1, 's56 probe', 'draft') RETURNING id",
          [siteId],
        );
        const {
          rows: [variant],
        } = await query<{ id: string }>(
          "INSERT INTO ab_test_variants (test_id, name, variant_content) VALUES ($1, 'control', $2) RETURNING id",
          [abTest.id, SEEDED],
        );
        const { rows: bulkRows } = await query<{
          id: string;
          element_id: string;
        }>(
          `INSERT INTO content_elements
             (site_id, element_id, selector, original_content, current_content, published_content)
           VALUES ($1, 's56-bulk', '.s56-bulk', $2, $2, $2),
                  ($1, 's56-import', '.s56-import', $2, $2, $2)
           RETURNING id, element_id`,
          [siteId, SEEDED],
        );
        const rowIdOf = (elementId: string) =>
          bulkRows.find((row) => row.element_id === elementId)!.id;
        return {
          ...user,
          siteId,
          elementRowId: element.id,
          testId: abTest.id,
          variantId: variant.id,
          bulkRowId: rowIdOf("s56-bulk"),
          importRowId: rowIdOf("s56-import"),
        };
      };

      beforeAll(async () => {
        const lapsed = await seedMember("lapsed", false);
        const paying = await seedMember("paying", true);
        const {
          rows: [serviceElement],
        } = await query<{ id: string }>(
          `INSERT INTO content_elements
             (site_id, element_id, selector, current_content, published_content)
           VALUES ($1, 's56-service', '.s56-service', $2, $2)
           RETURNING id`,
          [lapsed.siteId, SEEDED],
        );
        fixture = { lapsed, paying, serviceElementRowId: serviceElement.id };
      });

      afterAll(async () => {
        if (!fixture) return;
        await query("DELETE FROM sites WHERE id = ANY($1::uuid[])", [
          [fixture.lapsed.siteId, fixture.paying.siteId],
        ]);
        await query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [
          [fixture.lapsed.userId, fixture.paying.userId],
        ]);
      });

      const expectRefused = (response: { status: number; body: unknown }) => {
        expect(response).toEqual({
          status: 403,
          body: expect.objectContaining({ code: "42501" }),
        });
      };

      const readElement = async (id: string) => {
        const { rows } = await query<{ published_content: string }>(
          "SELECT published_content FROM content_elements WHERE id = $1",
          [id],
        );
        return rows;
      };

      describe.each(ACTORS)("%s, with their own JWT", (_label, key) => {
        test("PATCH content_elements published_content is refused and the live copy is unchanged", async () => {
          const member = fixture[key];
          const response = await rest(
            member.accessToken,
            "PATCH",
            restUrl("content_elements", { id: `eq.${member.elementRowId}` }),
            { published_content: INJECTED },
          );

          expectRefused(response);
          expect(await readElement(member.elementRowId)).toEqual([
            { published_content: SEEDED },
          ]);
        });

        test("POST content_elements is refused and no row is created", async () => {
          const member = fixture[key];
          const response = await rest(
            member.accessToken,
            "POST",
            restUrl("content_elements"),
            {
              site_id: member.siteId,
              element_id: "s56-injected",
              selector: ".s56-injected",
              current_content: INJECTED,
              published_content: INJECTED,
            },
          );

          expectRefused(response);
          const { rows } = await query(
            "SELECT id FROM content_elements WHERE site_id = $1 AND element_id = 's56-injected'",
            [member.siteId],
          );
          expect(rows).toEqual([]);
        });

        test("DELETE content_elements is refused and the row is still there", async () => {
          const member = fixture[key];
          const response = await rest(
            member.accessToken,
            "DELETE",
            restUrl("content_elements", { id: `eq.${member.elementRowId}` }),
          );

          expectRefused(response);
          expect(await readElement(member.elementRowId)).toEqual([
            { published_content: SEEDED },
          ]);
        });

        test("PATCH ab_tests status is refused and the test stays a draft", async () => {
          const member = fixture[key];
          const response = await rest(
            member.accessToken,
            "PATCH",
            restUrl("ab_tests", { id: `eq.${member.testId}` }),
            { status: "active" },
          );

          expectRefused(response);
          const { rows } = await query<{ status: string }>(
            "SELECT status FROM ab_tests WHERE id = $1",
            [member.testId],
          );
          expect(rows).toEqual([{ status: "draft" }]);
        });

        test("POST ab_test_variants is refused and no variant is created", async () => {
          const member = fixture[key];
          const response = await rest(
            member.accessToken,
            "POST",
            restUrl("ab_test_variants"),
            {
              test_id: member.testId,
              name: "injected",
              variant_content: INJECTED,
            },
          );

          expectRefused(response);
          const { rows } = await query(
            "SELECT id FROM ab_test_variants WHERE test_id = $1 AND name = 'injected'",
            [member.testId],
          );
          expect(rows).toEqual([]);
        });

        test("DELETE ab_test_variants is refused and the variant is still there", async () => {
          const member = fixture[key];
          const response = await rest(
            member.accessToken,
            "DELETE",
            restUrl("ab_test_variants", { id: `eq.${member.variantId}` }),
          );

          expectRefused(response);
          const { rows } = await query<{ variant_content: string }>(
            "SELECT variant_content FROM ab_test_variants WHERE id = $1",
            [member.variantId],
          );
          expect(rows).toEqual([{ variant_content: SEEDED }]);
        });
      });

      test("the lapsed owner's member still reads the site's content and A/B tests", async () => {
        const member = fixture.lapsed;
        const content = await rest(
          member.accessToken,
          "GET",
          restUrl("content_elements", {
            select: "id,published_content",
            site_id: `eq.${member.siteId}`,
            element_id: "eq.s56-probe",
          }),
        );
        const tests = await rest(
          member.accessToken,
          "GET",
          restUrl("ab_tests", {
            select: "id,status",
            site_id: `eq.${member.siteId}`,
          }),
        );

        expect(content).toEqual({
          status: 200,
          body: [{ id: member.elementRowId, published_content: SEEDED }],
        });
        expect(tests).toEqual({
          status: 200,
          body: [{ id: member.testId, status: "draft" }],
        });
      });

      test("the service key still writes content_elements", async () => {
        const response = await rest(
          POSTGREST_SERVICE_ROLE_KEY!,
          "PATCH",
          restUrl("content_elements", {
            id: `eq.${fixture.serviceElementRowId}`,
          }),
          { published_content: "written by the service role" },
        );

        expect(response.status).toBeGreaterThanOrEqual(200);
        expect(response.status).toBeLessThan(300);
        expect(await readElement(fixture.serviceElementRowId)).toEqual([
          { published_content: "written by the service role" },
        ]);
      });

      describe("the bulk handlers, with a real session", () => {
        type Handler = (request: NextRequest) => Promise<Response>;
        let bulkUpdate: Handler;
        let bulkImport: Handler;
        let RealNextRequest: typeof NextRequest;
        const cookies: Partial<Record<ActorKey, string>> = {};

        /**
         * The session cookie exactly as `@supabase/ssr` writes it — name,
         * chunking and encoding are the library's, never hand-formatted — so
         * the handler reads it back the way it reads a browser's.
         */
        const sessionCookie = async (member: Member): Promise<string> => {
          let jar: Array<{ name: string; value: string }> = [];
          const client = createServerClient(
            POSTGREST_BASE_URL!,
            POSTGREST_ANON_KEY!,
            {
              cookies: {
                getAll: () => jar,
                setAll: (written) => {
                  for (const { name, value } of written) {
                    jar = jar.filter((cookie) => cookie.name !== name);
                    if (value) jar = [...jar, { name, value }];
                  }
                },
              },
            },
          );
          const { error } = await client.auth.signInWithPassword({
            email: member.email,
            password: PASSWORD,
          });
          if (error) throw error;
          if (jar.length === 0) {
            throw new Error("@supabase/ssr wrote no session cookie");
          }
          return jar.map(({ name, value }) => `${name}=${value}`).join("; ");
        };

        const post = (path: string, cookie: string, body: unknown) =>
          new RealNextRequest(`http://localhost${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie },
            body: JSON.stringify(body),
          });

        const bulkOperationsOf = async (member: Member) => {
          const { rows } = await query<{ operation_type: string }>(
            "SELECT operation_type FROM bulk_operations WHERE user_id = $1 ORDER BY created_at",
            [member.userId],
          );
          return rows.map((row) => row.operation_type);
        };

        beforeAll(async () => {
          ({ NextRequest: RealNextRequest } = await import("next/server"));
          ({ POST: bulkUpdate } = await import("@/app/api/bulk/update/route"));
          ({ POST: bulkImport } = await import("@/app/api/bulk/import/route"));
          cookies.lapsed = await sessionCookie(fixture.lapsed);
          cookies.paying = await sessionCookie(fixture.paying);
        });

        test("a paying owner's bulk update answers 200 and changes the live copy", async () => {
          const member = fixture.paying;
          const response = await bulkUpdate(
            post("/api/bulk/update", cookies.paying!, {
              site_id: member.siteId,
              operations: [
                {
                  element_id: "s56-bulk",
                  operation: "set",
                  content: "Set by the paying owner's bulk update",
                },
              ],
            }),
          );
          const body = (await response.json()) as {
            results?: { successful: number; failed: number };
          };

          expect(response.status).toBe(200);
          expect(body.results).toMatchObject({ successful: 1, failed: 0 });
          expect(await readElement(member.bulkRowId)).toEqual([
            { published_content: "Set by the paying owner's bulk update" },
          ]);
        });

        test("a paying owner's bulk import answers 200, lands the rows and takes one bulk_edit snapshot", async () => {
          const member = fixture.paying;
          const response = await bulkImport(
            post("/api/bulk/import", cookies.paying!, {
              site_id: member.siteId,
              format: "json",
              data: [
                {
                  element_id: "s56-import",
                  selector: ".s56-import",
                  current_content: "Imported over the seeded row",
                },
                {
                  element_id: "s56-import-new",
                  selector: ".s56-import-new",
                  current_content: "Imported as a new row",
                },
              ],
              options: {
                overwrite_existing: true,
                create_missing_elements: true,
              },
            }),
          );
          const body = (await response.json()) as {
            results?: { updated: number; created: number; failed: number };
          };

          expect(response.status).toBe(200);
          expect(body.results).toMatchObject({
            updated: 1,
            created: 1,
            failed: 0,
          });
          expect(await readElement(member.importRowId)).toEqual([
            { published_content: "Imported over the seeded row" },
          ]);
          const { rows: created } = await query(
            `SELECT published_content FROM content_elements
             WHERE site_id = $1 AND element_id = 's56-import-new'`,
            [member.siteId],
          );
          expect(created).toEqual([
            { published_content: "Imported as a new row" },
          ]);
          const { rows: versions } = await query(
            "SELECT change_type FROM content_versions WHERE site_id = $1",
            [member.siteId],
          );
          expect(versions).toEqual([{ change_type: "bulk_edit" }]);
        });

        test("a lapsed owner's bulk update and import answer 402 plan_ended and write nothing", async () => {
          const member = fixture.lapsed;
          const update = await bulkUpdate(
            post("/api/bulk/update", cookies.lapsed!, {
              site_id: member.siteId,
              operations: [
                { element_id: "s56-bulk", operation: "set", content: INJECTED },
              ],
            }),
          );
          const imported = await bulkImport(
            post("/api/bulk/import", cookies.lapsed!, {
              site_id: member.siteId,
              format: "json",
              data: [
                {
                  element_id: "s56-import",
                  selector: ".s56-import",
                  current_content: INJECTED,
                },
              ],
              options: { overwrite_existing: true },
            }),
          );

          expect(update.status).toBe(402);
          await expect(update.json()).resolves.toMatchObject({
            reason: "plan_ended",
          });
          expect(imported.status).toBe(402);
          await expect(imported.json()).resolves.toMatchObject({
            reason: "plan_ended",
          });
          expect(await readElement(member.bulkRowId)).toEqual([
            { published_content: SEEDED },
          ]);
          expect(await readElement(member.importRowId)).toEqual([
            { published_content: SEEDED },
          ]);
          expect(await bulkOperationsOf(member)).toEqual([]);
        });
      });
    });
  },
);
