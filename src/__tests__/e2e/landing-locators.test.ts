import type { Locator, Page } from "@playwright/test";
import { pricingSection } from "../../../e2e/support/landing-locators";

describe("pricingSection", () => {
  it("scopes the pricing id under the single semantic main landmark", () => {
    const pricing = {} as Locator;
    const main = { locator: jest.fn().mockReturnValue(pricing) };
    const page = {
      getByRole: jest.fn().mockReturnValue(main),
    } as unknown as Page;

    expect(pricingSection(page)).toBe(pricing);
    expect(page.getByRole).toHaveBeenCalledWith("main");
    expect(main.locator).toHaveBeenCalledWith("#pricing");
  });
});
