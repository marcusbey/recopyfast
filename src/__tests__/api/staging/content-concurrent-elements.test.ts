/**
 * AC 7 — two editors working on two different elements both persist, and
 * neither overwrites the other.
 *
 * This is an HTTP test, not a socket test, and after `s07a` that is the whole
 * point. The realtime service used to write `content_elements` off a socket
 * message (server/index.js, `content-update`), so "does a second editor's save
 * survive" depended on which of two write paths won. Under ADR 004 rule 1 there
 * is exactly one writer — `PUT /api/staging/content/:siteId` — so the criterion
 * reduces to: does that route scope its update to the element it was given.
 *
 * The interleave is genuine. A read barrier holds both handlers until both have
 * read, so neither observes the other's write before issuing its own — the
 * window a per-row update would clobber. `content-concurrent-write.test.ts`
 * covers the same-element case (A-17, still `test.failing`); this is the
 * different-element case, which must simply work.
 *
 * The fake filters on the same `.eq()` chain the route builds, so an update
 * that dropped the `element_id` predicate lands on both rows and the assertion
 * catches it. A fake that ignored filters would make this test unfalsifiable.
 */

import { NextRequest } from "next/server";
import type { EditorAccess } from "@/lib/auth/editor-access";

const SITE_ID = "site-1";
const HEADLINE = "headline";
const SUBHEAD = "subhead";

interface ContentElementRow {
  id: string;
  site_id: string;
  element_id: string;
  language: string;
  variant: string;
  staging_content: string | null;
  staging_updated_at: string;
  updated_at: string;
}

interface StagingHistoryRow {
  content_element_id: string;
  previous_content: string | null;
  new_content: string;
  user_email: string;
  action: string;
}

function seedRows(): ContentElementRow[] {
  return [
    {
      id: "element-headline",
      site_id: SITE_ID,
      element_id: HEADLINE,
      language: "en",
      variant: "default",
      staging_content: "Original headline",
      staging_updated_at: "2026-08-07T10:00:00.000Z",
      updated_at: "2026-08-07T10:00:00.000Z",
    },
    {
      id: "element-subhead",
      site_id: SITE_ID,
      element_id: SUBHEAD,
      language: "en",
      variant: "default",
      staging_content: "Original subhead",
      staging_updated_at: "2026-08-07T10:00:00.000Z",
      updated_at: "2026-08-07T10:00:00.000Z",
    },
  ];
}

class FakeDb {
  elements: ContentElementRow[] = seedRows();
  history: StagingHistoryRow[] = [];

  /**
   * Park readers until this many are waiting, then release them together. Both
   * collaborators read before either writes — the interleave a row-scoped
   * update would lose an edit in.
   */
  readBarrier = 0;
  private parked: Array<() => void> = [];

  async waitAtBarrier(): Promise<void> {
    if (this.readBarrier <= 1) return;
    await new Promise<void>((resolve) => {
      this.parked.push(resolve);
      if (this.parked.length >= this.readBarrier) {
        const waiting = this.parked;
        this.parked = [];
        waiting.forEach((release) => release());
      }
    });
  }

  reset() {
    this.elements = seedRows();
    this.history = [];
    this.readBarrier = 0;
    this.parked = [];
  }
}

const db = new FakeDb();

function makeServiceClient() {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      expect(name).toBe("save_staging_content_atomic");
      await db.waitAtBarrier();
      const found = db.elements.find(
        (row) =>
          row.site_id === args.p_site_id &&
          row.element_id === args.p_element_id &&
          row.language === args.p_language &&
          row.variant === args.p_variant,
      );
      if (!found) return { data: [], error: null };

      const previousContent = found.staging_content;
      const now = new Date().toISOString();
      found.staging_content = String(args.p_staging_content);
      found.staging_updated_at = now;
      found.updated_at = now;
      db.history = [
        ...db.history,
        {
          content_element_id: found.id,
          previous_content: previousContent,
          new_content: String(args.p_staging_content),
          user_email: String(args.p_user_email),
          action: previousContent === null ? "create" : "update",
        },
      ];
      return {
        data: [{ content_element_id: found.id, updated_at: now }],
        error: null,
      };
    },
  };
}

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => makeServiceClient()),
}));

// Only the session is stubbed. `requireEditorPermission` and the permission
// ladder run for real.
jest.mock("@/lib/auth/editor-access", () => {
  const actual = jest.requireActual("@/lib/auth/editor-access");
  return {
    ...actual,
    authorizeFirstPartyEditorAccess: jest.fn(),
  };
});

import { authorizeFirstPartyEditorAccess } from "@/lib/auth/editor-access";
import { PUT } from "@/app/api/staging/content/[siteId]/route";

const mockAuthorize = authorizeFirstPartyEditorAccess as jest.MockedFunction<
  typeof authorizeFirstPartyEditorAccess
>;

function accessFor(email: string): EditorAccess {
  return {
    kind: "staging",
    siteId: SITE_ID,
    token: "first-party",
    permissions: ["view", "edit"],
    email,
    userId: email,
    stagingAccessId: null,
    verified: true,
  };
}

function putContent(elementId: string, content: string): Promise<Response> {
  return PUT(
    new NextRequest(`https://www.recopyfa.st/api/staging/content/${SITE_ID}`, {
      method: "PUT",
      body: JSON.stringify({ elementId, content }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  ) as unknown as Promise<Response>;
}

function contentOf(elementId: string): string | null {
  return (
    db.elements.find((row) => row.element_id === elementId)?.staging_content ??
    null
  );
}

describe("AC 7 — two editors on two different elements", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    db.reset();
    mockAuthorize.mockResolvedValue(accessFor("first@example.com"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("persists both edits when they interleave, and neither overwrites the other", async () => {
    db.readBarrier = 2;

    mockAuthorize
      .mockResolvedValueOnce(accessFor("first@example.com"))
      .mockResolvedValueOnce(accessFor("second@example.com"));

    const responses = await Promise.all([
      putContent(HEADLINE, "New headline"),
      putContent(SUBHEAD, "New subhead"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    // The criterion, stated directly: each element holds its own editor's value.
    expect(contentOf(HEADLINE)).toBe("New headline");
    expect(contentOf(SUBHEAD)).toBe("New subhead");
  });

  it("records one history row per element, each against its own element id", async () => {
    db.readBarrier = 2;

    mockAuthorize
      .mockResolvedValueOnce(accessFor("first@example.com"))
      .mockResolvedValueOnce(accessFor("second@example.com"));

    await Promise.all([
      putContent(HEADLINE, "New headline"),
      putContent(SUBHEAD, "New subhead"),
    ]);

    expect(db.history).toHaveLength(2);

    const byElement = new Map(
      db.history.map((row) => [row.content_element_id, row]),
    );
    expect(byElement.get("element-headline")).toMatchObject({
      previous_content: "Original headline",
      new_content: "New headline",
    });
    expect(byElement.get("element-subhead")).toMatchObject({
      previous_content: "Original subhead",
      new_content: "New subhead",
    });
  });

  it("leaves an untouched element exactly as it was (control)", async () => {
    const response = await putContent(HEADLINE, "New headline");

    expect(response.status).toBe(200);
    expect(contentOf(SUBHEAD)).toBe("Original subhead");
    expect(
      db.elements.find((row) => row.element_id === SUBHEAD)?.staging_updated_at,
    ).toBe("2026-08-07T10:00:00.000Z");
  });
});
