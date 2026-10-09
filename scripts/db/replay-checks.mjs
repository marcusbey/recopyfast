// Pure checks for scripts/run-db-invariants.mjs, kept here so `node --test`
// can exercise them without a PostgreSQL install
// (scripts/__tests__/replay-checks.test.mjs).

import path from "node:path";

/**
 * The PostgreSQL major the migration replay must run on: production's.
 *
 * s75: production is PostgreSQL 17.4 (docs/research/s56-rls-content-writes-need-plan.md:7),
 * but until s75 this runner demanded 14 and CI fed it `postgres:14`, while the
 * e2e job's Supabase stack ran 15. Three parsers, none of them production's: a
 * migration valid only on 17 (e.g. naming MAINTAIN) was refused, and one that
 * misbehaves only on 17 passed. Change this together with the `postgres:` image
 * in .github/workflows/ci.yml and `major_version` in supabase/config.toml —
 * src/__tests__/ci/release-gates.test.ts holds all three to one value.
 */
export const REQUIRED_PG_MAJOR = 17;

/**
 * Throws unless `serverVersionNum` (the text of `SHOW server_version_num`) is
 * a REQUIRED_PG_MAJOR server. The message carries the fix, because on a laptop
 * the usual cause is an older `psql`/`initdb` earlier on PATH.
 */
export function assertServerMajor(serverVersionNum) {
  const reported = String(serverVersionNum).trim();
  if (new RegExp(`^${REQUIRED_PG_MAJOR}\\d{4}$`).test(reported)) return;

  throw new Error(
    `Database invariant runner requires PostgreSQL ${REQUIRED_PG_MAJOR}; ` +
      `server reported ${JSON.stringify(reported)}. Point RCF_TEST_DB_URL at a ` +
      `PostgreSQL ${REQUIRED_PG_MAJOR} server, or set RCF_POSTGRES_BIN to a ` +
      `PostgreSQL ${REQUIRED_PG_MAJOR} bin directory ` +
      `(e.g. /opt/homebrew/opt/postgresql@${REQUIRED_PG_MAJOR}/bin).`,
  );
}

const GATED_PLACEHOLDER = "[gated]";

/**
 * Reads a Jest `--json` report and returns one line per named suite that did
 * not actually run against the database; an empty array means every one did.
 *
 * s75: Jest exits 0 when a DB suite registers only its "[gated]" placeholder
 * (db-harness.ts, no database reached), when a suite skips itself
 * (editor-activation-concurrency without RCF_S29_DB_URL), and when a named path
 * matches no file at all (positional paths are patterns). Until s75 seven
 * suites lived in exactly that state on every CI run.
 *
 * A suite passes when it has at least one passing test that is not a
 * placeholder, and every placeholder it registered matches
 * `toleratedPlaceholders` — the halves a step cannot run by design (the
 * replay has no PostgREST, so "[gated] no PostgREST target configured" is
 * expected there and proven in the e2e job instead). A skip beside real tests
 * (column-privileges' PostgREST-only test) is fine for the same reason.
 *
 * @param {unknown} report parsed Jest JSON report
 * @param {string[]} expectedSuites repo-relative suite paths the step named
 * @param {string} repoRoot absolute repository root the report's paths start with
 * @param {RegExp[]} [toleratedPlaceholders] placeholder titles expected in this step
 * @returns {string[]}
 */
export function findSuitesThatDidNotRun(
  report,
  expectedSuites,
  repoRoot,
  toleratedPlaceholders = [],
) {
  if (!report || !Array.isArray(report.testResults)) {
    throw new Error(
      "Jest report has no testResults; refusing to read it as clean.",
    );
  }

  const byPath = new Map(
    report.testResults.map((result) => [
      path.relative(repoRoot, String(result.name)).split(path.sep).join("/"),
      Array.isArray(result.assertionResults) ? result.assertionResults : [],
    ]),
  );
  const isPlaceholder = (title) => title.includes(GATED_PLACEHOLDER);
  const isTolerated = (title) =>
    toleratedPlaceholders.some((pattern) => pattern.test(title));

  return expectedSuites.flatMap((suite) => {
    const assertions = byPath.get(suite);
    if (!assertions) {
      return [`${suite}: no result — the path matched no test file`];
    }

    const titles = assertions.map((assertion) => String(assertion.title));
    const untolerated = titles.filter(
      (title) => isPlaceholder(title) && !isTolerated(title),
    );
    if (untolerated.length > 0) {
      return [
        `${suite}: registered a placeholder instead of running — "${untolerated[0]}"`,
      ];
    }

    const ranRealTest = assertions.some(
      (assertion) =>
        assertion.status === "passed" &&
        !isPlaceholder(String(assertion.title)),
    );
    if (!ranRealTest) {
      return [
        `${suite}: no passing test (${assertions.length} registered) — skipped or never ran`,
      ];
    }
    return [];
  });
}
