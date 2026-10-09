import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_PG_MAJOR,
  assertServerMajor,
  findSuitesThatDidNotRun,
} from "../db/replay-checks.mjs";

// s75: production is PostgreSQL 17.4. The replay used to insist on 14, so a
// migration that only parses on the production major (or only on 14) was
// judged by the wrong parser.
test("the replay requires the production PostgreSQL major", () => {
  assert.equal(REQUIRED_PG_MAJOR, 17);
});

test("accepts any 17.x server", () => {
  assert.doesNotThrow(() => assertServerMajor("170004"));
  assert.doesNotThrow(() => assertServerMajor("170011\n"));
});

test("refuses another major and says how to point the runner at a 17 install", () => {
  for (const reported of ["140017", "150008", "160010", "180001"]) {
    assert.throws(
      () => assertServerMajor(reported),
      (error) =>
        error instanceof Error &&
        error.message.includes("requires PostgreSQL 17") &&
        error.message.includes(reported) &&
        error.message.includes("RCF_POSTGRES_BIN"),
    );
  }
});

test("refuses an answer that is not a server_version_num", () => {
  for (const reported of ["", "17.4", "17", "1700040", "abc"]) {
    assert.throws(() => assertServerMajor(reported), /requires PostgreSQL 17/);
  }
});

// s75: a DB suite that cannot reach its database registers a passing
// "[gated]" placeholder (db-harness.ts) or skips itself (describe.skip), and a
// misspelled path matches nothing — all three exit 0. The replay step reads
// Jest's --json report and refuses each of them by name.
const ROOT = "/repo";
const A = "src/__tests__/db/a.test.ts";
const B = "src/__tests__/db/b.test.ts";

function suite(relativePath, statuses, titles = []) {
  return {
    name: `${ROOT}/${relativePath}`,
    status: statuses.includes("failed") ? "failed" : "passed",
    assertionResults: statuses.map((status, index) => ({
      status,
      title: titles[index] ?? `test ${index}`,
    })),
  };
}

test("a run where every named suite ran real tests passes, by-design skips included", () => {
  const report = {
    testResults: [
      suite(A, ["passed", "passed"]),
      suite(B, ["passed", "pending"]),
    ],
  };

  assert.deepEqual(findSuitesThatDidNotRun(report, [A, B], ROOT), []);
});

test("a named suite with no result is reported (a path that matched nothing)", () => {
  const report = { testResults: [suite(A, ["passed"])] };

  const problems = findSuitesThatDidNotRun(report, [A, B], ROOT);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /src\/__tests__\/db\/b\.test\.ts/);
  assert.match(problems[0], /no result/);
});

test("a suite that only registered its [gated] placeholder is reported", () => {
  const report = {
    testResults: [
      suite(A, ["passed"]),
      suite(
        B,
        ["passed"],
        ["[gated] no ReCopyFast database reachable — invariants not checked"],
      ),
    ],
  };

  const problems = findSuitesThatDidNotRun(report, [A, B], ROOT);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /b\.test\.ts/);
  assert.match(problems[0], /\[gated\]/);
});

test("a database placeholder beside passing text-only tests is still reported", () => {
  // sites-install-status reads its migration as text and then runs a
  // describeDb block: if only the block gated, five passes would hide it.
  const report = {
    testResults: [
      suite(A, ["passed"]),
      suite(
        B,
        ["passed", "passed", "passed"],
        [
          "adds the status column",
          "never writes stale anywhere",
          "[gated] no ReCopyFast database reachable — invariants not checked",
        ],
      ),
    ],
  };

  const problems = findSuitesThatDidNotRun(report, [A, B], ROOT);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /b\.test\.ts/);
  assert.match(problems[0], /no ReCopyFast database reachable/);
});

const NO_POSTGREST = /^\[gated\] no PostgREST target configured/;

test("a tolerated placeholder beside real tests passes (the replay has no PostgREST by design)", () => {
  const report = {
    testResults: [
      suite(
        A,
        ["passed", "passed"],
        [
          "the member's INSERT is refused",
          "[gated] no PostgREST target configured — direct issuance not probed",
        ],
      ),
    ],
  };

  assert.deepEqual(
    findSuitesThatDidNotRun(report, [A], ROOT, [NO_POSTGREST]),
    [],
  );
  assert.equal(findSuitesThatDidNotRun(report, [A], ROOT).length, 1);
});

test("a suite with nothing but a tolerated placeholder is reported", () => {
  const report = {
    testResults: [
      suite(
        A,
        ["passed"],
        [
          "[gated] no PostgREST target configured — snapshot freshness not checked",
        ],
      ),
    ],
  };

  const problems = findSuitesThatDidNotRun(report, [A], ROOT, [NO_POSTGREST]);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /no passing test/);
});

test("a suite whose tests were all skipped is reported", () => {
  const report = {
    testResults: [suite(A, ["passed"]), suite(B, ["pending", "pending"])],
  };

  const problems = findSuitesThatDidNotRun(report, [A, B], ROOT);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /b\.test\.ts/);
  assert.match(problems[0], /no passing test/);
});

test("a suite that failed to load (no tests at all) is reported", () => {
  const report = { testResults: [suite(A, ["passed"]), suite(B, [])] };

  const problems = findSuitesThatDidNotRun(report, [A, B], ROOT);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /b\.test\.ts/);
});

test("a malformed report is refused rather than read as clean", () => {
  assert.throws(() => findSuitesThatDidNotRun({}, [A], ROOT), /report/);
  assert.throws(() => findSuitesThatDidNotRun(null, [A], ROOT), /report/);
});
