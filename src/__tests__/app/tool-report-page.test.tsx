/**
 * s96 (ADR 062) — the report page reads ONE row by id through the service
 * role, validates everything, and 404s on anything off.
 */

import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { createFinding } from "@/lib/tools/lens";
import type { ToolReport } from "@/lib/tools/report/report-schema";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { createAnonClient } from "@/lib/supabase/anon";

jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/supabase/anon", () => ({ createAnonClient: jest.fn() }));
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    signInWithMagicLink: jest.fn(),
    signOut: jest.fn(),
    refreshSession: jest.fn(),
  }),
}));

import ReportPage, { generateMetadata } from "@/app/tools/[slug]/r/[id]/page";

const ID = "6f1c2b9e-1d2c-4f5a-9b8c-7d6e5f4a3b2c";
const SLUG = "website-spell-checker";

function storedReport(overrides: Partial<ToolReport> = {}): ToolReport {
  return {
    v: 1,
    tool: SLUG,
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    scannedAt: "2026-10-11T12:00:00.000Z",
    summary: {
      headline: "1 possible typo on 1 page of 1",
      verdict: "warn",
      facts: [{ label: "Pages checked", value: "1" }],
    },
    findings: [
      createFinding({
        page: "https://example.com/",
        kind: "typo",
        match: "recieve",
        before: "We ",
        after: " orders daily.",
        suggestion: "receive",
      }),
    ],
    pages: [{ url: "https://example.com/", status: "checked" }],
    truncated: false,
    ...overrides,
  };
}

/** A service client answering one `tool_reports` row read. */
function serviceClient(row: unknown, error: unknown = null) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gt"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => ({ data: row, error });
  (createServiceRoleClient as jest.Mock).mockReturnValue({
    from: (table: string) => {
      calls.push(["from", table]);
      return builder;
    },
  });
  return calls;
}

function row(report: unknown = storedReport(), tool = SLUG) {
  return {
    id: ID,
    tool,
    report,
    created_at: "2026-10-11T12:00:00Z",
    expires_at: "2026-11-10T12:00:00Z",
  };
}

async function renderReport(slug = SLUG, id = ID) {
  const tree = (await ReportPage({
    params: Promise.resolve({ slug, id }),
  })) as ReactElement;
  return render(tree);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe("the report page", () => {
  it("renders the findings in their sentences, and the CTA", async () => {
    const calls = serviceClient(row());

    await renderReport();

    expect(
      screen.getByRole("heading", { level: 1, name: "example.com" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 possible typo on 1 page of 1"),
    ).toBeInTheDocument();
    expect(document.querySelector("mark")?.textContent).toContain("recieve");
    expect(
      screen.getByRole("link", { name: /fix it on your live page/i }),
    ).toHaveAttribute(
      "href",
      "/try?utm_source=tools&utm_medium=free_tool&utm_campaign=website-spell-checker#install",
    );
    expect(calls).toEqual([
      ["from", "tool_reports"],
      ["select", "id, tool, report, created_at, expires_at"],
      ["eq", "id", ID],
      ["gt", "expires_at", expect.any(String)],
    ]);
  });

  it("uses neither the anon nor the cookie client", async () => {
    serviceClient(row());

    await renderReport();

    expect(createAnonClient).not.toHaveBeenCalled();
    expect(createCookieClient).not.toHaveBeenCalled();
  });

  it("says when the report is partial", async () => {
    serviceClient(
      row(
        storedReport({
          pages: [
            { url: "https://example.com/", status: "checked" },
            {
              url: "https://example.com/slow",
              status: "skipped",
              reason: "Not reached within the scan's time limit.",
            },
          ],
        }),
      ),
    );

    await renderReport();

    expect(screen.getByText(/this report is partial/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Pages not checked" }),
    ).toBeInTheDocument();
  });

  it("is noindex, nofollow", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: SLUG, id: ID }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toBeUndefined();
  });
});

describe("404s", () => {
  it.each(["not-a-uuid", "1' OR '1'='1", `${ID}x`, ""])(
    "a malformed id (%p) never reaches the database — no client is even built",
    async (id) => {
      await expect(renderReport(SLUG, id)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(createServiceRoleClient).not.toHaveBeenCalled();
    },
  );

  it.each(["unknown-tool", "constructor"])(
    "an unknown slug (%s) is a 404",
    async (slug) => {
      await expect(renderReport(slug)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(createServiceRoleClient).not.toHaveBeenCalled();
    },
  );

  it("an unknown or expired id is a 404", async () => {
    serviceClient(null);

    await expect(renderReport()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a row belonging to another tool is a 404", async () => {
    serviceClient(row(storedReport(), "csp-checker"));

    await expect(renderReport()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("invalid stored JSON is a 404, logged", async () => {
    serviceClient(
      row({ ...storedReport(), findings: [{ page: "javascript:alert(1)" }] }),
    );

    await expect(renderReport()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(console.error).toHaveBeenCalledWith(
      "[tools/report] stored report failed validation:",
      ID,
    );
  });

  it("a database error is thrown, not dressed up as a 404", async () => {
    serviceClient(null, { code: "XX000" });

    await expect(renderReport()).rejects.toThrow("tool_reports read failed");
  });
});
