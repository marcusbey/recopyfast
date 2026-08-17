/**
 * Deterministic A/B bucketing: one visitor, one test, always the same variant.
 *
 * This lives in `lib/` rather than inside `api/ab-tests/bucket/[siteId]/route.ts`
 * for one reason: a Next route module may only export route handlers, so a
 * function defined there cannot be unit-tested at all. The ±2pp distribution
 * claim and the server/widget hash-parity claim are the two things this feature
 * has no other way of proving — a bucketing defect produces no error, no log
 * line and no 500, only numbers that are quietly wrong six weeks later — so the
 * function has to be reachable from a test.
 *
 * The widget carries a second implementation of `fnv1aHash` and of the
 * cumulative walk (`public/embed/recopyfast.src.js`, the A/B TESTING METHODS
 * block), because it must keep bucketing when the endpoint is unreachable. The
 * two are held equal by `src/__tests__/embed/ab-bucketing-parity.test.ts`,
 * which slices the shipped widget source and runs both against shared vectors.
 * If you change anything here, that test is the one that tells you the widget
 * no longer agrees.
 */

export interface BucketableVariant {
  id: string;
  traffic_percentage: number;
  is_control: boolean;
  geo_countries: string[] | null;
  geo_regions: string[] | null;
}

/**
 * FNV-1a, 32-bit. Mirrored in the widget; keep the two behaviourally identical.
 *
 * `Math.imul`, not `*`. Both copies of this function used to read
 * `hash = (hash * 16777619) >>> 0`, which is a float64 multiply: the product of
 * a 32-bit hash and the FNV prime reaches ~7.2e16, well past 2^53, so the
 * result is rounded before `>>> 0` ever looks at it — and rounding at that
 * magnitude zeroes the low bits, which are exactly the bits `% 100` then reads.
 *
 * Measured over 10,000 seeded v4-shaped visitor ids: the low three bits came
 * back 57% zeros (5698/10000 against an expected ~1250), per-bucket counts
 * ranged 4 to 328 where ~100 was expected, and the configured split missed by
 * more than the story's ±2 pp allowance on real configurations — 10/90 by
 * 2.01 pp, 5/95 by 2.06 pp, 33/33/34 by 2.01 pp. With `Math.imul` the same
 * 10,000 ids land within 0.56 pp on every split tested.
 *
 * It is worth being precise about the failure this repaired, because it is the
 * one the whole story exists to prevent: nothing errored. Traffic was split,
 * events were recorded, a dashboard would have shown a number, and the number
 * was wrong. See src/__tests__/api/ab-tests/bucket-distribution.test.ts.
 */
export function fnv1aHash(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Control first, then id ascending — a total order over the variant list.
 *
 * The cumulative walk below maps a bucket number onto whichever variant the
 * running total reaches first, so the answer is a function of the list's order.
 * The queries now ask PostgREST for this same order, but Postgres promises
 * nothing without an ORDER BY and a payload can be reshaped by anything between
 * here and there, so the walk sorts for itself rather than trusting it. Get
 * this wrong and a returning visitor is reassigned mid-test with nothing
 * anywhere reporting it.
 */
export function orderVariantsForBucketing<
  T extends { id: string; is_control: boolean },
>(variants: readonly T[]): T[] {
  return [...variants].sort((a, b) => {
    const controlFirst =
      Number(Boolean(b.is_control)) - Number(Boolean(a.is_control));
    if (controlFirst !== 0) return controlFirst;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}

export function bucketVisitorToVariant(
  visitorId: string,
  testId: string,
  variants: readonly BucketableVariant[],
  geoCountry?: string | null,
  geoRegion?: string | null,
): string | null {
  // Filter variants by geo eligibility
  const eligible = orderVariantsForBucketing(variants).filter((v) => {
    if (v.geo_countries && v.geo_countries.length > 0 && geoCountry) {
      if (!v.geo_countries.includes(geoCountry)) return false;
    }
    if (v.geo_regions && v.geo_regions.length > 0 && geoRegion) {
      if (!v.geo_regions.includes(geoRegion)) return false;
    }
    return true;
  });

  if (eligible.length === 0) return null;

  // Deterministic bucket 0-99
  const bucket = fnv1aHash(`${visitorId}:${testId}`) % 100;

  // Map to variant by cumulative traffic percentage
  let cumulative = 0;
  for (const variant of eligible) {
    cumulative += variant.traffic_percentage;
    if (bucket < cumulative) {
      return variant.id;
    }
  }

  // Fallback to last eligible variant
  return eligible[eligible.length - 1].id;
}
