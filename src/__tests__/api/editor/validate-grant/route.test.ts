/**
 * s76 — `POST /api/editor/validate-grant` answers an outage as an outage.
 *
 * The widget's grant client keeps the grant on any status >= 500 or a body
 * with no `reason`, and treats everything else as a verdict: it clears the
 * grant from storage and either prompts for an emailed code or hides the pencil
 * (recopyfast.src.js, `validate`). `validateDeviceGrant` reports a failed read
 * of the grant row as the reason `error` — and this route used to send that
 * with 401, so a database blip signed every invited editor out of every site
 * and sent them to their mailbox.
 */

import { NextRequest } from "next/server";

jest.mock("@/lib/auth/editor-grants", () => ({
  ...jest.requireActual("@/lib/auth/editor-grants"),
  validateDeviceGrant: jest.fn(),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  ...jest.requireActual("@/lib/api/rate-limit"),
  enforceRateLimit: jest.fn(() => Promise.resolve(null)),
}));

import { POST } from "@/app/api/editor/validate-grant/route";
import { validateDeviceGrant } from "@/lib/auth/editor-grants";

const mockValidateDeviceGrant = validateDeviceGrant as jest.MockedFunction<
  typeof validateDeviceGrant
>;

function validateRequest(): NextRequest {
  return new NextRequest("https://www.recopyfa.st/api/editor/validate-grant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://helloworld.com",
      "User-Agent": "jest",
    },
    body: JSON.stringify({ grant: "rcfg1.held", siteId: "site-1" }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("s76 — POST /api/editor/validate-grant", () => {
  it("answers 503 when the grant could not be read, so the widget keeps it", async () => {
    mockValidateDeviceGrant.mockResolvedValue({
      valid: false,
      reason: "error",
    });

    const response = await POST(validateRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.valid).toBe(false);
    // No verdict to obey: no next action at all.
    expect(body).not.toHaveProperty("nextAction");
  });

  it.each([
    ["expired", "verify"],
    ["editor_revoked", "hide"],
    ["replayed", "refresh"],
  ] as const)(
    "still answers a refused grant (%s) with 401 and its next action",
    async (reason, nextAction) => {
      mockValidateDeviceGrant.mockResolvedValue({ valid: false, reason });

      const response = await POST(validateRequest());

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        valid: false,
        reason,
        nextAction,
      });
    },
  );
});
