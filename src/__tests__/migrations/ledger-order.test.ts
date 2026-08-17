/**
 * The migration ledger applies files in order, and the order is derived from
 * the filename. Nothing in this repo checks that the derived order is the order
 * a human reading the directory would expect, and a schema that applies out of
 * order does not error — it produces a database that disagrees with the code
 * for reasons no log line records.
 *
 * Two things are asserted:
 *
 *   (a) every migration filename is `YYYYMMDDHHMMSS_snake_case.sql`
 *       (AGENTS.md "Naming"), with a single allowlisted historical exception;
 *   (b) sorting the directory lexically produces the same order as sorting by
 *       the timestamp parsed out of each name — for the filenames themselves
 *       *and* for the version strings the ledger stores.
 *
 * (b) is the live one and carries no allowlist.
 */

import { readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

const MIGRATION_NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

/**
 * TOMBSTONE — one file, applied long ago, that can never be renamed.
 *
 * `20260127_ab_testing_v2.sql` carries an 8-digit prefix where every other
 * migration carries 14, so the ledger registers its version as the string
 * `20260127`. It is marked applied in the target database; renaming it would
 * change its ledger key and replay it, which is the same thing as editing an
 * applied migration (AGENTS.md non-negotiable 5). So it is allowlisted here
 * rather than fixed.
 *
 * Measured on 2026-08-17, not assumed: it is NOT mis-ordered today. Both
 * orderings this file asserts agree with the timestamps —
 * `20251230100000` < `20260127` < `20260531000000` — and the only other
 * migrations naming the tables it creates (`20260611020000`,
 * `20260801200000`) sort after it under both.
 *
 * The defect is a *future* one, and it is why the ordering assertions below
 * carry no allowlist: a migration stamped the same day with a full timestamp,
 * `20260127HHMMSS_…`, sorts ahead of `20260127_…` by filename (`'1' < '_'` in
 * ASCII) and behind it by ledger version (a prefix sorts first) — the two
 * orderings disagree, and the schema applies in an order nobody chose, with no
 * error anywhere. The day someone adds that file, the suite fails instead.
 */
const LEDGER_SCARS = ["20260127_ab_testing_v2.sql"];

function migrationFilenames(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"));
}

/**
 * The version the ledger keys on: the digits before the first underscore.
 * `20260127_ab_testing_v2.sql` therefore registers as `20260127`, not
 * `20260127000000`.
 */
function ledgerVersion(filename: string): string {
  return filename.slice(0, filename.indexOf("_"));
}

/** The instant a name means, with a short version padded out to compare. */
function parsedTimestamp(filename: string): string {
  return ledgerVersion(filename).padEnd(14, "0");
}

function sortedCopy(values: string[]): string[] {
  return [...values].sort();
}

describe("supabase migration ledger", () => {
  it("names every migration YYYYMMDDHHMMSS_snake_case.sql", () => {
    const offenders = migrationFilenames().filter(
      (name) => !MIGRATION_NAME.test(name) && !LEDGER_SCARS.includes(name),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist to the one file that earned it", () => {
    const files = migrationFilenames();

    // An allowlist that outlives the file it excuses silently excuses the next
    // one too.
    expect(LEDGER_SCARS).toHaveLength(1);
    expect(files).toEqual(expect.arrayContaining(LEDGER_SCARS));
  });

  it("applies migrations in the order their names claim", () => {
    const files = migrationFilenames();

    const byName = sortedCopy(files);
    const byTimestamp = [...files].sort((a, b) =>
      parsedTimestamp(a).localeCompare(parsedTimestamp(b)),
    );

    expect(byName).toEqual(byTimestamp);
  });

  it("stores ledger versions in the order their names claim", () => {
    const files = migrationFilenames();

    const byVersion = [...files].sort((a, b) =>
      ledgerVersion(a).localeCompare(ledgerVersion(b)),
    );
    const byTimestamp = [...files].sort((a, b) =>
      parsedTimestamp(a).localeCompare(parsedTimestamp(b)),
    );

    expect(byVersion).toEqual(byTimestamp);
  });
});
