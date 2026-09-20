import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import StrictReporter from "../../../e2e/support/strict-reporter";

function fakeTest(
  title: string,
  outcome: ReturnType<TestCase["outcome"]>,
  status: "passed" | "failed" | "skipped",
  errorMessages: string[] = [],
): TestCase {
  return {
    title,
    titlePath: () => ["chromium", "fixture.spec.ts", title],
    location: { file: "/repo/e2e/fixture.spec.ts", line: 1, column: 1 },
    outcome: () => outcome,
    results: [
      {
        status,
        duration: 7,
        errors: errorMessages.map((message) => ({ message })),
      },
    ],
  } as unknown as TestCase;
}

function fakeSuite(tests: TestCase[]): Suite {
  return { allTests: () => tests } as unknown as Suite;
}

describe("StrictReporter", () => {
  it("writes a minimal report and preserves a clean exit", async () => {
    const outputFile = join(
      mkdtempSync(join(tmpdir(), "rcf-e2e-")),
      "summary.json",
    );
    const reporter = new StrictReporter({ expected: 2, outputFile });
    reporter.onBegin(
      { rootDir: "/repo" } as FullConfig,
      fakeSuite([
        fakeTest("first", "expected", "passed"),
        fakeTest("second", "expected", "passed"),
      ]),
    );

    await expect(
      reporter.onEnd({ status: "passed" } as FullResult),
    ).resolves.toBeUndefined();

    const report = JSON.parse(readFileSync(outputFile, "utf8"));
    expect(report).toEqual({
      contract: "passed",
      expected: 2,
      total: 2,
      passed: 2,
      failed: 0,
      skipped: 0,
      flaky: 0,
      tests: [
        {
          title: "chromium > fixture.spec.ts > first",
          file: "e2e/fixture.spec.ts",
          outcome: "passed",
          durationMs: 7,
        },
        {
          title: "chromium > fixture.spec.ts > second",
          file: "e2e/fixture.spec.ts",
          outcome: "passed",
          durationMs: 7,
        },
      ],
    });
  });

  it("overrides a green runner status when a test was skipped", async () => {
    const outputFile = join(
      mkdtempSync(join(tmpdir(), "rcf-e2e-")),
      "summary.json",
    );
    const reporter = new StrictReporter({ expected: 2, outputFile });
    reporter.onBegin(
      { rootDir: "/repo" } as FullConfig,
      fakeSuite([
        fakeTest("first", "expected", "passed"),
        fakeTest(
          "hidden rcf_edit_token=must-not-survive",
          "skipped",
          "skipped",
        ),
      ]),
    );

    await expect(
      reporter.onEnd({ status: "passed" } as FullResult),
    ).resolves.toEqual({ status: "failed" });

    const reportText = readFileSync(outputFile, "utf8");
    expect(JSON.parse(reportText)).toMatchObject({
      contract: "failed",
      total: 2,
      passed: 1,
      skipped: 1,
    });
    expect(reporter.printsToStdio()).toBe(true);
    expect(reportText).not.toContain("must-not-survive");
    expect(reportText).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(reportText).not.toContain("Authorization");
    expect(reportText).not.toContain("rcf_edit_token");
  });

  it("retains actionable failure context while redacting credentials", async () => {
    const outputFile = join(
      mkdtempSync(join(tmpdir(), "rcf-e2e-")),
      "summary.json",
    );
    const reporter = new StrictReporter({ expected: 1, outputFile });
    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
    const rawDiagnostic =
      "beforeAll failed: access_type='link' is retired at " +
      "http://127.0.0.1:4173/?rcf_edit_token=secret-edit-token&code=424242 " +
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature " +
      'SUPABASE_SERVICE_ROLE_KEY="qa-secret" token=raw-token e2e@example.test';
    const failed = fakeTest("fixture setup", "unexpected", "failed", [
      rawDiagnostic,
    ]);
    reporter.onBegin({ rootDir: "/repo" } as FullConfig, fakeSuite([failed]));
    reporter.onTestEnd(failed, failed.results[0] as TestResult);

    await expect(
      reporter.onEnd({ status: "failed" } as FullResult),
    ).resolves.toEqual({ status: "failed" });

    const reportText = readFileSync(outputFile, "utf8");
    const report = JSON.parse(reportText);
    expect(report.tests[0].diagnostics).toEqual([
      expect.stringContaining("access_type='link' is retired"),
    ]);
    expect(reportText).toContain("[REDACTED]");
    for (const secret of [
      "secret-edit-token",
      "424242",
      "eyJhbGciOiJIUzI1NiJ9",
      "qa-secret",
      "raw-token",
      "e2e@example.test",
    ]) {
      expect(reportText).not.toContain(secret);
    }

    expect(consoleLog).toHaveBeenCalledWith(
      expect.stringContaining("access_type='link' is retired"),
    );
    expect(consoleLog.mock.calls.flat().join("\n")).not.toContain(
      "secret-edit-token",
    );
    consoleLog.mockRestore();
  });
});
