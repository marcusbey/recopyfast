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
 * Both callers used the anon-key user client, i.e. the `authenticated` role
 * (src/app/api/bulk/update/route.ts and src/app/api/ai/translate/route.ts).
 * They no longer do. Since s56 (ADR 042) both write through the service role,
 * after authorization and the owner-plan gate, and no web principal holds DML
 * on `content_elements` at all
 * (20260928140000_content_writes_are_service_role_only.sql). The only migration
 * granting `authenticated` INSERT on `content_history` was
 * 20260731008000_rls_policies_for_locked_tables.sql:337-348 — the one recorded
 * as aborted in production; s56 drops that policy on replayed databases too.
 *
 * An `AFTER ... FOR EACH ROW` refusal aborts the statement that fired it. So
 * while the callers wrote as `authenticated`, a missing policy would have rolled
 * back the user's own UPDATE — every bulk find-and-replace and every AI
 * translation failing, reported as a per-element error rather than a systemic
 * one.
 *
 * This file covers it twice:
 *
 *   1. A source assertion that runs everywhere: the trigger must not depend on
 *      the invoker's policy set at all. That is what SECURITY DEFINER buys.
 *      Closed by 20260809130000_content_history_definer_and_delete_split.sql and
 *      enforced from here on.
 *   2. A database test, gated on a reachable Postgres, that performs the write
 *      as `authenticated` for real. It used to be a `test.failing` expecting
 *      that write to succeed one day. Since s56 its refusal is the intended
 *      state, so it asserts the refusal: 42501, and the row unchanged.
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
    // Through the statement terminator, not merely to the `language` keyword.
    // SECURITY DEFINER is legal on either side of the body — before `AS $$`, or
    // after the LANGUAGE clause, which is where the usual repair puts it
    // (`$$ LANGUAGE plpgsql SECURITY DEFINER;`). Stopping at `language` would
    // leave that outside the captured text, so the assertion below could never
    // see a correct fix and this file would keep reporting it as unfixed.
    const match = sql.match(
      /CREATE OR REPLACE FUNCTION log_content_change\(\)[\s\S]*?\$\$[\s\S]*?\$\$[^;]*;/i,
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

  it("log_content_change() does not depend on the caller's policy set", () => {
    // SECURITY DEFINER makes the audit write run as the function owner, so a
    // missing `authenticated` INSERT policy can no longer abort a customer's
    // UPDATE. Without it the trigger is judged against whoever happens to be
    // calling — today the anon-key user client.
    //
    // Closed by 20260809130000_content_history_definer_and_delete_split.sql,
    // which is now the latest definition of the function. Enforced rather than
    // `test.failing` from that migration onwards: this is the regression guard
    // that stops a later CREATE OR REPLACE dropping the qualifier again, which
    // would silently make the answer to B-3 load-bearing a second time.
    const latest = latestTriggerFunctionBody();
    expect(latest!.body.toUpperCase()).toContain("SECURITY DEFINER");
  });

  // The other half of the same qualifier: a SECURITY DEFINER function with a
  // caller-controlled `search_path` lets the caller choose which
  // `content_history` receives the audit row.
  it("pins the search_path it runs under", () => {
    const latest = latestTriggerFunctionBody();
    expect(latest!.body).toMatch(/SET\s+search_path\s*=\s*public,\s*pg_temp/i);
  });
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

  // Guard for the refusal below. It asserts the superuser seed path works — the
  // right database, a seed that still inserts, a trigger still wired — so the
  // refusal below is the grant's and not this file's.
  it("guard: the superuser seed path works", async () => {
    await client.query("BEGIN");
    try {
      const suffix = randomUUID().slice(0, 8);
      const site = await client.query(
        `INSERT INTO sites (domain, name) VALUES ($1, 'A-13 guard') RETURNING id`,
        [`a13-guard-${suffix}.example.test`],
      );
      const siteId = site.rows[0].id as string;
      const element = await client.query(
        `INSERT INTO content_elements (site_id, element_id, selector, original_content, current_content)
         VALUES ($1, 'a13-guard', 'h1', 'Before', 'Before') RETURNING id`,
        [siteId],
      );
      // The AFTER INSERT branch of log_content_change() fired, so the trigger
      // itself is wired up and only the `authenticated` path is in question.
      const history = await client.query(
        `SELECT change_type FROM content_history WHERE content_element_id = $1`,
        [element.rows[0].id],
      );
      expect(history.rows.map((r) => r.change_type)).toEqual(["create"]);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  // WHAT THIS MEASURED, AND WHY IT NOW ASSERTS A REFUSAL.
  //
  // This was a `test.failing` named "succeeds and leaves exactly one
  // content_history row": it expected an `authenticated` UPDATE of
  // `content_elements` to work one day, because bulk update and AI translate
  // wrote with the user's JWT. Measured on a local image
  // (public.ecr.aws/supabase/postgres:15.8.1.085), the UPDATE was refused at the
  // table level — "permission denied for table content_elements" — because that
  // image granted every role only `Dxt` on the table, while production and older
  // images granted `arwdDxt`. The grant, not the trigger, decided it.
  //
  // s56 (ADR 042) made that refusal the intended state everywhere. A member's
  // direct write bypassed the owner-plan gate (s51 review, finding 1: a PATCH
  // through PostgREST answered 200 on a planless owner's site), so
  // 20260928140000 revokes INSERT/UPDATE/DELETE/TRUNCATE from `anon`,
  // `authenticated` and PUBLIC, and bulk update and translate write through the
  // service role since. Left as `test.failing`, this body would now throw for the
  // intended reason and "pass" while still claiming a defect — the trap
  // src/__tests__/db/README.md warns about. So it asserts the refusal itself,
  // and reads the row back: a refusal that changed the row would be no refusal.
  test("is refused with 42501 and leaves the row unchanged (s56, ADR 042)", async () => {
    const userId = randomUUID();
    const suffix = userId.slice(0, 8);

    await client.query("BEGIN");
    try {
      // --- Seed as superuser (RLS bypassed), so the test is about the UPDATE ---
      // `site_permissions.user_id` references auth.users, so the JWT subject
      // has to be a real row.
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
      // The savepoint precedes SET LOCAL ROLE, so rolling back to it also
      // returns this connection to the superuser for the read-back.
      await client.query("SAVEPOINT before_update");
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      await client.query("SET LOCAL ROLE authenticated");

      await expect(
        client.query(
          `UPDATE content_elements SET current_content = 'After' WHERE id = $1`,
          [elementId],
        ),
      ).rejects.toMatchObject({ code: "42501" });

      await client.query("ROLLBACK TO SAVEPOINT before_update");

      const row = await client.query(
        `SELECT current_content FROM content_elements WHERE id = $1`,
        [elementId],
      );
      expect(row.rows).toEqual([{ current_content: "Before" }]);

      const history = await client.query(
        `SELECT change_type FROM content_history
         WHERE content_element_id = $1 AND change_type = 'update'`,
        [elementId],
      );
      expect(history.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
