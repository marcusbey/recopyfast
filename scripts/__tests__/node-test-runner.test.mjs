import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  discoverNodeTestFiles,
  executeReviewedNodeTests,
  findInventoryProblems,
  parseTapSummary,
  validateTapSummary,
} from "../run-node-tests.mjs";

function withFixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), "recopyfast-node-tests-"));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(root, relativePath, source = "") {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
}

function tap({
  tests = 1,
  pass = tests,
  fail = 0,
  cancelled = 0,
  skipped = 0,
  todo = 0,
} = {}) {
  return [
    "TAP version 13",
    `1..${tests}`,
    `# tests ${tests}`,
    `# pass ${pass}`,
    `# fail ${fail}`,
    `# cancelled ${cancelled}`,
    `# skipped ${skipped}`,
    `# todo ${todo}`,
    "# duration_ms 1",
    "",
  ].join("\n");
}

test("discovers nested Node test files in stable repository-relative order", () =>
  withFixture((root) => {
    write(root, "scripts/z.test.mjs");
    write(root, "scripts/__tests__/a.test.mjs");
    write(root, "scripts/not-a-test.mjs");

    assert.deepEqual(discoverNodeTestFiles(root), [
      "scripts/__tests__/a.test.mjs",
      "scripts/z.test.mjs",
    ]);
  }));

test("reports every missing and unexpected file by name", () => {
  assert.deepEqual(
    findInventoryProblems(
      ["scripts/approved.test.mjs", "scripts/provider.test.mjs"],
      ["scripts/approved.test.mjs", "scripts/missing.test.mjs"],
    ),
    [
      "missing reviewed test: scripts/missing.test.mjs",
      "unexpected unreviewed test: scripts/provider.test.mjs",
    ],
  );
});

test("parses a complete TAP summary", () => {
  assert.deepEqual(
    parseTapSummary(tap({ tests: 3, pass: 3 }), "safe.test.mjs"),
    {
      tests: 3,
      pass: 3,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0,
    },
  );
});

test("refuses zero tests and a missing or malformed TAP summary", () => {
  assert.throws(
    () =>
      validateTapSummary(
        parseTapSummary(tap({ tests: 0 }), "zero.test.mjs"),
        "zero.test.mjs",
      ),
    /zero\.test\.mjs.*zero tests/,
  );
  assert.throws(
    () => parseTapSummary("TAP version 13\n1..1\n", "missing.test.mjs"),
    /missing\.test\.mjs.*summary/,
  );
  assert.throws(
    () => parseTapSummary("# tests one\n# pass one\n", "malformed.test.mjs"),
    /malformed\.test\.mjs.*summary/,
  );
});

for (const [field, summary] of [
  ["failed", { tests: 1, pass: 0, fail: 1 }],
  ["cancelled", { tests: 1, pass: 0, cancelled: 1 }],
  ["skipped", { tests: 1, pass: 0, skipped: 1 }],
  ["todo", { tests: 1, pass: 0, todo: 1 }],
]) {
  test(`refuses a result with ${field} tests`, () => {
    assert.throws(
      () =>
        validateTapSummary(
          parseTapSummary(tap(summary), `${field}.test.mjs`),
          `${field}.test.mjs`,
        ),
      new RegExp(`${field}\\.test\\.mjs.*${field}`),
    );
  });
}

test("refuses inconsistent totals", () => {
  assert.throws(
    () =>
      validateTapSummary(
        parseTapSummary(tap({ tests: 2, pass: 1 }), "inconsistent.test.mjs"),
        "inconsistent.test.mjs",
      ),
    /inconsistent\.test\.mjs.*inconsistent/,
  );
});

test("rejects an unknown provider-like test before any child can execute", () =>
  withFixture((root) => {
    const marker = path.join(root, "provider-ran");
    write(root, "scripts/safe.test.mjs", "// reviewed fixture\n");
    write(
      root,
      "scripts/provider.test.mjs",
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran");`,
    );
    let spawnCount = 0;

    assert.throws(
      () =>
        executeReviewedNodeTests({
          root,
          reviewedTests: [{ path: "scripts/safe.test.mjs", network: "none" }],
          spawnTest: () => {
            spawnCount += 1;
            return { status: 0, stdout: tap(), stderr: "" };
          },
          writeOutput: () => undefined,
        }),
      /unexpected unreviewed test: scripts\/provider\.test\.mjs/,
    );
    assert.equal(spawnCount, 0);
    assert.equal(existsSync(marker), false);
  }));

test("runs reviewed files sequentially and reports actual totals", () =>
  withFixture((root) => {
    write(root, "scripts/a.test.mjs");
    write(root, "scripts/b.test.mjs");
    const calls = [];
    const output = [];

    const result = executeReviewedNodeTests({
      root,
      reviewedTests: [
        { path: "scripts/a.test.mjs", network: "none" },
        { path: "scripts/b.test.mjs", network: "loopback" },
      ],
      spawnTest: (file) => {
        calls.push(file);
        const tests = calls.length;
        return { status: 0, stdout: tap({ tests, pass: tests }), stderr: "" };
      },
      writeOutput: (text) => output.push(text),
    });

    assert.deepEqual(calls, ["scripts/a.test.mjs", "scripts/b.test.mjs"]);
    assert.deepEqual(result, {
      files: 2,
      tests: 3,
      pass: 3,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0,
    });
    assert.match(output.join(""), /3 tests across 2 reviewed files/);
  }));
