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
