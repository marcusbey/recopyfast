/**
 * SSRF guard for outbound webhook URLs (AC 5).
 *
 * `ipaddr.js` has been a declared dependency of this project since the
 * integrations schema landed and was imported by exactly zero files; the only
 * check on a webhook URL was `new URL(url)`, which is syntax. `http://localhost`,
 * `http://10.0.0.5` and — the one that matters — `http://169.254.169.254/`, the
 * cloud instance-metadata endpoint, all passed.
 *
 * Two properties are load-bearing here and are asserted separately:
 *
 *   1. EVERY resolved address is checked, not just the first. A hostname with
 *      one public A record and one private one is a refusal, not a pass.
 *   2. An IPv4-mapped IPv6 address is unwrapped before its range is read.
 *      `::ffff:169.254.169.254` is link-local wearing an IPv6 costume; a check
 *      that reads its range without unwrapping sees `ipv4Mapped` and can be
 *      talked into letting it through.
 *
 * And one policy: resolution failure is a refusal. Failing open here would mean
 * a DNS outage turns the guard off exactly when nobody is watching.
 */

import { promises as dns } from "dns";
import { assertSafeWebhookUrl } from "@/lib/security/webhook-url-safety";

jest.mock("dns", () => ({ promises: { lookup: jest.fn() } }));

const lookup = dns.lookup as unknown as jest.Mock;

/** What `dns.lookup(host, { all: true })` resolves to. */
function resolvesTo(...addresses: string[]) {
  lookup.mockResolvedValue(
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    })),
  );
}

describe("assertSafeWebhookUrl", () => {
  beforeEach(() => {
    lookup.mockReset();
  });

  describe("literal addresses", () => {
    it.each([
      ["https://93.184.216.34/rebuild", "public IPv4"],
      ["https://[2606:4700:4700::1111]/rebuild", "public IPv6"],
    ])("accepts %s (%s)", async (url) => {
      const result = await assertSafeWebhookUrl(url);

      expect(result.ok).toBe(true);
      expect(lookup).not.toHaveBeenCalled();
    });

    it.each([
      ["http://127.0.0.1/rebuild", /loopback/i],
      ["http://169.254.169.254/latest/meta-data", /link-local/i],
      ["http://10.0.0.5/rebuild", /private/i],
      ["http://192.168.1.1/rebuild", /private/i],
      ["http://172.16.0.1/rebuild", /private/i],
      ["http://[::1]/rebuild", /loopback/i],
      ["http://[fe80::1]/rebuild", /link-local/i],
      ["http://[fc00::1]/rebuild", /private/i],
      ["http://0.0.0.0/rebuild", /unspecified/i],
      ["http://100.64.0.1/rebuild", /carrier-grade NAT/i],
    ])("refuses %s and names the address class", async (url, expected) => {
      const result = await assertSafeWebhookUrl(url);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(expected);
    });

    it("unwraps an IPv4-mapped IPv6 address before reading its range", async () => {
      const result = await assertSafeWebhookUrl(
        "http://[::ffff:169.254.169.254]/latest/meta-data",
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // Not "ipv4Mapped" — the address underneath is what decides.
      expect(result.error).toMatch(/link-local/i);
      expect(result.error).toContain("169.254.169.254");
    });
  });

  describe("hostnames", () => {
    it("accepts a hostname that resolves to a public address", async () => {
      resolvesTo("93.184.216.34");

      const result = await assertSafeWebhookUrl(
        "https://build.example.com/hook",
      );

      expect(result.ok).toBe(true);
      expect(lookup).toHaveBeenCalledWith(
        "build.example.com",
        expect.objectContaining({ all: true }),
      );
    });

    it("refuses a hostname that resolves to a private address", async () => {
      resolvesTo("10.1.2.3");

      const result = await assertSafeWebhookUrl(
        "https://internal.example.com/hook",
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/private/i);
      expect(result.error).toContain("internal.example.com");
    });

    it("refuses when any resolved address is private, not just the first", async () => {
      resolvesTo("93.184.216.34", "169.254.169.254");

      const result = await assertSafeWebhookUrl(
        "https://split.example.com/hook",
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/link-local/i);
    });

    it("refuses when resolution fails — fails closed, never open", async () => {
      lookup.mockRejectedValue(
        Object.assign(new Error("getaddrinfo ENOTFOUND"), {
          code: "ENOTFOUND",
        }),
      );

      const result = await assertSafeWebhookUrl(
        "https://missing.example.com/hook",
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/could not be resolved/i);
    });

    it("refuses when resolution returns no addresses at all", async () => {
      resolvesTo();

      const result = await assertSafeWebhookUrl(
        "https://empty.example.com/hook",
      );

      expect(result.ok).toBe(false);
    });
  });

  describe("scheme and shape", () => {
    it.each([
      "file:///etc/passwd",
      "ftp://example.com/x",
      "gopher://example.com",
    ])("refuses %s by scheme", async (url) => {
      const result = await assertSafeWebhookUrl(url);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/http/i);
    });

    it.each(["", "   ", "not a url", "https://", "//example.com/hook"])(
      "refuses malformed input %p",
      async (url) => {
        const result = await assertSafeWebhookUrl(url);

        expect(result.ok).toBe(false);
      },
    );

    it("returns the parsed URL when it passes", async () => {
      resolvesTo("93.184.216.34");

      const result = await assertSafeWebhookUrl(
        "  https://build.example.com/hook  ",
      );

      expect(result).toEqual({
        ok: true,
        value: "https://build.example.com/hook",
      });
    });
  });
});
