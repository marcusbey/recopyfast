/**
 * Shared plumbing for the database-invariant suites in this directory.
 *
 * These suites assert things about the *database* — function ACLs, RLS
 * policies, what a plpgsql RPC actually writes — so they cannot be answered by
 * a mock. They need a real Postgres. Every other suite in this repo must keep
 * passing on a laptop that has none, so the gate below decides at **collection
 * time** whether to register the real tests at all.
 *
 * Why collection time and not `beforeAll`: several tests here use
 * `test.failing()` (the convention in docs/archive/2026-08-07-qa-production-audit.md
 * for a defect that is not yet fixed). `test.failing` fails when its body
 * *passes*, so a body that quietly no-ops without a database would turn the
 * suite red. The decision has to be made before the test is registered, which
 * means the probe has to be synchronous — hence `spawnSync`.
 *
 * Why the probe is not just "is port 54322 open": on a machine that runs more
 * than one Supabase project, that port is very often bound by somebody else's
 * stack. Connecting and running DDL against it would be both wrong and rude.
 * The probe therefore checks for ReCopyFast's own tables before declaring the
 * database usable.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const CONFIG_TOML = path.join(REPO_ROOT, "supabase", "config.toml");

/** `supabase start` publishes the local database with these credentials. */
const LOCAL_DB_USER = "postgres";
const LOCAL_DB_PASSWORD = "postgres";
const LOCAL_DB_NAME = "postgres";
const LOCAL_DB_HOST = "127.0.0.1";
const FALLBACK_DB_PORT = 54322;

const PROBE_TIMEOUT_MS = 15_000;
/** Enough connections for the concurrency suite to actually overlap. */
const POOL_SIZE = 32;

type ProbeOutcome = "ok" | "unreachable" | "wrong-schema" | "probe-failed";

export interface DbTarget {
  connectionString: string;
  /** Same string with the password removed — safe to print. */
  display: string;
  source: "RCF_TEST_DB_URL" | "supabase/config.toml";
}

export interface QueryResult<R> {
  rows: R[];
  rowCount: number | null;
}

interface PgClient {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

interface PgPool extends PgClient {
  end(): Promise<void>;
}

interface PgPoolConstructor {
  new (config: { connectionString: string; max?: number }): PgPool;
}

// `pg` ships no type declarations and `@types/pg` is not a dependency of this
// repo, so it is loaded through a structurally-typed require rather than an
// import that `tsc --noEmit` cannot resolve.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pool } = require("pg") as { Pool: PgPoolConstructor };

/** Reads the `port` under `[db]` in supabase/config.toml. */
function readConfiguredDbPort(): number {
  try {
    const toml = readFileSync(CONFIG_TOML, "utf8");
    // Everything from the `[db]` header up to the next section header, or to
    // the end of the file when `[db]` is the last section — anchoring only on
    // `^\[` would silently find nothing there and fall back to a port the
    // config never asked for. This stops before `[db.pooler]`, whose own `port`
    // is a different thing.
    const section = /^\[db\][^\n]*\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml);
    const port = section && /^port\s*=\s*(\d+)/m.exec(section[1]);
    return port ? Number(port[1]) : FALLBACK_DB_PORT;
  } catch {
    return FALLBACK_DB_PORT;
  }
}

export function resolveDbTarget(): DbTarget {
  const override = process.env.RCF_TEST_DB_URL;
  if (override) {
    return {
      connectionString: override,
      display: override.replace(/:\/\/([^:@/]+):[^@]*@/, "://$1:***@"),
      source: "RCF_TEST_DB_URL",
    };
  }

  const port = readConfiguredDbPort();
  return {
    connectionString: `postgresql://${LOCAL_DB_USER}:${LOCAL_DB_PASSWORD}@${LOCAL_DB_HOST}:${port}/${LOCAL_DB_NAME}`,
    display: `postgresql://${LOCAL_DB_USER}:***@${LOCAL_DB_HOST}:${port}/${LOCAL_DB_NAME}`,
    source: "supabase/config.toml",
  };
}

/**
 * Connects, fingerprints the schema, and exits with a distinct code per
 * outcome. Runs in a child process so the whole thing is synchronous from
 * Jest's point of view.
 */
const PROBE_SOURCE = `
const { Client } = require("pg");
const client = new Client({
  connectionString: process.argv[1],
  connectionTimeoutMillis: 3000,
  statement_timeout: 3000,
});
const finish = (code) => {
  client.end().catch(() => {});
  process.exit(code);
};
client
  .connect()
  .then(() =>
    client.query(
      "SELECT to_regclass('public.content_elements') IS NOT NULL" +
      " AND to_regclass('public.content_versions') IS NOT NULL" +
      " AND to_regclass('public.site_permissions') IS NOT NULL AS ok",
    ),
  )
  .then((result) => finish(result.rows[0] && result.rows[0].ok ? 0 : 2))
  .catch(() => finish(1));
`;

function probe(target: DbTarget): ProbeOutcome {
  const result = spawnSync(
    process.execPath,
    ["-e", PROBE_SOURCE, target.connectionString],
    { cwd: REPO_ROOT, timeout: PROBE_TIMEOUT_MS, stdio: "ignore" },
  );

  if (result.status === 0) return "ok";
  if (result.status === 2) return "wrong-schema";
  if (result.status === 1) return "unreachable";
  return "probe-failed";
}

function gateNote(target: DbTarget, outcome: ProbeOutcome): string {
  const reason: Record<Exclude<ProbeOutcome, "ok">, string> = {
    unreachable: `nothing accepted a connection at ${target.display}`,
    "wrong-schema": `something answered at ${target.display}, but it is not a ReCopyFast database (no content_elements / content_versions / site_permissions) — most likely another project's local Supabase holding that port`,
    "probe-failed": `the connectivity probe itself could not run against ${target.display}`,
  };

  return [
    "",
    "  ── database invariants NOT verified ──────────────────────────────────",
    `  Skipped because ${reason[outcome as Exclude<ProbeOutcome, "ok">]}.`,
    "",
    "  To run them:      npx supabase start   (then re-run this suite)",
    "  Against another:  RCF_TEST_DB_URL=postgresql://user:pass@host:port/db npx jest src/__tests__/db",
    `  Target resolved from: ${target.source}`,
    "  ─────────────────────────────────────────────────────────────────────",
    "",
  ].join("\n");
}

export interface DbSuite {
  /** Runs a query against the pool created for this suite. */
  query: <R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<R>>;
  /**
   * Inserts a `sites` row with a collision-proof domain and arranges for it, and
   * everything the FK cascade reaches from it, to be removed after the suite.
   */
  createSite: (label: string) => Promise<string>;
}

/**
 * Removes the sites a suite created, plus everything that hangs off them.
 *
 * One statement, deliberately. This used to be a five-statement transaction that
 * set `session_replication_role = 'replica'` to suppress triggers *and*
 * referential integrity, then deleted `content_history`, `content_elements`,
 * `content_versions` and `sites` by hand in that order — because a plain
 * `DELETE FROM sites` did not work at all. `content_change_trigger` was an AFTER
 * DELETE trigger inserting the deleted row into `content_history`, whose FK
 * requires the `content_elements` row to still exist, so every content element
 * delete raised 23503 and the cascade from `sites` inherited it (A-35):
 *
 *   ERROR: insert or update on table "content_history" violates foreign key
 *          constraint "content_history_content_element_id_fkey"
 *   CONTEXT: PL/pgSQL function log_content_change() line 10
 *
 * 20260809130000_content_history_definer_and_delete_split.sql moved the DELETE
 * branch onto a BEFORE DELETE trigger, so the cascade completes. The workaround
 * is removed rather than left in place on purpose: while it was here, this
 * harness was the one caller in the repository that could delete a site, and its
 * own teardown hid the defect from every suite that used it. Cleaning up the way
 * the product does means a regression shows up here first.
 *
 * Every FK into `sites` and into `content_elements` is ON DELETE CASCADE (26 and
 * counting; verified across supabase/migrations), so this reaches the whole tree.
 */
async function deleteSites(pool: PgPool, siteIds: string[]): Promise<void> {
  await pool.query("DELETE FROM sites WHERE id = ANY($1::uuid[])", [siteIds]);
}

/**
 * `describe`, but the body is only registered when a ReCopyFast database is
 * actually reachable. When it is not, a single clearly-named passing test is
 * registered in its place so the run stays green and says why.
 */
export function describeDb(
  suiteName: string,
  defineSuite: (suite: DbSuite) => void,
): void {
  const target = resolveDbTarget();
  const outcome = probe(target);

  if (outcome !== "ok") {
    describe(suiteName, () => {
      test("[gated] no ReCopyFast database reachable — invariants not checked", () => {
        console.warn(gateNote(target, outcome));
        expect(outcome).not.toBe("ok");
      });
    });
    return;
  }

  describe(suiteName, () => {
    let pool: PgPool | undefined;
    const createdSiteIds: string[] = [];

    beforeAll(() => {
      pool = new Pool({
        connectionString: target.connectionString,
        max: POOL_SIZE,
      });
    });

    afterAll(async () => {
      if (!pool) return;
      try {
        if (createdSiteIds.length > 0) {
          await deleteSites(pool, createdSiteIds);
        }
      } finally {
        await pool.end();
      }
    });

    const query = <R = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> => {
      if (!pool) throw new Error("db pool used before beforeAll ran");
      return pool.query<R>(text, values);
    };

    const createSite = async (label: string): Promise<string> => {
      const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const { rows } = await query<{ id: string }>(
        "INSERT INTO sites (domain, name) VALUES ($1, $2) RETURNING id",
        [`rcf-dbtest-${label}-${suffix}.invalid`, `rcf-dbtest ${label}`],
      );
      createdSiteIds.push(rows[0].id);
      return rows[0].id;
    };

    defineSuite({ query, createSite });
  });
}
