/**
 * @jest-environment node
 */

/**
 * DataFast — the owner's attribution analytics, on every page (CTO decision,
 * 2026-10-22). The website id, domain and script URL are the owner's snippet,
 * byte for byte; `NEXT_PUBLIC_DATAFAST_DISABLED=true` is the one way off.
 */

import {
  DATAFAST_DOMAIN,
  DATAFAST_ORIGIN,
  DATAFAST_SCRIPT_URL,
  DATAFAST_WEBSITE_ID,
  isDataFastEnabled,
} from "@/lib/analytics/datafast";

describe("DataFast configuration", () => {
  const saved = process.env.NEXT_PUBLIC_DATAFAST_DISABLED;

  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_DATAFAST_DISABLED;
    else process.env.NEXT_PUBLIC_DATAFAST_DISABLED = saved;
  });

  it("is the owner's snippet: website id, domain and script URL", () => {
    expect(DATAFAST_WEBSITE_ID).toBe("dfid_Vk5ah6dRMY195GtTY4lIP");
    expect(DATAFAST_DOMAIN).toBe("recopyfa.st");
    expect(DATAFAST_SCRIPT_URL).toBe("https://datafa.st/js/script.js");
  });

  it("names the one origin the script loads from and beacons to", () => {
    expect(DATAFAST_ORIGIN).toBe("https://datafa.st");
    expect(new URL(DATAFAST_SCRIPT_URL).origin).toBe(DATAFAST_ORIGIN);
  });

  it("is on by default", () => {
    delete process.env.NEXT_PUBLIC_DATAFAST_DISABLED;

    expect(isDataFastEnabled()).toBe(true);
  });

  it("is off only for the exact value 'true'", () => {
    process.env.NEXT_PUBLIC_DATAFAST_DISABLED = "true";
    expect(isDataFastEnabled()).toBe(false);

    for (const value of ["", "false", "0", "TRUE "]) {
      process.env.NEXT_PUBLIC_DATAFAST_DISABLED = value;
      expect([value, isDataFastEnabled()]).toEqual([value, true]);
    }
  });
});
