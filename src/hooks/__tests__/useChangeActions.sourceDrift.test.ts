import { act, renderHook } from "@testing-library/react";
import { useChangeActions, type ActionOutcome } from "../useChangeActions";
import type { ContentChange } from "../useContentChanges";

/**
 * s119 (ADR 075) — Keep override and Use new source write through
 * POST /api/content/source-drift and nothing else, sending back the observed
 * text the row showed. A newer observation (409) or a drift that is gone (404)
 * is stale: nothing was written here, and the row is read again so the page
 * shows what the server holds. Without an open drift nothing is sent.
 */

const SITE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_ID = "11111111-1111-4111-8111-111111111111";

function row(overrides: Partial<ContentChange> = {}): ContentChange {
  return {
    id: ROW_ID,
    siteId: SITE_ID,
    elementId: "pricing-range",
    pagePath: "/pricing",
    elementType: "p",
    selector: "#pricing > p",
    language: "en",
    variant: "default",
    original: "5 to 10",
    live: "5 to 11",
    draft: null,
    draftAttributes: [],
    hasLiveText: true,
    state: "published",
    changedAt: "2026-10-20T10:00:00+00:00",
    updatedAt: "2026-10-20T10:00:00.123456+00:00",
    changedBy: null,
    createdAt: "2026-09-28T09:00:00+00:00",
    sourceDrift: {
      baseline: "5 to 10",
      observed: "5 to 9",
      detectedAt: "2026-10-22T10:00:00+00:00",
    },
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const reread = jest.fn(async () => true);

async function run(
  action: "keepOverride" | "takeNewSource",
  target: ContentChange = row(),
): Promise<ActionOutcome> {
  const { result } = renderHook(() => useChangeActions({ reread }));
  let outcome!: ActionOutcome;
  await act(async () => {
    outcome = await result.current[action](target);
  });
  return outcome;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async () =>
    response({ status: "resolved" }),
  ) as unknown as typeof fetch;
});

describe("useChangeActions — source drift (ADR 075)", () => {
  it.each([
    ["keepOverride", "keep"],
    ["takeNewSource", "drop"],
  ] as const)(
    "%s posts the resolution with the observed text and re-reads the element",
    async (action, resolution) => {
      const outcome = await run(action);

      expect(outcome).toEqual({ error: null, applied: action });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe("/api/content/source-drift");
      expect((init as RequestInit).method).toBe("POST");
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({
        siteId: SITE_ID,
        contentElementId: ROW_ID,
        resolution,
        expectedObserved: "5 to 9",
      });
      expect(reread).toHaveBeenCalledTimes(1);
    },
  );

  it.each([409, 404])(
    "a %i is stale: nothing landed, the server's words are kept and the row is read again",
    async (status) => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        response({ error: "The page changed again since you looked." }, status),
      );

      const outcome = await run("keepOverride");

      expect(outcome).toEqual({
        error: "The page changed again since you looked.",
        applied: null,
        isStale: true,
      });
      expect(reread).toHaveBeenCalledTimes(1);
    },
  );

  it("a refusal that changed nothing is not re-read", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      response({ error: "Only a site admin can resolve source changes." }, 403),
    );

    const outcome = await run("takeNewSource");

    expect(outcome).toEqual({
      error: "Only a site admin can resolve source changes.",
      applied: null,
    });
    expect(reread).not.toHaveBeenCalled();
  });

  it("a lost answer is uncertain and read again", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError("offline"));

    const outcome = await run("takeNewSource");

    expect(outcome.isUncertain).toBe(true);
    expect(outcome.error).toMatch(/may or may not have been resolved/);
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it.each(["keepOverride", "takeNewSource"] as const)(
    "%s sends nothing for a row without an open drift",
    async (action) => {
      const outcome = await run(action, row({ sourceDrift: null }));

      expect(outcome.applied).toBeNull();
      expect(outcome.error).toBe(
        "There is no open source change on this text.",
      );
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );
});
