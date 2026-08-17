/**
 * H-3 — every edit-board route runs on the service-role client and carried no
 * rate limiter.
 *
 * ADR 002 rule 4: a service-role route carries a FAIL-CLOSED limiter keyed on
 * the site. These six are opened by a staging token delivered in an invite link
 * — a link that leaks is a copied credential — and between them they rewrite
 * themes, styles, translations and version history, two of them by spending
 * OpenAI calls per content element.
 *
 * Every exported handler that reaches the service role is in the table below, so
 * a method added later without a limiter shows up as an untested one rather than
 * as nothing at all.
 *
 * Only the store, the identity and the AI client are stubbed. `enforceRateLimit`,
 * its failure policy and its headers are the shipped implementations.
 */

import { NextRequest } from "next/server";
import { rateLimiter } from "@/lib/security/rate-limiter";
import { StagingAccessManager } from "@/lib/auth/staging-access";
import { authorizeFirstPartyEditorAccess } from "@/lib/auth/editor-access";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { aiService } from "@/lib/ai/openai-service";

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
    generateContentSuggestion: jest.fn(),
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
import {
  GET as getVersion,
  POST as restoreVersion,
} from "@/app/api/edit-board/history/[versionId]/route";

const SITE_ID = "11111111-1111-1111-1111-111111111111";
const VERSION_ID = "22222222-2222-2222-2222-222222222222";
const TOKEN = "staging-token";
const BASE = "https://www.recopyfa.st/api/edit-board";

const checkLimit = rateLimiter.checkLimit as jest.MockedFunction<
  typeof rateLimiter.checkLimit
>;

/** Anything the service-role client was asked to change. */
let writes: string[] = [];

function wireServiceClient() {
  writes = [];
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
    single: jest.fn(() =>
      Promise.resolve({
        data: { id: VERSION_ID, site_id: SITE_ID, is_active: false },
        error: null,
      }),
    ),
    maybeSingle: jest.fn(() =>
      Promise.resolve({ data: { id: VERSION_ID, site_id: SITE_ID } }),
    ),
    insert: jest.fn(() => {
      writes.push("insert");
      return chain;
    }),
    update: jest.fn(() => {
      writes.push("update");
      return chain;
    }),
    upsert: jest.fn(() => {
      writes.push("upsert");
      return chain;
    }),
    delete: jest.fn(() => {
      writes.push("delete");
      return chain;
    }),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(resolve),
  } as unknown as Record<string, jest.Mock>;

  (createServiceRoleClient as jest.Mock).mockReturnValue({
    from: jest.fn(() => chain),
    rpc: jest.fn(() => {
      writes.push("rpc");
      return Promise.resolve({ data: 1, error: null });
    }),
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

const versionParams = { params: Promise.resolve({ versionId: VERSION_ID }) };

/**
 * Every handler, called the way the edit board calls it. `ai` marks the two that
 * spend OpenAI calls, so the refusal can be checked to land in FRONT of the spend
 * rather than after it.
 */
const HANDLERS: Array<{
  name: string;
  ai?: boolean;
  call: () => Promise<Response>;
}> = [
  {
    name: "themes GET",
    call: () => getThemes(query(`${BASE}/themes?siteId=${SITE_ID}`)),
  },
  {
    name: "themes POST",
    call: () =>
      postTheme(
        json(`${BASE}/themes`, "POST", { siteId: SITE_ID, name: "Winter" }),
      ),
  },
  {
    name: "themes PUT",
    call: () =>
      putTheme(
        json(`${BASE}/themes`, "PUT", {
          siteId: SITE_ID,
          themeId: "theme-1",
          name: "Spring",
        }),
      ),
  },
  {
    name: "themes DELETE",
    call: () =>
      deleteTheme(
        query(`${BASE}/themes?siteId=${SITE_ID}&themeId=theme-1`, "DELETE"),
      ),
  },
  {
    name: "styles GET",
    call: () => getStyles(query(`${BASE}/styles?siteId=${SITE_ID}`)),
  },
  {
    name: "styles POST",
    call: () =>
      postStyle(
        json(`${BASE}/styles`, "POST", {
          siteId: SITE_ID,
          name: "Punchy",
          prompt: "Shorter",
        }),
      ),
  },
  {
    name: "styles/apply POST",
    ai: true,
    call: () =>
      applyStyle(
        json(`${BASE}/styles/apply`, "POST", {
          siteId: SITE_ID,
          styleId: "style-1",
        }),
      ),
  },
  {
    name: "languages GET",
    call: () => getLanguages(query(`${BASE}/languages?siteId=${SITE_ID}`)),
  },
  {
    name: "languages POST",
    ai: true,
    call: () =>
      postLanguage(
        json(`${BASE}/languages`, "POST", {
          siteId: SITE_ID,
          languageCode: "fr",
          autoTranslate: true,
        }),
      ),
  },
  {
    name: "languages PUT",
    call: () =>
      putLanguage(
        json(`${BASE}/languages`, "PUT", {
          siteId: SITE_ID,
          languageId: "lang-1",
          translations: {},
        }),
      ),
  },
  {
    name: "languages DELETE",
    call: () =>
      deleteLanguage(
        query(
          `${BASE}/languages?siteId=${SITE_ID}&languageId=lang-1`,
          "DELETE",
        ),
      ),
  },
  {
    name: "history GET",
    call: () => getHistory(query(`${BASE}/history?siteId=${SITE_ID}`)),
  },
  {
    name: "history POST",
    call: () =>
      postVersion(
        json(`${BASE}/history`, "POST", {
          siteId: SITE_ID,
          description: "snapshot",
        }),
      ),
  },
  {
    name: "history/[versionId] GET",
    call: () =>
      getVersion(query(`${BASE}/history/${VERSION_ID}`), versionParams),
  },
  {
    name: "history/[versionId] POST",
    call: () =>
      restoreVersion(
        json(`${BASE}/history/${VERSION_ID}`, "POST", {}),
        versionParams,
      ),
  },
];

describe("the edit-board service-role routes are metered per site", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    wireServiceClient();

    (StagingAccessManager.validateStagingAccess as jest.Mock).mockResolvedValue(
      {
        valid: true,
        verified: true,
        permissions: ["admin", "publish", "edit", "view"],
        email: "editor@example.com",
      },
    );
    (
      authorizeFirstPartyEditorAccess as jest.MockedFunction<
        typeof authorizeFirstPartyEditorAccess
      >
    ).mockResolvedValue(null);
    (aiService.generateContentSuggestion as jest.Mock).mockResolvedValue({
      success: true,
      data: ["rewritten"],
      tokensUsed: 10,
    });
    (aiService.translateText as jest.Mock).mockResolvedValue({
      success: true,
      data: "traduit",
    });

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

  describe.each(HANDLERS)("$name", ({ call, ai }) => {
    it("meters the request, bucketed by site", async () => {
      // The control: the handler runs, and it asks the limiter about THIS site
      // rather than about the caller's address.
      const response = await call();

      expect(response.status).not.toBe(429);
      expect(checkLimit).toHaveBeenCalled();

      const config = checkLimit.mock.calls[0][0];
      expect(config.identifier).toBe(SITE_ID);
      expect(config.identifierType).not.toBe("ip");
    });

    it("refuses over the limit, before writing or spending anything", async () => {
      checkLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 30_000,
        totalRequests: 999,
      });

      const response = await call();

      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).not.toBeNull();
      expect(writes).toHaveLength(0);

      if (ai) {
        // A limiter behind the OpenAI calls would bound the database and leave
        // the bill unbounded, which is the more expensive half.
        expect(aiService.generateContentSuggestion).not.toHaveBeenCalled();
        expect(aiService.translateText).not.toHaveBeenCalled();
      }
    });

    it("refuses when the limiter store is unreachable", async () => {
      checkLimit.mockRejectedValue(new Error("Redis unreachable"));

      const response = await call();

      // Fail closed, per ADR 002 rule 4: losing Redis must not remove the only
      // ceiling on a service-role path opened by a shareable link.
      expect(response.status).toBe(503);
      expect(writes).toHaveLength(0);
    });
  });
});
