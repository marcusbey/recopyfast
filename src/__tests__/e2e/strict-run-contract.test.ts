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
  it("accepts exactly 40 passed tests", () => {
    expect(enforceStrictRunContract(passingTests(40), 40)).toMatchObject({
      expected: 40,
      total: 40,
      passed: 40,
      failed: 0,
      skipped: 0,
      flaky: 0,
    });
  });

  it.each(["failed", "skipped", "flaky"] as const)(
    "fails when one test is %s",
    (outcome) => {
      const tests = passingTests(40);
      tests[12] = { ...tests[12], outcome };

      expect(() => enforceStrictRunContract(tests, 40)).toThrow(
        /playwright run contract failed/i,
      );
    },
  );

  it("fails when collection silently drops a test", () => {
    expect(() => enforceStrictRunContract(passingTests(39), 40)).toThrow(
      /expected 40.*collected 39/i,
    );
  });
});
