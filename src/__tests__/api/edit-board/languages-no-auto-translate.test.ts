/**
 * s40 — adding a language no longer calls the model.
 *
 * The Edit Board's "Auto-translate with AI" checkbox (on by default) made
 * `POST /api/edit-board/languages` run one OpenAI call per content element on
 * the site, charged to nobody, into `site_languages.translations` — a column
 * nothing reads. The widget control is gone; this pins that the route stops
 * spending even when an old cached copy of the widget still sends
 * `autoTranslate: true`, and that the request stays valid rather than breaking
 * those copies.
 */

import { NextRequest } from "next/server";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { aiService } from "@/lib/ai/openai-service";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/auth/staging-access", () => ({
  __esModule: true,
  StagingAccessManager: { validateStagingAccess: jest.fn() },
}));
jest.mock("@/lib/ai/openai-service", () => ({
  __esModule: true,
  aiService: { translateText: jest.fn() },
}));
jest.mock("@/lib/api/rate-limit", () => ({
  enforceRateLimit: jest.fn(async () => null),
  getClientIp: jest.fn(() => "203.0.113.7"),
}));

import { POST } from "@/app/api/edit-board/languages/route";

const mockValidate = StagingAccessManager.validateStagingAccess as jest.Mock;
const mockCreateServiceRoleClient = createServiceRoleClient as jest.Mock;
const mockTranslate = aiService.translateText as jest.Mock;

const SITE_ID = "11111111-1111-1111-1111-111111111111";

interface Op {
  table: string;
  kind: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
}

function recordingClient() {
  const ops: Op[] = [];

  function from(table: string) {
    const op: Op = { table, kind: "select" };
    const answer = () => {
      ops.push(op);
      if (op.kind === "insert") {
        return { data: { id: "lang-new", ...op.payload }, error: null };
      }
      if (table === "content_elements") {
        // What an existing site holds. Were the branch still here, each of
        // these would be one OpenAI call.
        return {
          data: [
            {
              element_id: "hero",
              staging_content: "Hello",
              published_content: null,
            },
            {
              element_id: "cta",
              staging_content: null,
              published_content: "Buy",
            },
          ],
          error: null,
        };
      }
      // No existing language row for this code.
      return { data: null, error: { code: "PGRST116", message: "no rows" } };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      insert: (payload: Record<string, unknown>) => {
        op.kind = "insert";
        op.payload = payload;
        return builder;
      },
      update: (payload: Record<string, unknown>) => {
        op.kind = "update";
        op.payload = payload;
        return builder;
      },
      single: async () => answer(),
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(answer()).then(onOk, onErr),
    };
    return builder;
  }

  return { client: { from }, ops };
}

function addLanguage(body: Record<string, unknown>) {
  return POST(
    new NextRequest("https://www.recopyfa.st/api/edit-board/languages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer staging-token",
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/edit-board/languages — no model call", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockValidate.mockResolvedValue({
      valid: true,
      verified: true,
      permissions: ["view", "edit", "publish", "admin"],
      email: "owner@example.com",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adds the language without translating anything, even when an old widget asks it to", async () => {
    const { client, ops } = recordingClient();
    mockCreateServiceRoleClient.mockReturnValue(client);

    const response = await addLanguage({
      siteId: SITE_ID,
      languageCode: "fr",
      autoTranslate: true,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockTranslate).not.toHaveBeenCalled();
    expect(ops.some((op) => op.table === "content_elements")).toBe(false);

    const insert = ops.find(
      (op) => op.table === "site_languages" && op.kind === "insert",
    );
    expect(insert?.payload).toEqual(
      expect.objectContaining({
        site_id: SITE_ID,
        language_code: "fr",
        language_name: "French",
        translations: {},
        translation_coverage: 0,
        last_translated_at: null,
      }),
    );

    // Nothing in the response claims a translation happened.
    expect(body).toEqual({
      success: true,
      language: expect.objectContaining({ language_code: "fr" }),
    });
  });
});
