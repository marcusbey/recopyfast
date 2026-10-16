/** @jest-environment node */
jest.unmock("next/server");
import { NextRequest } from "next/server";
import { POST } from "../route";
const rpc = jest.fn();
const getUser = jest.fn();
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ rpc }),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn().mockResolvedValue(null),
  getClientIp: () => "192.0.2.1",
}));
import { enforceRateLimit } from "@/lib/api/rate-limit";
function req(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://www.recopyfa.st/api/analytics/context", {
    method: "POST",
    headers: {
      origin: "https://www.recopyfa.st",
      "content-type": "application/json",
      "x-vercel-ip-country": "US",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  rpc.mockResolvedValue({ data: "some-id", error: null });
  getUser.mockResolvedValue({ data: { user: null }, error: null });
});
it("rejects absent or cross-site origin before any limiter/auth/store", async () => {
  for (const origin of ["", "https://evil.test"])
    expect(
      (await POST(req({ action: "capture", clientId: "123.456" }, { origin })))
        .status,
    ).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
  expect(enforceRateLimit).not.toHaveBeenCalled();
});
it("refuses extra keys and oversized identifiers", async () => {
  for (const body of [
    { action: "capture", clientId: "1.2", userId: "attacker" },
    { action: "capture", clientId: "a".repeat(300) },
  ])
    expect((await POST(req(body))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it("writes only hash and returns secure opaque cookie, no GA id", async () => {
  const response = await POST(req({ action: "capture", clientId: "123.456" }));
  expect(response.status).toBe(204);
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toMatch(/__Host-rcf_analytics_context=/);
  for (const attr of ["Secure", "HttpOnly", "SameSite=lax", "Path=/"])
    expect(cookie).toContain(attr);
  expect(cookie).not.toContain("123.456");
  expect(rpc).toHaveBeenCalledWith(
    "capture_analytics_context",
    expect.objectContaining({
      p_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_existing: false,
    }),
  );
});
it("denial and missing geography cannot create captures", async () => {
  await POST(
    req(
      { action: "capture", clientId: "1.2" },
      { cookie: "rcf_analytics_consent=denied" },
    ),
  );
  await POST(
    req({ action: "capture", clientId: "1.2" }, { "x-vercel-ip-country": "" }),
  );
  expect(rpc).not.toHaveBeenCalled();
});
it("revoke uses verified account and clears cookie only after success", async () => {
  getUser.mockResolvedValue({
    data: { user: { id: "verified" } },
    error: null,
  });
  expect(
    (await POST(req({ action: "revoke" }))).headers.get("set-cookie"),
  ).toContain("Max-Age=0");
  expect(rpc).toHaveBeenCalledWith("revoke_analytics_context", {
    p_hash: null,
    p_user_id: "verified",
  });
  rpc.mockResolvedValue({ error: { message: "private" } });
  const response = await POST(req({ action: "revoke" }));
  expect(response.status).toBe(503);
  expect(response.headers.get("set-cookie")).toContain(
    "__Host-rcf_analytics_consent=;",
  );
  expect(response.headers.get("set-cookie")).not.toContain(
    "__Host-rcf_analytics_context=",
  );
});

it.each(["returned", "thrown"])(
  "transient %s auth failure revokes capability but preserves retry for account-wide withdrawal",
  async (kind) => {
    const cookie = `__Host-rcf_analytics_context=${"a".repeat(43)}`;
    if (kind === "returned")
      getUser.mockResolvedValue({
        data: { user: null },
        error: new Error("private auth detail"),
      });
    else getUser.mockRejectedValue(new Error("private auth detail"));
    const response = await POST(req({ action: "revoke" }, { cookie }));
    expect(rpc).toHaveBeenCalledWith("revoke_analytics_context", {
      p_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_user_id: null,
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-rcf_analytics_consent=;",
    );
    expect(response.headers.get("set-cookie")).not.toContain(
      "__Host-rcf_analytics_context=",
    );
    expect(JSON.stringify(await response.json())).not.toContain(
      "private auth detail",
    );
  },
);
it.each([["revoke"], ["capture"], {}, 1, true])(
  "rejects non-string action %j",
  async (action) => {
    expect((await POST(req({ action }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  },
);
it("a genuine missing session can revoke anonymously", async () => {
  const { AuthSessionMissingError } = await import("@supabase/supabase-js");
  getUser.mockResolvedValue({
    data: { user: null },
    error: new AuthSessionMissingError(),
  });
  expect((await POST(req({ action: "revoke" }))).status).toBe(204);
});

it("refresh renews the existing browser capability through the new capture expiry", async () => {
  const capability = "a".repeat(43);
  const response = await POST(
    req(
      { action: "capture", clientId: "1.2" },
      { cookie: `__Host-rcf_analytics_context=${capability}` },
    ),
  );
  expect(response.status).toBe(204);
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toContain(`__Host-rcf_analytics_context=${capability}`);
  expect(cookie).toMatch(/Max-Age=259199[89]|Max-Age=2592000/);
});

it("issues an identifier-free signed receipt only for an explicit grant action", async () => {
  process.env.ANALYTICS_CONSENT_SIGNING_KEY = "ab".repeat(32);
  const response = await POST(
    req({ action: "grant" }, { cookie: "rcf_analytics_consent=granted" }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain(
    "__Host-rcf_analytics_consent=",
  );
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(await response.json()).toEqual({ expiresAt: expect.any(Number) });
  expect(rpc).not.toHaveBeenCalled();
  delete process.env.ANALYTICS_CONSENT_SIGNING_KEY;
});
it("does not turn a writable granted/time cookie into explicit context, even in US", async () => {
  const response = await POST(
    req(
      { action: "capture", clientId: "1.2" },
      {
        cookie: `rcf_analytics_consent=granted; rcf_analytics_consent_at=${Date.now()}`,
      },
    ),
  );
  expect(response.status).toBe(204);
  expect(rpc).not.toHaveBeenCalled();
  expect(response.headers.get("set-cookie")).toBeNull();
});

it("capture uses verified receipt expiry, ignores a rewritten issuance hint, and never renews receipt", async () => {
  process.env.ANALYTICS_CONSENT_SIGNING_KEY = "ab".repeat(32);
  const { issueConsentReceipt } = await import(
    "@/lib/analytics/google-analytics/consent-receipt"
  );
  const receipt = issueConsentReceipt(Date.now() - 179 * 86400000)!;
  const response = await POST(
    req(
      { action: "capture", clientId: "1.2" },
      {
        cookie: `rcf_analytics_consent=granted; rcf_analytics_consent_at=${Date.now()}; __Host-rcf_analytics_consent=${receipt.value}`,
      },
    ),
  );
  expect(rpc).toHaveBeenCalledWith(
    "capture_analytics_context",
    expect.objectContaining({
      p_basis: "explicit",
      p_consent_expires_at: new Date(receipt.expiresAt).toISOString(),
    }),
  );
  expect(response.headers.get("set-cookie")).not.toContain(
    "__Host-rcf_analytics_consent=",
  );
  const age = Number(
    /Max-Age=(\d+)/.exec(response.headers.get("set-cookie")!)?.[1],
  );
  expect(age).toBeGreaterThan(86390);
  expect(age).toBeLessThanOrEqual(86400);
  delete process.env.ANALYTICS_CONSENT_SIGNING_KEY;
});

it("signout revokes identifiers but preserves consent receipt for a fresh public capture", async () => {
  process.env.ANALYTICS_CONSENT_SIGNING_KEY = "ab".repeat(32);
  const { issueConsentReceipt } = await import(
    "@/lib/analytics/google-analytics/consent-receipt"
  );
  const receipt = issueConsentReceipt()!;
  const choice = `rcf_analytics_consent=granted; __Host-rcf_analytics_consent=${receipt.value}`;
  const response = await POST(
    req(
      { action: "signout" },
      { cookie: `${choice}; __Host-rcf_analytics_context=${"a".repeat(43)}` },
    ),
  );
  expect(response.headers.get("set-cookie")).toContain(
    "__Host-rcf_analytics_context=;",
  );
  expect(response.headers.get("set-cookie")).not.toContain(
    "__Host-rcf_analytics_consent=",
  );
  rpc.mockClear();
  await POST(req({ action: "capture", clientId: "9.8" }, { cookie: choice }));
  expect(rpc).toHaveBeenCalledWith(
    "capture_analytics_context",
    expect.objectContaining({
      p_existing: false,
      p_basis: "explicit",
      p_client_id: "9.8",
    }),
  );
  delete process.env.ANALYTICS_CONSENT_SIGNING_KEY;
});
