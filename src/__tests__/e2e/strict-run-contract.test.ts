import {
  enforceStrictRunContract,
  type FinalTestRecord,
} from "../../../e2e/support/strict-run-contract";

function passingTests(count: number): FinalTestRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    title: `test ${index + 1}`,
    file: `e2e/spec-${index + 1}.spec.ts`,
    outcome: "passed" as const,
    durationMs: index + 1,
  }));
}

describe("enforceStrictRunContract", () => {
  it("accepts exactly 45 passed tests", () => {
    expect(enforceStrictRunContract(passingTests(45), 45)).toMatchObject({
      expected: 45,
      total: 45,
      passed: 45,
      failed: 0,
      skipped: 0,
      flaky: 0,
    });
  });

  it.each(["failed", "skipped", "flaky"] as const)(
    "fails when one test is %s",
    (outcome) => {
      const tests = passingTests(45);
      tests[12] = { ...tests[12], outcome };

      expect(() => enforceStrictRunContract(tests, 45)).toThrow(
        /playwright run contract failed/i,
      );
    },
  );

  it("fails when collection silently drops a test", () => {
    expect(() => enforceStrictRunContract(passingTests(44), 45)).toThrow(
      /expected 45.*collected 44/i,
    );
  });
});
