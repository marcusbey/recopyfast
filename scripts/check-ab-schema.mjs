#!/usr/bin/env node
/**
 * Proves the A/B data plane's two runtime tables are really in the target
 * database before anything is built on top of them.
 *
 * Why this exists: `supabase/migrations/20260801200000_missing_base_tables.sql:59-66`
 * states in writing that `20260127_ab_testing_v2.sql` aborted on a 42P01
 * (`ab_test_results REFERENCES ab_tests`, and `ab_tests` did not exist yet),
 * that Supabase wraps each migration in a transaction so it rolled back in
 * full, and that the repair file deliberately did NOT recreate
 * `ab_test_results` and `visitor_buckets`. That claim is about the *database*.
 * The migration *files* say the opposite — both tables are created at
 * `20260127_ab_testing_v2.sql:8` and `:40`, and no migration anywhere drops
 * either. Both statements can be true at once, and only the database can
 * settle it, which is what this script is for.
 *
 * It is a probe, not a repair. It creates nothing and writes nothing: if a
 * table is missing, that is a scope decision for the operator, not something
 * an agent adds mid-plan.
 *
 * Credentials come from the environment, never from a literal (AGENTS.md
 * non-negotiable 8). Two modes, because the two halves of the question need
 * different access:
 *
 *   SUPABASE_DB_URL / DATABASE_URL   full probe. RLS, policies and the unique
 *                                    constraint live in pg_catalog, which
 *                                    PostgREST does not expose, so the
 *                                    complete answer needs a direct
 *                                    connection.
 *   SUPABASE_SERVICE_ROLE_KEY        partial probe over PostgREST. Answers
 *   + NEXT_PUBLIC_SUPABASE_URL       "do the tables and columns exist"; cannot
 *                                    answer RLS, policies or constraints, and
 *                                    says so rather than implying it checked.
 *
 * Usage:
 *   node scripts/check-ab-schema.mjs                 # env, or .env.local/.env
 *   node scripts/check-ab-schema.mjs <postgres-url>  # a URL directly
 *
 * Exit codes:
 *   0  every check this run could make passed, and it could make all of them
 *   1  a table, column, constraint or policy the code depends on is missing
 *   2  nothing was probed, or only part of it was — verdict UNKNOWN, not PASS
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What the running code actually reads and writes. Sourced from the routes,
 * not from the migration — the migration is the claim under test.
 *
 * ab_test_results: src/app/api/ab-tests/track/route.ts:145-155
 * visitor_buckets: src/app/api/ab-tests/bucket/[siteId]/route.ts:187-194
 */
const REQUIRED = {
  ab_test_results: [
    "test_id",
    "variant_id",
    "visitor_id",
    "session_id",
    "event_type",
    "value",
    "metadata",
    "geo_country",
    "geo_region",
    "recorded_at",
  ],
  visitor_buckets: [
    "site_id",
    "visitor_id",
    "test_id",
    "variant_id",
    "geo_country",
    "geo_region",
    "bucketed_at",
  ],
};

/**
 * `bucket` upserts with `onConflict: "visitor_id,test_id"`. Without this exact
 * unique constraint the upsert is a 42P10 on every returning visitor.
 */
const REQUIRED_UNIQUE = {
  table: "visitor_buckets",
  columns: ["test_id", "visitor_id"], // sorted, to compare order-insensitively
};

const steps = [];
function record(name, ok, detail) {
  steps.push({ name, ok, detail });
  const mark = ok === true ? "  ok  " : ok === null ? " ???? " : " FAIL ";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Never print a credential — only ever the part that is safe to paste. */
function redact(url) {
  return url.replace(/(postgres(?:ql)?:\/\/)[^@]*@/, "$1<redacted>@");
}

async function readEnvFile(key) {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await readFile(path.join(ROOT, file), "utf8");
      const match = text.match(new RegExp(`^${key}=(.+)$`, "m"));
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      // File absent; try the next one.
    }
  }
  return null;
}

async function resolve(keys) {
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
  }
  for (const key of keys) {
    const fromFile = await readEnvFile(key);
    if (fromFile) return fromFile;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Full probe — direct connection, pg_catalog answers everything.
// ---------------------------------------------------------------------------

async function probeWithDatabaseUrl(connectionString) {
  console.log(`Probing ${redact(connectionString)}\n`);

  const client = new pg.Client({
    connectionString,
    // Supabase's pooler presents a certificate for a different host than the
    // one dialled; this is a read-only catalogue probe, not a data path.
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    for (const [table, columns] of Object.entries(REQUIRED)) {
      const { rows: existing } = await client.query(
        "SELECT to_regclass($1) AS oid",
        [`public.${table}`],
      );
      if (!existing[0].oid) {
        record(`table ${table} exists`, false, "to_regclass returned NULL");
        continue;
      }
      record(`table ${table} exists`, true);

      const { rows: found } = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      const present = new Set(found.map((row) => row.column_name));
      const missing = columns.filter((column) => !present.has(column));
      record(
        `${table} carries every column the code writes`,
        missing.length === 0,
        missing.length ? `missing: ${missing.join(", ")}` : undefined,
      );

      const { rows: rls } = await client.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass",
        [`public.${table}`],
      );
      record(`${table} has RLS enabled`, rls[0]?.relrowsecurity === true);

      const { rows: policies } = await client.query(
        `SELECT count(*)::int AS total FROM pg_policies
          WHERE schemaname = 'public' AND tablename = $1`,
        [table],
      );
      record(
        `${table} has at least one policy`,
        (policies[0]?.total ?? 0) > 0,
        `${policies[0]?.total ?? 0} policies`,
      );
    }

    const { rows: unique } = await client.query(
      `SELECT (
         SELECT array_agg(a.attname::text ORDER BY a.attname)
           FROM unnest(c.conkey) AS k
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
       ) AS cols
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND t.relname = $1 AND c.contype = 'u'`,
      [REQUIRED_UNIQUE.table],
    );
    const wanted = REQUIRED_UNIQUE.columns.join(",");
    const matched = unique.some((row) => (row.cols ?? []).join(",") === wanted);
    record(
      `${REQUIRED_UNIQUE.table} is UNIQUE(visitor_id, test_id)`,
      matched,
      matched ? undefined : "the bucket upsert's onConflict has no constraint",
    );
  } finally {
    await client.end();
  }

  return "full";
}

// ---------------------------------------------------------------------------
// Partial probe — PostgREST. Existence and columns only, and it says so.
// ---------------------------------------------------------------------------

async function probeWithServiceRoleKey(supabaseUrl, serviceRoleKey) {
  console.log(`Probing ${supabaseUrl} over PostgREST (partial)\n`);

  for (const [table, columns] of Object.entries(REQUIRED)) {
    const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}?select=${columns.join(",")}&limit=0`;
    let response;
    try {
      response = await fetch(url, {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });
    } catch (error) {
      record(`table ${table} reachable`, false, error.message);
      continue;
    }

    if (response.ok) {
      record(`table ${table} exists with every column the code writes`, true);
      continue;
    }

    const body = await response.text();
    record(
      `table ${table} exists with every column the code writes`,
      false,
      `HTTP ${response.status} ${body.slice(0, 200)}`,
    );
  }

  record(
    "RLS, policies and UNIQUE(visitor_id, test_id)",
    null,
    "not visible over PostgREST — set SUPABASE_DB_URL for the full probe",
  );

  return "partial";
}

async function main() {
  const databaseUrl =
    process.argv[2] ||
    (await resolve(["SUPABASE_DB_URL", "DATABASE_URL", "POSTGRES_URL"]));
  const supabaseUrl = await resolve([
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_URL",
  ]);
  const serviceRoleKey = await resolve(["SUPABASE_SERVICE_ROLE_KEY"]);

  let coverage;
  if (databaseUrl) {
    coverage = await probeWithDatabaseUrl(databaseUrl);
  } else if (supabaseUrl && serviceRoleKey) {
    coverage = await probeWithServiceRoleKey(supabaseUrl, serviceRoleKey);
  } else {
    console.error(
      "No credentials found. Set SUPABASE_DB_URL (full probe), or\n" +
        "NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (partial probe),\n" +
        "in the environment or in .env.local. Nothing was probed: the verdict is\n" +
        "UNKNOWN, which is not the same as PASS.",
    );
    process.exit(2);
  }

  const failed = steps.filter((step) => step.ok === false);
  const unknown = steps.filter((step) => step.ok === null);

  console.log("");
  if (failed.length > 0) {
    console.error(
      `VERDICT: ABSENT OR PARTIAL — ${failed.length} check(s) failed.\n` +
        "Stop and escalate. Do not create these tables under s11a.",
    );
    process.exit(1);
  }
  if (coverage === "partial" || unknown.length > 0) {
    console.error(
      "VERDICT: INCOMPLETE — the tables and columns are present, but RLS,\n" +
        "policies and the unique constraint were not verifiable with the\n" +
        "credentials given. Re-run with SUPABASE_DB_URL before relying on it.",
    );
    process.exit(2);
  }
  console.log("VERDICT: PRESENT — every check passed.");
}

main().catch((error) => {
  console.error(`Probe failed to run: ${error.message}`);
  process.exit(2);
});
