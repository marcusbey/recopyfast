/**
 * @jest-environment node
 */
import { buildGuideLighthouseUrls } from "../lighthouse";
import { guideList } from "../guides";

describe("buildGuideLighthouseUrls (s123)", () => {
  it("measures /guides and the first registry guide, on the given origin", () => {
    expect(buildGuideLighthouseUrls("http://127.0.0.1:4175/ignored")).toEqual([
      "http://127.0.0.1:4175/guides",
      `http://127.0.0.1:4175/guides/${guideList[0]?.slug}`,
    ]);
  });

  it("refuses an empty registry instead of measuring a 404", () => {
    expect(() => buildGuideLighthouseUrls("http://127.0.0.1:4175", [])).toThrow(
      /empty/,
    );
  });
});
