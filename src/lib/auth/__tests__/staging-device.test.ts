/**
 * Unit tests for the staging device binding primitives.
 *
 * These cover the decision function in isolation; the end-to-end "a forwarded
 * URL no longer grants access" case lives in staging-access.device-binding.test.ts.
 */

import {
  STAGING_VERIFICATION_TTL_MS,
  checkStagingDeviceBinding,
  readStagingDeviceFingerprint,
} from "../staging-device";

function requestWith(
  headers: Record<string, string>,
): Pick<Request, "headers"> {
  return { headers: new Headers(headers) };
}

describe("readStagingDeviceFingerprint", () => {
  it("produces a stable fingerprint for identical headers", () => {
    const headers = {
      "user-agent": "Mozilla/5.0 (Macintosh) Chrome/120",
      origin: "https://customer.example",
      "x-forwarded-for": "203.0.113.44, 10.0.0.1",
    };

    expect(readStagingDeviceFingerprint(requestWith(headers))).toEqual(
      readStagingDeviceFingerprint(requestWith(headers)),
    );
  });

  it("produces a different user-agent hash for a different browser", () => {
    const bob = readStagingDeviceFingerprint(
      requestWith({ "user-agent": "Mozilla/5.0 (Macintosh) Chrome/120" }),
    );
    const contractor = readStagingDeviceFingerprint(
      requestWith({
        "user-agent": "Mozilla/5.0 (Windows NT 10.0) Firefox/121",
      }),
    );

    expect(bob.userAgentHash).not.toEqual(contractor.userAgentHash);
  });

  it("truncates IPv4 to a /24 and never records the full address", () => {
    const fingerprint = readStagingDeviceFingerprint(
      requestWith({ "x-forwarded-for": "203.0.113.44" }),
    );

    expect(fingerprint.ipPrefix).toBe("203.0.113.0/24");
  });

  it("hashes a missing origin to a stable non-empty value", () => {
    const fingerprint = readStagingDeviceFingerprint(
      requestWith({ "user-agent": "curl/8" }),
    );

    expect(fingerprint.originHash).toEqual(expect.any(String));
    expect(fingerprint.originHash.length).toBeGreaterThan(0);
  });
});

describe("checkStagingDeviceBinding", () => {
  const device = readStagingDeviceFingerprint(
    requestWith({ "user-agent": "Mozilla/5.0 (Macintosh) Chrome/120" }),
  );
  const now = Date.parse("2026-08-02T12:00:00.000Z");
  const freshlyVerified = new Date(now - 60_000).toISOString();

  it("accepts the same device inside the validity window", () => {
    expect(
      checkStagingDeviceBinding(
        { userAgentHash: device.userAgentHash, verifiedAt: freshlyVerified },
        device,
        now,
      ),
    ).toEqual({ ok: true });
  });

  it("rejects a different device — the forwarded-URL case", () => {
    const contractor = readStagingDeviceFingerprint(
      requestWith({
        "user-agent": "Mozilla/5.0 (Windows NT 10.0) Firefox/121",
      }),
    );

    expect(
      checkStagingDeviceBinding(
        { userAgentHash: device.userAgentHash, verifiedAt: freshlyVerified },
        contractor,
        now,
      ),
    ).toEqual({ ok: false, reason: "device_mismatch" });
  });

  it("rejects a binding older than the validity window", () => {
    const stale = new Date(
      now - STAGING_VERIFICATION_TTL_MS - 1_000,
    ).toISOString();

    expect(
      checkStagingDeviceBinding(
        { userAgentHash: device.userAgentHash, verifiedAt: stale },
        device,
        now,
      ),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("fails closed for rows verified before the binding existed", () => {
    // Pre-migration rows carry email_verified=true and no fingerprint.
    // Grandfathering them would leave every already-forwarded URL working.
    expect(
      checkStagingDeviceBinding(
        { userAgentHash: null, verifiedAt: null },
        device,
        now,
      ),
    ).toEqual({ ok: false, reason: "unbound" });
  });

  it("fails closed when a fingerprint exists but the timestamp does not", () => {
    expect(
      checkStagingDeviceBinding(
        { userAgentHash: device.userAgentHash, verifiedAt: null },
        device,
        now,
      ),
    ).toEqual({ ok: false, reason: "unbound" });
  });

  it("fails closed on an unparseable verified_at", () => {
    expect(
      checkStagingDeviceBinding(
        { userAgentHash: device.userAgentHash, verifiedAt: "not-a-date" },
        device,
        now,
      ),
    ).toEqual({ ok: false, reason: "unbound" });
  });

  it("rejects a caller that presents no fingerprint at all", () => {
    // "I brought no evidence" must not beat "I brought the wrong evidence".
    expect(
      checkStagingDeviceBinding(
        { userAgentHash: device.userAgentHash, verifiedAt: freshlyVerified },
        { userAgentHash: "", originHash: "", ipPrefix: null },
        now,
      ),
    ).toEqual({ ok: false, reason: "device_mismatch" });
  });
});
