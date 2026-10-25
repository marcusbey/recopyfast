import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { chromium } from "@playwright/test";
import { buildComparisonLighthouseUrls } from "@/lib/compare/lighthouse";
import { buildGuideLighthouseUrls } from "@/lib/guides/lighthouse";

const DEFAULT_BASE_URL = "http://127.0.0.1:4175";
const LIGHTHOUSE_CONFIG_FILE = "lighthouserc.cjs";
const LIGHTHOUSE_OUTPUT_DIRECTORY = "test-results/lighthouse";
const LIGHTHOUSE_WORKING_DIRECTORY = ".lighthouseci";
const DEFAULT_RUNS = 5;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
const EXPECTED_LIGHTHOUSE_PROFILE = {
  formFactor: "mobile",
  throttlingMethod: "devtools",
  throttling: {
    rttMs: 150,
    throughputKbps: 1638.4,
    requestLatencyMs: 562.5,
    downloadThroughputKbps: 1474.56,
    uploadThroughputKbps: 675,
    cpuSlowdownMultiplier: 4,
  },
  screenEmulation: {
    mobile: true,
    width: 412,
    height: 823,
    deviceScaleFactor: 1.75,
    disabled: false,
  },
} as const;
const REQUIRED_LIGHTHOUSE_METRICS = [
  "largest-contentful-paint",
  "cumulative-layout-shift",
  "total-blocking-time",
] as const;

type FetchImplementation = typeof fetch;

interface WarmOptions {
  fetchImpl?: FetchImplementation;
  attempts?: number;
  retryDelayMs?: number;
  requestTimeoutMs?: number;
  beforeAttempt?: () => void;
}

interface LighthouseManifestEntry {
  url?: unknown;
  isRepresentativeRun?: unknown;
  htmlPath?: unknown;
  jsonPath?: unknown;
}

export interface LighthouseManifestSummary {
  routes: number;
  reports: number;
  representativeRuns: number;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * The performance gate must never become a convenient remote scanner. Its
 * target is the production build started by this script, on a dedicated local
 * port. Requiring an explicit unprivileged port also keeps a stale or malformed
 * environment variable from silently falling back to port 80.
 */
export function parseLoopbackBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("LIGHTHOUSE_BASE_URL must be an absolute URL.");
  }

  const port = Number(url.port);
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65_535
  ) {
    throw new Error(
      "LIGHTHOUSE_BASE_URL must be one loopback HTTP origin with an explicit unprivileged port.",
    );
  }

  return new URL(url.origin);
}

/**
 * URL ownership stays in the comparison registry. A hand-maintained CI list
 * passed while a newly-added page escaped the gate during the September WIP;
 * this wrapper therefore accepts only the registry helpers' output: the
 * comparison cluster, then the owner guides (s123), which inherit ADR 013's
 * gate rather than standing up a second job.
 */
export function buildLighthouseRunPlan(baseUrl: string, cwd = process.cwd()) {
  const origin = parseLoopbackBaseUrl(baseUrl);
  const urls = [
    ...buildComparisonLighthouseUrls(origin.origin),
    ...buildGuideLighthouseUrls(origin.origin),
  ];
  const lhciExecutable = process.platform === "win32" ? "lhci.cmd" : "lhci";
  const lhciPath = path.join(cwd, "node_modules", ".bin", lhciExecutable);
  const configPath = path.join(cwd, LIGHTHOUSE_CONFIG_FILE);

  return {
    origin,
    urls,
    lhciPath,
    configPath,
    args: [
      "autorun",
      `--config=${configPath}`,
      "--failOnUploadFailure",
      ...urls.map((url) => `--collect.url=${url}`),
    ],
  };
}

/**
 * A successful TCP connection is not a warm comparison page. Read every body
 * once before Lighthouse starts so route compilation, registry validation and
 * the deliberately unavailable local catalogue fixture all settle outside the
 * measured runs. Every route must answer 200; redirects would hide a missing
 * canonical page behind the not-found or home surface.
 */
export async function warmLighthouseUrls(
  urls: readonly string[],
  {
    fetchImpl = fetch,
    attempts = 120,
    retryDelayMs = 250,
    requestTimeoutMs = 5_000,
    beforeAttempt = () => undefined,
  }: WarmOptions = {},
): Promise<void> {
  for (const url of urls) {
    let lastError: unknown = new Error("Route was not requested.");

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      beforeAttempt();
      try {
        const response = await fetchImpl(url, {
          redirect: "manual",
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        await response.arrayBuffer();
        if (response.status !== 200) {
          throw new Error(`${url} returned ${response.status}.`);
        }
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await delay(retryDelayMs);
      }
    }

    if (lastError) {
      const detail =
        lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Could not warm ${url}: ${detail}`);
    }
  }
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".."
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(
  parent: Record<string, unknown>,
  key: string,
  reportPath: string,
): Record<string, unknown> {
  const value = parent[key];
  if (!isRecord(value)) {
    throw new Error(`Lighthouse report ${reportPath} lacks ${key}.`);
  }
  return value;
}

function assertExactProfileValue(
  actual: unknown,
  expected: string | number | boolean,
  field: string,
  reportPath: string,
): void {
  let matches = actual === expected;
  if (typeof actual === "number" && typeof expected === "number") {
    // Lighthouse 12.6.1 derives the standard applied download rate as
    // `1638.4 * 0.9`: the approved 1474.56 Kbps value is serialized in its
    // reports as 1474.5600000000002. Strict equality rejected the real 40-run
    // corpus even though the difference is one binary floating-point rounding
    // step. Four machine epsilons allow only representation noise at the
    // value's scale; a human-scale profile change remains many orders larger.
    const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
    matches =
      Number.isFinite(actual) &&
      Math.abs(actual - expected) <= 4 * Number.EPSILON * scale;
  }

  if (!matches) {
    throw new Error(
      `Lighthouse report ${reportPath} does not use the approved applied-mobile profile: ${field}.`,
    );
  }
}

/**
 * LHCI can exit zero while a config override or future dependency change has
 * silently measured a different environment. The October s17 diagnosis found
 * that simulated Lantern and applied DevTools produce materially different LCP
 * semantics on the same source, so every durable report must prove which one
 * it used before its scores can authorize this gate.
 */
function validateLighthouseReport(
  reportPath: string,
  expectedUrl: string,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(reportPath, "utf8")) as unknown;
  } catch {
    throw new Error(`Lighthouse report ${reportPath} is not valid JSON.`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`Lighthouse report ${reportPath} must be an object.`);
  }

  for (const field of [
    "requestedUrl",
    "finalUrl",
    "finalDisplayedUrl",
  ] as const) {
    if (parsed[field] !== expectedUrl) {
      throw new Error(
        `Lighthouse report ${reportPath} URL mismatch for ${field}: ${String(parsed[field])}.`,
      );
    }
  }

  const config = requireRecord(parsed, "configSettings", reportPath);
  assertExactProfileValue(
    config.formFactor,
    EXPECTED_LIGHTHOUSE_PROFILE.formFactor,
    "formFactor",
    reportPath,
  );
  assertExactProfileValue(
    config.throttlingMethod,
    EXPECTED_LIGHTHOUSE_PROFILE.throttlingMethod,
    "throttlingMethod",
    reportPath,
  );
  const onlyCategories = config.onlyCategories;
  if (
    !Array.isArray(onlyCategories) ||
    onlyCategories.length !== 1 ||
    onlyCategories[0] !== "performance"
  ) {
    throw new Error(
      `Lighthouse report ${reportPath} does not use the approved applied-mobile profile: onlyCategories.`,
    );
  }

  const throttling = requireRecord(config, "throttling", reportPath);
  for (const [field, expected] of Object.entries(
    EXPECTED_LIGHTHOUSE_PROFILE.throttling,
  )) {
    assertExactProfileValue(
      throttling[field],
      expected,
      `throttling.${field}`,
      reportPath,
    );
  }

  const screenEmulation = requireRecord(config, "screenEmulation", reportPath);
  for (const [field, expected] of Object.entries(
    EXPECTED_LIGHTHOUSE_PROFILE.screenEmulation,
  )) {
    assertExactProfileValue(
      screenEmulation[field],
      expected,
      `screenEmulation.${field}`,
      reportPath,
    );
  }

  const categories = requireRecord(parsed, "categories", reportPath);
  const performance = requireRecord(categories, "performance", reportPath);
  if (
    typeof performance.score !== "number" ||
    !Number.isFinite(performance.score)
  ) {
    throw new Error(
      `Lighthouse report ${reportPath} lacks a required finite metric: categories.performance.score.`,
    );
  }

  const audits = requireRecord(parsed, "audits", reportPath);
  for (const metric of REQUIRED_LIGHTHOUSE_METRICS) {
    const audit = requireRecord(audits, metric, reportPath);
    if (
      typeof audit.numericValue !== "number" ||
      !Number.isFinite(audit.numericValue)
    ) {
      throw new Error(
        `Lighthouse report ${reportPath} lacks a required finite metric: ${metric}.`,
      );
    }
  }
}

/**
 * LHCI exits successfully after filesystem upload, but that alone does not
 * prove every route (ten since s123) produced five usable reports. Validate
 * its manifest, the representative median selection and every referenced file
 * before the CI step can turn green.
 */
export function validateLighthouseManifest(
  outputDirectory: string,
  expectedUrls: readonly string[],
  expectedRuns = DEFAULT_RUNS,
): LighthouseManifestSummary {
  const outputRoot = path.resolve(outputDirectory);
  const manifestPath = path.join(outputRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Lighthouse manifest is missing at ${manifestPath}.`);
  }

  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Lighthouse manifest must be an array.");
  }

  const expected = new Set(expectedUrls);
  const reportsByUrl = new Map<string, number>();
  const representativesByUrl = new Map<string, number>();
  const reportPaths = new Set<string>();

  for (const candidate of parsed as LighthouseManifestEntry[]) {
    if (typeof candidate.url !== "string" || !expected.has(candidate.url)) {
      throw new Error(
        `Lighthouse manifest contains an unexpected URL: ${String(candidate.url)}.`,
      );
    }

    for (const field of ["jsonPath", "htmlPath"] as const) {
      const filePath = candidate[field];
      if (typeof filePath !== "string") {
        throw new Error(
          `Lighthouse manifest entry for ${candidate.url} lacks a report path.`,
        );
      }
      const resolved = path.resolve(filePath);
      if (!isPathInside(outputRoot, resolved) || !existsSync(resolved)) {
        throw new Error(
          `Lighthouse manifest references a missing report file: ${resolved}.`,
        );
      }
      if (reportPaths.has(resolved)) {
        throw new Error(
          `Lighthouse report path must be unique for ${field}: ${resolved}.`,
        );
      }
      reportPaths.add(resolved);
    }

    validateLighthouseReport(
      path.resolve(candidate.jsonPath as string),
      candidate.url,
    );
    reportsByUrl.set(candidate.url, (reportsByUrl.get(candidate.url) || 0) + 1);
    if (candidate.isRepresentativeRun === true) {
      representativesByUrl.set(
        candidate.url,
        (representativesByUrl.get(candidate.url) || 0) + 1,
      );
    }
  }

  const expectedReportCount = expectedUrls.length * expectedRuns;
  if (parsed.length !== expectedReportCount) {
    throw new Error(
      `Expected ${expectedReportCount} reports, received ${parsed.length}.`,
    );
  }

  for (const url of expectedUrls) {
    if (reportsByUrl.get(url) !== expectedRuns) {
      throw new Error(
        `Expected ${expectedRuns} Lighthouse runs for ${url}, received ${reportsByUrl.get(url) || 0}.`,
      );
    }
    if (representativesByUrl.get(url) !== 1) {
      throw new Error(
        `Expected one representative Lighthouse run for ${url}, received ${representativesByUrl.get(url) || 0}.`,
      );
    }
  }

  return {
    routes: expectedUrls.length,
    reports: parsed.length,
    representativeRuns: [...representativesByUrl.values()].reduce(
      (total, count) => total + count,
      0,
    ),
  };
}

function prepareOutputDirectory(cwd: string): string {
  const testResultsRoot = path.resolve(cwd, "test-results");
  const outputDirectory = path.resolve(cwd, LIGHTHOUSE_OUTPUT_DIRECTORY);
  if (!isPathInside(testResultsRoot, outputDirectory)) {
    throw new Error("Lighthouse output must stay under test-results.");
  }
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  return outputDirectory;
}

function startNextServer(cwd: string, origin: URL): ChildProcess {
  const nextCli = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
  if (
    !existsSync(nextCli) ||
    !existsSync(path.join(cwd, ".next", "BUILD_ID"))
  ) {
    throw new Error("Run npm run build before npm run lighthouse:ci.");
  }

  return spawn(
    process.execPath,
    [nextCli, "start", "--hostname", origin.hostname, "--port", origin.port],
    {
      cwd,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "inherit",
    },
  );
}

function assertServerRunning(server: ChildProcess): void {
  if (server.exitCode !== null) {
    throw new Error(
      `The Lighthouse Next server exited with code ${server.exitCode}.`,
    );
  }
}

function runProcess(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`LHCI exited after signal ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(force);
      clearTimeout(giveUp);
      resolve();
    };
    const force = setTimeout(() => {
      if (server.exitCode === null) server.kill("SIGKILL");
    }, 5_000);
    const giveUp = setTimeout(finish, 7_000);
    server.once("exit", finish);
    if (server.exitCode !== null) finish();
    else server.kill("SIGTERM");
  });
}

export async function runLighthouseCi(): Promise<void> {
  const cwd = process.cwd();
  const plan = buildLighthouseRunPlan(
    process.env.LIGHTHOUSE_BASE_URL || DEFAULT_BASE_URL,
    cwd,
  );
  if (!existsSync(plan.lhciPath) || !existsSync(plan.configPath)) {
    throw new Error("Local LHCI executable or lighthouserc.cjs is missing.");
  }

  const chromePath = chromium.executablePath();
  if (!existsSync(chromePath)) {
    throw new Error(
      "Playwright Chromium is missing. Run npx playwright install chromium.",
    );
  }

  const outputDirectory = prepareOutputDirectory(cwd);
  const workingDirectory = path.resolve(cwd, LIGHTHOUSE_WORKING_DIRECTORY);
  // LHCI's collect step normally clears its own cache, but a killed local run
  // can leave untracked LHRs behind. The filesystem upload below is the durable
  // artifact; this task-owned cache is cleared before and after every run.
  rmSync(workingDirectory, { recursive: true, force: true });
  const server = startNextServer(cwd, plan.origin);

  try {
    await warmLighthouseUrls(plan.urls, {
      beforeAttempt: () => assertServerRunning(server),
    });
    await delay(100);
    assertServerRunning(server);

    const exitCode = await runProcess(plan.lhciPath, plan.args, cwd, {
      ...process.env,
      CHROME_PATH: chromePath,
    });

    let summary: LighthouseManifestSummary;
    try {
      summary = validateLighthouseManifest(
        outputDirectory,
        plan.urls,
        DEFAULT_RUNS,
      );
    } catch (error) {
      if (exitCode !== 0) {
        throw new AggregateError(
          [error],
          `LHCI exited ${exitCode} and its filesystem reports were invalid.`,
        );
      }
      throw error;
    }

    console.log(
      `[lighthouse] ${summary.reports} reports, ${summary.representativeRuns} representative runs, ${summary.routes} routes.`,
    );
    if (exitCode !== 0) {
      throw new Error(`LHCI assertions failed with exit code ${exitCode}.`);
    }
  } finally {
    await stopServer(server);
    rmSync(workingDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runLighthouseCi().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
