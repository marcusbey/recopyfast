/**
 * A-13 — bulk update and AI translate may be dead in production, because the
 * audit trigger writes as the invoking role.
 *
 * `log_content_change()` is declared at
 * 20250817000000_complete_database_setup.sql:524 **without** SECURITY DEFINER,
 * and `content_change_trigger` (`:542-544`) fires it AFTER every
 * content_elements write. A trigger function without SECURITY DEFINER runs as
 * the invoker, so its `INSERT INTO content_history` is judged against the
 * invoker's policies.
 *
 * Both callers use the anon-key user client, i.e. the `authenticated` role:
 * src/app/api/bulk/update/route.ts:20-30 and src/app/api/ai/translate/route.ts:142.
 * The only migration granting `authenticated` INSERT on `content_history` is
 * 20260731008000_rls_policies_for_locked_tables.sql:337-348 — the one recorded
 * as aborted in production. 20260804130000_restore_missing_rls_policies.sql
 * restores SELECT and the service_role grant but *not* that INSERT.
 *
 * An `AFTER ... FOR EACH ROW` refusal aborts the statement that fired it. So if
 * the policy is genuinely absent in production, the user's own UPDATE is rolled
 * back — every bulk find-and-replace and every AI translation fails, and the
 * route reports it as a per-element error rather than a systemic one.
 *
 * Whether the policy is present in production is B-3, and is not answerable
 * from this repository. This file therefore covers it twice:
 *
 *   1. A source assertion that runs everywhere: the trigger must not depend on
 *      the invoker's policy set at all. That is what SECURITY DEFINER buys, and
 *      it makes the answer to B-3 irrelevant. `test.failing` today.
 *   2. A database test, gated on a reachable Postgres, that performs the write
 *      as `authenticated` for real. Its outcome IS the answer to B-3 — see the
 *      two branches documented on it.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// 1. Source assertion — no database required
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

/** The last definition of `log_content_change()` across the migration set. */
function latestTriggerFunctionBody(): { file: string; body: string } | null {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  let latest: { file: string; body: string } | null = null;

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const match = sql.match(
      /CREATE OR REPLACE FUNCTION log_content_change\(\)[\s\S]*?\$\$\s*language/i,
    );
    if (match) latest = { file, body: match[0] };
  }

  return latest;
}

describe("A-13 content_history is written by the invoking role", () => {
  it("finds the trigger function to inspect (guards against a silent no-op)", () => {
    const latest = latestTriggerFunctionBody();
    expect(latest).not.toBeNull();
    expect(latest!.body).toContain("INSERT INTO content_history");
  });

  test.failing(
    "log_content_change() does not depend on the caller's policy set",
    () => {
      // SECURITY DEFINER makes the audit write run as the function owner, so a
      // missing `authenticated` INSERT policy can no longer abort a customer's
      // UPDATE. Without it the trigger is judged against whoever happens to be
      // calling — today the anon-key user client.
      //
      // If the fix taken is instead "guarantee the INSERT policy in a migration
      // production has actually applied", that is verified by the gated test
      // below, and this marker should be removed with it.
      const latest = latestTriggerFunctionBody();
      expect(latest!.body.toUpperCase()).toContain("SECURITY DEFINER");
    },
  );
});

// ---------------------------------------------------------------------------
// 2. Database test — gated, not skipped by hand
// ---------------------------------------------------------------------------

/**
 * Gate. Excluded from the default run so `npm test` works on a laptop with no
 * database; enable with:
 *
 *   RCF_DB_TESTS=1 npx jest src/__tests__/api/bulk/update-history-policy.test.ts
 *
 * `SUPABASE_TEST_DB_URL` overrides the connection; the default is the port
 * `supabase/config.toml` assigns to the local stack's Postgres.
 */
const DB_TESTS_ENABLED = process.env.RCF_DB_TESTS === "1";
const DB_URL =
  process.env.SUPABASE_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const describeWithDb = DB_TESTS_ENABLED ? describe : describe.skip;

interface PgClient {
  connect(): Promise<void>;
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end(): Promise<void>;
}

describeWithDb("A-13 an authenticated UPDATE against content_elements", () => {
  let client: PgClient;

  beforeAll(async () => {
    // Required lazily so the driver is never loaded when the gate is closed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require("pg") as {
      Client: new (config: { connectionString: string }) => PgClient;
    };
    client = new Client({ connectionString: DB_URL });
    await client.connect();

    // A local Supabase stack answers on this port for whichever project was
    // started last. Say so plainly rather than failing later on
    // `relation "sites" does not exist`, which reads like a broken test.
    const schema = await client.query(
      `SELECT to_regclass('public.content_elements') AS elements,
              to_regclass('public.content_history')  AS history`,
    );
    if (!schema.rows[0].elements || !schema.rows[0].history) {
      throw new Error(
        `${DB_URL} is not a ReCopyFast database — content_elements/content_history are absent. ` +
          `Start this project's stack (npx supabase start && npx supabase db reset) or point ` +
          `SUPABASE_TEST_DB_URL at it.`,
      );
    }
  });

  afterAll(async () => {
    await client?.end();
  });

  it("succeeds and leaves exactly one content_history row", async () => {
    const userId = randomUUID();
    const suffix = userId.slice(0, 8);

    await client.query("BEGIN");
    try {
      // --- Seed as superuser (RLS bypassed), so the test is about the UPDATE ---
      // `content_history.changed_by` and `site_permissions.user_id` both
      // reference auth.users, and the trigger writes auth.uid() into the first
      // of them — so the JWT subject has to be a real row.
      await client.query(
        `INSERT INTO auth.users (id, aud, role, email)
         VALUES ($1, 'authenticated', 'authenticated', $2)`,
        [userId, `a13-${suffix}@example.test`],
      );

      const site = await client.query(
        `INSERT INTO sites (domain, name) VALUES ($1, 'A-13 fixture') RETURNING id`,
        [`a13-${suffix}.example.test`],
      );
      const siteId = site.rows[0].id as string;

      await client.query(
        `INSERT INTO site_permissions (user_id, site_id, permission)
         VALUES ($1, $2, 'admin')`,
        [userId, siteId],
      );

      const element = await client.query(
        `INSERT INTO content_elements (site_id, element_id, selector, original_content, current_content)
         VALUES ($1, 'a13-headline', 'h1', 'Before', 'Before') RETURNING id`,
        [siteId],
      );
      const elementId = element.rows[0].id as string;

      // --- Act as `authenticated`, which is what the anon-key client is ---
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      await client.query("SET LOCAL ROLE authenticated");

      const updated = await client.query(
        `UPDATE content_elements SET current_content = 'After' WHERE id = $1`,
        [elementId],
      );

      // RLS refusals on the row itself are silent (zero rows, no error), so the
      // update has to be shown to have actually landed.
      expect(updated.rowCount).toBe(1);

      await client.query("RESET ROLE");

      const history = await client.query(
        `SELECT content, change_type, changed_by FROM content_history
         WHERE content_element_id = $1 AND change_type = 'update'`,
        [elementId],
      );

      // Branch 1 — the local database has 20260731008000 applied, so the
      // `authenticated` INSERT policy on content_history exists. This passes,
      // and it is the regression guard that stops the policy being dropped or
      // superseded again.
      //
      // Branch 2 — the database reproduces production's policy set (that
      // migration recorded as aborted). The trigger's insert is refused, the
      // refusal aborts the customer's UPDATE, and this fails at `updated.rowCount`
      // or here. That failure is A-13 reproduced, and it answers B-3: bulk
      // update and AI translate are dead in production.
      expect(history.rowCount).toBe(1);
      expect(history.rows[0].content).toBe("After");
      expect(history.rows[0].changed_by).toBe(userId);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
