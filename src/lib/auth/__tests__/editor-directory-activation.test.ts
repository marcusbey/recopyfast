const mockSingle = jest.fn();
const mockRpc = jest.fn(() => ({ single: mockSingle }));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({ rpc: mockRpc })),
}));

import { activateSiteEditor } from "../editor-directory";

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EDITOR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("activateSiteEditor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([true, false])(
    "maps did_activate=%s without changing it",
    async (didActivate) => {
      mockSingle.mockResolvedValue({
        data: {
          id: EDITOR_ID,
          site_id: SITE_ID,
          email: "editor@example.com",
          permissions: ["edit"],
          created_at: "2026-09-24T00:00:00.000Z",
          did_activate: didActivate,
        },
        error: null,
      });

      await expect(
        activateSiteEditor({
          siteId: SITE_ID,
          email: "EDITOR@example.com",
          permissions: ["edit"],
          invitedBy: null,
        }),
      ).resolves.toMatchObject({ didActivate });
    },
  );

  it.each(["PGRST202", "42883"])(
    "throws a typed unavailable error for missing RPC code %s",
    async (code) => {
      mockSingle.mockResolvedValue({
        data: null,
        error: {
          code,
          message: "function public.activate_site_editor missing",
        },
      });

      await expect(
        activateSiteEditor({
          siteId: SITE_ID,
          email: "editor@example.com",
          permissions: ["edit"],
          invitedBy: null,
        }),
      ).rejects.toMatchObject({ code: "ACTIVATION_RPC_UNAVAILABLE" });
    },
  );
});
