import { ASSETS_BUCKET, buildAssetKey } from "../assets";

const SITE_ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

/** `sites/<siteId>/<yyyy>/<mm>/<32-hex>.<ext>` and nothing else. */
const KEY_PATTERN =
  /^sites\/[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f]{32}\.[a-z0-9]+$/;

describe("ASSETS_BUCKET", () => {
  it("names the bucket the health check probes", () => {
    // GET /api/health calls storage.getBucket("assets"). Renaming this constant
    // without renaming the bucket turns every upload into a 500 and leaves the
    // health check green, so the literal is pinned here on purpose.
    expect(ASSETS_BUCKET).toBe("assets");
  });
});

describe("buildAssetKey", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("produces the documented key shape", () => {
    expect(buildAssetKey(SITE_ID, "png")).toMatch(KEY_PATTERN);
  });

  it("namespaces the object under the owning site", () => {
    expect(buildAssetKey(SITE_ID, "png").startsWith(`sites/${SITE_ID}/`)).toBe(
      true,
    );
  });

  it("keeps two sites in separate prefixes", () => {
    const other = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

    expect(buildAssetKey(SITE_ID, "png")).toContain(`sites/${SITE_ID}/`);
    expect(buildAssetKey(other, "png")).toContain(`sites/${other}/`);
  });

  it("carries the supplied extension as the suffix", () => {
    expect(buildAssetKey(SITE_ID, "webp").endsWith(".webp")).toBe(true);
    expect(buildAssetKey(SITE_ID, "jpg").endsWith(".jpg")).toBe(true);
  });

  it("uses 128 bits of randomness for the object name", () => {
    const random = buildAssetKey(SITE_ID, "png")
      .split("/")
      .pop()
      ?.split(".")[0];

    expect(random).toMatch(/^[0-9a-f]{32}$/);
  });

  it("never reuses a key", () => {
    const keys = new Set(
      Array.from({ length: 500 }, () => buildAssetKey(SITE_ID, "png")),
    );

    expect(keys.size).toBe(500);
  });

  it("contains no caller-supplied filename and no traversal segments", () => {
    // The key is built from siteId + extension only; there is no parameter a
    // filename could enter through. This asserts that stays true.
    const key = buildAssetKey(SITE_ID, "png");

    expect(key).toMatch(KEY_PATTERN);
    expect(key).not.toContain("..");
    expect(key).not.toContain("\\");
    expect(key.split("/")).toHaveLength(5);
  });

  it("dates the prefix in UTC with a zero-padded month", () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-01-05T12:00:00Z"));

    expect(buildAssetKey(SITE_ID, "png")).toContain("/2024/01/");
  });

  it("rolls the prefix over on the UTC year boundary", () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-12-31T23:59:59Z"));

    expect(buildAssetKey(SITE_ID, "png")).toContain("/2024/12/");

    jest.setSystemTime(new Date("2025-01-01T00:00:00Z"));

    expect(buildAssetKey(SITE_ID, "png")).toContain("/2025/01/");
  });
});
