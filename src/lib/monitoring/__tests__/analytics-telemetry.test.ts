/** @jest-environment node */
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  isMeasurementProtocolRequest,
  filterAnalyticsBreadcrumb,
} from "../analytics-telemetry";

test("actual Sentry envelopes exclude MP secrets from breadcrumbs and traces, preserving other telemetry", () => {
  const output = execFileSync(
    process.execPath,
    [path.join(__dirname, "fixtures/analytics-telemetry.cjs")],
    {
      encoding: "utf8",
      env: { PATH: process.env.PATH, NODE_ENV: "test" },
      timeout: 15000,
    },
  );
  const result = JSON.parse(output.trim());
  expect(result).toEqual({
    leaked: false,
    errorCount: 1,
    transactionCount: 1,
    unrelatedBreadcrumb: true,
    unrelatedSpan: true,
    collectorSpans: 0,
    integrationIgnoresCollector: true,
    integrationKeepsHealth: true,
  });
});

describe("exact collector exclusion boundary", () => {
  test.each([
    "https://www.google-analytics.com/mp/collect?api_secret=dummy",
    "https://www.google-analytics.com/debug/mp/collect?api_secret=dummy",
  ])("excludes %s", (url) => {
    expect(isMeasurementProtocolRequest(url)).toBe(true);
    expect(
      filterAnalyticsBreadcrumb({ category: "http", data: { url } }),
    ).toBeNull();
  });
  test.each([
    "https://www.google-analytics.com/g/collect",
    "https://www.google-analytics.com/mp/collect-extra",
    "https://www.google-analytics.com.example.invalid/mp/collect",
    "https://example.invalid/mp/collect",
    "http://www.google-analytics.com/mp/collect",
    "invalid",
    undefined,
  ])("preserves unrelated or invalid target %p", (url) => {
    expect(isMeasurementProtocolRequest(url)).toBe(false);
    const crumb = { category: "http", data: { url } };
    expect(filterAnalyticsBreadcrumb(crumb)).toBe(crumb);
  });
});
