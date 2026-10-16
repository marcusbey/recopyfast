#!/usr/bin/env node

/**
 * The script tests used to be four hand-written workflow steps. A fifth test
 * then landed in `scripts/` and stayed invisible while CI remained green. A
 * glob would close that omission by creating a worse one: the next diagnostic
 * that talks to Stripe, Google or another provider would execute merely because
 * its filename matched. Discovery and review are therefore separate. Every
 * discovered `*.test.mjs` must be in this fixture-only manifest before any
 * child process starts; an unknown file is a refusal, never an automatic run.
 *
 * This is intentionally an inventory guard, not a network sandbox. Changes
 * inside a reviewed file and its transitive imports still require code review.
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REVIEWED_NODE_TESTS = Object.freeze([
  {
    path: "scripts/__tests__/measure-published-snapshot.test.mjs",
    network: "owned loopback HTTP fixtures",
  },
  {
    path: "scripts/__tests__/node-test-runner.test.mjs",
    network: "temporary files and injected child results",
  },
  {
    path: "scripts/__tests__/replay-checks.test.mjs",
    network: "temporary report files only",
  },
  {
    path: "scripts/__tests__/sync-stripe-catalogue.test.mjs",
    network: "injected Stripe doubles only",
  },
  {
    path: "scripts/__tests__/uptime-check.test.mjs",
    network: "owned loopback HTTP and recording gh fixtures",
  },
  {
    path: "scripts/check-analytics-conversions.test.mjs",
    network: "injected fetch fixtures only",
  },
]);

function toRepoPath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

export function discoverNodeTestFiles(root) {
  const scriptsRoot = path.join(root, "scripts");
  const discovered = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
        discovered.push(toRepoPath(root, absolutePath));
      }
    }
  }

  visit(scriptsRoot);
  return discovered.sort();
}

function reviewedPaths(reviewedTests) {
  return reviewedTests
    .map((entry) => (typeof entry === "string" ? entry : entry.path))
    .sort();
}

export function findInventoryProblems(discovered, reviewedTests) {
  const actual = new Set(discovered);
  const reviewed = new Set(reviewedPaths(reviewedTests));
  return [
    ...[...reviewed]
      .filter((file) => !actual.has(file))
      .map((file) => `missing reviewed test: ${file}`),
    ...[...actual]
      .filter((file) => !reviewed.has(file))
      .map((file) => `unexpected unreviewed test: ${file}`),
  ].sort();
}

const TAP_SUMMARY_FIELDS = [
  "tests",
  "pass",
  "fail",
  "cancelled",
  "skipped",
  "todo",
];

export function parseTapSummary(output, file) {
  const summary = {};
  for (const field of TAP_SUMMARY_FIELDS) {
    const matches = [
      ...output.matchAll(new RegExp(`^# ${field} (\\d+)$`, "gm")),
    ];
    if (matches.length !== 1) {
      throw new Error(
        `${file}: TAP summary must contain exactly one numeric ${field} line`,
      );
    }
    summary[field] = Number(matches[0][1]);
  }
  return summary;
}

export function validateTapSummary(summary, file) {
  if (summary.tests === 0) throw new Error(`${file}: zero tests ran`);

  const total =
    summary.pass +
    summary.fail +
    summary.cancelled +
    summary.skipped +
    summary.todo;
  if (summary.tests !== total) {
    throw new Error(
      `${file}: inconsistent TAP totals (${summary.tests} tests, ${total} classified)`,
    );
  }

  const refused = [
    ["failed", summary.fail],
    ["cancelled", summary.cancelled],
    ["skipped", summary.skipped],
    ["todo", summary.todo],
  ].filter(([, count]) => count > 0);
  if (refused.length > 0) {
    throw new Error(
      `${file}: ${refused.map(([label, count]) => `${count} ${label}`).join(", ")}`,
    );
  }
  if (summary.pass !== summary.tests) {
    throw new Error(
      `${file}: inconsistent TAP totals (${summary.pass} passed of ${summary.tests})`,
    );
  }
  return summary;
}

function defaultSpawnTest(root, file) {
  return spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", path.join(root, file)],
    {
      cwd: root,
      env: process.env,
      encoding: "utf8",
    },
  );
}

export function executeReviewedNodeTests({
  root,
  reviewedTests = REVIEWED_NODE_TESTS,
  spawnTest = (file) => defaultSpawnTest(root, file),
  writeOutput = (text) => process.stdout.write(text),
}) {
  const discovered = discoverNodeTestFiles(root);
  const problems = findInventoryProblems(discovered, reviewedTests);
  if (problems.length > 0) {
    throw new Error(`Node test inventory refused:\n${problems.join("\n")}`);
  }

  const total = {
    files: 0,
    tests: 0,
    pass: 0,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
  };

  for (const entry of reviewedTests) {
    const file = typeof entry === "string" ? entry : entry.path;
    const result = spawnTest(file);
    if (result.stdout) writeOutput(result.stdout);
    if (result.stderr) writeOutput(result.stderr);
    if (result.error) {
      throw new Error(
        `${file}: could not start Node test (${result.error.message})`,
      );
    }
    if (result.status !== 0) {
      throw new Error(`${file}: Node test exited ${String(result.status)}`);
    }

    const summary = validateTapSummary(
      parseTapSummary(result.stdout, file),
      file,
    );
    total.files += 1;
    for (const field of TAP_SUMMARY_FIELDS) total[field] += summary[field];
  }

  writeOutput(
    `Node test inventory: ${total.tests} tests across ${total.files} reviewed files; ` +
      `${total.pass} passed, ${total.fail} failed, ${total.cancelled} cancelled, ` +
      `${total.skipped} skipped, ${total.todo} todo.\n`,
  );
  return total;
}

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    executeReviewedNodeTests({ root: REPO_ROOT });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
