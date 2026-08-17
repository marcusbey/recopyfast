/**
 * The two claims the A/B feature cannot survive being wrong about, and which
 * nothing but a test will ever tell us:
 *
 *   1. Over 10,000 assignments each variant's share is within ±2 percentage
 *      points of its configured split.
 *   2. A returning visitor gets the variant they got last time.
 *
 * Both fail silently. Visitors are served variants, rows accumulate, a
 * dashboard renders a number, and the number is wrong — no error, no 500, no
 * support ticket, and by the time anyone doubts it the decision has shipped.
 *
 * The id generator is written down here on purpose. `fnv1aHash % 100` reads
 * FNV-1a's low bits, which are its weakest, so a distribution test over ids
 * nobody specified proves nothing about the ids the product actually mints —
 * and one seeded with `Math.random()` would flake, which is worse than absent.
 */

import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { authorizeSiteRequest } from "@/lib/security/site-auth";
import {
  bucketVisitorToVariant,
  fnv1aHash,
  type BucketableVariant,
} from "@/lib/ab-testing/bucketing";
import { createChain, mockServiceClient } from "./support/postgrest-chain";

jest.mock("@/lib/supabase/service");
jest.mock("@/lib/security/site-auth", () => {
  const actual = jest.requireActual("@/lib/security/site-auth");
  return {
    __esModule: true,
    ...actual,
    authorizeSiteRequest: jest.fn(),
  };
});

import { GET as getBucket } from "@/app/api/ab-tests/bucket/[siteId]/route";

const SITE_ID = "site-123";
const TEST_ID = "33333333-3333-3333-3333-333333333333";
const ASSIGNMENTS = 10000;
const TOLERANCE_PP = 2;

/**
 * xorshift128, seeded with the fractional-hex constants used as nothing-up-my-
 * sleeve numbers. Deterministic: the same 10,000 ids on every machine and every
 * run, so a failure here is a real failure and never a bad draw.
 */
function xorshift128(a: number, b: number, c: number, d: number) {
  let x = a >>> 0;
  let y = b >>> 0;
  let z = c >>> 0;
  let w = d >>> 0;
  return function next(): number {
    const t = (x ^ (x << 11)) >>> 0;
    x = y;
    y = z;
    z = w;
    w = (w ^ (w >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return w >>> 0;
  };
}

function hex(value: number, digits: number): string {
  return (value >>> 0).toString(16).padStart(8, "0").slice(0, digits);
}

/** v4-shaped, the shape `initVisitorId` mints via `crypto.randomUUID`. */
function uuidFrom(next: () => number): string {
  const a = next();
  const b = next();
  const c = next();
  const d = next();
  const e = next();
  const variant = "89ab"[next() % 4];
  return [
    hex(a, 8),
    hex(b, 4),
    `4${hex(b >>> 4, 3)}`,
    `${variant}${hex(c, 3)}`,
    `${hex(d, 6)}${hex(e, 6)}`,
  ].join("-");
}

function seededVisitorIds(count: number): string[] {
  const next = xorshift128(0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x85ebca6b);
  return Array.from({ length: count }, () => uuidFrom(next));
}

function sequentialVisitorIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `visitor-${i}`);
}

/** Same prefix, differing only in the tail — adjacent inputs, by construction. */
function patternedVisitorIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  );
}

function variantsFor(split: number[]): BucketableVariant[] {
  return split.map((traffic, index) => ({
    id: `${String.fromCharCode(97 + index).repeat(8)}-0000-0000-0000-00000000000${index}`,
    traffic_percentage: traffic,
    is_control: index === 0,
    geo_countries: null,
    geo_regions: null,
  }));
}

function observedShares(split: number[], visitorIds: string[]): number[] {
  const variants = variantsFor(split);
  const counts = new Map<string, number>(variants.map((v) => [v.id, 0]));

  for (const visitorId of visitorIds) {
    const assigned = bucketVisitorToVariant(visitorId, TEST_ID, variants);
    counts.set(assigned as string, (counts.get(assigned as string) ?? 0) + 1);
  }

  return variants.map(
    (v) => ((counts.get(v.id) ?? 0) / visitorIds.length) * 100,
  );
}

function expectWithinTolerance(split: number[], visitorIds: string[]) {
  const shares = observedShares(split, visitorIds);

  shares.forEach((share, index) => {
    expect(Math.abs(share - split[index])).toBeLessThanOrEqual(TOLERANCE_PP);
  });
}

/**
 * The splits the plan names, plus three it does not.
 *
 * 10/90, 5/95 and 33/33/34 are here because they are the ones that caught the
 * live defect: the shipped hash used a float64 multiply, and 50/50, 90/10 and
 * 34/33/33 all passed under it (worst 1.79 pp) while these three did not
 * (2.01, 2.06 and 2.01 pp). A ±2 pp suite that would have missed the bug it
 * exists to catch is not a suite.
 */
const SPLITS: number[][] = [
  [50, 50],
  [90, 10],
  [34, 33, 33],
  [10, 90],
  [5, 95],
  [33, 33, 34],
];

describe("A/B bucket distribution", () => {
  describe(`over ${ASSIGNMENTS} seeded v4-shaped visitor ids`, () => {
    const visitorIds = seededVisitorIds(ASSIGNMENTS);

    it.each(SPLITS)(
      "keeps every share within ±2 pp of a %s split",
      (...split: number[]) => {
        expectWithinTolerance(split, visitorIds);
      },
    );

    it("spreads the raw bucket number across all 100 buckets", () => {
      // The share tests can be passed by a hash that is badly clumped but
      // happens to clump on the right side of the split boundaries. This one
      // cannot: it reads the mapping itself. Under the float-multiply hash the
      // buckets ran 4..328 against an expected 100.
      const counts = new Array(100).fill(0);
      for (const visitorId of visitorIds) {
        counts[fnv1aHash(`${visitorId}:${TEST_ID}`) % 100] += 1;
      }

      const expected = ASSIGNMENTS / 100;
      expect(Math.min(...counts)).toBeGreaterThan(expected * 0.6);
      expect(Math.max(...counts)).toBeLessThan(expected * 1.4);
    });
  });

  describe(`over ${ASSIGNMENTS} sequential ids`, () => {
    const visitorIds = sequentialVisitorIds(ASSIGNMENTS);

    it.each(SPLITS)(
      "keeps every share within ±2 pp of a %s split",
      (...split: number[]) => {
        expectWithinTolerance(split, visitorIds);
      },
    );
  });

  describe(`over ${ASSIGNMENTS} patterned ids`, () => {
    const visitorIds = patternedVisitorIds(ASSIGNMENTS);

    it.each(SPLITS)(
      "keeps every share within ±2 pp of a %s split",
      (...split: number[]) => {
        expectWithinTolerance(split, visitorIds);
      },
    );
  });

  it("never draws on request-scoped entropy", () => {
    const variants = variantsFor([34, 33, 33]);
    const first = bucketVisitorToVariant("visitor-entropy", TEST_ID, variants);

    const random = jest.spyOn(Math, "random");
    const now = jest.spyOn(Date, "now");

    const second = bucketVisitorToVariant("visitor-entropy", TEST_ID, variants);

    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(second).toBe(first);

    random.mockRestore();
    now.mockRestore();
  });
});

describe("returning visitors", () => {
  const variants = variantsFor([34, 33, 33]);

  it("gets the same variant on a second page load", () => {
    const firstLoad = bucketVisitorToVariant(
      "visitor-return",
      TEST_ID,
      variants,
    );
    const secondLoad = bucketVisitorToVariant(
      "visitor-return",
      TEST_ID,
      variants,
    );

    expect(secondLoad).toBe(firstLoad);
  });

  it("gets the same variant after the variant rows are reordered", () => {
    const before = bucketVisitorToVariant("visitor-return", TEST_ID, variants);
    const after = bucketVisitorToVariant("visitor-return", TEST_ID, [
      variants[2],
      variants[0],
      variants[1],
    ]);

    expect(after).toBe(before);
  });

  it("keeps distinct tests independent for one visitor", () => {
    const other = "44444444-4444-4444-4444-444444444444";

    expect(bucketVisitorToVariant("visitor-return", TEST_ID, variants)).toBe(
      bucketVisitorToVariant("visitor-return", TEST_ID, variants),
    );
    expect(bucketVisitorToVariant("visitor-return", other, variants)).toBe(
      bucketVisitorToVariant("visitor-return", other, variants),
    );
  });

  describe("the persisted assignment", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (
        authorizeSiteRequest as jest.MockedFunction<typeof authorizeSiteRequest>
      ).mockResolvedValue({
        site: { id: SITE_ID, domain: "example.com", api_key: "key" },
        allowedOrigin: "https://example.com",
      });
    });

    function request(visitorId: string) {
      return getBucket(
        new NextRequest(
          `https://www.recopyfa.st/api/ab-tests/bucket/${SITE_ID}?token=t&visitor_id=${visitorId}`,
          { headers: { origin: "https://example.com" } },
        ),
        { params: Promise.resolve({ siteId: SITE_ID }) },
      );
    }

    it("beats a fresh hash, so a mid-test split change cannot move anyone", async () => {
      const visitorId = "visitor-persisted";
      const freshHash = bucketVisitorToVariant(visitorId, TEST_ID, variants);
      // Whatever the hash says today, the row says something else. Only a
      // read-back can produce this answer.
      const persisted = variants.find((v) => v.id !== freshHash)!.id;

      const buckets = createChain({
        result: {
          data: [{ test_id: TEST_ID, variant_id: persisted }],
          error: null,
        },
      });
      const tests = createChain({
        result: {
          data: [{ id: TEST_ID, ab_test_variants: variants }],
          error: null,
        },
      });
      mockServiceClient(createServiceRoleClient as unknown as jest.Mock, {
        visitor_buckets: buckets,
        ab_tests: tests,
      });

      const body = await (await request(visitorId)).json();

      expect(body.assignments[TEST_ID]).toBe(persisted);
      expect(body.assignments[TEST_ID]).not.toBe(freshHash);
      // Nothing to write: the visitor was already bucketed.
      expect(buckets.upsert).not.toHaveBeenCalled();
    });

    it("is written once and then honoured on the next page load", async () => {
      const visitorId = "visitor-first-time";

      const firstBuckets = createChain({ result: { data: [], error: null } });
      mockServiceClient(createServiceRoleClient as unknown as jest.Mock, {
        visitor_buckets: firstBuckets,
        ab_tests: createChain({
          result: {
            data: [{ id: TEST_ID, ab_test_variants: variants }],
            error: null,
          },
        }),
      });

      const firstLoad = await (await request(visitorId)).json();
      const assigned = firstLoad.assignments[TEST_ID];

      expect(firstBuckets.upsert).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            site_id: SITE_ID,
            visitor_id: visitorId,
            test_id: TEST_ID,
            variant_id: assigned,
          }),
        ],
        { onConflict: "visitor_id,test_id" },
      );

      // Second page load: the row now exists and the variants come back in a
      // different order, which used to be enough to move the visitor.
      const secondBuckets = createChain({
        result: {
          data: [{ test_id: TEST_ID, variant_id: assigned }],
          error: null,
        },
      });
      mockServiceClient(createServiceRoleClient as unknown as jest.Mock, {
        visitor_buckets: secondBuckets,
        ab_tests: createChain({
          result: {
            data: [{ id: TEST_ID, ab_test_variants: [...variants].reverse() }],
            error: null,
          },
        }),
      });

      const secondLoad = await (await request(visitorId)).json();

      expect(secondLoad.assignments[TEST_ID]).toBe(assigned);
    });
  });
});
