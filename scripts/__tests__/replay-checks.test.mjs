import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REQUIRED_PG_MAJOR,
  assertServerMajor,
  findSuitesThatDidNotRun,
  verifyReplayReport,
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

// s75 review (major): the runner used to hold the tolerated-placeholder pattern
// and the "did any suite fail to run?" decision inline, so neither had a test —
// dropping the check or widening the pattern left every test green while the
// replay printed "all 13 named suites ran". The whole verdict now lives in
// verifyReplayReport, and the runner only calls it. These tests feed it real
// report files, with the placeholder titles the suites actually register.
const ACTIVATION = "src/__tests__/db/editor-activation-concurrency.test.ts";
const GRANTS = "src/__tests__/db/function-grants.test.ts";
const EDIT_SESSIONS = "src/__tests__/db/edit-sessions-privileges.test.ts";
const REPLAY = [GRANTS, EDIT_SESSIONS, ACTIVATION];

function withReport(report, check) {
  const dir = mkdtempSync(path.join(tmpdir(), "replay-checks-test-"));
  try {
    const file = path.join(dir, "jest.json");
    if (report !== undefined) {
      writeFileSync(
        file,
        typeof report === "string" ? report : JSON.stringify(report),
      );
    }
    return check(file, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function realSuite(relativePath, titles, statuses) {
  return {
    name: path.join(ROOT, relativePath),
    assertionResults: titles.map((title, index) => ({
      title,
      status: statuses?.[index] ?? "passed",
    })),
  };
}

/** Every suite of REPLAY ran for real; `override` replaces one by path. */
function replayReport(override = {}) {
  const ran = {
    [GRANTS]: realSuite(GRANTS, ["anon cannot execute definer functions"]),
    [EDIT_SESSIONS]: realSuite(EDIT_SESSIONS, [
      "the authenticated role cannot insert an edit session",
      "[gated] no PostgREST target configured — direct issuance not probed",
    ]),
    [ACTIVATION]: realSuite(ACTIVATION, ["activates one editor under a race"]),
    ...override,
  };
  return {
    testResults: Object.values(ran).filter(Boolean),
  };
}

test("the replay passes when every named suite ran, with the one PostgREST placeholder it has by design", () => {
  const verdict = withReport(replayReport(), (file) =>
    verifyReplayReport(file, REPLAY, ROOT),
  );

  assert.equal(
    verdict,
    `Database replay: all ${REPLAY.length} named suites ran against PostgreSQL ${REQUIRED_PG_MAJOR}.`,
  );
});

test("a skipped suite fails the replay, naming it", () => {
  // editor-activation-concurrency without RCF_S29_DB_URL: describe.skip.
  const report = replayReport({
    [ACTIVATION]: realSuite(
      ACTIVATION,
      ["activates one editor under a race", "never activates twice"],
      ["pending", "pending"],
    ),
  });

  assert.throws(
    () => withReport(report, (file) => verifyReplayReport(file, REPLAY, ROOT)),
    (error) =>
      error instanceof Error &&
      error.message.includes(ACTIVATION) &&
      error.message.includes("1 named suite(s) did not run") &&
      !error.message.includes(GRANTS),
  );
});

test("a placeholder the replay does not tolerate fails it, naming the suite and the placeholder", () => {
  for (const placeholder of [
    // db-harness.ts: no database reached.
    "[gated] no ReCopyFast database reachable — invariants not checked",
    // content-attributes-lifecycle.test.ts: its variable is missing.
    "[gated] RCF_TEST_DB_URL was not provided — SQL lifecycle not checked",
  ]) {
    const report = replayReport({
      [GRANTS]: realSuite(GRANTS, ["reads the migration text", placeholder]),
    });

    assert.throws(
      () =>
        withReport(report, (file) => verifyReplayReport(file, REPLAY, ROOT)),
      (error) =>
        error instanceof Error &&
        error.message.includes(GRANTS) &&
        error.message.includes(placeholder),
      placeholder,
    );
  }
});

test("only the PostgREST placeholder is tolerated: any other [gated] title beside it still fails", () => {
  const report = replayReport({
    [EDIT_SESSIONS]: realSuite(EDIT_SESSIONS, [
      "the authenticated role cannot insert an edit session",
      "[gated] no PostgREST target configured — direct issuance not probed",
      "[gated] no ReCopyFast database reachable — invariants not checked",
    ]),
  });

  assert.throws(
    () => withReport(report, (file) => verifyReplayReport(file, REPLAY, ROOT)),
    (error) =>
      error instanceof Error &&
      error.message.includes(EDIT_SESSIONS) &&
      error.message.includes("no ReCopyFast database reachable"),
  );
});

test("every suite that did not run is named, not just the first", () => {
  const report = replayReport({
    [GRANTS]: undefined,
    [ACTIVATION]: realSuite(ACTIVATION, ["activates"], ["pending"]),
  });

  assert.throws(
    () => withReport(report, (file) => verifyReplayReport(file, REPLAY, ROOT)),
    (error) =>
      error instanceof Error &&
      error.message.includes("2 named suite(s) did not run") &&
      error.message.includes(GRANTS) &&
      error.message.includes(ACTIVATION),
  );
});

test("a missing report file fails the replay rather than reading as clean", () => {
  // Jest writes the file only when asked (--json --outputFile); a runner that
  // stops asking must not get a green verdict.
  assert.throws(
    () =>
      withReport(undefined, (file) => verifyReplayReport(file, REPLAY, ROOT)),
    (error) =>
      error instanceof Error &&
      /no readable Jest report/.test(error.message) &&
      error.message.includes("jest.json"),
  );
});

test("an unreadable report fails the replay", () => {
  for (const contents of ["", "{not json", "{}"]) {
    assert.throws(
      () =>
        withReport(contents, (file) => verifyReplayReport(file, REPLAY, ROOT)),
      /report/,
      JSON.stringify(contents),
    );
  }
});
