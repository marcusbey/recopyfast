/**
 * s51 — `POST /api/editor/submit-code` mints no device grant on a lapsed
 * owner's site, and the hub still lists every site the address may edit.
 *
 * A device grant lasts 12 hours, or 7 days sliding. Its writes are gated on the
 * owner's plan anyway, so the refusal here is about telling the editor why,
 * at the moment they unlock: the widget's code prompt shows `message`. The gate
 * runs only AFTER the code is spent and the editor found — before that the
 * caller has proved nothing, and "plan ended" would be an oracle on a
 * customer's billing for anyone holding the public site id.
 */

process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import { NextRequest } from "next/server";

// Hub mode answers with a `Set-Cookie`, and the global next/server mock
// (jest.setup.js) has no cookie jar — the same re-declaration as
// ./route.test.ts, trimmed to what these tests read.
jest.mock("next/server", () => {
  function makeResponse(data: unknown, init?: { status?: number }) {
    const status = init?.status || 200;
    return {
      json: () => Promise.resolve(data),
      status,
      headers: new Headers(),
      ok: status >= 200 && status < 300,
      cookies: { set: () => {} },
    };
  }
  return {
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
    NextResponse: Object.assign(
      (body: unknown, init?: { status?: number }) => makeResponse(body, init),
      { json: makeResponse },
    ),
  };
});

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({ data: { domain: "helloworld.com" }, error: null }),
      };
      return chain;
    },
  })),
}));
jest.mock("@/lib/auth/editor-directory", () => ({
  ...jest.requireActual("@/lib/auth/editor-directory"),
  findActiveSiteEditor: jest.fn(),
  listSitesForEditor: jest.fn(),
}));
jest.mock("@/lib/auth/editor-verification", () => ({
  consumeVerificationCode: jest.fn(),
}));
jest.mock("@/lib/auth/editor-grants", () => ({
  ...jest.requireActual("@/lib/auth/editor-grants"),
  issueDeviceGrant: jest.fn(),
}));
jest.mock("@/lib/api/rate-limit", () => ({
  ...jest.requireActual("@/lib/api/rate-limit"),
  enforceRateLimit: jest.fn(() => Promise.resolve(null)),
}));
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: jest.fn(),
}));

import { POST } from "@/app/api/editor/submit-code/route";
import {
  findActiveSiteEditor,
  listSitesForEditor,
} from "@/lib/auth/editor-directory";
import { consumeVerificationCode } from "@/lib/auth/editor-verification";
import { issueDeviceGrant } from "@/lib/auth/editor-grants";
import {
  checkOwnerCanEdit,
  PLAN_ENDED_MESSAGE,
} from "@/lib/billing/owner-can-edit";

const SITE_ID = "site-1";
const EMAIL = "bob@example.com";

const mockConsumeCode = consumeVerificationCode as jest.MockedFunction<
  typeof consumeVerificationCode
>;
const mockFindActiveSiteEditor = findActiveSiteEditor as jest.MockedFunction<
  typeof findActiveSiteEditor
>;
const mockListSitesForEditor = listSitesForEditor as jest.MockedFunction<
  typeof listSitesForEditor
>;
const mockIssueDeviceGrant = issueDeviceGrant as jest.MockedFunction<
  typeof issueDeviceGrant
>;
const mockCheckOwnerCanEdit = checkOwnerCanEdit as jest.MockedFunction<
  typeof checkOwnerCanEdit
>;

function submit(body: Record<string, unknown>): NextRequest {
  return new NextRequest("https://www.recopyfa.st/api/editor/submit-code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://helloworld.com",
      "User-Agent": "jest",
    },
    body: JSON.stringify({ email: EMAIL, code: "123456", ...body }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockConsumeCode.mockResolvedValue({ ok: true } as Awaited<
    ReturnType<typeof consumeVerificationCode>
  >);
  mockFindActiveSiteEditor.mockResolvedValue({
    id: "editor-1",
    siteId: SITE_ID,
    email: EMAIL,
    permissions: ["view", "edit"],
    createdAt: new Date(),
  });
  mockCheckOwnerCanEdit.mockResolvedValue({
    ok: false,
    reason: "plan_ended",
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * The no-oracle rule (s51): an unauthenticated caller — or one with no access
 * on this site — must get the same answer whether the owner's plan lapsed or
 * not, and the plan must not even be read. Sent twice, once per plan state.
 */
async function answerWhateverThePlan(send: () => Promise<Response>) {
  mockCheckOwnerCanEdit.mockResolvedValue({ ok: false, reason: "plan_ended" });
  const lapsed = await send();
  const lapsedAnswer = { status: lapsed.status, body: await lapsed.json() };

  mockCheckOwnerCanEdit.mockResolvedValue({ ok: true, ownerId: "owner-1" });
  const paying = await send();
  const payingAnswer = { status: paying.status, body: await paying.json() };

  expect(lapsedAnswer).toEqual(payingAnswer);
  expect(JSON.stringify(lapsedAnswer.body)).not.toContain(PLAN_ENDED_MESSAGE);
  expect(mockCheckOwnerCanEdit).not.toHaveBeenCalled();
  return lapsedAnswer;
}

describe("s51 — POST /api/editor/submit-code", () => {
  it("submit-code refuses to mint a grant on a lapsed owner's site after the code is spent", async () => {
    const response = await POST(submit({ siteId: SITE_ID }));

    expect(response.status).toBe(402);
    // The widget's code prompt shows `message`.
    await expect(response.json()).resolves.toMatchObject({
      message: PLAN_ENDED_MESSAGE,
      reason: "plan_ended",
    });
    expect(mockConsumeCode).toHaveBeenCalled();
    expect(mockFindActiveSiteEditor).toHaveBeenCalledWith(SITE_ID, EMAIL);
    expect(mockCheckOwnerCanEdit).toHaveBeenCalledWith(SITE_ID);
    expect(mockIssueDeviceGrant).not.toHaveBeenCalled();
  });

  it("answers a code that does not verify identically whether the owner lapsed or pays", async () => {
    mockConsumeCode.mockResolvedValue({
      ok: false,
      reason: "mismatch",
    } as unknown as Awaited<ReturnType<typeof consumeVerificationCode>>);

    const answer = await answerWhateverThePlan(() =>
      POST(submit({ siteId: SITE_ID })),
    );

    expect(answer).toEqual({
      status: 401,
      body: {
        error: "invalid_code",
        message: "That code isn't valid. Request a new one.",
      },
    });
    expect(mockIssueDeviceGrant).not.toHaveBeenCalled();
  });

  it("answers a verified address that edits no such site identically whether the owner lapsed or pays", async () => {
    mockFindActiveSiteEditor.mockResolvedValue(null);

    const answer = await answerWhateverThePlan(() =>
      POST(submit({ siteId: SITE_ID })),
    );

    expect(answer.status).toBe(401);
    expect(mockIssueDeviceGrant).not.toHaveBeenCalled();
  });

  it("submit-code hub sign-in still lists a lapsed owner's sites", async () => {
    mockListSitesForEditor.mockResolvedValue([
      {
        siteId: SITE_ID,
        siteName: "Hello World",
        siteDomain: "helloworld.com",
        permissions: ["view", "edit"],
      },
    ] as unknown as Awaited<ReturnType<typeof listSitesForEditor>>);

    const response = await POST(submit({}));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      mode: "hub",
      sites: [{ siteId: SITE_ID, domain: "helloworld.com" }],
    });
    expect(mockCheckOwnerCanEdit).not.toHaveBeenCalled();
  });
});
