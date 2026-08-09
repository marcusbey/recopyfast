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
 *      it makes the answer to B-3 irrelevant. Closed by
 *      20260809130000_content_history_definer_and_delete_split.sql and enforced
 *      from here on.
 *   2. A database test, gated on a reachable Postgres, that performs the write
 *      as `authenticated` for real. It was meant to answer B-3; run against a
 *      local Supabase it instead found a different and larger defect one layer
 *      above the trigger — `authenticated` has no table-level DML on
 *      `content_elements` at all — so B-3 is still open and no longer decides
 *      whether the trigger works. Full measurement in the note on that test.
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

  // Guard for the `test.failing` below, which passes on ANY throw — including a
  // connection that opened against the wrong database, or a seed that silently
  // stopped inserting. This asserts the superuser seed path works, so the failure
  // below is the product's and not this file's.
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

  // MEASURED AND STILL BROKEN, for a reason this file did not anticipate — and
  // NOT the reason A-13 predicted.
  //
  // Run against a local Supabase (image public.ecr.aws/supabase/postgres:15.8.1.085)
  // with the full migration set applied, this fails at the UPDATE with
  //
  //   error: permission denied for table content_elements
  //
  // That is a table-level GRANT failure, not an RLS refusal and not the
  // content_history INSERT policy of A-13/B-3. `authenticated` holds no DML on
  // `content_elements` at all:
  //
  //   content_elements | {postgres=arwdDxt/postgres,anon=Dxt/postgres,
  //                       authenticated=Dxt/postgres,service_role=Dxt/postgres}
  //
  // `Dxt` is TRUNCATE, REFERENCES and TRIGGER — no SELECT, INSERT, UPDATE or
  // DELETE. It comes from that image's stock default privileges for the `postgres`
  // role, measured with this branch's two migrations removed and the database
  // reset, so it is neither caused nor worsened by them:
  //
  //   r | {postgres=arwdDxt/postgres,anon=Dxt/postgres,
  //        authenticated=Dxt/postgres,service_role=Dxt/postgres}
  //
  // No migration grants table DML on `content_elements` or `content_history` to
  // anybody, so on this image the gap is schema-wide and hits `service_role` too:
  // `SET ROLE service_role; INSERT INTO sites …` also answers "permission denied".
  // An older image (15.8.1.060) defaults to `arwdDxt` for all three roles, which
  // is why the migrations have never needed explicit GRANTs and why production,
  // provisioned earlier, does not show this.
  //
  // Left as `test.failing` rather than fixed here: the fix is a deliberate
  // schema-wide GRANT policy — which roles get which DML on which tables — and
  // that is a security decision with its own blast radius, not a follow-on to the
  // A-3/A-5/A-35 lockdown this branch is doing. Note that A-13's own remedy still
  // landed and still holds: `log_content_change()` is SECURITY DEFINER, so the
  // trigger's write no longer depends on the caller's policy set. This case is
  // now measuring the statement *above* the trigger.
  test.failing(
    "succeeds and leaves exactly one content_history row",
    async () => {
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
        await client.query(
          `SELECT set_config('request.jwt.claims', $1, true)`,
          [JSON.stringify({ sub: userId, role: "authenticated" })],
        );
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

        // Neither branch this file originally predicted is what happens. It
        // expected either the `authenticated` INSERT policy on content_history to
        // exist (pass) or to be missing (fail here, answering B-3). Measured, the
        // run never reaches this point: the UPDATE above is refused at the table
        // level, because `authenticated` has no UPDATE on `content_elements` — see
        // the note on this test. So B-3 remains unanswered, and it is now moot for
        // the trigger, which is SECURITY DEFINER; what blocks the route is the
        // missing table grant one layer above.
        //
        // These three assertions are kept unchanged and are what should hold once
        // that grant exists. They are the regression guard for the policy too.
        expect(history.rowCount).toBe(1);
        expect(history.rows[0].content).toBe("After");
        expect(history.rows[0].changed_by).toBe(userId);
      } finally {
        await client.query("ROLLBACK");
      }
    },
  );
});
