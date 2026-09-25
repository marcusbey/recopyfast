/**
 * s39 — `GET /api/editor/sites`, the call `/edit` now makes on load.
 *
 * It existed from the start — the hub cookie was even made SameSite=Lax "so it
 * survives the top-level navigation back from a customer site" — and nothing
 * called it, so an editor coming back to `/edit` was always asked for a new
 * code. Now the hub resumes from it, which means it must also say whether the
 * session is a remembered one: a resumed hub never shows the checkbox again,
 * and the page must not guess.
 *
 * The session is a real signed token behind a mocked cookie store, read by the
 * real reader — not a mocked `getHubSessionEmail` — so these tests fail if the
 * route stops honouring what the token actually says.
 */

process.env.EDITOR_GRANT_SECRET =
  "test-editor-grant-secret-at-least-32-chars-long";

import { cookies } from "next/headers";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/auth/editor-directory", () => {
  const actual = jest.requireActual("@/lib/auth/editor-directory");
  return { ...actual, listSitesForEditor: jest.fn() };
});

import { GET } from "@/app/api/editor/sites/route";
import { listSitesForEditor } from "@/lib/auth/editor-directory";
import {
  HUB_SESSION_COOKIE,
  createHubSessionToken,
} from "@/lib/auth/editor-hub-session";
import { resetSigningKeyCache } from "@/lib/auth/editor-crypto";

const mockCookies = cookies as unknown as jest.Mock;
const mockListSitesForEditor = listSitesForEditor as jest.MockedFunction<
  typeof listSitesForEditor
>;

const EMAIL = "bob@example.com";

function withHubCookie(value?: string) {
  mockCookies.mockResolvedValue({
    get: (name: string) =>
      name === HUB_SESSION_COOKIE && value ? { name, value } : undefined,
  });
}

describe("GET /api/editor/sites", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSigningKeyCache();
    mockListSitesForEditor.mockResolvedValue([
      {
        siteEditorId: "editor-1",
        siteId: "site-1",
        siteName: "Hello World",
        siteDomain: "helloworld.com",
        permissions: ["view", "edit"],
      },
      {
        siteEditorId: "editor-2",
        siteId: "site-2",
        siteName: "Second Site",
        siteDomain: "second.example",
        permissions: ["view", "edit", "publish"],
      },
    ]);
  });

  it("answers 401 without a hub session, and lists nothing", async () => {
    withHubCookie(undefined);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "not_signed_in",
    });
    expect(mockListSitesForEditor).not.toHaveBeenCalled();
  });

  it("answers 401 for a cookie that is not a valid session", async () => {
    withHubCookie("rcfh1.forged.signature");

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mockListSitesForEditor).not.toHaveBeenCalled();
  });

  it("lists every site the address may edit, with the remembered flag", async () => {
    withHubCookie(createHubSessionToken(EMAIL, true));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mockListSitesForEditor).toHaveBeenCalledWith(EMAIL);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      email: EMAIL,
      remembered: true,
      sites: [
        {
          siteId: "site-1",
          name: "Hello World",
          domain: "helloworld.com",
          permissions: ["view", "edit"],
        },
        {
          siteId: "site-2",
          name: "Second Site",
          domain: "second.example",
          permissions: ["view", "edit", "publish"],
        },
      ],
    });
  });

  it("reports an unremembered session as such", async () => {
    withHubCookie(createHubSessionToken(EMAIL));

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      email: EMAIL,
      remembered: false,
    });
  });

  it("answers 500, not an empty list, when the directory read fails", async () => {
    withHubCookie(createHubSessionToken(EMAIL, true));
    mockListSitesForEditor.mockRejectedValueOnce(new Error("db down"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.not.toHaveProperty("sites");
  });
});
