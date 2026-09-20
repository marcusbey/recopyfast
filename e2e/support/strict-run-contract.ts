export type FinalTestOutcome = "passed" | "failed" | "skipped" | "flaky";

export interface FinalTestRecord {
  title: string;
  file: string;
  outcome: FinalTestOutcome;
  durationMs: number;
}

export interface StrictRunSummary {
  expected: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  tests: FinalTestRecord[];
}

export function summarizeStrictRun(
  tests: FinalTestRecord[],
  expected: number,
): StrictRunSummary {
  const summary: StrictRunSummary = {
    expected,
    total: tests.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    tests,
  };

  for (const test of tests) {
    summary[test.outcome] += 1;
  }

  return summary;
}

export function enforceStrictRunContract(
  tests: FinalTestRecord[],
  expected: number,
): StrictRunSummary {
  const summary = summarizeStrictRun(tests, expected);
  const isCleanRun =
    summary.total === expected &&
    summary.passed === expected &&
    summary.failed === 0 &&
    summary.skipped === 0 &&
    summary.flaky === 0;

  if (!isCleanRun) {
    throw new Error(
      `Playwright run contract failed: expected ${expected}, collected ${summary.total}; ` +
        `passed ${summary.passed}, failed ${summary.failed}, skipped ${summary.skipped}, ` +
        `flaky ${summary.flaky}.`,
    );
  }

  return summary;
}
