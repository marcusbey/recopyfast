/**
 * A-26 — link and image-alt edits are accepted, confirmed, and thrown away.
 *
 * The widget's link editor sends the new destination as an extra field on the
 * save payload — `payload: function(values) { return { href: values.href }; }`
 * (public/embed/recopyfast.src.js:4675) — and the image editor does the same
 * with `alt` (:4612-4617). `persistContentUpdate` merges those extras into the
 * PUT body (:2635-2641).
 *
 * The handler never reads them. It updates exactly three columns —
 * `staging_content`, `staging_updated_at`, `updated_at`
 * (src/app/api/staging/content/[siteId]/route.ts:223-233) — and `grep href`
 * over the route returns nothing. There is no column for either value.
 *
 * The editor is then told it worked. `persistContentUpdate` treats any 2xx as
 * success and the widget applies the change to the live DOM in the editor's own
 * tab (:4628-4636), so they watch the link change in front of them, close the
 * tab, and visitors keep clicking through to the old destination forever.
 *
 * THIS SUITE ASSERTS ON THE PERSISTED ROW, NOT ON THE 200. The 200 is the
 * defect, not the evidence — a status assertion here would pass today and would
 * still pass after a fix, which is to say it would test nothing.
 *
 * `test.failing` on the two writes: each passes while the field is dropped and
 * fails the moment it is stored.
 */

const mockGetUser = jest.fn();
const mockMaybeSingle = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: mockMaybeSingle }),
          }),
        }),
      }),
    }),
  ),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => serviceClient),
}));

import { PUT } from "@/app/api/staging/content/[siteId]/route";
import { NextRequest } from "next/server";

const SITE_ID = "site-1";
const ELEMENT_ID = "rcf-nav-link";

/** Every column the route asked the database to write, per call. */
let updatePayloads: Record<string, unknown>[] = [];
/** Every `staging_history` row the route recorded. */
let historyRows: Record<string, unknown>[] = [];

/**
 * A supabase-js query chain that resolves to `result` however many `.eq()`
 * filters are hung off it, and is awaitable at the end like the real builder.
 */
function chain(result: unknown) {
  const node: Record<string, unknown> = {};
  node.eq = jest.fn(() => node);
  node.single = jest.fn(() => Promise.resolve(result));
  node.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return node;
}

const serviceClient = {
  from: jest.fn((table: string) => {
    if (table === "staging_history") {
      return {
        insert: jest.fn((row: Record<string, unknown>) => {
          historyRows.push(row);
          return Promise.resolve({ error: null });
        }),
      };
    }

    return {
      select: jest.fn(() =>
        chain({
          data: { id: "row-1", staging_content: "Documentation" },
          error: null,
        }),
      ),
      update: jest.fn((payload: Record<string, unknown>) => {
        updatePayloads.push(payload);
        return chain({ error: null });
      }),
    };
  }),
};

/** The exact body the widget builds for a save, extras merged in. */
function widgetSave(
  content: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return PUT(
    new NextRequest(`https://www.recopyfa.st/api/staging/content/${SITE_ID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elementId: ELEMENT_ID,
        content,
        ...extra,
      }),
    }),
    { params: Promise.resolve({ siteId: SITE_ID }) },
  ) as Promise<Response>;
}

/** The single row the route persisted for this edit. */
function persistedRow(): Record<string, unknown> {
  expect(updatePayloads).toHaveLength(1);
  return updatePayloads[0];
}

describe("PUT /api/staging/content/[siteId] link and image extras", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
    updatePayloads = [];
    historyRows = [];

    // A signed-in site admin: the first-party path, no invite token involved.
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "owner@example.com" } },
    });
    mockMaybeSingle.mockResolvedValue({ data: { permission: "admin" } });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The control. The text half of the same request is stored, so a failure
  // below is about the extras and not about the fixture, the auth path or the
  // query chain.
  it("persists the edited text", async () => {
    await widgetSave("Docs");

    expect(persistedRow().staging_content).toBe("Docs");
  });

  // GUARD for the link test below. `test.failing` passes on ANY throw — an
  // auth mock that stopped granting edit, a query chain the route no longer
  // matches — so each marked test needs an unmarked sibling sending the
  // identical body and asserting the write happened at all.
  it("reaches the write for a link edit", async () => {
    await widgetSave("Docs", { href: "https://docs.example.com/v2" });

    expect(updatePayloads).toHaveLength(1);
    expect(persistedRow().staging_content).toBe("Docs");
  });

  test.failing("persists the new link destination", async () => {
    // startLinkEdit -> persistContentUpdate(elementId, text, { href })
    await widgetSave("Docs", { href: "https://docs.example.com/v2" });

    expect(JSON.stringify(persistedRow())).toContain(
      "https://docs.example.com/v2",
    );
  });

  // GUARD for the alt test below.
  it("reaches the write for an image edit", async () => {
    await widgetSave("https://cdn.example.com/hero-v2.png", {
      contentType: "image",
      alt: "Two engineers reviewing a dashboard",
    });

    expect(updatePayloads).toHaveLength(1);
    expect(persistedRow().staging_content).toBe(
      "https://cdn.example.com/hero-v2.png",
    );
  });

  test.failing("persists the new image alt text", async () => {
    // The image editor's save: a new src as the content, and the alt alongside.
    await widgetSave("https://cdn.example.com/hero-v2.png", {
      contentType: "image",
      alt: "Two engineers reviewing a dashboard",
    });

    expect(JSON.stringify(persistedRow())).toContain(
      "Two engineers reviewing a dashboard",
    );
  });

  // GUARD for the history test below: a history row IS written for this edit,
  // so the marked test is about its contents and not about whether the insert
  // ran at all.
  it("writes a staging_history row for a link edit", async () => {
    await widgetSave("Docs", { href: "https://docs.example.com/v2" });

    expect(historyRows).toHaveLength(1);
    expect(historyRows[0].new_content).toBe("Docs");
  });

  test.failing("records the link change in staging history", async () => {
    // History is the customer's only record of what changed. A link edit that
    // leaves no trace cannot be reviewed, attributed or rolled back.
    await widgetSave("Docs", { href: "https://docs.example.com/v2" });

    expect(historyRows).toHaveLength(1);
    expect(JSON.stringify(historyRows[0])).toContain(
      "https://docs.example.com/v2",
    );
  });

  describe("what the caller is told", () => {
    // The confirmation is why the defect is invisible: the widget treats any
    // 2xx as success and applies the change to the live DOM in the editor's own
    // tab, so they watch the link change and believe it stuck.

    it("answers 200 with a success body for a link edit", async () => {
      const response = await widgetSave("Docs", {
        href: "https://docs.example.com/v2",
      });
      const body = await response.json();

      // Deliberately not asserting that the href is absent from the write:
      // that is true only while the bug is present, and the marked tests above
      // are what pin it. This half stays true after the fix, which is the
      // point — the confirmation is right once there is something behind it.
      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
    });

    test.failing(
      "writes more columns when extras are sent than when they are not",
      async () => {
        // The mechanism behind the silent 200: the route writes one fixed set
        // of columns, so a request carrying `href`/`alt` produces byte-for-byte
        // the same write as one carrying neither. Storing the extras — in
        // columns of their own or in an existing payload column — is what makes
        // the two differ, and that is the signal to drop this marker.
        await widgetSave("Docs");
        const withoutExtras = Object.keys(persistedRow()).sort();

        updatePayloads = [];
        await widgetSave("Docs", {
          href: "https://docs.example.com/v2",
          alt: "alt text",
        });
        const withExtras = Object.keys(persistedRow()).sort();

        expect(withExtras).not.toEqual(withoutExtras);
      },
    );
  });
});
