module.exports = {
  ci: {
    collect: {
      numberOfRuns: 5,
      chromePath: process.env.CHROME_PATH,
      settings: {
        onlyCategories: ["performance"],
        chromeFlags: "--headless --no-sandbox --disable-dev-shm-usage",
        formFactor: "mobile",
        throttlingMethod: "devtools",
        // ADR 061 pins Lighthouse 12.6.1's standard applied-mobile profile.
        // The simulated pair stays explicit too: report validation compares the
        // resolved profile, so a future Lighthouse upgrade cannot silently
        // reinterpret this gate while leaving the config text unchanged.
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
      },
    },
    assert: {
      assertions: {
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
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "test-results/lighthouse",
    },
  },
};
