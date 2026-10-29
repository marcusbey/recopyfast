import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildComparisonLighthouseUrls } from "@/lib/compare/lighthouse";
import { buildGuideLighthouseUrls } from "@/lib/guides/lighthouse";
import {
  buildLighthouseRunPlan,
  parseLoopbackBaseUrl,
  validateLighthouseManifest,
  warmLighthouseUrls,
} from "../../../scripts/run-lighthouse-ci";

const ROOT = process.cwd();
const BASE_URL = "http://127.0.0.1:4175";
// s123: the owner guides joined the gate (index + one template page).
const EXPECTED_URLS = [
  ...buildComparisonLighthouseUrls(BASE_URL),
  ...buildGuideLighthouseUrls(BASE_URL),
];
const EXPECTED_PROFILE = {
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

type LighthouseConfig = {
  ci: {
    collect: {
      numberOfRuns: number;
      chromePath?: string;
      settings?: {
        onlyCategories?: string[];
        formFactor?: string;
        throttlingMethod?: string;
        throttling?: Record<string, number>;
        screenEmulation?: Record<string, number | boolean>;
      };
    };
    assert: {
      assertions: Record<
        string,
        [
          string,
          {
            aggregationMethod?: string;
            minScore?: number;
            maxNumericValue?: number;
          },
        ]
      >;
    };
    upload: { target: string; outputDir: string };
  };
};

type MutableProfile<Profile> = {
  -readonly [Field in keyof Profile]: Profile[Field] extends string
    ? string
    : Profile[Field] extends number
      ? number
      : Profile[Field] extends boolean
        ? boolean
        : Profile[Field];
};

type LighthouseReportFixture = {
  requestedUrl: string;
  finalUrl: string;
  finalDisplayedUrl: string;
  configSettings: {
    onlyCategories: string[];
    formFactor: string;
    throttlingMethod: string;
    throttling: MutableProfile<typeof EXPECTED_PROFILE.throttling>;
    screenEmulation: MutableProfile<typeof EXPECTED_PROFILE.screenEmulation>;
  };
  categories: { performance: { score: number } };
  audits: {
    "largest-contentful-paint": { numericValue: number };
    "cumulative-layout-shift": { numericValue: number };
    "total-blocking-time": { numericValue: number };
  };
};

const requireFromRoot = createRequire(join(ROOT, "package.json"));
const lighthouseConfig = requireFromRoot(
  join(ROOT, "lighthouserc.cjs"),
) as LighthouseConfig;

function validLighthouseReport(url: string): LighthouseReportFixture {
  return {
    requestedUrl: url,
    finalUrl: url,
    finalDisplayedUrl: url,
    configSettings: {
      onlyCategories: ["performance"],
      ...EXPECTED_PROFILE,
      throttling: {
        ...EXPECTED_PROFILE.throttling,
        // Lighthouse 12.6.1 emits the approved 1474.56 Kbps value using this
        // adjacent binary-float representation in real applied reports.
        downloadThroughputKbps: 1474.5600000000002,
      },
      screenEmulation: { ...EXPECTED_PROFILE.screenEmulation },
    },
    categories: { performance: { score: 0.98 } },
    audits: {
      "largest-contentful-paint": { numericValue: 1_650 },
      "cumulative-layout-shift": { numericValue: 0.01 },
      "total-blocking-time": { numericValue: 90 },
    },
  };
}

function writeManifestFixture(
  outputDir: string,
  urls: readonly string[],
  runs = 5,
) {
  const manifest = urls.flatMap((url, urlIndex) =>
    Array.from({ length: runs }, (_, runIndex) => {
      const jsonPath = join(
        outputDir,
        `route-${urlIndex}-run-${runIndex}.json`,
      );
      const htmlPath = join(
        outputDir,
        `route-${urlIndex}-run-${runIndex}.html`,
      );
      writeFileSync(jsonPath, JSON.stringify(validLighthouseReport(url)));
      writeFileSync(
        htmlPath,
        "<!doctype html><title>Lighthouse fixture</title>",
      );
      return {
        url,
        isRepresentativeRun: runIndex === 2,
        jsonPath,
        htmlPath,
        summary: { performance: 0.95 },
      };
    }),
  );
  writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(manifest));
  return manifest;
}

describe("comparison Lighthouse CI contract", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), "recopyfast-lhci-"));
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  it("derives exactly the hub plus seven detail URLs and passes each one to local LHCI", () => {
    const plan = buildLighthouseRunPlan(BASE_URL);

    expect(plan.urls).toEqual(EXPECTED_URLS);
    expect(plan.urls).toHaveLength(10);
    expect(plan.urls[0]).toBe(`${BASE_URL}/compare`);
    expect(new Set(plan.urls).size).toBe(10);
    expect(plan.lhciPath).toBe(join(ROOT, "node_modules", ".bin", "lhci"));
    expect(plan.args.slice(0, 3)).toEqual([
      "autorun",
      `--config=${join(ROOT, "lighthouserc.cjs")}`,
      "--failOnUploadFailure",
    ]);
    expect(plan.args.filter((arg) => arg.startsWith("--collect.url="))).toEqual(
      EXPECTED_URLS.map((url) => `--collect.url=${url}`),
    );
  });

  it("refuses anything except one explicit loopback HTTP origin", () => {
    expect(parseLoopbackBaseUrl(`${BASE_URL}/`).origin).toBe(BASE_URL);
    expect(parseLoopbackBaseUrl("http://localhost:4175").hostname).toBe(
      "localhost",
    );

    for (const unsafe of [
      "https://127.0.0.1:4175",
      "http://example.com:4175",
      "http://127.0.0.1:4175/compare",
      "http://user:secret@127.0.0.1:4175",
      "http://127.0.0.1",
    ]) {
      expect(() => parseLoopbackBaseUrl(unsafe)).toThrow();
    }
  });

  it("pins applied mobile, five median runs and the four blocking lab thresholds", () => {
    const assertions = lighthouseConfig.ci.assert.assertions;

    expect(lighthouseConfig.ci.collect).toMatchObject({
      numberOfRuns: 5,
      settings: {
        onlyCategories: ["performance"],
        ...EXPECTED_PROFILE,
      },
    });
    expect(assertions).toEqual({
      "categories:performance": [
        "error",
        { minScore: 0.9, aggregationMethod: "median" },
      ],
      "largest-contentful-paint": [
        "error",
        { maxNumericValue: 2500, aggregationMethod: "median" },
      ],
      "cumulative-layout-shift": [
        "error",
        { maxNumericValue: 0.1, aggregationMethod: "median" },
      ],
      "total-blocking-time": [
        "error",
        { maxNumericValue: 200, aggregationMethod: "median" },
      ],
    });
    expect(
      Object.keys(assertions).some((key) => key.includes("interaction")),
    ).toBe(false);
    expect(lighthouseConfig.ci.upload).toEqual({
      target: "filesystem",
      outputDir: "test-results/lighthouse",
    });
  });

  it("warms every route and refuses a non-200 response", async () => {
    const fetchImpl = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >(async () => Promise.resolve(new Response("ok", { status: 200 })));
    const unavailableFetch = jest.fn<
      ReturnType<typeof fetch>,
      Parameters<typeof fetch>
    >(async () =>
      Promise.resolve(new Response("unavailable", { status: 503 })),
    );

    await warmLighthouseUrls(EXPECTED_URLS, {
      fetchImpl,
      attempts: 1,
      retryDelayMs: 0,
      requestTimeoutMs: 100,
    });
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual(EXPECTED_URLS);

    await expect(
      warmLighthouseUrls([EXPECTED_URLS[0]], {
        fetchImpl: unavailableFetch,
        attempts: 1,
        retryDelayMs: 0,
        requestTimeoutMs: 100,
      }),
    ).rejects.toThrow(/503/);
  });

  it("accepts only five reports and one representative run for every expected URL", () => {
    writeManifestFixture(outputDir, EXPECTED_URLS);

    expect(validateLighthouseManifest(outputDir, EXPECTED_URLS, 5)).toEqual({
      routes: 10,
      reports: 50,
      representativeRuns: 10,
    });
  });

  it("rejects incomplete, extra, or missing filesystem reports", () => {
    const manifest = writeManifestFixture(outputDir, EXPECTED_URLS);
    const manifestPath = join(outputDir, "manifest.json");

    writeFileSync(manifestPath, JSON.stringify(manifest.slice(0, -1)));
    expect(() =>
      validateLighthouseManifest(outputDir, EXPECTED_URLS, 5),
    ).toThrow(/50 reports/);

    writeFileSync(
      manifestPath,
      JSON.stringify([
        ...manifest,
        { ...manifest[0], url: "http://127.0.0.1:4175/not-reviewed" },
      ]),
    );
    expect(() =>
      validateLighthouseManifest(outputDir, EXPECTED_URLS, 5),
    ).toThrow(/unexpected URL/);

    writeFileSync(manifestPath, JSON.stringify(manifest));
    rmSync(manifest[0].jsonPath);
    expect(existsSync(manifest[0].jsonPath)).toBe(false);
    expect(() =>
      validateLighthouseManifest(outputDir, EXPECTED_URLS, 5),
    ).toThrow(/missing report file/);
  });

  it.each(["jsonPath", "htmlPath"] as const)(
    "rejects a complete manifest that reuses one %s",
    (pathField) => {
      const manifest = writeManifestFixture(outputDir, EXPECTED_URLS);
      const manifestPath = join(outputDir, "manifest.json");
      manifest[1] = {
        ...manifest[1],
        [pathField]: manifest[0][pathField],
      };
      writeFileSync(manifestPath, JSON.stringify(manifest));

      expect(() =>
        validateLighthouseManifest(outputDir, EXPECTED_URLS, 5),
      ).toThrow(/report path.*unique/i);
    },
  );

  it.each([
    ["within one entry", 0, 0],
    ["across entries", 1, 0],
  ] as const)(
    "rejects one report file used as JSON and HTML %s",
    (_label, htmlEntry, jsonEntry) => {
      const manifest = writeManifestFixture(outputDir, EXPECTED_URLS);
      manifest[htmlEntry] = {
        ...manifest[htmlEntry],
        htmlPath: manifest[jsonEntry].jsonPath,
      };
      writeFileSync(join(outputDir, "manifest.json"), JSON.stringify(manifest));

      expect(() =>
        validateLighthouseManifest(outputDir, EXPECTED_URLS, 5),
      ).toThrow(/report path.*unique/i);
    },
  );

  it("rejects reports with the wrong profile, URL or required metrics", () => {
    const manifest = writeManifestFixture(outputDir, EXPECTED_URLS);
    const reportPath = manifest[0].jsonPath;
    const expectedUrl = EXPECTED_URLS[0];

    const expectRejected = (
      mutate: (report: ReturnType<typeof validLighthouseReport>) => void,
      message: RegExp,
    ) => {
      const report = validLighthouseReport(expectedUrl);
      mutate(report);
      writeFileSync(reportPath, JSON.stringify(report));
      expect(() =>
        validateLighthouseManifest(outputDir, EXPECTED_URLS, 5),
      ).toThrow(message);
    };

    expectRejected((report) => {
      report.configSettings.throttlingMethod = "simulate";
    }, /applied-mobile profile/);
    expectRejected((report) => {
      report.configSettings.throttling.requestLatencyMs = 150;
    }, /applied-mobile profile/);
    expectRejected((report) => {
      report.configSettings.throttling.downloadThroughputKbps = 1474.56001;
    }, /applied-mobile profile/);
    expectRejected((report) => {
      report.configSettings.screenEmulation.width = 360;
    }, /applied-mobile profile/);
    expectRejected((report) => {
      report.finalDisplayedUrl = `${BASE_URL}/not-reviewed`;
    }, /URL mismatch/);
    expectRejected((report) => {
      report.audits["largest-contentful-paint"].numericValue = Number.NaN;
    }, /finite metric/);
    expectRejected((report) => {
      report.categories.performance.score = Number.POSITIVE_INFINITY;
    }, /finite metric/);
  });

  it("uses an unconditional pinned read-only workflow with no provider credentials", () => {
    const workflow = readFileSync(
      join(ROOT, ".github/workflows/lighthouse-comparisons.yml"),
      "utf8",
    );
    const packageManifest = readFileSync(join(ROOT, "package.json"), "utf8");
    const packageLock = JSON.parse(
      readFileSync(join(ROOT, "package-lock.json"), "utf8"),
    ) as {
      packages: Record<
        string,
        { version?: string; devDependencies?: Record<string, string> }
      >;
    };
    const triggers = workflow.slice(
      workflow.indexOf("\non:\n"),
      workflow.indexOf("\npermissions:\n"),
    );

    expect(triggers).toContain("pull_request:");
    expect(triggers).toContain("push:");
    expect(triggers).toContain("branches: [main]");
    expect(triggers).toContain("workflow_dispatch:");
    expect(triggers).not.toContain("paths:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain(
      "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0",
    );
    expect(workflow).toContain(
      "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0",
    );
    expect(workflow).toContain(
      "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6.0.0",
    );
    expect(workflow).toContain('node-version: "24"');
    expect(workflow).toContain("npx playwright install --with-deps chromium");
    expect(workflow).toContain("npm run build");
    expect(workflow).toContain("npm run lighthouse:ci");
    expect(workflow).toContain(
      "Comparison and guide Lighthouse (applied mobile, 10 routes)",
    );
    expect(workflow).toContain(
      "Run five applied-mobile Lighthouse passes on all comparison and guide routes",
    );
    expect(workflow).toContain("if: ${{ always() }}");
    expect(workflow).toContain("test-results/lighthouse");
    expect(workflow).toContain('LIGHTHOUSE_BASE_URL: "http://127.0.0.1:4175"');
    expect(workflow).toContain(
      'NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1"',
    );
    // s107: the gate measures the build with Google Analytics in it (the
    // consent-required path: init script + banner, nothing from Google), and
    // with a fake id only.
    expect(workflow).toContain('NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-E2ETEST000"');
    expect(workflow).not.toContain("secrets.");
    expect(packageManifest).toContain(
      '"lighthouse:ci": "tsx scripts/run-lighthouse-ci.ts"',
    );
    expect(packageManifest).toContain('"@lhci/cli": "0.15.1"');
    expect(packageLock.packages[""].devDependencies?.["@lhci/cli"]).toBe(
      "0.15.1",
    );
    expect(packageLock.packages["node_modules/@lhci/cli"].version).toBe(
      "0.15.1",
    );
  });
});
