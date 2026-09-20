import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
} from "@playwright/test/reporter";
import {
  enforceStrictRunContract,
  summarizeStrictRun,
  type FinalTestOutcome,
  type FinalTestRecord,
} from "./strict-run-contract";
import { redactDiagnostic } from "./redacted-diagnostics";

interface StrictReporterOptions {
  expected?: number;
  outputFile?: string;
}

interface SerializableReport {
  contract: "passed" | "failed";
  expected: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  tests: FinalTestRecord[];
  diagnostics?: string[];
}

const MAX_DIAGNOSTICS_PER_TEST = 3;

function resultDiagnostics(result: TestResult): string[] {
  const messages = result.errors
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message));

  if (result.error?.message && !messages.includes(result.error.message)) {
    messages.push(result.error.message);
  }

  return messages.map((message) => redactDiagnostic(message)).filter(Boolean);
}

function testDiagnostics(test: TestCase): string[] {
  const unique = new Set<string>();
  for (const result of test.results) {
    for (const diagnostic of resultDiagnostics(result)) {
      unique.add(diagnostic);
      if (unique.size >= MAX_DIAGNOSTICS_PER_TEST) {
        return [...unique];
      }
    }
  }
  return [...unique];
}

function finalOutcome(test: TestCase): FinalTestOutcome {
  const outcome = test.outcome();
  if (outcome === "skipped") return "skipped";
  if (outcome === "flaky") return "flaky";
  if (outcome === "unexpected") return "failed";

  const lastResult = test.results[test.results.length - 1];
  if (lastResult?.status === "passed") return "passed";
  if (lastResult?.status === "skipped") return "skipped";
  return "failed";
}

/**
 * CI used to upload Playwright's complete trace bundle even though the core
 * specs put editor credentials in page URLs. The s24 artifact is intentionally
 * smaller: fixed test titles, repo-relative file names, outcome, duration and
 * at most three bounded/redacted error messages. It contains no request,
 * response, environment, console, screenshot, video, trace or raw stack in
 * which a credential could hide.
 */
export default class StrictReporter implements Reporter {
  private readonly expected: number;
  private readonly outputFile: string;
  private rootDir = process.cwd();
  private suite: Suite | null = null;
  private readonly globalDiagnostics = new Set<string>();

  constructor(options: StrictReporterOptions = {}) {
    this.expected = options.expected ?? 39;
    this.outputFile =
      options.outputFile ?? "test-results/playwright-summary.json";
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.rootDir = config.rootDir;
    this.suite = suite;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const diagnostic = resultDiagnostics(result)[0];
    console.log(
      `[playwright] ${result.status} ${redactDiagnostic(test.titlePath().join(" > "))} ` +
        `(${result.duration}ms)${diagnostic ? ` — ${diagnostic}` : ""}`,
    );
  }

  onError(error: TestError): void {
    const rawDiagnostic = error.message ?? error.value;
    if (!rawDiagnostic) return;

    const diagnostic = redactDiagnostic(rawDiagnostic);
    if (!diagnostic) return;

    if (this.globalDiagnostics.size < MAX_DIAGNOSTICS_PER_TEST) {
      this.globalDiagnostics.add(diagnostic);
    }
    console.log(`[playwright] global error — ${diagnostic}`);
  }

  async onEnd(result: FullResult): Promise<{ status: "failed" } | undefined> {
    const tests = (this.suite?.allTests() ?? []).map((test) => {
      const diagnostics = testDiagnostics(test);
      return {
        title: redactDiagnostic(test.titlePath().join(" > ")),
        file: relative(this.rootDir, test.location.file),
        outcome: finalOutcome(test),
        durationMs: test.results.reduce(
          (total, testResult) => total + testResult.duration,
          0,
        ),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      };
    });
    const summary = summarizeStrictRun(tests, this.expected);

    let contract: SerializableReport["contract"] = "passed";
    try {
      enforceStrictRunContract(tests, this.expected);
      if (result.status !== "passed") contract = "failed";
    } catch {
      contract = "failed";
    }

    const diagnostics = [...this.globalDiagnostics];
    const report: SerializableReport = {
      contract,
      ...summary,
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };
    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });

    console.log(
      `Playwright strict summary: ${report.passed} passed, ${report.failed} failed, ` +
        `${report.skipped} skipped, ${report.flaky} flaky, ${report.total} total ` +
        `(expected ${report.expected}).`,
    );

    return contract === "failed" ? { status: "failed" } : undefined;
  }

  printsToStdio(): boolean {
    return true;
  }
}
