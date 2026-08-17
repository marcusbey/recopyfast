/**
 * `sites` gains a persisted install status, and only two values ever reach it.
 *
 * Until this migration the dashboard's "status" was recomputed on every
 * `GET /api/sites` from `content_elements > 0` — a snapshot with no transition
 * and no timestamp, so nothing could say *when* a site first reported, and
 * nothing distinguished "never installed" from "installed, then went quiet".
 * ADR 006 settles the shape: persist `awaiting-install` and `live` only, and
 * derive `stale` at read time from `last_reported_at`.
 *
 * The two suites answer two different questions and neither substitutes for the
 * other:
 *
 *   1. The text suite reads the migration itself, the way
 *      `src/__tests__/lib/stripe/plan-seed.test.ts` reads the plans seed. It is
 *      what pins the commitments a running database cannot show you after the
 *      fact — above all the backfill, which executes exactly once, before any
 *      test could observe the rows it was meant to repair.
 *
 *   2. The `describeDb` suite asks a real Postgres what the column actually
 *      does. It is gated on a reachable ReCopyFast database and skips loudly
 *      when there is none (see db-harness.ts).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describeDb } from "./db-harness";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260817001000_sites_install_status.sql",
);

const sql = readFileSync(MIGRATION, "utf8");

describe("sites install-status migration", () => {
  it("adds the status column defaulting to awaiting-install", () => {
    expect(sql).toMatch(/ADD COLUMN[^;]*\bstatus\s+TEXT\b/i);
    expect(sql).toMatch(/DEFAULT\s+'awaiting-install'/i);
  });

  it("adds the four transition timestamp columns AC 8 exposes", () => {
    for (const column of [
      "live_at",
      "last_reported_at",
      "last_mismatch_domain",
      "last_mismatch_at",
    ]) {
      expect(sql).toContain(column);
    }
  });

  it("constrains status to exactly the two persisted values", () => {
    const check = /CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)\s*\)/i.exec(sql);
    expect(check).not.toBeNull();

    const allowed = check![1]
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""));

    expect(allowed).toEqual(["awaiting-install", "live"]);
  });

  /**
   * `stale` is computed, never stored — the whole point of ADR 006. A stored
   * value is a value some later code path can gate on, and AC 7 says staleness
   * must never block content delivery or editing. Nothing can gate on a value
   * that is never written.
   */
  it("never writes stale anywhere", () => {
    expect(sql).not.toMatch(/'stale'/);
  });

  /**
   * The regression this migration is one statement away from causing: without
   * the backfill every site whose script has been reporting for weeks would
   * read "awaiting install" the moment this ships. The set marked `live` must
   * equal `SELECT DISTINCT site_id FROM content_elements`, no more, no fewer,
   * and the timestamps must come from that site's earliest row.
   */
  it("backfills live from the earliest content_elements row per site", () => {
    expect(sql).toMatch(/UPDATE\s+(public\.)?sites/i);
    expect(sql).toMatch(/MIN\(\s*created_at\s*\)/i);
    expect(sql).toMatch(/FROM\s+(public\.)?content_elements/i);
    expect(sql).toMatch(/GROUP BY\s+site_id/i);
    expect(sql).toMatch(/SET[\s\S]*status\s*=\s*'live'/i);
    expect(sql).toMatch(/live_at\s*=/i);
    expect(sql).toMatch(/last_reported_at\s*=/i);
  });
});

describeDb("sites install-status columns", ({ query, createSite }) => {
  test("a newly registered site starts in awaiting-install with no timestamps", async () => {
    const siteId = await createSite("install-status-default");

    const { rows } = await query<{
      status: string;
      live_at: string | null;
      last_reported_at: string | null;
      last_mismatch_domain: string | null;
      last_mismatch_at: string | null;
    }>(
      `SELECT status, live_at, last_reported_at, last_mismatch_domain, last_mismatch_at
         FROM sites WHERE id = $1`,
      [siteId],
    );

    expect(rows[0]).toEqual({
      status: "awaiting-install",
      live_at: null,
      last_reported_at: null,
      last_mismatch_domain: null,
      last_mismatch_at: null,
    });
  });

  test("the database refuses any status but awaiting-install and live", async () => {
    const siteId = await createSite("install-status-check");

    await expect(
      query("UPDATE sites SET status = 'stale' WHERE id = $1", [siteId]),
    ).rejects.toThrow();

    await expect(
      query("UPDATE sites SET status = 'live' WHERE id = $1", [siteId]),
    ).resolves.toBeDefined();
  });
});
