/**
 * @jest-environment node
 */

/**
 * s96 — the address classifier shared by the webhook guard and the free-tools
 * fetcher. Extracted unchanged from webhook-url-safety.ts; the webhook suites
 * (src/__tests__/security/webhook-url-safety.test.ts and
 * src/__tests__/webhooks/*) pin that the webhook behaviour did not move.
 *
 * Every refused address below was checked against ipaddr.js 2.2 on 2026-10-11:
 * the range named in each row is the one the library reports, so a library
 * upgrade that reclassifies one of them fails here, by name.
 */

import { classifyAddress, unwrapHostname } from "../public-address";

describe("classifyAddress", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "linkLocal"],
    ["100.64.0.1", "carrierGradeNat"],
    ["0.0.0.0", "unspecified"],
    ["255.255.255.255", "broadcast"],
    ["224.0.0.1", "multicast"],
    ["198.18.0.1", "reserved"],
    ["192.0.2.1", "reserved"],
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fe80::1", "linkLocal"],
    // AWS's IPv6 instance-metadata endpoint.
    ["fd00:ec2::254", "uniqueLocal"],
    // IPv4-mapped: the IPv4 inside the shell decides, not the shell.
    ["::ffff:169.254.169.254", "linkLocal"],
    ["::ffff:7f00:1", "loopback"],
    // NAT64 well-known prefix, 6to4 and Teredo: routes to an IPv4 by another name.
    ["64:ff9b::a9fe:a9fe", "rfc6052"],
    ["2002:7f00:1::", "6to4"],
    ["2001::1", "teredo"],
  ])("refuses %s (%s)", (address, range) => {
    const refusal = classifyAddress(address);

    expect(refusal).not.toBeNull();
    expect(refusal?.range).toBe(range);
  });

  it("refuses what it cannot read, rather than connecting on the strength of not understanding it", () => {
    const refusal = classifyAddress("not-an-address");

    expect(refusal).toEqual({
      address: "not-an-address",
      range: "unreadable",
      why: "not a readable IP address",
    });
  });

  it.each(["1.1.1.1", "2606:4700:4700::1111", "::ffff:1.1.1.1"])(
    "allows the globally routable unicast address %s",
    (address) => {
      expect(classifyAddress(address)).toBeNull();
    },
  );

  it("describes a refused range in words, and names the unwrapped IPv4 address", () => {
    expect(classifyAddress("::ffff:169.254.169.254")).toEqual({
      address: "169.254.169.254",
      range: "linkLocal",
      why: "a link-local address",
    });
    expect(classifyAddress("64:ff9b::a9fe:a9fe")?.why).toBe(
      "not a publicly routable address",
    );
  });
});

describe("unwrapHostname", () => {
  it("strips the brackets an IPv6 literal wears inside a URL", () => {
    expect(unwrapHostname("[::1]")).toBe("::1");
    expect(unwrapHostname("example.com")).toBe("example.com");
    expect(unwrapHostname("[unbalanced")).toBe("[unbalanced");
  });
});
