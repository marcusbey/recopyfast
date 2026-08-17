/**
 * The server and the widget each implement A/B bucketing, and they have to
 * agree. If they ever don't, the server hands variant A to a visitor, the
 * widget's offline fallback hands variant B to the same visitor on the next
 * page, both are recorded under one `visitor_id`, and six weeks later a
 * marketer ships the headline the arithmetic preferred. There is no error, no
 * log line and no support ticket in that story — only a decision drawn from
 * two different experiments averaged together.
 *
 * Today they agree by transcription. Nothing enforces it.
 *
 * THESE TESTS RUN THE SHIPPED WIDGET. `recopyfast.src.js` is a browser IIFE
 * that reads `document.currentScript` at parse time and cannot be imported, so
 * the A/B TESTING METHODS block is sliced out of the real file and evaluated as
 * a class body with its globals injected. A transcription of the hash into this
 * file would pass forever while the widget rotted; this cannot.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import vectors from "../fixtures/bucketing-vectors.json";
import {
  fnv1aHash as serverHash,
  bucketVisitorToVariant,
} from "@/lib/ab-testing/bucketing";

const WIDGET_SOURCE = path.join(
  process.cwd(),
  "public",
  "embed",
  "recopyfast.src.js",
);

const SECTION_BEGIN = "// A/B TESTING METHODS";
const SECTION_END = "// END A/B TESTING METHODS";

interface WidgetVariant {
  id: string;
  traffic_percentage: number;
  is_control: boolean;
  variant_content?: string;
  geo_countries?: string[] | null;
  geo_regions?: string[] | null;
}

interface WidgetTest {
  id: string;
  target_element_id?: string;
  variants: WidgetVariant[];
}

interface ABTestingBlock {
  visitorId: string | null;
  activeTests: WidgetTest[];
  variantAssignments: Record<string, string>;
  geoData: { country: string | null; region: string | null } | null;
  fnv1aHash(value: string): number;
  bucketVisitor(): Promise<void>;
  trackImpressions(): void;
}

interface BlockGlobals {
  fetch?: typeof fetch;
  navigator?: { sendBeacon?: (url: string, blob: Blob) => boolean };
}

/**
 * Slice the A/B block out of the shipped widget and hand back a constructor.
 *
 * The block is a run of class methods, not statements, so it is re-wrapped in a
 * class of its own. Every global it reads is passed in as a parameter, which
 * shadows the real one: the test controls the network, the API origin and the
 * credentials without touching the environment.
 */
function loadABTestingBlock(globals: BlockGlobals = {}): ABTestingBlock {
  const source = readFileSync(WIDGET_SOURCE, "utf8");
  const begin = source.indexOf(SECTION_BEGIN);
  const end = source.indexOf(SECTION_END);

  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `public/embed/recopyfast.src.js no longer contains the "${SECTION_BEGIN}" ` +
        `section ending at "${SECTION_END}", so the A/B methods cannot be ` +
        "extracted. Update this loader rather than transcribing them.",
    );
  }

  const block = source.slice(begin, end);
  const factory = new Function(
    "RECOPYFAST_API",
    "SITE_ID",
    "SITE_TOKEN",
    "fetch",
    "navigator",
    `class ABTestingBlock {\n${block}\n}\nreturn ABTestingBlock;`,
  );

  const Block = factory(
    "https://api.recopyfa.st",
    "site-123",
    "site-token",
    globals.fetch ?? (() => Promise.reject(new Error("offline"))),
    globals.navigator ?? { sendBeacon: () => true },
  ) as new () => ABTestingBlock;

  const instance = new Block();
  instance.visitorId = null;
  instance.activeTests = [];
  instance.variantAssignments = {};
  instance.geoData = null;
  return instance;
}

const CONTROL_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const VARIANT_B_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const VARIANT_C_ID = "cccccccc-0000-0000-0000-000000000003";
const TEST_ID = "33333333-3333-3333-3333-333333333333";

function threeVariants(): WidgetVariant[] {
  return [
    { id: CONTROL_ID, traffic_percentage: 34, is_control: true },
    { id: VARIANT_B_ID, traffic_percentage: 33, is_control: false },
    { id: VARIANT_C_ID, traffic_percentage: 33, is_control: false },
  ];
}

/** Run the widget's offline fallback for one visitor against one variant order. */
async function fallbackAssignment(
  visitorId: string,
  variants: WidgetVariant[],
): Promise<string | undefined> {
  const widget = loadABTestingBlock();
  widget.visitorId = visitorId;
  widget.activeTests = [{ id: TEST_ID, variants }];
  await widget.bucketVisitor();
  return widget.variantAssignments[TEST_ID];
}

describe("widget A/B bucketing", () => {
  describe("hash parity with the server", () => {
    it("agrees with the server hash on every shared vector", () => {
      const widget = loadABTestingBlock();

      expect(vectors.length).toBeGreaterThanOrEqual(64);

      for (const vector of vectors) {
        const input = `${vector.visitorId}:${vector.testId}`;

        // Three-way: the widget's hash, the server's hash, and the value
        // recorded in the fixture. Two agreeing implementations that have both
        // drifted is the failure this third leg exists to catch.
        expect(widget.fnv1aHash(input)).toBe(vector.expectedHash);
        expect(serverHash(input)).toBe(vector.expectedHash);
        expect(widget.fnv1aHash(input) % 100).toBe(vector.expectedBucket);
      }
    });
  });

  describe("fallback variant ordering", () => {
    it("assigns the same variant whatever order the variants arrive in", async () => {
      const variants = threeVariants();

      const inOrder = await fallbackAssignment("visitor-reorder", variants);
      const reversed = await fallbackAssignment(
        "visitor-reorder",
        [...variants].reverse(),
      );
      const shuffled = await fallbackAssignment("visitor-reorder", [
        variants[2],
        variants[0],
        variants[1],
      ]);

      expect(inOrder).toBeDefined();
      expect(reversed).toBe(inOrder);
      expect(shuffled).toBe(inOrder);
    });

    it("assigns the same variant on a second page load", async () => {
      // Two independent instances of the block, as two page loads are: the
      // visitor id is what carries across, nothing else.
      const first = await fallbackAssignment(
        "visitor-two-loads",
        threeVariants(),
      );
      const second = await fallbackAssignment(
        "visitor-two-loads",
        threeVariants(),
      );

      expect(first).toBeDefined();
      expect(second).toBe(first);
    });

    it("assigns what the server would assign, for the same visitor", async () => {
      const variants = threeVariants();
      const serverVariants = variants.map((v) => ({
        ...v,
        geo_countries: null,
        geo_regions: null,
      }));

      for (const visitorId of vectors.slice(0, 32).map((v) => v.visitorId)) {
        const fromWidget = await fallbackAssignment(visitorId, variants);
        const fromServer = bucketVisitorToVariant(
          visitorId,
          TEST_ID,
          serverVariants,
        );

        expect(fromWidget).toBe(fromServer);
      }
    });
  });

  /**
   * The one thing the widget's fallback cannot reproduce.
   *
   * `bucketVisitorToVariant` filters variants by geo *before* the cumulative
   * walk (`src/lib/ab-testing/bucketing.ts`), and it can, because the route
   * reads `x-vercel-ip-country` off the request. The widget has no country and
   * no region: geo reaches it only in the bucket response's `geo` field, and on
   * the fallback path that response never arrived. So on a geo-restricted test
   * the two paths are not two implementations of one algorithm — they are one
   * algorithm run on two different inputs, and the fallback's input is missing
   * the term that decides the answer.
   *
   * An unfiltered walk does not fail safe. It walks a *longer* list than the
   * server walked, so the same bucket number lands on a different variant: the
   * server serves A, the fallback serves B on the next page, and both are
   * recorded under one `visitor_id`. That is the exact failure this story
   * exists to prevent, and it produces no error anywhere.
   *
   * The fallback therefore declines to answer a question it cannot answer
   * correctly: no assignment, no variant applied, the visitor sees the page's
   * own copy. Nothing today writes `geo_countries` or `geo_regions` — no
   * creation path sets either column — so this is a guard against `s11b`, not a
   * live repair.
   */
  describe("geo-restricted variants", () => {
    const geoScoped = (): WidgetVariant[] => [
      {
        id: CONTROL_ID,
        traffic_percentage: 50,
        is_control: true,
        geo_countries: null,
        geo_regions: null,
      },
      {
        id: VARIANT_B_ID,
        traffic_percentage: 50,
        is_control: false,
        geo_countries: ["FR"],
        geo_regions: null,
      },
    ];

    const asServerVariants = (variants: WidgetVariant[]) =>
      variants.map((v) => ({
        ...v,
        geo_countries: v.geo_countries ?? null,
        geo_regions: v.geo_regions ?? null,
      }));

    it("assigns nothing rather than guessing at a geo it does not have", async () => {
      for (const visitorId of vectors.slice(0, 16).map((v) => v.visitorId)) {
        expect(
          await fallbackAssignment(visitorId, geoScoped()),
        ).toBeUndefined();
      }
    });

    it("declines because the server's answer genuinely depends on geo", () => {
      // Not prose: the same visitor, the same variants, two countries, two
      // answers. Whatever the fallback returned, it would be right for at most
      // one of them — and it cannot tell which.
      const serverVariants = asServerVariants(geoScoped());
      const divergent = vectors
        .slice(0, 64)
        .map((v) => v.visitorId)
        .filter(
          (visitorId) =>
            bucketVisitorToVariant(visitorId, TEST_ID, serverVariants, "FR") !==
            bucketVisitorToVariant(visitorId, TEST_ID, serverVariants, "US"),
        );

      expect(divergent.length).toBeGreaterThan(0);
    });

    it("treats an empty restriction list as no restriction, as the server does", async () => {
      const empty = geoScoped().map((v) => ({
        ...v,
        geo_countries: [],
        geo_regions: [],
      }));

      const fromWidget = await fallbackAssignment("visitor-empty-geo", empty);
      const fromServer = bucketVisitorToVariant(
        "visitor-empty-geo",
        TEST_ID,
        asServerVariants(empty),
        "US",
      );

      expect(fromWidget).toBe(fromServer);
    });

    it("still buckets when no variant is restricted", async () => {
      const unrestricted = threeVariants().map((v) => ({
        ...v,
        geo_countries: null,
        geo_regions: null,
      }));

      expect(
        await fallbackAssignment("visitor-no-geo", unrestricted),
      ).toBeDefined();
    });
  });

  /**
   * `bucketVisitor` only `return`ed inside `if (response.ok)`, so a 401 or a
   * 500 fell out of the `if`, skipped the `catch` entirely, and landed on the
   * client-side bucketing below it.
   *
   * A revoked token therefore kept splitting traffic while every `track` call
   * 401'd: the visitor saw a variant, nothing was recorded, and the population
   * that failed was not a random sample — it was every visitor on the site
   * whose credential had been revoked. The numbers that survived were skewed by
   * exactly the people missing from them.
   *
   * A refusal has to stop the A/B path. A dropped connection is a different
   * thing: the assignment is still ours to make, and the visitor is still shown
   * something, so the fallback stays — with one warning, so the failure is
   * visible to anyone looking.
   */
  describe("when the bucket endpoint refuses", () => {
    let consoleWarn: jest.SpyInstance;

    beforeEach(() => {
      consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarn.mockRestore();
    });

    function refusing(status: number) {
      return jest.fn(() =>
        Promise.resolve({
          ok: false,
          status,
          json: () => Promise.resolve({ error: "nope" }),
        }),
      ) as unknown as typeof fetch;
    }

    async function bucketAgainst(fetchImpl: typeof fetch) {
      const sendBeacon = jest.fn(() => true);
      const widget = loadABTestingBlock({
        fetch: fetchImpl,
        navigator: { sendBeacon },
      });
      widget.visitorId = "visitor-refused";
      widget.activeTests = [{ id: TEST_ID, variants: threeVariants() }];
      await widget.bucketVisitor();
      return { widget, sendBeacon };
    }

    it.each([401, 403, 500, 503])(
      "applies no variant after a %s",
      async (status) => {
        const { widget } = await bucketAgainst(refusing(status));

        expect(widget.variantAssignments).toEqual({});
        expect(widget.activeTests).toEqual([]);
      },
    );

    it("sends no event after a 401", async () => {
      const { widget, sendBeacon } = await bucketAgainst(refusing(401));

      widget.trackImpressions();

      expect(sendBeacon).not.toHaveBeenCalled();
    });

    it("keeps the fallback for a dropped connection, and says so once", async () => {
      const offline = jest.fn(() =>
        Promise.reject(new Error("network down")),
      ) as unknown as typeof fetch;

      const { widget } = await bucketAgainst(offline);

      expect(widget.variantAssignments[TEST_ID]).toBeDefined();
      expect(widget.activeTests).toHaveLength(1);
      expect(consoleWarn).toHaveBeenCalledTimes(1);
    });

    it("takes the server's answer when the endpoint answers", async () => {
      const ok = jest.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              assignments: { [TEST_ID]: VARIANT_C_ID },
              geo: { country: "FR", region: null },
            }),
        }),
      ) as unknown as typeof fetch;

      const { widget } = await bucketAgainst(ok);

      expect(widget.variantAssignments).toEqual({ [TEST_ID]: VARIANT_C_ID });
      expect(widget.activeTests).toHaveLength(1);
    });
  });
});
