/**
 * s77 (s69 R1) — the edit-board routes key their per-site buckets on the
 * CANONICAL site id, and refuse a malformed one before doing any work.
 *
 * Each handler metered on the raw `siteId` the caller sent. The access checks
 * reach the site through a `uuid` cast, so `ABCD…` and `abcd…` are one site —
 * and were two budgets: every spelling of a site id multiplied what one copied
 * invite link could spend. The id is now canonicalised (lower case) where the
 * handler reads it, so the access check, the limiter and every query see the
 * same value; an id that cannot be a site id is 400 before any lookup.
 *
 * `history/[versionId]` is not in the table: it meters on the database's
 * `version.site_id`, which is already canonical.
 *
 * Only the store, the identity and the database are stubbed; `enforceRateLimit`
 * and `requireUuid` are the shipped implementations.
 */

import { NextRequest } from "next/server";
import { rateLimiter } from "@/lib/security/rate-limiter";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import { authorizeFirstPartyEditorAccess } from "@/lib/auth/editor-access";
import { createServiceRoleClient } from "@/lib/supabase/service";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/auth/staging-access", () => ({
  __esModule: true,
  StagingAccessManager: { validateStagingAccess: jest.fn() },
}));
jest.mock("@/lib/auth/editor-access", () => {
  const actual = jest.requireActual("@/lib/auth/editor-access");
  return {
    __esModule: true,
    ...actual,
    authorizeFirstPartyEditorAccess: jest.fn(),
  };
});
jest.mock("@/lib/ai/openai-service", () => ({
  __esModule: true,
  aiService: {
    generateContentSuggestion: jest.fn(async () => ({
      success: true,
      data: ["rewritten"],
      tokensUsed: 1,
    })),
    translateText: jest.fn(),
  },
}));
jest.mock("@/lib/security/rate-limiter", () => {
  const actual = jest.requireActual("@/lib/security/rate-limiter");
  return {
    __esModule: true,
    ...actual,
    rateLimiter: { checkLimit: jest.fn() },
  };
});

import {
  GET as getThemes,
  POST as postTheme,
  PUT as putTheme,
  DELETE as deleteTheme,
} from "@/app/api/edit-board/themes/route";
import {
  GET as getStyles,
  POST as postStyle,
} from "@/app/api/edit-board/styles/route";
import { POST as applyStyle } from "@/app/api/edit-board/styles/apply/route";
import {
  GET as getLanguages,
  POST as postLanguage,
  PUT as putLanguage,
  DELETE as deleteLanguage,
} from "@/app/api/edit-board/languages/route";
import {
  GET as getHistory,
  POST as postVersion,
} from "@/app/api/edit-board/history/route";

const SITE_ID = "6f1c2b9e-3d4a-4b5c-8d6e-7f8091a2b3c4";
const UPPER_SITE_ID = SITE_ID.toUpperCase();
const TOKEN = "staging-token";
const BASE = "https://www.recopyfa.st/api/edit-board";

const checkLimit = rateLimiter.checkLimit as jest.MockedFunction<
  typeof rateLimiter.checkLimit
>;
const stagingAccess = StagingAccessManager.validateStagingAccess as jest.Mock;
const firstParty = authorizeFirstPartyEditorAccess as jest.MockedFunction<
  typeof authorizeFirstPartyEditorAccess
>;

function wireServiceClient() {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    neq: jest.fn(() => chain),
    in: jest.fn(() => chain),
    not: jest.fn(() => chain),
    is: jest.fn(() => chain),
    gt: jest.fn(() => chain),
    order: jest.fn(() => chain),
    range: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    single: jest.fn(() =>
      Promise.resolve({
        data: { id: "row-1", site_id: SITE_ID, prompt: "Shorter" },
        error: null,
      }),
    ),
    maybeSingle: jest.fn(() =>
      Promise.resolve({ data: { id: "row-1", site_id: SITE_ID } }),
    ),
    insert: jest.fn(() => chain),
    update: jest.fn(() => chain),
    upsert: jest.fn(() => chain),
    delete: jest.fn(() => chain),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
  } as unknown as Record<string, jest.Mock>;

  (createServiceRoleClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => chain),
    rpc: jest.fn(() => Promise.resolve({ data: 1, error: null })),
  });
}

function json(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
}

function query(url: string, method = "GET") {
  return new NextRequest(url, {
    method,
    headers: { authorization: `Bearer ${TOKEN}` },
  });
}

const q = encodeURIComponent;

/** Every edit-board handler that takes a site id from its caller. */
const HANDLERS: Array<{
  name: string;
  call: (siteId: string) => Promise<Response>;
}> = [
  {
    name: "themes GET",
    call: (siteId) => getThemes(query(`${BASE}/themes?siteId=${q(siteId)}`)),
  },
  {
    name: "themes POST",
    call: (siteId) =>
      postTheme(json(`${BASE}/themes`, "POST", { siteId, name: "Winter" })),
  },
  {
    name: "themes PUT",
    call: (siteId) =>
      putTheme(
        json(`${BASE}/themes`, "PUT", {
          siteId,
          themeId: "theme-1",
          name: "Spring",
        }),
      ),
  },
  {
    name: "themes DELETE",
    call: (siteId) =>
      deleteTheme(
        query(`${BASE}/themes?siteId=${q(siteId)}&themeId=theme-1`, "DELETE"),
      ),
  },
  {
    name: "styles GET",
    call: (siteId) => getStyles(query(`${BASE}/styles?siteId=${q(siteId)}`)),
  },
  {
    name: "styles POST",
    call: (siteId) =>
      postStyle(
        json(`${BASE}/styles`, "POST", {
          siteId,
          name: "Punchy",
          prompt: "Shorter",
        }),
      ),
  },
  {
    name: "styles/apply POST",
    call: (siteId) =>
      applyStyle(
        json(`${BASE}/styles/apply`, "POST", { siteId, styleId: "style-1" }),
      ),
  },
  {
    name: "languages GET",
    call: (siteId) =>
      getLanguages(query(`${BASE}/languages?siteId=${q(siteId)}`)),
  },
  {
    name: "languages POST",
    call: (siteId) =>
      postLanguage(
        json(`${BASE}/languages`, "POST", { siteId, languageCode: "fr" }),
      ),
  },
  {
    name: "languages PUT",
    call: (siteId) =>
      putLanguage(
        json(`${BASE}/languages`, "PUT", {
          siteId,
          languageId: "lang-1",
          translations: {},
        }),
      ),
  },
  {
    name: "languages DELETE",
    call: (siteId) =>
      deleteLanguage(
        query(
          `${BASE}/languages?siteId=${q(siteId)}&languageId=lang-1`,
          "DELETE",
        ),
      ),
  },
  {
    name: "history GET",
    call: (siteId) => getHistory(query(`${BASE}/history?siteId=${q(siteId)}`)),
  },
  {
    name: "history POST",
    call: (siteId) =>
      postVersion(
        json(`${BASE}/history`, "POST", { siteId, description: "snapshot" }),
      ),
  },
];

describe("edit-board routes meter and look up the canonical site id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    wireServiceClient();
    stagingAccess.mockResolvedValue({
      valid: true,
      verified: true,
      permissions: ["admin", "publish", "edit", "view"],
      email: "editor@example.com",
    });
    firstParty.mockResolvedValue(null);
    checkLimit.mockResolvedValue({
      allowed: true,
      remaining: 49,
      resetTime: Date.now() + 60_000,
      totalRequests: 1,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(HANDLERS)("$name", ({ call }) => {
    it("meters an upper-case spelling on the lower-case id, and checks access on it", async () => {
      const response = await call(UPPER_SITE_ID);

      expect(response.status).not.toBe(400);
      expect(checkLimit).toHaveBeenCalled();
      for (const [config] of checkLimit.mock.calls) {
        expect(config.identifier).toBe(SITE_ID);
      }
      for (const [, siteId] of stagingAccess.mock.calls) {
        expect(siteId).toBe(SITE_ID);
      }
    });

    it.each([
      ["a slug", "site-1"],
      ["a braced id", `{${SITE_ID}}`],
      ["an id without hyphens", SITE_ID.replace(/-/g, "")],
    ])(
      "refuses %s with 400 before any access check or limiter",
      async (_label, siteId) => {
        const response = await call(siteId);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Field "siteId" must be a valid UUID');
        expect(stagingAccess).not.toHaveBeenCalled();
        expect(firstParty).not.toHaveBeenCalled();
        expect(checkLimit).not.toHaveBeenCalled();
      },
    );
  });
});
