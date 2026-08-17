#!/usr/bin/env node
/**
 * Proves what the production database actually contains — tables, RLS, policies,
 * and which migrations the ledger thinks it applied.
 *
 * WHY THIS EXISTS
 * ---------------
 * This repository cannot tell you the state of its own database, and has been
 * wrong about it repeatedly. Two independent failure modes are live:
 *
 *   1. Migrations that ABORTED and are marked applied. Supabase wraps each
 *      migration in a transaction, so one 42P01 rolls the whole file back while
 *      the ledger records success. It never runs again. Five files are in this
 *      state (see docs/quality/qa-register.md).
 *   2. Migrations that were NEVER APPLIED. The ledger simply stops. Eleven files
 *      on `main` have no ledger row at all.
 *
 * A `CREATE TABLE` in a migration file is therefore NOT evidence that the table
 * exists. Read this script's output instead of reasoning about the files.
 *
 * USAGE
 *   node scripts/check-schema.mjs            # tables + RLS + policies + ledger
 *   node scripts/check-schema.mjs --json     # machine-readable
 *
 * CONNECTION
 *   Needs SUPABASE_PASSWORD and NEXT_PUBLIC_SUPABASE_URL in .env, or
 *   SUPABASE_DB_URL for an explicit override.
 *
 *   `db.<ref>.supabase.co` is IPv6-ONLY. On an IPv4-only host it fails with
 *   ENETUNREACH, which is why earlier attempts at this were abandoned. Use the
 *   POOLER — `aws-0-<region>.pooler.supabase.com:5432`, session mode — which is
 *   IPv4. The region comes from `supabase projects list`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");

function env(key) {
  if (process.env[key]) return process.env[key];
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(path.join(ROOT, file), "utf8");
      const m = text.match(new RegExp(`^${key}=(.+)$`, "m"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      /* next */
    }
  }
  return undefined;
}

function connectionString() {
  const explicit = env("SUPABASE_DB_URL") || env("DATABASE_URL");
  if (explicit) return explicit;

  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const password = env("SUPABASE_PASSWORD");
  if (!url || !password) {
    console.error(
      "Need SUPABASE_DB_URL, or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_PASSWORD, in the environment or .env",
    );
    process.exit(2);
  }
  const ref = new URL(url).hostname.split(".")[0];
  const region = env("SUPABASE_REGION") || "us-east-2";
  const host = `aws-0-${region}.pooler.supabase.com`;
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`;
}

const client = new pg.Client({
  connectionString: connectionString(),
  // The pooler presents a certificate for a different hostname than the one
  // dialled. Verification is off for that reason and no other.
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const { rows: tables } = await client.query(`
  SELECT c.relname AS table,
         c.relrowsecurity AS rls,
         (SELECT count(*)::int FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
   ORDER BY c.relname;
`);

const { rows: applied } = await client.query(
  "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
);

await client.end();

// Ledger vs the files on disk.
const { readdirSync } = await import("node:fs");
const files = readdirSync(path.join(ROOT, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const appliedSet = new Set(applied.map((r) => r.version));
const neverApplied = files.filter((f) => !appliedSet.has(f.split("_")[0]));

const unguarded = tables.filter((t) => !t.rls || t.policies === 0);

if (asJson) {
  console.log(
    JSON.stringify(
      { tables, applied: [...appliedSet], neverApplied, unguarded },
      null,
      2,
    ),
  );
} else {
  console.log(`TABLES IN public: ${tables.length}\n`);
  for (const t of tables) {
    const flag = !t.rls
      ? "  ← RLS OFF"
      : t.policies === 0
        ? "  ← NO POLICIES"
        : "";
    console.log(
      `  ${t.table.padEnd(30)} rls=${t.rls ? "on " : "OFF"} policies=${t.policies}${flag}`,
    );
  }
  console.log(
    `\nRLS: ${unguarded.length === 0 ? "every table has RLS on and at least one policy" : `${unguarded.length} UNGUARDED`}`,
  );
  console.log(
    `\nMIGRATIONS: ${files.length} files, ${appliedSet.size} in the ledger`,
  );
  if (neverApplied.length) {
    console.log(
      `\nNEVER APPLIED (${neverApplied.length}) — production is behind main:`,
    );
    for (const f of neverApplied) console.log(`  ${f}`);
  }
  console.log(
    "\nNote: a migration IN the ledger may still have aborted and applied nothing.\n" +
      "Compare the table list above against what each migration claims to create.",
  );
}

process.exit(unguarded.length > 0 ? 1 : 0);
