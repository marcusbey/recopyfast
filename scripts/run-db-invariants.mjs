#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import {
  REQUIRED_PG_MAJOR,
  assertServerMajor,
  verifyReplayReport,
} from "./db/replay-checks.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const require = createRequire(import.meta.url);
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const BOOTSTRAP = path.join(
  REPO_ROOT,
  "scripts",
  "db",
  "bootstrap-supabase-fixtures.sql",
);
const REQUIRED_MIGRATION = "20260925120000_sites_api_key_column_grants.sql";
const REVISION_MIGRATION = "20261005000000_versioned_public_content_cache.sql";
// s68a (ADR 047): both carry a data step or a postcondition, so a retry after
// an uncertain connection result must converge rather than raise.
const EDIT_SESSIONS_MIGRATION =
  "20261008100000_edit_sessions_service_role_writes.sql";
const CONVERGENCE_MIGRATION = "20261008110000_converge_replay_privileges.sql";
const isPreFixProof = process.argv.includes("--pre-fix-proof");

// Every suite the replay step runs. Each must produce at least one passing test
// against this database: verifyReplayReport refuses a suite that matched no
// file, registered a placeholder other than the PostgREST one, or skipped
// everything.
const REPLAY_SUITES = [
  "src/__tests__/db/column-privileges.test.ts",
  "src/__tests__/db/public-content-revision.test.ts",
  // s68a: the definer-function and RLS invariants were only ever run by
  // hand; a plain Jest run turns them into a passing "[gated]" line. Named
  // here, under RCF_REQUIRE_TEST_DB=1, they gate every replay.
  "src/__tests__/db/function-grants.test.ts",
  "src/__tests__/db/rls-policies.test.ts",
  "src/__tests__/db/edit-sessions-privileges.test.ts",
  "src/__tests__/db/replay-privilege-convergence.test.ts",
  // s75: these seven were named by no CI step, so every run recorded a
  // "[gated]" placeholder or a describe.skip for them. None needs PostgREST
  // or GoTrue. The first five use db-harness and run on this replay; the
  // last two each create, own and drop a scratch database on this server
  // (content-attributes-lifecycle refuses the Supabase port 54322, so it
  // cannot ride the e2e job's database steps).
  "src/__tests__/db/content-version-concurrency.test.ts",
  "src/__tests__/db/content-version-i18n.test.ts",
  "src/__tests__/db/restore-reports-rows.test.ts",
  "src/__tests__/db/site-delete-cascade.test.ts",
  "src/__tests__/db/sites-install-status.test.ts",
  "src/__tests__/db/content-attributes-lifecycle.test.ts",
  "src/__tests__/db/editor-activation-concurrency.test.ts",
];

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    ...options,
  });
}

function findBinary(name) {
  const configured = process.env.RCF_POSTGRES_BIN;
  const candidates = [
    configured && path.join(configured, name),
    path.join("/usr/local/bin", name),
    path.join("/opt/homebrew/bin", name),
    name,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (result.status === 0) return candidate;
  }
  throw new Error(
    `Could not find ${name}. Set RCF_POSTGRES_BIN to a PostgreSQL ${REQUIRED_PG_MAJOR} bin directory.`,
  );
}

function assertLoopbackDatabase(url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error(
      `Refusing database invariant target outside loopback: ${parsed.hostname}`,
    );
  }
  if (!/^(postgres|recopyfast_s38_ci)$/.test(parsed.pathname.slice(1))) {
    throw new Error(
      `Refusing unexpected database name ${parsed.pathname}; use postgres or recopyfast_s38_ci.`,
    );
  }
}

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a loopback PostgreSQL port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

const externalUrl = process.env.RCF_TEST_DB_URL;
let ownedDataDir;
let ownedPgCtl;
let databaseUrl = externalUrl;

try {
  if (!databaseUrl) {
    const initdb = findBinary("initdb");
    ownedPgCtl = findBinary("pg_ctl");
    const port = await availablePort();
    ownedDataDir = mkdtempSync(
      path.join(tmpdir(), `recopyfast-replay-pg${REQUIRED_PG_MAJOR}-`),
    );
    run(initdb, [
      "-D",
      ownedDataDir,
      "--username=postgres",
      "--auth=trust",
      "--encoding=UTF8",
    ]);
    run(ownedPgCtl, [
      "-D",
      ownedDataDir,
      "-o",
      `-F -p ${port} -h 127.0.0.1`,
      "-w",
      "start",
    ]);
    databaseUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;
  }

  assertLoopbackDatabase(databaseUrl);
  const psql = findBinary("psql");
  const psqlArgs = [databaseUrl, "--no-psqlrc", "--set", "ON_ERROR_STOP=1"];
  const psqlOptions = {
    env: {
      ...process.env,
      // Supabase installs pgcrypto in `extensions` and exposes that schema on
      // migration sessions. Several inherited migrations call
      // gen_random_bytes() without qualifying it, so bare Postgres must match
      // the platform search path or the first real migration cannot parse.
      PGOPTIONS: "-c search_path=public,extensions",
    },
  };

  const serverVersion = execFileSync(
    psql,
    [
      databaseUrl,
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--command",
      "SHOW server_version_num",
    ],
    { ...psqlOptions, encoding: "utf8" },
  ).trim();
  assertServerMajor(serverVersion);

  run(psql, [...psqlArgs, "--file", BOOTSTRAP], psqlOptions);

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => !(isPreFixProof && file === REQUIRED_MIGRATION));

  if (!isPreFixProof && !migrations.includes(REQUIRED_MIGRATION)) {
    throw new Error(`Required migration is missing: ${REQUIRED_MIGRATION}`);
  }
  if (!isPreFixProof && !migrations.includes(REVISION_MIGRATION)) {
    throw new Error(`Required migration is missing: ${REVISION_MIGRATION}`);
  }

  for (const migration of migrations) {
    run(
      psql,
      [...psqlArgs, "--file", path.join(MIGRATIONS_DIR, migration)],
      psqlOptions,
    );
  }

  // Forward migrations must converge if an operator retries after an uncertain
  // connection result. Apply the security migration a second time explicitly.
  if (!isPreFixProof) {
    for (const migration of [
      REQUIRED_MIGRATION,
      REVISION_MIGRATION,
      EDIT_SESSIONS_MIGRATION,
      CONVERGENCE_MIGRATION,
    ]) {
      run(
        psql,
        [...psqlArgs, "--file", path.join(MIGRATIONS_DIR, migration)],
        psqlOptions,
      );
    }
  }

  const node = process.execPath;
  const reportDir = mkdtempSync(
    path.join(tmpdir(), "recopyfast-replay-report-"),
  );
  try {
    const reportFile = path.join(reportDir, "jest.json");
    run(
      node,
      [
        require.resolve("jest/bin/jest"),
        "--runInBand",
        "--json",
        `--outputFile=${reportFile}`,
        ...REPLAY_SUITES,
      ],
      {
        env: {
          ...process.env,
          RCF_TEST_DB_URL: databaseUrl,
          RCF_REQUIRE_TEST_DB: "1",
          // editor-activation-concurrency reads its own variable and falls
          // back to describe.skip without it; it only bootstraps a scratch
          // database from this URL.
          RCF_S29_DB_URL: databaseUrl,
        },
      },
    );

    // Jest exits 0 on a placeholder, a describe.skip and a path that matched
    // nothing. A green replay must mean every named suite ran here, and that
    // verdict is verifyReplayReport's alone (tested by `node --test`; s75
    // review). It throws, naming each suite that did not run; nothing here
    // catches it, so the run ends red.
    console.log(
      verifyReplayReport(reportFile, REPLAY_SUITES, realpathSync(REPO_ROOT)),
    );
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
} finally {
  if (ownedDataDir && ownedPgCtl) {
    try {
      run(ownedPgCtl, ["-D", ownedDataDir, "-m", "fast", "-w", "stop"]);
    } finally {
      rmSync(ownedDataDir, { recursive: true, force: true });
    }
  }
}
