/**
 * @jest-environment node
 */

import {
  isDataFastId,
  readDataFastAttribution,
  readDataFastVisitorId,
  type CookieReader,
} from "@/lib/analytics/datafast-attribution";

const VISITOR = "a3ab2331-989f-4cfa-91c6-2461c9e3c6bd";
const SESSION = "s-7d1c0d3e-6a0f-4bbf-9b1e-0c2f1f3c9a11";

function jar(values: Record<string, string>): CookieReader {
  return {
    get: (name) => (name in values ? { value: values[name] } : undefined),
  };
}

describe("readDataFastAttribution", () => {
  it("returns both DataFast ids for Stripe metadata", () => {
    expect(
      readDataFastAttribution(
        jar({ datafast_visitor_id: VISITOR, datafast_session_id: SESSION }),
      ),
    ).toEqual({ datafast_visitor_id: VISITOR, datafast_session_id: SESSION });
  });

  it("is empty with no cookies, so callers can spread it unconditionally", () => {
    expect(readDataFastAttribution(jar({}))).toEqual({});
  });

  it("drops a forged or oversized value and keeps the valid one", () => {
    expect(
      readDataFastAttribution(
        jar({
          datafast_visitor_id: VISITOR,
          datafast_session_id: "<script>",
        }),
      ),
    ).toEqual({ datafast_visitor_id: VISITOR });
    expect(
      readDataFastAttribution(jar({ datafast_visitor_id: "a".repeat(129) })),
    ).toEqual({});
  });

  it("survives a cookie store that throws", () => {
    expect(
      readDataFastAttribution({
        get: () => {
          throw new Error("no request scope");
        },
      }),
    ).toEqual({});
  });
});

describe("readDataFastVisitorId", () => {
  it("reads the visitor cookie from a raw header", () => {
    expect(
      readDataFastVisitorId(`a=1; datafast_visitor_id=${VISITOR}; b=2`),
    ).toBe(VISITOR);
  });

  it("is null when absent or invalid", () => {
    expect(readDataFastVisitorId(null)).toBeNull();
    expect(readDataFastVisitorId("datafast_session_id=x")).toBeNull();
    expect(readDataFastVisitorId("datafast_visitor_id=a@b.c")).toBeNull();
  });
});

describe("isDataFastId", () => {
  it("accepts ids and rejects everything else", () => {
    expect(isDataFastId(VISITOR)).toBe(true);
    expect(isDataFastId("")).toBe(false);
    expect(isDataFastId(42)).toBe(false);
    expect(isDataFastId("a b")).toBe(false);
  });
});
