/**
 * @jest-environment node
 */

/**
 * s96 (ADR 062) — `public.tool_reports` is reachable by the service role only.
 *
 * WHY. A free-tool report is public to whoever holds its link, which makes an
 * anon SELECT policy look right. It would let anyone holding the public anon
 * key run `GET /rest/v1/tool_reports?select=*` and list every address anyone
 * ever scanned, staging hosts included — unguessable ids protect nothing once
 * there is a listing. So no web principal holds a policy, a table privilege, a
 * column privilege or EXECUTE on the prune function; the report page reads one
 * row by id through the service role.
 *
 * WHAT THIS PROVES.
 * - The catalogue: RLS on, exactly one policy (service_role), no privilege of
 *   any kind for PUBLIC, anon or authenticated (TRUNCATE, REFERENCES and
 *   TRIGGER included), and immutable rows (the service role holds no UPDATE).
 * - Role-switched SQL: anon's and authenticated's SELECT and INSERT are 42501.
 * - Every CHECK, and that the LARGEST report the app can serialise (12 KB of
 *   compact, multibyte JSON) fits the 16 KB `report::text` ceiling.
 * - `prune_tool_reports` deletes expired rows first, then the oldest beyond
 *   the ceiling; it is SECURITY INVOKER and not executable by a web principal.
 * - The migration re-applied converges.
 * - Through the real PostgREST, when a local stack is configured, the anon key
 *   lists nothing. Gated to a "[gated]" test otherwise: the bare PostgreSQL 17
 *   replay (scripts/run-db-invariants.mjs) has no PostgREST.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createFinding, MAX_FINDINGS } from "@/lib/tools/lens";
import {
  compactBytes,
  MAX_REPORT_BYTES,
  serializeReport,
  type ToolReport,
} from "@/lib/tools/report/report-schema";
import { describeDb, readConfiguredApiPort } from "./db-harness";

const MIGRATION_FILE = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20261011120000_tool_reports.sql",
);

const WEB_PRINCIPALS = ["public", "anon", "authenticated"] as const;
const TABLE_PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;
const COLUMN_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "REFERENCES"] as const;

const POSTGREST_BASE_URL = process.env.RCF_TEST_POSTGREST_URL;
const POSTGREST_ANON_KEY = process.env.RCF_TEST_POSTGREST_ANON_KEY;

if (POSTGREST_BASE_URL && !POSTGREST_ANON_KEY) {
  throw new Error(
    "RCF_TEST_POSTGREST_URL is set but RCF_TEST_POSTGREST_ANON_KEY is missing: the anon listing probe must not pass unrun.",
  );
}
if (POSTGREST_BASE_URL) {
  const target = new URL(POSTGREST_BASE_URL);
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    target.hostname,
  );
  if (
    target.protocol !== "http:" ||
    !isLoopback ||
    target.port !== String(readConfiguredApiPort()) ||
    target.pathname !== "/"
  ) {
    throw new Error(
      `Refusing PostgREST integration target outside this project's local Supabase: ${target.origin}`,
    );
  }
}
const hasPostgrestTarget = Boolean(POSTGREST_BASE_URL && POSTGREST_ANON_KEY);

const HOME = "https://example.com/";

/**
 * The biggest report `serializeReport` lets through: forty findings whose
 * every text field is at its cap in multibyte characters (2–3 bytes each),
 * trimmed by the serializer to just under 12 KB of compact JSON. Short page
 * URLs, so that many findings — and their `": "` / `", "` separators, which
 * `report::text` widens — reach the row.
 */
function largestReport(): ToolReport {
  const findings = Array.from({ length: MAX_FINDINGS }, (_, index) =>
    createFinding({
      page: `${HOME}p${index}`,
      kind: "typo",
      match: "é".repeat(80),
      before: "€".repeat(200),
      after: "日".repeat(200),
      note: "ü".repeat(400),
      suggestion: "ß".repeat(80),
    }),
  );
  return serializeReport({
    v: 1,
    tool: "website-spell-checker",
    url: HOME,
    finalUrl: HOME,
    scannedAt: "2026-10-11T12:00:00.000Z",
    summary: {
      headline: "h".repeat(300),
      verdict: "warn",
      facts: Array.from({ length: 8 }, () => ({
        label: "l".repeat(120),
        value: "v".repeat(120),
      })),
    },
    findings,
    pages: [{ url: HOME, status: "checked" }],
    truncated: false,
  });
}

interface PgClientLike {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

async function sqlState(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
}

describeDb(
  "s96 — tool_reports is service-role only (ADR 062)",
  ({ query, withClient }) => {
    describe("catalogue", () => {
      test("RLS is on, with exactly one policy, FOR ALL TO service_role", async () => {
        const { rows: table } = await query<{ rls: boolean }>(
          "SELECT relrowsecurity AS rls FROM pg_class WHERE oid = 'public.tool_reports'::regclass",
        );
        const { rows: policies } = await query<{
          cmd: string;
          roles: string[];
        }>(
          `SELECT polcmd::text AS cmd, ARRAY(SELECT pg_get_userbyid(r)::text FROM unnest(polroles) r) AS roles
           FROM pg_policy WHERE polrelid = 'public.tool_reports'::regclass`,
        );

        expect(table[0]?.rls).toBe(true);
        expect(policies).toEqual([{ cmd: "*", roles: ["service_role"] }]);
      });

      test("PUBLIC, anon and authenticated hold no table or column privilege", async () => {
        const offenders: string[] = [];
        for (const role of WEB_PRINCIPALS) {
          for (const privilege of TABLE_PRIVILEGES) {
            const { rows } = await query<{ allowed: boolean }>(
              "SELECT has_table_privilege($1, 'public.tool_reports', $2) AS allowed",
              [role, privilege],
            );
            if (rows[0]?.allowed) offenders.push(`${role} ${privilege}`);
          }
          for (const privilege of COLUMN_PRIVILEGES) {
            const { rows } = await query<{ allowed: boolean }>(
              "SELECT has_any_column_privilege($1, 'public.tool_reports', $2) AS allowed",
              [role, privilege],
            );
            if (rows[0]?.allowed)
              offenders.push(`${role} ${privilege} (column)`);
          }
        }

        expect(offenders).toEqual([]);
      });

      test("the service role reads, inserts and deletes, and never updates: rows are immutable", async () => {
        const held: Record<string, boolean> = {};
        for (const privilege of TABLE_PRIVILEGES) {
          const { rows } = await query<{ allowed: boolean }>(
            "SELECT has_table_privilege('service_role', 'public.tool_reports', $1) AS allowed",
            [privilege],
          );
          held[privilege] = Boolean(rows[0]?.allowed);
        }

        expect(held).toEqual({
          SELECT: true,
          INSERT: true,
          DELETE: true,
          UPDATE: false,
          TRUNCATE: false,
          REFERENCES: false,
          TRIGGER: false,
        });
      });

      test("prune_tool_reports is SECURITY INVOKER and only the service role may execute it", async () => {
        const { rows: definer } = await query<{ definer: boolean }>(
          "SELECT prosecdef AS definer FROM pg_proc WHERE oid = 'public.prune_tool_reports(integer)'::regprocedure",
        );
        const offenders: string[] = [];
        for (const role of WEB_PRINCIPALS) {
          const { rows } = await query<{ allowed: boolean }>(
            "SELECT has_function_privilege($1, 'public.prune_tool_reports(integer)', 'EXECUTE') AS allowed",
            [role],
          );
          if (rows[0]?.allowed) offenders.push(role);
        }
        const { rows: service } = await query<{ allowed: boolean }>(
          "SELECT has_function_privilege('service_role', 'public.prune_tool_reports(integer)', 'EXECUTE') AS allowed",
        );

        expect(definer[0]?.definer).toBe(false);
        expect(offenders).toEqual([]);
        expect(service[0]?.allowed).toBe(true);
      });
    });

    describe("role-switched", () => {
      test.each(["anon", "authenticated"])(
        "%s cannot SELECT or INSERT (42501)",
        async (role) => {
          await withClient(async (client: PgClientLike) => {
            await client.query("BEGIN");
            try {
              await client.query(`SET LOCAL ROLE ${role}`);
              const selectState = await sqlState(() =>
                client.query("SELECT id FROM public.tool_reports LIMIT 1"),
              );
              expect(selectState).toBe("42501");
            } finally {
              await client.query("ROLLBACK");
            }
            await client.query("BEGIN");
            try {
              await client.query(`SET LOCAL ROLE ${role}`);
              const insertState = await sqlState(() =>
                client.query(
                  `INSERT INTO public.tool_reports (tool, cache_key, url, report)
                 VALUES ('website-spell-checker', repeat('a', 64), 'https://e.test/', '{}')`,
                ),
              );
              expect(insertState).toBe("42501");
            } finally {
              await client.query("ROLLBACK");
            }
          });
        },
      );
    });

    describe("checks", () => {
      const insertAsServiceRole = async (values: {
        tool?: string;
        cacheKey?: string;
        url?: string;
        report?: string;
        createdAt?: string;
        expiresAt?: string;
      }) =>
        withClient(async (client: PgClientLike) => {
          await client.query("BEGIN");
          try {
            await client.query("SET LOCAL ROLE service_role");
            return await sqlState(() =>
              client.query(
                `INSERT INTO public.tool_reports (tool, cache_key, url, report, created_at, expires_at)
               VALUES ($1, $2, $3, $4::jsonb, coalesce($5::timestamptz, now()), coalesce($6::timestamptz, now() + interval '30 days'))`,
                [
                  values.tool ?? "website-spell-checker",
                  values.cacheKey ?? "a".repeat(64),
                  values.url ?? "https://e.test/",
                  values.report ?? "{}",
                  values.createdAt ?? null,
                  values.expiresAt ?? null,
                ],
              ),
            );
          } finally {
            await client.query("ROLLBACK");
          }
        });

      test("a valid row inserts as the service role", async () => {
        expect(await insertAsServiceRole({})).toBeNull();
      });

      test.each([
        ["a tool slug with a slash", { tool: "../etc" }],
        ["an upper-case tool slug", { tool: "Typos" }],
        ["a cache key that is not 64 hex", { cacheKey: "XYZ" }],
        ["a non-web URL", { url: "javascript:alert(1)" }],
        [
          "a URL over 2,048 characters",
          { url: `https://e.test/${"a".repeat(2_040)}` },
        ],
        ["a report that is not an object", { report: "[1,2,3]" }],
        [
          "a report over 16 KB as text",
          { report: JSON.stringify({ big: "x".repeat(16_400) }) },
        ],
        [
          "an expiry not after creation",
          {
            createdAt: "2026-10-11T00:00:00Z",
            expiresAt: "2026-10-11T00:00:00Z",
          },
        ],
      ])("refuses %s (23514)", async (_case, values) => {
        expect(await insertAsServiceRole(values)).toBe("23514");
      });

      test("the largest report the app can serialise (12 KB compact, multibyte) fits", async () => {
        const report = largestReport();
        expect(compactBytes(report)).toBeLessThanOrEqual(MAX_REPORT_BYTES);
        expect(compactBytes(report)).toBeGreaterThan(MAX_REPORT_BYTES - 2_048);

        const text = JSON.stringify(report);
        expect(await insertAsServiceRole({ report: text })).toBeNull();

        const { rows } = await query<{ bytes: number }>(
          "SELECT octet_length($1::jsonb::text) AS bytes",
          [text],
        );
        expect(Number(rows[0].bytes)).toBeLessThanOrEqual(16_384);
      });
    });

    describe("prune_tool_reports", () => {
      test("deletes expired rows first, then the oldest live rows beyond the ceiling", async () => {
        await withClient(async (client: PgClientLike) => {
          await client.query("BEGIN");
          try {
            await client.query("DELETE FROM public.tool_reports");
            const insert = (
              createdOffset: string,
              expiresOffset: string,
              label: string,
            ) =>
              client.query(
                `INSERT INTO public.tool_reports (tool, cache_key, url, report, created_at, expires_at)
               VALUES ('website-spell-checker', encode(sha256($1::bytea), 'hex'), $2, '{}',
                       now() + $3::interval, now() + $4::interval)`,
                [
                  label,
                  `https://e.test/${label}`,
                  createdOffset,
                  expiresOffset,
                ],
              );
            await insert("-40 days", "-10 days", "expired-1");
            await insert("-31 days", "-1 day", "expired-2");
            await insert("-5 days", "25 days", "live-oldest");
            await insert("-4 days", "26 days", "live-older");
            await insert("-3 days", "27 days", "live-old");
            await insert("-2 days", "28 days", "live-new");
            await insert("-1 days", "29 days", "live-newest");

            await client.query("SET LOCAL ROLE service_role");
            const { rows } = await client.query<{
              expired: string;
              trimmed: string;
            }>("SELECT * FROM public.prune_tool_reports(3)");
            const { rows: left } = await client.query<{ url: string }>(
              "SELECT url FROM public.tool_reports ORDER BY created_at DESC",
            );

            expect(rows).toEqual([{ expired: "2", trimmed: "2" }]);
            expect(left.map((row) => row.url)).toEqual([
              "https://e.test/live-newest",
              "https://e.test/live-new",
              "https://e.test/live-old",
            ]);

            const { rows: again } = await client.query<{
              expired: string;
              trimmed: string;
            }>("SELECT * FROM public.prune_tool_reports(3)");
            expect(again).toEqual([{ expired: "0", trimmed: "0" }]);
          } finally {
            await client.query("ROLLBACK");
          }
        });
      });
    });

    describe("re-applying the migration", () => {
      test("converges: same policy, same privileges, no error", async () => {
        const migrationSql = readFileSync(MIGRATION_FILE, "utf8");
        await withClient(async (client: PgClientLike) => {
          await client.query("BEGIN");
          try {
            await client.query(migrationSql);
            await client.query(migrationSql);
            const { rows } = await client.query<{ count: string }>(
              "SELECT count(*) FROM pg_policy WHERE polrelid = 'public.tool_reports'::regclass",
            );
            const { rows: anon } = await client.query<{ allowed: boolean }>(
              "SELECT has_table_privilege('anon', 'public.tool_reports', 'SELECT') AS allowed",
            );
            expect(rows[0].count).toBe("1");
            expect(anon[0].allowed).toBe(false);
          } finally {
            await client.query("ROLLBACK");
          }
        });
      });
    });

    if (!hasPostgrestTarget) {
      test("[gated] no PostgREST target configured — the anon listing is not probed", () => {
        console.warn(
          "Set RCF_TEST_POSTGREST_URL and RCF_TEST_POSTGREST_ANON_KEY to probe PostgREST with the anon key.",
        );
        expect(hasPostgrestTarget).toBe(false);
      });
      return;
    }

    describe("through PostgREST with the public anon key", () => {
      const marker = randomUUID();

      beforeAll(async () => {
        await query(
          `INSERT INTO public.tool_reports (tool, cache_key, url, report)
         VALUES ('website-spell-checker', encode(sha256($1::bytea), 'hex'), $2, '{}')`,
          [marker, `https://e.test/${marker}`],
        );
      });

      afterAll(async () => {
        await query("DELETE FROM public.tool_reports WHERE url = $1", [
          `https://e.test/${marker}`,
        ]);
      });

      test("GET /rest/v1/tool_reports lists nothing", async () => {
        const response = await fetch(
          `${POSTGREST_BASE_URL}/rest/v1/tool_reports?select=*`,
          {
            headers: {
              apikey: POSTGREST_ANON_KEY!,
              Authorization: `Bearer ${POSTGREST_ANON_KEY}`,
            },
          },
        );
        const body = await response.text();

        expect([401, 403, 404]).toContain(response.status);
        expect(body).not.toContain(marker);
      });

      test("POST /rest/v1/tool_reports is refused", async () => {
        const response = await fetch(
          `${POSTGREST_BASE_URL}/rest/v1/tool_reports`,
          {
            method: "POST",
            headers: {
              apikey: POSTGREST_ANON_KEY!,
              Authorization: `Bearer ${POSTGREST_ANON_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              tool: "website-spell-checker",
              cache_key: "f".repeat(64),
              url: "https://e.test/anon",
              report: {},
            }),
          },
        );

        expect([401, 403, 404]).toContain(response.status);
      });
    });
  },
);
