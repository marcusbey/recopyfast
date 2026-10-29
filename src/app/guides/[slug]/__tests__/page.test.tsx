import { render } from "@testing-library/react";
import { notFound } from "next/navigation";
import GuideRoute, {
  dynamicParams,
  generateMetadata,
  generateStaticParams,
} from "../page";
import * as routeModule from "../page";
import { GuidePage } from "@/components/guides/GuidePage";
import { createGuideMetadata } from "@/lib/guides/guide-registry";
import { guideList } from "@/lib/guides/guides";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

jest.mock("@/components/guides/GuidePage", () => ({
  GuidePage: jest.fn(() => null),
}));

const mockedGuidePage = jest.mocked(GuidePage);
const mockedNotFound = jest.mocked(notFound);

describe("dynamic guide route (s123)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("generates every registry slug and nothing else, statically", () => {
    expect(generateStaticParams()).toEqual(
      guideList.map((guide) => ({ slug: guide.slug })),
    );
    expect(dynamicParams).toBe(false);
    // No revalidate: a guide reads no data, so the build prerenders it once.
    expect("revalidate" in routeModule).toBe(false);
  });

  it.each(guideList)("renders $slug with its metadata", async (guide) => {
    const params = Promise.resolve({ slug: guide.slug });

    expect(await generateMetadata({ params })).toEqual(
      createGuideMetadata(guide),
    );
    render(await GuideRoute({ params }));
    expect(mockedGuidePage).toHaveBeenCalledWith({ guide }, undefined);
  });

  it.each(["missing", "__proto__", "../compare", "UPDATE-WEBSITE-HOURS"])(
    "returns notFound for hostile or unknown slug %s",
    async (slug) => {
      const params = Promise.resolve({ slug });

      await expect(GuideRoute({ params })).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(generateMetadata({ params })).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
      expect(mockedNotFound).toHaveBeenCalled();
      expect(mockedGuidePage).not.toHaveBeenCalled();
    },
  );
});
