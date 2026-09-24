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
const CORE_SETUP_DIAGNOSTIC_PREFIX = "[core-e2e setup]";

function redactedCoreSetupChunk(chunk: string | Buffer): string | null {
  const line = (typeof chunk === "string" ? chunk : chunk.toString("utf8"))
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(CORE_SETUP_DIAGNOSTIC_PREFIX));
  if (!line) return null;

  const withoutUrls = line.replace(
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi,
    "[REDACTED URL]",
  );
  const diagnostic = redactDiagnostic(withoutUrls);
  return diagnostic ? `${diagnostic}\n` : null;
}

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
    this.expected = options.expected ?? 44;
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

  /**
   * The first executed s24 Actions run proved that Playwright routes worker
   * console output through reporter hooks when a custom reporter is the only
   * configured reporter. The core fixture already emits one deliberately
   * bounded/redacted setup diagnostic, but the missing hooks discarded it and
   * left a 0ms beforeAll failure with no actionable stage. Forward only that
   * trusted prefix after a second redaction pass. General worker output stays
   * suppressed because page/fixture logs can contain short-lived editor URLs.
   */
  onStdOut(chunk: string | Buffer): void {
    const output = redactedCoreSetupChunk(chunk);
    if (output) process.stdout.write(output);
  }

  onStdErr(chunk: string | Buffer): void {
    const output = redactedCoreSetupChunk(chunk);
    if (output) process.stderr.write(output);
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
