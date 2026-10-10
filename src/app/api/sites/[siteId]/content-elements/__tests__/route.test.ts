import { NextRequest } from "next/server";

const rows = Array.from({ length: 1002 }, (_unused, index) => ({
  id: `row-${String(index).padStart(4, "0")}`,
  site_id: "site-1",
  element_id: `element-${String(index).padStart(4, "0")}`,
  selector: "p",
  published_content: `Published ${index}`,
  original_content: `Original ${index}`,
  language: "en",
  variant: "default",
  page_path: "/pricing",
  metadata: { type: "p" },
  published_at: "2026-09-24T00:00:00.000Z",
}));

type Row = (typeof rows)[number];

class Query implements PromiseLike<{ data: Row[]; error: null }> {
  private filtered = rows;
  private start = 0;
  private end = 499;

  select() {
    return this;
  }

  eq(column: keyof Row, value: unknown) {
    this.filtered = this.filtered.filter((row) => row[column] === value);
    return this;
  }

  order(column: keyof Row) {
    this.filtered = [...this.filtered].sort((left, right) =>
      String(left[column]).localeCompare(String(right[column])),
    );
    return this;
  }

  range(start: number, end: number) {
    this.start = start;
    this.end = Math.min(end, start + 499);
    return this;
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: Row[];
          error: null;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({
      data: this.filtered.slice(this.start, this.end + 1),
      error: null,
    }).then(onfulfilled, onrejected);
  }
}

jest.mock("@/lib/security/ingest-auth", () => ({
  authorizeSiteReadAccess: jest.fn(async () => ({
    ok: true,
    mode: "session",
    userId: "user-1",
  })),
}));

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn(() => new Query()),
  })),
}));

import { GET } from "../route";

describe("GET /api/sites/[siteId]/content-elements", () => {
  it("returns every filtered row when PostgREST caps responses at 500", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/sites/site-1/content-elements?language=en&variant=default",
      ),
      { params: Promise.resolve({ siteId: "site-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.elements).toHaveLength(1002);
    expect(body.elements.at(-1)).toMatchObject({
      element_id: "element-1001",
      current_content: "Published 1001",
    });
  });
});
