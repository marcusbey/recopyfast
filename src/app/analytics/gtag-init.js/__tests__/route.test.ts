/**
 * @jest-environment node
 */

/**
 * s107 — `GET /analytics/gtag-init.js`, the first-party init script.
 *
 * It carries the one per-request input a prerendered marketing page cannot
 * have: whether this visitor's country needs consent first (Vercel's
 * `x-vercel-ip-country`). The country is reduced to a boolean and never
 * echoed, stored or cached across visitors — `private, no-store`, because the
 * same URL answers differently per country.
 */

import { dynamic, GET } from "@/app/analytics/gtag-init.js/route";
import { buildGtagInitScript } from "@/lib/analytics/google-analytics/init-script";

const saved = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

function request(country?: string, region?: string): Request {
  const headers: Record<string, string> = {};
  if (country !== undefined) headers["x-vercel-ip-country"] = country;
  if (region !== undefined) headers["x-vercel-ip-country-region"] = region;
  return new Request("https://www.recopyfa.st/analytics/gtag-init.js", {
    headers,
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-TEST123456";
});

afterAll(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  else process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = saved;
});

describe("GET /analytics/gtag-init.js", () => {
  it("renders per request", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("is a 404 when GA is not configured, so a preview build serves nothing", async () => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

    const response = GET(request("US"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it.each([
    ["FR", undefined, true],
    ["GB", undefined, true],
    ["CH", undefined, true],
    ["US", undefined, false],
    ["XX", undefined, true],
    // Quebec (Law 25) by Vercel's province header; Canada without one asks.
    ["CA", "QC", true],
    ["CA", "ON", false],
    ["CA", undefined, true],
  ])(
    "for a visitor from %s (province %s), consentRequired is %s",
    async (country, region, required) => {
      const response = GET(request(country, region));

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(
        buildGtagInitScript({ consentRequired: required }),
      );
    },
  );

  it("fails closed without the header (local, CI, any non-Vercel host)", async () => {
    expect(await GET(request()).text()).toBe(
      buildGtagInitScript({ consentRequired: true }),
    );
  });

  it("never reflects the headers into the script", async () => {
    const body = await GET(
      request('US"</script><script>alert(1)', '"</script><script>alert(2)'),
    ).text();

    expect(body).not.toContain("alert");
    expect(body).toBe(buildGtagInitScript({ consentRequired: true }));
  });

  it("is JavaScript, sniff-proof, and never shared between visitors", () => {
    const { headers } = GET(request("US"));

    expect(headers.get("content-type")).toBe(
      "application/javascript; charset=utf-8",
    );
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("cache-control")).toBe("private, no-store");
  });
});
