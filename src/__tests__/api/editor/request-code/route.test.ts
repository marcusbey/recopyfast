/**
 * Regression test for the editor-existence oracle in
 * `POST /api/editor/request-code`.
 *
 * The route's whole defence is that a recognised address and an unrecognised
 * one are indistinguishable to the caller. Two channels used to leak that:
 *
 * 1. Timing — the recognised branch awaited a DB write (`issueVerificationCode`)
 *    and a Resend network call (`sendEditorAccessCode`) before responding; the
 *    unrecognised branch returned immediately.
 * 2. Status code — if minting failed, only a recognised address could reach a
 *    503 `code_unavailable`. One request was enough to confirm recognition.
 *
 * The fix responds with the same body/status/headers at the same point for
 * both branches, and defers the recognised-only work to `after()`. These
 * tests assert the response is identical either way, that `after()` is the
 * only thing that differs, and that the deferred work still actually runs
 * (and still logs on failure) once invoked — not just that it was scheduled.
 */

import { NextRequest, NextResponse, after } from "next/server";

// The route imports `after` from "next/server". The repo's global mock
// (jest.setup.js) predates that API and does not export it, so this file
// re-declares the same NextRequest/NextResponse shape used everywhere else in
// the suite and adds `after` as a spy — recording the deferred callback so a
// test can invoke it directly and prove what it does.
jest.mock("next/server", () => ({
  NextRequest: class MockNextRequest {
    url: string;
    nextUrl: URL;
    method: string;
    headers: Headers;
    body?: string;
    constructor(
      url: string,
      init?: { method?: string; headers?: HeadersInit; body?: string },
    ) {
      this.url = url;
      this.nextUrl = new URL(url);
      this.method = init?.method || "GET";
      this.headers = new Headers(init?.headers);
      this.body = init?.body;
    }
    async json() {
      return JSON.parse(this.body || "{}");
    }
  },
  NextResponse: {
    json: (
      data: unknown,
      init?: { status?: number; headers?: HeadersInit },
    ) => ({
      json: () => Promise.resolve(data),
      status: init?.status || 200,
      headers: new Headers(init?.headers),
      ok: (init?.status || 200) >= 200 && (init?.status || 200) < 300,
      _data: data,
      _status: init?.status || 200,
    }),
  },
  after: jest.fn(),
}));

import { POST } from "@/app/api/editor/request-code/route";
import {
  isEmailProviderConfigured,
  sendEditorAccessCode,
} from "@/lib/email/resend";
import {
  findActiveSiteEditor,
  listSitesForEditor,
} from "@/lib/auth/editor-directory";
import { issueVerificationCode } from "@/lib/auth/editor-verification";
import { enforceRateLimit } from "@/lib/api/rate-limit";

jest.mock("@/lib/email/resend");
jest.mock("@/lib/auth/editor-directory", () => {
  const actual = jest.requireActual("@/lib/auth/editor-directory");
  return {
    ...actual,
    findActiveSiteEditor: jest.fn(),
    listSitesForEditor: jest.fn(),
  };
});
jest.mock("@/lib/auth/editor-verification");
jest.mock("@/lib/api/rate-limit");

const mockAfter = after as jest.Mock;

const mockIsConfigured = isEmailProviderConfigured as jest.MockedFunction<
  typeof isEmailProviderConfigured
>;
const mockSendCode = sendEditorAccessCode as jest.MockedFunction<
  typeof sendEditorAccessCode
>;
const mockFindActiveSiteEditor = findActiveSiteEditor as jest.MockedFunction<
  typeof findActiveSiteEditor
>;
const mockListSitesForEditor = listSitesForEditor as jest.MockedFunction<
  typeof listSitesForEditor
>;
const mockIssueCode = issueVerificationCode as jest.MockedFunction<
  typeof issueVerificationCode
>;
const mockEnforceRateLimit = enforceRateLimit as jest.MockedFunction<
  typeof enforceRateLimit
>;

const RECOGNISED_EMAIL = "editor@example.com";
const UNKNOWN_EMAIL = "nobody@example.com";

function requestCodeRequest(email: string, siteId?: string): NextRequest {
  return new NextRequest("http://localhost/api/editor/request-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, ...(siteId ? { siteId } : {}) }),
  });
}

describe("POST /api/editor/request-code — enumeration defence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    mockIsConfigured.mockReturnValue(true);
    mockEnforceRateLimit.mockResolvedValue(null);
    mockIssueCode.mockResolvedValue("123456");
    mockSendCode.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("response equivalence", () => {
    it("returns the same status and body for a recognised and an unrecognised address", async () => {
      mockFindActiveSiteEditor.mockResolvedValue({
        id: "se_1",
        siteId: "site_1",
        email: RECOGNISED_EMAIL,
        permissions: ["edit"],
        createdAt: new Date(),
      });
      const recognisedResponse = await POST(
        requestCodeRequest(RECOGNISED_EMAIL, "site_1"),
      );

      mockFindActiveSiteEditor.mockResolvedValue(null);
      const unrecognisedResponse = await POST(
        requestCodeRequest(UNKNOWN_EMAIL, "site_1"),
      );

      expect(recognisedResponse.status).toBe(unrecognisedResponse.status);
      expect(await recognisedResponse.json()).toEqual(
        await unrecognisedResponse.json(),
      );
    });

    it("never awaits the code mint or the mail send before responding — the response is not gated on `after`'s callback resolving", async () => {
      mockFindActiveSiteEditor.mockResolvedValue({
        id: "se_1",
        siteId: "site_1",
        email: RECOGNISED_EMAIL,
        permissions: ["edit"],
        createdAt: new Date(),
      });
      // If the route awaited these before responding, this test would hang —
      // the promises never resolve.
      mockIssueCode.mockReturnValue(new Promise(() => {}));
      mockSendCode.mockReturnValue(new Promise(() => {}));

      const response = await POST(
        requestCodeRequest(RECOGNISED_EMAIL, "site_1"),
      );

      expect(response.status).toBe(200);
      expect(mockIssueCode).not.toHaveBeenCalled();
      expect(mockSendCode).not.toHaveBeenCalled();
    });
  });

  describe("deferred work", () => {
    it("schedules the mint+send via `after()` only for a recognised address", async () => {
      mockFindActiveSiteEditor.mockResolvedValue({
        id: "se_1",
        siteId: "site_1",
        email: RECOGNISED_EMAIL,
        permissions: ["edit"],
        createdAt: new Date(),
      });

      await POST(requestCodeRequest(RECOGNISED_EMAIL, "site_1"));

      expect(mockAfter).toHaveBeenCalledTimes(1);
    });

    it("does not schedule anything for an unrecognised address", async () => {
      mockFindActiveSiteEditor.mockResolvedValue(null);

      await POST(requestCodeRequest(UNKNOWN_EMAIL, "site_1"));

      expect(mockAfter).not.toHaveBeenCalled();
    });

    it("the deferred callback actually mints and sends the code when run", async () => {
      mockFindActiveSiteEditor.mockResolvedValue({
        id: "se_1",
        siteId: "site_1",
        email: RECOGNISED_EMAIL,
        permissions: ["edit"],
        createdAt: new Date(),
      });

      await POST(requestCodeRequest(RECOGNISED_EMAIL, "site_1"));

      expect(mockAfter).toHaveBeenCalledTimes(1);
      const deferred = mockAfter.mock.calls[0][0] as () => Promise<void>;

      expect(mockIssueCode).not.toHaveBeenCalled();
      await deferred();

      expect(mockIssueCode).toHaveBeenCalledWith({
        email: RECOGNISED_EMAIL,
        siteId: "site_1",
      });
      expect(mockSendCode).toHaveBeenCalledWith(
        RECOGNISED_EMAIL,
        "123456",
        undefined,
      );
    });

    it("logs, rather than drops, a mint failure inside the deferred callback", async () => {
      mockFindActiveSiteEditor.mockResolvedValue({
        id: "se_1",
        siteId: "site_1",
        email: RECOGNISED_EMAIL,
        permissions: ["edit"],
        createdAt: new Date(),
      });
      mockIssueCode.mockResolvedValue(null);

      await POST(requestCodeRequest(RECOGNISED_EMAIL, "site_1"));
      const deferred = mockAfter.mock.calls[0][0] as () => Promise<void>;
      await deferred();

      expect(mockSendCode).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("could not mint a code after responding"),
      );
    });

    it("logs, rather than drops, a delivery failure inside the deferred callback", async () => {
      mockFindActiveSiteEditor.mockResolvedValue({
        id: "se_1",
        siteId: "site_1",
        email: RECOGNISED_EMAIL,
        permissions: ["edit"],
        createdAt: new Date(),
      });
      mockSendCode.mockResolvedValue({ sent: false, error: "boom" });

      await POST(requestCodeRequest(RECOGNISED_EMAIL, "site_1"));
      const deferred = mockAfter.mock.calls[0][0] as () => Promise<void>;
      await deferred();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("code generated but delivery failed"),
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("boom"),
      );
    });

    it("hub sign-in (no siteId) also defers via `after()`, keyed off listSitesForEditor", async () => {
      mockListSitesForEditor.mockResolvedValue([
        {
          siteEditorId: "se_1",
          siteId: "site_1",
          siteName: "Example",
          siteDomain: "example.com",
          permissions: ["edit"],
        },
      ]);

      const response = await POST(requestCodeRequest(RECOGNISED_EMAIL));

      expect(response.status).toBe(200);
      expect(mockAfter).toHaveBeenCalledTimes(1);
      const deferred = mockAfter.mock.calls[0][0] as () => Promise<void>;
      await deferred();

      // Hub sign-ins must never name a site — confirmed by the third arg.
      expect(mockSendCode).toHaveBeenCalledWith(
        RECOGNISED_EMAIL,
        expect.any(String),
        undefined,
      );
    });
  });

  describe("address-independent branches are unchanged", () => {
    it("still answers 400 for a malformed address, before any lookup", async () => {
      const response = await POST(requestCodeRequest("not-an-email"));

      expect(response.status).toBe(400);
      expect(mockFindActiveSiteEditor).not.toHaveBeenCalled();
      expect(mockListSitesForEditor).not.toHaveBeenCalled();
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it("still answers 503 when mail is not configured, before any lookup", async () => {
      mockIsConfigured.mockReturnValue(false);

      const response = await POST(
        requestCodeRequest(RECOGNISED_EMAIL, "site_1"),
      );
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toBe("email_unavailable");
      expect(mockFindActiveSiteEditor).not.toHaveBeenCalled();
      expect(mockAfter).not.toHaveBeenCalled();
    });

    it("still applies the rate limit before resolving recognition", async () => {
      const limited = NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 },
      ) as unknown as Awaited<ReturnType<typeof enforceRateLimit>>;
      mockEnforceRateLimit.mockResolvedValueOnce(limited);

      const response = await POST(
        requestCodeRequest(RECOGNISED_EMAIL, "site_1"),
      );

      expect(response.status).toBe(429);
      expect(mockFindActiveSiteEditor).not.toHaveBeenCalled();
      expect(mockAfter).not.toHaveBeenCalled();
    });
  });
});
