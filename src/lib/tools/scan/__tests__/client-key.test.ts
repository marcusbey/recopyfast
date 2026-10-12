/**
 * @jest-environment node
 */

import { scanClientKey } from "../client-key";

describe("scanClientKey", () => {
  it("keys an IPv4 caller by its address", () => {
    expect(scanClientKey("203.0.113.7")).toEqual({
      key: "203.0.113.7",
      network48: null,
    });
  });

  it("keys an IPv6 caller by its /64, and reports its /48 for the wider daily bucket", () => {
    expect(scanClientKey("2001:db8:1:2:3:4:5:6")).toEqual({
      key: "2001:db8:1:2::/64",
      network48: "2001:db8:1::/48",
    });
    // Every address of one /64 is one caller: rotating the interface id buys nothing.
    expect(scanClientKey("2001:db8:1:2:ffff::1")?.key).toBe(
      "2001:db8:1:2::/64",
    );
  });

  it("unwraps an IPv4-mapped IPv6 address to the IPv4 it carries", () => {
    expect(scanClientKey("::ffff:1.2.3.4")).toEqual({
      key: "1.2.3.4",
      network48: null,
    });
  });

  it.each(["unknown", "", "not-an-ip", "1.2.3", "1.2.3.4.5"])(
    "refuses %p (the route answers 403, fail closed)",
    (raw) => {
      expect(scanClientKey(raw)).toBeNull();
    },
  );
});
