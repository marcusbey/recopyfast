import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
} from "@playwright/test/reporter";
import StrictReporter from "../../../e2e/support/strict-reporter";

function fakeTest(
  title: string,
  outcome: ReturnType<TestCase["outcome"]>,
  status: "passed" | "failed" | "skipped",
): TestCase {
  return {
    title,
    titlePath: () => ["chromium", "fixture.spec.ts", title],
    location: { file: "/repo/e2e/fixture.spec.ts", line: 1, column: 1 },
    outcome: () => outcome,
    results: [{ status, duration: 7 }],
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
});
