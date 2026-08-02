/**
 * Regression test for the unrate-limited resend branch.
 *
 * `POST /api/staging/verify {action:"resend"}` mails a code to an address the
 * caller does not choose — whoever the token was issued to. Unthrottled, anyone
 * holding a staging token could loop it and aim unbounded mail at a named
 * person's inbox while burning the sending domain's reputation.
 *
 * The load-bearing assertions are that the limit is applied BEFORE anything is
 * sent, on both the recipient and the IP, and that both fail closed.
 */

import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/staging/verify/route";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import { enforceRateLimit } from "@/lib/api/rate-limit";
import { sendStagingVerificationEmail } from "@/lib/email/resend";
import { rateLimiter } from "@/lib/security/rate-limiter";

jest.mock("@/lib/auth/staging-access");
jest.mock("@/lib/api/rate-limit");
jest.mock("@/lib/email/resend");
jest.mock("@/lib/security/rate-limiter", () => ({
  rateLimiter: { checkLimit: jest.fn() },
  createRateLimitConfig: jest.fn(() => ({ maxRequests: 10, windowMs: 1000 })),
}));

const mockEnforceRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;
const mockSendEmail = sendStagingVerificationEmail as jest.MockedFunction<
  typeof sendStagingVerificationEmail
>;
const mockManager = StagingAccessManager as jest.Mocked<
  typeof StagingAccessManager
>;
const mockCheckLimit = rateLimiter.checkLimit as jest.MockedFunction<
  typeof rateLimiter.checkLimit
>;

const TOKEN = "staging-token-abc";
const RECIPIENT = "bob@corp.example";

/** What `enforceRateLimit` returns when a bucket is exhausted. */
function throttled() {
  return NextResponse.json(
    { error: "Rate limit exceeded" },
    { status: 429 },
  ) as unknown as Awaited<ReturnType<typeof enforceRateLimit>>;
}

function resendRequest(): NextRequest {
  return new NextRequest("http://localhost/api/staging/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": "Mozilla/5.0 (Macintosh) Chrome/120",
      "x-forwarded-for": "203.0.113.44",
    },
    body: JSON.stringify({ token: TOKEN, action: "resend" }),
  });
}

describe("POST /api/staging/verify — resend throttling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});

    mockCheckLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetTime: Date.now() + 1000,
      totalRequests: 1,
    } as unknown as Awaited<ReturnType<typeof rateLimiter.checkLimit>>);

    mockManager.getResendRecipient.mockResolvedValue(RECIPIENT);
    mockManager.resendVerificationCode.mockResolvedValue({
      success: true,
      verificationCode: "123456",
      email: RECIPIENT,
    });
    mockSendEmail.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sends when both buckets allow", async () => {
    mockEnforceRateLimit.mockResolvedValue(null);

    const response = await POST(resendRequest());

    expect(response.status).toBe(200);
    expect(mockManager.resendVerificationCode).toHaveBeenCalledWith(TOKEN);
    expect(mockSendEmail).toHaveBeenCalledWith(RECIPIENT, "123456");
  });

  it("throttles on the recipient and sends nothing", async () => {
    const limited = throttled();
    mockEnforceRateLimit.mockResolvedValueOnce(limited);

    const response = await POST(resendRequest());

    expect(response.status).toBe(429);
    // The point of the fix: no code minted, no mail sent.
    expect(mockManager.resendVerificationCode).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("throttles on the IP even when the recipient bucket has room", async () => {
    const limited = throttled();
    mockEnforceRateLimit
      .mockResolvedValueOnce(null) // recipient bucket
      .mockResolvedValueOnce(limited); // ip bucket

    const response = await POST(resendRequest());

    expect(response.status).toBe(429);
    expect(mockManager.resendVerificationCode).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("keys the recipient bucket on the address, not the token", async () => {
    mockEnforceRateLimit.mockResolvedValue(null);

    await POST(resendRequest());

    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        identifier: RECIPIENT,
        identifierType: "user",
        onStoreFailure: "deny",
      }),
    );
  });

  it("applies a per-IP bucket that also fails closed", async () => {
    mockEnforceRateLimit.mockResolvedValue(null);

    await POST(resendRequest());

    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        identifierType: "ip",
        onStoreFailure: "deny",
      }),
    );
  });

  it("still applies the IP bucket when the token resolves to no recipient", async () => {
    // An unknown or expired token has no inbox to charge, but must not become a
    // way to make unmetered requests.
    mockManager.getResendRecipient.mockResolvedValue(null);
    mockEnforceRateLimit.mockResolvedValue(null);
    mockManager.resendVerificationCode.mockResolvedValue({
      success: false,
      error: "Invalid or expired token",
    });

    const response = await POST(resendRequest());

    expect(response.status).toBe(400);
    expect(mockEnforceRateLimit).toHaveBeenCalledTimes(1);
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ identifierType: "ip" }),
    );
  });
});
