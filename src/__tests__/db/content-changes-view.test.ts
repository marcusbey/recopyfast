/**
 * @jest-environment node
 */

/**
 * s70b — a row's change state is derived once, in a security-invoker view
 * (ADR 054).
 *
 * WHY A VIEW. There is no status column: "changed" compares columns of one
 * row, and PostgREST cannot filter one column against another. The old Content
 * page downloaded every row of every site and derived the state in the browser
 * (`getContentStatus`), differently from the staging GET's
 * `has_staging_changes`, which counts attribute-only drafts. The Changes page
 * filters, counts and pages on `public.content_changes.change_state`, so a
 * wrong CASE hides changes or lists untouched text.
 *
 * WHY SECURITY INVOKER. A view runs as its owner unless told otherwise, and
 * the owner here is `postgres`, which bypasses RLS: a plain view over
 * `content_elements` would hand every signed-in user every site's copy. With
 * `security_invoker = true` the base tables' policies apply to the caller,
 * through the lateral `staging_history` read too, so an `edit` member sees
 * their site's rows and no "who" (history is admin-only), and nobody sees
 * another tenant's rows. That is only provable with a real JWT through the
 * real PostgREST, never with the `postgres` role (research, "The point
 * everything turns on" 2).
 *
 * WHAT THIS PROVES.
 * - Every state of the plan's list, read by a site admin through PostgREST,
 *   and the same pending set as the publish RPC's own "changed" test and the
 *   staging GET's `has_staging_changes` (point 1).
 * - `changed_at`: the draft's time for pending, else `published_at`, else
 *   `updated_at`.
 * - Tenancy: `edit` and `admin` members of site A, an admin of site B, and
 *   `anon`.
 * - The security mode and the grants, read from the catalogue, and the
 *   projection pinned: a widened view is a widened read for every member
 *   (ADR 054, Watch).
 *
 * REQUIRED, NEVER SKIPPED, IN CI. Named in the Supabase-stack DB step of
 * `.github/workflows/ci.yml`; under `RCF_REQUIRE_TEST_DB=1` a missing
 * PostgREST target fails the suite instead of passing "[gated]".
 */

import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { describeDb, readConfiguredApiPort } from "./db-harness";

// The staging GET runs for real below: real NextRequest, real GoTrue session,
// real service client. Its first-party check reads the session through
// `next/headers`' cookie store, which only exists inside a Next request; the
// store is replaced by the cookies `@supabase/ssr` itself wrote at sign-in.
jest.unmock("next/server");
let mockSessionCookies: Array<{ name: string; value: string }> = [];
jest.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => mockSessionCookies,
    set: () => undefined,
  }),
}));

const POSTGREST_BASE_URL = process.env.RCF_TEST_POSTGREST_URL;
const POSTGREST_ANON_KEY = process.env.RCF_TEST_POSTGREST_ANON_KEY;
const POSTGREST_SERVICE_ROLE_KEY =
  process.env.RCF_TEST_POSTGREST_SERVICE_ROLE_KEY;

const hasPostgrestTarget = Boolean(
  POSTGREST_BASE_URL && POSTGREST_ANON_KEY && POSTGREST_SERVICE_ROLE_KEY,
);

if (process.env.RCF_REQUIRE_TEST_DB === "1" && !hasPostgrestTarget) {
  throw new Error(
    "RCF_REQUIRE_TEST_DB=1 but RCF_TEST_POSTGREST_URL, RCF_TEST_POSTGREST_ANON_KEY or RCF_TEST_POSTGREST_SERVICE_ROLE_KEY is missing: the content_changes tenancy proof cannot run, and it must not pass unrun.",
  );
}

// Same pin as content-write-privileges.test.ts: this suite signs users up and
// reads with a service key, so it only ever talks to this project's local stack.
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

// The staging GET builds its clients from these; `@/lib/supabase/service`
// reads them once, at load, so they are set before it is imported.
if (hasPostgrestTarget) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = POSTGREST_BASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = POSTGREST_ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = POSTGREST_SERVICE_ROLE_KEY;
}

const VIEW = "public.content_changes";

/**
 * The projection, in order. A column added here is a column every member of
 * every site can read: it needs a decision, not a drive-by `SELECT ce.*`.
 */
const VIEW_COLUMNS = [
  "id",
  "site_id",
  "element_id",
  "page_path",
  "selector",
  "language",
  "variant",
  "element_type",
  "original_content",
  "published_content",
  "staging_content",
  "created_at",
  "change_state",
  "changed_at",
  "changed_by",
  "last_action",
  "search_text",
] as const;

const PASSWORD = `S70b-${crypto.randomUUID()}-Aa1!`;
const NEWEST_EDITOR = "newest-editor@example.com";

const T = {
  created: "2026-09-28T09:00:00.000Z",
  updated: "2026-10-01T08:00:00.000Z",
  bulkUpdated: "2026-10-02T08:00:00.000Z",
  published: "2026-10-03T12:00:00.000Z",
  revertPublished: "2026-10-04T12:00:00.000Z",
  draft: "2026-10-05T15:30:00.000Z",
  attributeDraft: "2026-10-06T10:00:00.000Z",
  abStaged: "2026-10-07T07:45:00.000Z",
  equalDraft: "2026-10-07T09:00:00.000Z",
  olderHistory: "2026-10-05T15:00:00.000Z",
  newestHistory: "2026-10-05T15:30:00.000Z",
} as const;

interface SeedRow {
  elementId: string;
  original: string;
  published: string | null;
  staging?: string | null;
  stagingUpdatedAt?: string | null;
  publishedAt?: string | null;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

/** One row per state in the plan's list (Task 1), keyed by element id. */
const SITE_A_ROWS: SeedRow[] = [
  {
    elementId: "s70b-untouched",
    original: "Untouched",
    published: "Untouched",
  },
  {
    elementId: "s70b-draft",
    original: "Start free trial",
    published: "Start free trial",
    staging: "Start your 14-day trial",
    stagingUpdatedAt: T.draft,
  },
  {
    // A draft saved with the live text: "Discard draft" lands here.
    elementId: "s70b-draft-equals-live",
    original: "Pricing",
    published: "Pricing",
    staging: "Pricing",
    stagingUpdatedAt: T.equalDraft,
  },
  {
    // Only an attribute was staged: the text is unchanged.
    elementId: "s70b-attribute-draft",
    original: "Docs",
    published: "Docs",
    stagingUpdatedAt: T.attributeDraft,
    metadata: {
      type: "a",
      href: "/docs",
      staging_attributes: { href: "/docs/start" },
    },
  },
  {
    elementId: "s70b-published",
    original: "Copy changes without a developer",
    published: "Ship copy changes in minutes, not sprints",
    publishedAt: T.published,
  },
  {
    // Reverted and published: the text is the original again.
    elementId: "s70b-published-revert",
    original: "Made with care",
    published: "Made with care",
    publishedAt: T.revertPublished,
  },
  {
    // bulk/update, bulk/import and v1 write published_content directly and
    // leave published_at NULL; the text comparison still sees the change.
    elementId: "s70b-bulk-update",
    original: "Contact sales",
    published: "Talk to us",
    updatedAt: T.bulkUpdated,
  },
  {
    // The A/B winner is staged with no staging_history row.
    elementId: "s70b-ab-winner",
    original: "Get started",
    published: "Get started",
    staging: "Start now",
    stagingUpdatedAt: T.abStaged,
  },
];

const EXPECTED_STATES: Record<string, "pending" | "published" | "original"> = {
  "s70b-untouched": "original",
  "s70b-draft": "pending",
  "s70b-draft-equals-live": "original",
  "s70b-attribute-draft": "pending",
  "s70b-published": "published",
  "s70b-published-revert": "published",
  "s70b-bulk-update": "published",
  "s70b-ab-winner": "pending",
};

const EXPECTED_CHANGED_AT: Record<string, string> = {
  // pending → the draft's time
  "s70b-draft": T.draft,
  "s70b-attribute-draft": T.attributeDraft,
  "s70b-ab-winner": T.abStaged,
  // else published_at
  "s70b-published": T.published,
  "s70b-published-revert": T.revertPublished,
  // else updated_at — a draft equal to the live text is not pending, so its
  // staging time does not count either
  "s70b-untouched": T.updated,
  "s70b-draft-equals-live": T.updated,
  "s70b-bulk-update": T.bulkUpdated,
};

interface Member {
  userId: string;
  email: string;
  accessToken: string;
}

interface Fixture {
  siteA: string;
  siteB: string;
  adminA: Member;
  editA: Member;
  adminB: Member;
  rowIdOf: Record<string, string>;
}

interface ViewRow {
  id: string;
  site_id: string;
  element_id: string;
  change_state: string;
  changed_at: string | null;
  changed_by: string | null;
}

async function signUp(label: string): Promise<Member> {
  const email = `s70b-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

async function readView(
  bearer: string,
  filters: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const url = new URL(`${POSTGREST_BASE_URL}/rest/v1/content_changes`);
  url.searchParams.set(
    "select",
    "id,site_id,element_id,change_state,changed_at,changed_by",
  );
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: {
      apikey: POSTGREST_ANON_KEY!,
      Authorization: `Bearer ${bearer}`,
    },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function byElement(body: unknown): Record<string, ViewRow> {
  if (!Array.isArray(body)) {
    throw new Error(`content_changes answered ${JSON.stringify(body)}`);
  }
  return Object.fromEntries(
    (body as ViewRow[]).map((row) => [row.element_id, row]),
  );
}

const instant = (value: string | null) =>
  value === null ? null : new Date(value).toISOString();

describeDb(
  "s70b — content_changes is one security-invoker view (ADR 054)",
  ({ query, withClient, createSite }) => {
    describe("catalogue", () => {
      test("the view runs as its caller: reloptions contain security_invoker=true", async () => {
        const { rows } = await query<{
          relkind: string;
          reloptions: string[] | null;
        }>(
          "SELECT relkind::text AS relkind, reloptions FROM pg_class WHERE oid = to_regclass($1)",
          [VIEW],
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].relkind).toBe("v");
        expect(rows[0].reloptions ?? []).toContain("security_invoker=true");
      });

      test("authenticated and service_role may only SELECT; anon and PUBLIC hold nothing", async () => {
        const privileges = [
          "SELECT",
          "INSERT",
          "UPDATE",
          "DELETE",
          "TRUNCATE",
          "REFERENCES",
          "TRIGGER",
        ];
        const held: string[] = [];
        for (const role of ["anon", "authenticated", "service_role"]) {
          for (const privilege of privileges) {
            const { rows } = await query<{ allowed: boolean }>(
              "SELECT has_table_privilege($1, $2, $3) AS allowed",
              [role, VIEW, privilege],
            );
            if (rows[0]?.allowed) held.push(`${role} ${privilege}`);
          }
        }
        const { rows: publicAcl } = await query<{ privilege: string }>(
          `
            SELECT acl.privilege_type AS privilege
            FROM pg_class c
            CROSS JOIN LATERAL aclexplode(c.relacl) acl
            WHERE c.oid = to_regclass($1) AND acl.grantee = 0
          `,
          [VIEW],
        );

        expect(held.sort()).toEqual([
          "authenticated SELECT",
          "service_role SELECT",
        ]);
        expect(publicAcl).toEqual([]);
      });

      test("the projection is exactly the reviewed column list", async () => {
        const { rows } = await query<{ column_name: string }>(
          `
            SELECT attname AS column_name
            FROM pg_attribute
            WHERE attrelid = to_regclass($1) AND attnum > 0 AND NOT attisdropped
            ORDER BY attnum
          `,
          [VIEW],
        );

        expect(rows.map((row) => row.column_name)).toEqual([...VIEW_COLUMNS]);
      });
    });

    if (!hasPostgrestTarget) {
      test("[gated] no PostgREST target configured — the view's tenancy was not probed", () => {
        console.warn(
          "Set RCF_TEST_POSTGREST_URL, RCF_TEST_POSTGREST_ANON_KEY and RCF_TEST_POSTGREST_SERVICE_ROLE_KEY to probe PostgREST (RCF_REQUIRE_TEST_DB=1 makes their absence a failure).",
        );
        expect(hasPostgrestTarget).toBe(false);
      });
      return;
    }

    describe("through PostgREST with real user JWTs", () => {
      let fixture: Fixture;

      const seedRows = async (siteId: string, rows: SeedRow[]) => {
        const rowIdOf: Record<string, string> = {};
        for (const row of rows) {
          const {
            rows: [inserted],
          } = await query<{ id: string }>(
            `INSERT INTO content_elements
               (site_id, element_id, selector, original_content, current_content,
                published_content, staging_content, staging_updated_at,
                published_at, metadata, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id`,
            [
              siteId,
              row.elementId,
              `#root > main > p.${row.elementId}`,
              row.original,
              row.published,
              row.staging ?? null,
              row.stagingUpdatedAt ?? null,
              row.publishedAt ?? null,
              JSON.stringify(row.metadata ?? { type: "p" }),
              T.created,
              row.updatedAt ?? T.updated,
            ],
          );
          rowIdOf[row.elementId] = inserted.id;
        }
        return rowIdOf;
      };

      beforeAll(async () => {
        const [adminA, editA, adminB] = [
          await signUp("admin-a"),
          await signUp("edit-a"),
          await signUp("admin-b"),
        ];
        const siteA = await createSite("s70b-a");
        const siteB = await createSite("s70b-b");
        await query(
          `INSERT INTO site_permissions (site_id, user_id, permission)
           VALUES ($1, $2, 'admin'), ($1, $3, 'edit'), ($4, $5, 'admin')`,
          [siteA, adminA.userId, editA.userId, siteB, adminB.userId],
        );
        const rowIdOf = await seedRows(siteA, SITE_A_ROWS);
        await seedRows(siteB, [
          {
            elementId: "s70b-other-tenant",
            original: "Site B copy",
            published: "Site B copy, changed",
            publishedAt: T.published,
          },
        ]);
        await query(
          `INSERT INTO staging_history
             (content_element_id, previous_content, new_content, user_email, action, created_at)
           VALUES ($1, 'Start free trial', 'Start your trial', 'older-editor@example.com', 'create', $2),
                  ($1, 'Start your trial', 'Start your 14-day trial', $3, 'update', $4)`,
          [
            rowIdOf["s70b-draft"],
            T.olderHistory,
            NEWEST_EDITOR,
            T.newestHistory,
          ],
        );
        fixture = { siteA, siteB, adminA, editA, adminB, rowIdOf };
      });

      afterAll(async () => {
        if (!fixture) return;
        await query("DELETE FROM sites WHERE id = ANY($1::uuid[])", [
          [fixture.siteA, fixture.siteB],
        ]);
        await query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [
          [fixture.adminA.userId, fixture.editA.userId, fixture.adminB.userId],
        ]);
      });

      test("every seeded state reads as the plan says, for a site admin", async () => {
        const response = await readView(fixture.adminA.accessToken, {
          site_id: `eq.${fixture.siteA}`,
        });

        expect(response.status).toBe(200);
        const states = Object.fromEntries(
          Object.entries(byElement(response.body)).map(([elementId, row]) => [
            elementId,
            row.change_state,
          ]),
        );
        expect(states).toEqual(EXPECTED_STATES);
      });

      test("changed_at is the draft's time for pending, else published_at, else updated_at", async () => {
        const response = await readView(fixture.adminA.accessToken, {
          site_id: `eq.${fixture.siteA}`,
        });

        const changedAt = Object.fromEntries(
          Object.entries(byElement(response.body)).map(([elementId, row]) => [
            elementId,
            instant(row.changed_at),
          ]),
        );
        expect(changedAt).toEqual(EXPECTED_CHANGED_AT);
      });

      test("pending is exactly what the publish RPC would publish (attribute drafts included)", async () => {
        const wouldPublish = await withClient(async (client) => {
          await client.query("BEGIN");
          try {
            const { rows } = await client.query<{ element_id: string }>(
              "SELECT element_id FROM public.publish_staging_content_with_attributes_atomic($1::uuid)",
              [fixture.siteA],
            );
            return rows.map((row) => row.element_id).sort();
          } finally {
            await client.query("ROLLBACK");
          }
        });
        const pending = Object.entries(EXPECTED_STATES)
          .filter(([, state]) => state === "pending")
          .map(([elementId]) => elementId)
          .sort();

        expect(wouldPublish).toEqual(pending);
      });

      test("pending is exactly what the staging GET flags has_staging_changes, on the same rows", async () => {
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
          email: fixture.adminA.email,
          password: PASSWORD,
        });
        if (error) throw error;
        mockSessionCookies = jar;

        const { NextRequest: RealNextRequest } = await import("next/server");
        const { GET } = await import(
          "@/app/api/staging/content/[siteId]/route"
        );
        const response = await GET(
          new RealNextRequest(
            `http://localhost/api/staging/content/${fixture.siteA}`,
          ) as NextRequest,
          { params: Promise.resolve({ siteId: fixture.siteA }) },
        );
        const body = (await response.json()) as {
          content?: Array<{ element_id: string; has_staging_changes: boolean }>;
        };

        expect(response.status).toBe(200);
        const flagged = (body.content ?? [])
          .filter((row) => row.has_staging_changes)
          .map((row) => row.element_id)
          .sort();
        const pending = Object.entries(EXPECTED_STATES)
          .filter(([, state]) => state === "pending")
          .map(([elementId]) => elementId)
          .sort();
        expect(flagged).toEqual(pending);
        expect(flagged).toContain("s70b-attribute-draft");
      });

      test("an admin reads the newest staging_history author as changed_by; the A/B row has none", async () => {
        const rows = byElement(
          (
            await readView(fixture.adminA.accessToken, {
              site_id: `eq.${fixture.siteA}`,
            })
          ).body,
        );

        expect(rows["s70b-draft"].changed_by).toBe(NEWEST_EDITOR);
        expect(rows["s70b-ab-winner"].changed_by).toBeNull();
      });

      test("an edit member reads site A's rows, with changed_by NULL on every one", async () => {
        const response = await readView(fixture.editA.accessToken, {
          site_id: `eq.${fixture.siteA}`,
        });

        expect(response.status).toBe(200);
        const rows = Object.values(byElement(response.body));
        expect(rows.map((row) => row.element_id).sort()).toEqual(
          Object.keys(EXPECTED_STATES).sort(),
        );
        expect(rows.map((row) => row.changed_by)).toEqual(rows.map(() => null));
      });

      test.each([
        ["the admin of site A", "adminA"],
        ["the edit member of site A", "editA"],
      ] as const)(
        "%s reads no row of site B, filtered or not",
        async (_label, key) => {
          const member = fixture[key];
          const filtered = await readView(member.accessToken, {
            site_id: `eq.${fixture.siteB}`,
          });
          const unfiltered = await readView(member.accessToken, {});

          expect(filtered).toEqual({ status: 200, body: [] });
          expect(
            (unfiltered.body as ViewRow[]).filter(
              (row) => row.site_id !== fixture.siteA,
            ),
          ).toEqual([]);
        },
      );

      test("the admin of site B reads no row of site A", async () => {
        const response = await readView(fixture.adminB.accessToken, {
          site_id: `eq.${fixture.siteA}`,
        });

        expect(response).toEqual({ status: 200, body: [] });
      });

      test("anon is refused, not answered with an empty list", async () => {
        const response = await readView(POSTGREST_ANON_KEY!, {
          site_id: `eq.${fixture.siteA}`,
        });

        expect([401, 403]).toContain(response.status);
        expect(response.body).toEqual(
          expect.objectContaining({ code: "42501" }),
        );
      });
    });
  },
);
