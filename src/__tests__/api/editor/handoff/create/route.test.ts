/**
 * s39 — `POST /api/editor/handoff/create` takes "Remember" from the session.
 *
 * Until s39 the only carrier of the checkbox from the hub to the customer's
 * site was the `rememberDevice` field in this request's body. That worked while
 * every hub visit went through the code step, where the checkbox is on screen.
 * A resumed hub (s39) skips that step, so the page's state is just the default
 * — now unticked — and every resumed hand-off would mint a 12-hour grant for an
 * editor who ticked "Remember" and was promised 7 days.
 *
 * The session is the source of truth now. The body is still honoured on top of
 * it — a hub tab opened before the deploy holds a pre-s39 cookie without the
 * flag and still sends the field, and it must keep working through the deploy.
 * The body can only ever add "remember", never take it away from the session;
 * that is the same choice the editor already made, so it grants nothing new.
 */

process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import { NextRequest } from "next/server";
import { cookies } from "next/headers";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/auth/editor-directory", () => {
  const actual = jest.requireActual("@/lib/auth/editor-directory");
  return { ...actual, findActiveSiteEditor: jest.fn() };
});
jest.mock("@/lib/auth/editor-handoff", () => ({ createHandoff: jest.fn() }));
// The fixture's owner holds a plan (s51), unless a test says otherwise.
jest.mock("@/lib/billing/owner-can-edit", () => ({
  ...jest.requireActual("@/lib/billing/owner-can-edit"),
  checkOwnerCanEdit: jest.fn(),
}));

import { POST } from "@/app/api/editor/handoff/create/route";
import { findActiveSiteEditor } from "@/lib/auth/editor-directory";
import { createHandoff } from "@/lib/auth/editor-handoff";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  HUB_SESSION_COOKIE,
  createHubSessionToken,
} from "@/lib/auth/editor-hub-session";
import { resetSigningKeyCache } from "@/lib/auth/editor-crypto";
import {
  checkOwnerCanEdit,
  PLAN_ENDED_MESSAGE,
} from "@/lib/billing/owner-can-edit";

const mockCookies = cookies as unknown as jest.Mock;
const mockFindActiveSiteEditor = findActiveSiteEditor as jest.MockedFunction<
  typeof findActiveSiteEditor
>;
const mockCreateHandoff = createHandoff as jest.MockedFunction<
  typeof createHandoff
>;
const mockCreateServiceRoleClient =
  createServiceRoleClient as jest.MockedFunction<
    typeof createServiceRoleClient
  >;
const mockCheckOwnerCanEdit = checkOwnerCanEdit as jest.MockedFunction<
  typeof checkOwnerCanEdit
>;

const EMAIL = "bob@example.com";
const SITE_ID = "site-1";

function withHubCookie(value?: string) {
  mockCookies.mockResolvedValue({
    get: (name: string) =>
      name === HUB_SESSION_COOKIE && value ? { name, value } : undefined,
  });
}

function handoffRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/editor/handoff/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The `sites.domain` lookup the route makes after the editor re-check. */
function siteLookupReturns(domain: string | null) {
  const maybeSingle = jest
    .fn()
    .mockResolvedValue({ data: domain ? { domain } : null, error: null });
  const client = {
    from: jest.fn(() => ({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle })) })),
    })),
  };
  mockCreateServiceRoleClient.mockReturnValue(
    client as unknown as ReturnType<typeof createServiceRoleClient>,
  );
}

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

describe("POST /api/editor/handoff/create", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    mockFindActiveSiteEditor.mockResolvedValue({
      id: "editor-1",
      siteId: SITE_ID,
      email: EMAIL,
      permissions: ["view", "edit"],
      createdAt: new Date(),
    });
    mockCreateHandoff.mockResolvedValue("handoff-code");
    mockCheckOwnerCanEdit.mockResolvedValue({ ok: true, ownerId: "owner-1" });
    siteLookupReturns("helloworld.com");
  });

  it("answers 401 without a hub session and mints nothing", async () => {
    withHubCookie(undefined);

    const response = await POST(handoffRequest({ siteId: SITE_ID }));

    expect(response.status).toBe(401);
    expect(mockCreateHandoff).not.toHaveBeenCalled();
  });

  it("forwards Remember from a remembered session even when the page sends nothing", async () => {
    withHubCookie(createHubSessionToken(EMAIL, true));

    const response = await POST(handoffRequest({ siteId: SITE_ID }));

    expect(response.status).toBe(200);
    expect(mockCreateHandoff).toHaveBeenCalledWith({
      siteEditorId: "editor-1",
      rememberDevice: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      redirectUrl: "https://helloworld.com/?rcf_handoff=handoff-code",
    });
  });

  it("does not let the page's default un-remember a remembered session", async () => {
    withHubCookie(createHubSessionToken(EMAIL, true));

    await POST(handoffRequest({ siteId: SITE_ID, rememberDevice: false }));

    expect(mockCreateHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ rememberDevice: true }),
    );
  });

  it("mints a session-length grant from an unremembered session", async () => {
    withHubCookie(createHubSessionToken(EMAIL));

    await POST(handoffRequest({ siteId: SITE_ID }));

    expect(mockCreateHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ rememberDevice: false }),
    );
  });

  it("still honours the body flag, so a hub tab opened before the deploy keeps working", async () => {
    withHubCookie(createHubSessionToken(EMAIL));

    await POST(handoffRequest({ siteId: SITE_ID, rememberDevice: true }));

    expect(mockCreateHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ rememberDevice: true }),
    );
  });

  it("re-checks the allowlist, whatever the session says", async () => {
    withHubCookie(createHubSessionToken(EMAIL, true));
    mockFindActiveSiteEditor.mockResolvedValueOnce(null);

    const response = await POST(handoffRequest({ siteId: SITE_ID }));

    expect(response.status).toBe(403);
    expect(mockCreateHandoff).not.toHaveBeenCalled();
    expect(mockCheckOwnerCanEdit).not.toHaveBeenCalled();
  });

  it("answers a caller with no hub session identically whether the owner lapsed or pays (s51)", async () => {
    withHubCookie(undefined);

    const answer = await answerWhateverThePlan(() =>
      POST(handoffRequest({ siteId: SITE_ID })),
    );

    expect(answer.status).toBe(401);
    expect(mockCreateHandoff).not.toHaveBeenCalled();
  });

  it("answers an address that edits no such site identically whether the owner lapsed or pays (s51)", async () => {
    withHubCookie(createHubSessionToken(EMAIL, true));
    mockFindActiveSiteEditor.mockResolvedValue(null);

    const answer = await answerWhateverThePlan(() =>
      POST(handoffRequest({ siteId: SITE_ID })),
    );

    expect(answer).toEqual({
      status: 403,
      body: { error: "not_authorized", message: "You can't edit that site." },
    });
    expect(mockCreateHandoff).not.toHaveBeenCalled();
  });

  it("handoff/create returns the plan-ended message for a lapsed owner's site", async () => {
    // s51: the hub shows `message` when a site can't be opened. Asked after
    // the hub session and the editor row, so a stranger learns nothing.
    withHubCookie(createHubSessionToken(EMAIL, true));
    mockCheckOwnerCanEdit.mockResolvedValueOnce({
      ok: false,
      reason: "plan_ended",
    });

    const response = await POST(handoffRequest({ siteId: SITE_ID }));

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      message: PLAN_ENDED_MESSAGE,
      reason: "plan_ended",
    });
    expect(mockCheckOwnerCanEdit).toHaveBeenCalledWith(SITE_ID);
    expect(mockCreateHandoff).not.toHaveBeenCalled();
  });
});
