import { render } from "@testing-library/react";
import { notFound } from "next/navigation";
import ComparisonRoute, {
  generateMetadata,
  generateStaticParams,
  revalidate,
} from "../page";
import { ComparisonPage } from "@/components/compare/ComparisonPage";
import {
  comparisonList,
  createComparisonMetadata,
} from "@/lib/compare/comparisons";
import { loadComparisonPricing } from "@/lib/compare/comparison-pricing";
import { loadCatalogueOffers } from "@/lib/seo/catalogue-offers";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

jest.mock("@/components/compare/ComparisonPage", () => ({
  ComparisonPage: jest.fn(() => null),
}));

jest.mock("@/lib/compare/comparison-pricing", () => ({
  loadComparisonPricing: jest.fn(),
}));

jest.mock("@/lib/seo/catalogue-offers", () => ({
  loadCatalogueOffers: jest.fn(),
}));

const mockedComparisonPage = jest.mocked(ComparisonPage);
const mockedLoadPricing = jest.mocked(loadComparisonPricing);
const mockedLoadOffers = jest.mocked(loadCatalogueOffers);
const mockedNotFound = jest.mocked(notFound);

const pricing = { status: "disabled" } as const;
const offers = [
  {
    name: "Starter",
    price: 9,
    currency: "USD",
    url: "http://localhost:3000/#pricing",
  },
];

describe("dynamic comparison route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadPricing.mockResolvedValue(pricing);
    mockedLoadOffers.mockResolvedValue(offers);
  });

  it("generates every registry slug without a hand-maintained route list", () => {
    expect(generateStaticParams()).toEqual(
      comparisonList.map((comparison) => ({
        competitor: comparison.slug,
      })),
    );
    expect(revalidate).toBe(300);
  });

  it.each(comparisonList)(
    "renders $slug with its inherited data and metadata",
    async (comparison) => {
      const params = Promise.resolve({ competitor: comparison.slug });

      expect(await generateMetadata({ params })).toEqual(
        createComparisonMetadata(comparison),
      );

      render(await ComparisonRoute({ params }));
      expect(mockedLoadPricing).toHaveBeenCalledTimes(1);
      expect(mockedLoadOffers).toHaveBeenCalledWith("http://localhost:3000");
      expect(mockedComparisonPage).toHaveBeenCalledWith(
        { comparison, pricing, offers },
        undefined,
      );
    },
  );

  it.each(["missing", "__proto__", "../contentful", "CONTENTFUL"])(
    "returns notFound for hostile or unknown slug %s",
    async (competitor) => {
      const params = Promise.resolve({ competitor });

      await expect(ComparisonRoute({ params })).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
      await expect(generateMetadata({ params })).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
      expect(mockedNotFound).toHaveBeenCalled();
      expect(mockedLoadPricing).not.toHaveBeenCalled();
      expect(mockedLoadOffers).not.toHaveBeenCalled();
    },
  );
});
