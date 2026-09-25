#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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
const isPreFixProof = process.argv.includes("--pre-fix-proof");

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
    `Could not find ${name}. Set RCF_POSTGRES_BIN to a PostgreSQL 14 bin directory.`,
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
    ownedDataDir = mkdtempSync(path.join(tmpdir(), "recopyfast-s38-pg14-"));
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
  if (!/^14\d{4}$/.test(serverVersion)) {
    throw new Error(
      `Database invariant runner requires PostgreSQL 14; server reported ${serverVersion}.`,
    );
  }

  run(psql, [...psqlArgs, "--file", BOOTSTRAP], psqlOptions);

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => !(isPreFixProof && file === REQUIRED_MIGRATION));

  if (!isPreFixProof && !migrations.includes(REQUIRED_MIGRATION)) {
    throw new Error(`Required migration is missing: ${REQUIRED_MIGRATION}`);
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
    run(
      psql,
      [...psqlArgs, "--file", path.join(MIGRATIONS_DIR, REQUIRED_MIGRATION)],
      psqlOptions,
    );
  }

  const node = process.execPath;
  run(
    node,
    [
      require.resolve("jest/bin/jest"),
      "--runInBand",
      "src/__tests__/db/column-privileges.test.ts",
    ],
    {
      env: {
        ...process.env,
        RCF_TEST_DB_URL: databaseUrl,
        RCF_REQUIRE_TEST_DB: "1",
      },
    },
  );
} finally {
  if (ownedDataDir && ownedPgCtl) {
    try {
      run(ownedPgCtl, ["-D", ownedDataDir, "-m", "fast", "-w", "stop"]);
    } finally {
      rmSync(ownedDataDir, { recursive: true, force: true });
    }
  }
}
