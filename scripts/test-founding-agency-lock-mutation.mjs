import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.RCF_TEST_DB_URL;
if (!connectionString) {
  throw new Error(
    "RCF_TEST_DB_URL is required and must identify a disposable loopback PostgreSQL database",
  );
}

const target = new URL(connectionString);
if (target.protocol !== "postgresql:" && target.protocol !== "postgres:") {
  throw new Error("RCF_TEST_DB_URL must use postgresql:// or postgres://");
}
if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
  throw new Error("Mutation proof refuses every non-loopback database target");
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const jestBin = path.join(repoRoot, "node_modules/jest/bin/jest.js");
const testArgs = [
  jestBin,
  "src/__tests__/db/founding-agency-cap.test.ts",
  "--runInBand",
  "-t",
  "20 barrier-synchronised",
];
const lockStatement =
  "  PERFORM pg_advisory_xact_lock(hashtextextended('founding_agency_capacity', 0));\n";

function runFocusedTest() {
  return spawnSync(process.execPath, testArgs, {
    cwd: repoRoot,
    env: { ...process.env, RCF_TEST_DB_URL: connectionString },
    encoding: "utf8",
  });
}

const client = new pg.Client({ connectionString });
await client.connect();

let mutationResult;
let originalFunctionSource;
let didMutate = false;
try {
  const probe = await client.query(`
    SELECT inet_server_addr()::text AS server_addr,
           to_regclass('public.founding_agency_reservations')::text AS reservations,
           to_regprocedure('public.reserve_founding_agency_spot(uuid)')::text AS reserve_rpc
  `);
  if (
    !/^(127\.0\.0\.1|::1)(?:\/\d+)?$/.test(probe.rows[0]?.server_addr ?? "") ||
    !probe.rows[0]?.reservations ||
    !probe.rows[0]?.reserve_rpc
  ) {
    throw new Error(
      "Mutation proof target is not a loopback ReCopyFast founding-cap database",
    );
  }

  const definition = await client.query(
    "SELECT pg_get_functiondef('public.reserve_founding_agency_spot(uuid)'::regprocedure) AS source",
  );
  const source = definition.rows[0]?.source;
  const mutant = source?.replace(lockStatement, "");
  if (!source || mutant === source) {
    throw new Error(
      "Reserve RPC advisory-lock statement was not found exactly once",
    );
  }

  originalFunctionSource = source;
  await client.query(mutant);
  didMutate = true;
  mutationResult = runFocusedTest();
} finally {
  // Restore only the exact function captured before mutation. A failed target
  // probe must perform zero writes, and restoring the whole migration here
  // would also rewrite catalogue rows unrelated to the mutation proof.
  if (didMutate && originalFunctionSource) {
    await client.query(originalFunctionSource);
  }
  await client.end();
}

process.stdout.write(mutationResult.stdout ?? "");
process.stderr.write(mutationResult.stderr ?? "");
const mutationOutput = `${mutationResult.stdout ?? ""}\n${mutationResult.stderr ?? ""}`;
if (
  mutationResult.status === 0 ||
  !mutationOutput.includes("resolvedClaims") ||
  !mutationOutput.includes("waiters")
) {
  throw new Error(
    "Removing the advisory lock did not produce the expected barrier-test failure",
  );
}

const restoredResult = runFocusedTest();
process.stdout.write(restoredResult.stdout ?? "");
process.stderr.write(restoredResult.stderr ?? "");
if (restoredResult.status !== 0) {
  throw new Error(
    "Barrier test did not return green after restoring the migration",
  );
}

console.log(
  "Mutation proof passed: lock removal was red; restored RPC was green.",
);
