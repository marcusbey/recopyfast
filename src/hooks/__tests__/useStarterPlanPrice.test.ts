/**
 * @jest-environment node
 */
import { parseStarterPlanPrice } from "@/hooks/useStarterPlanPrice";

describe("parseStarterPlanPrice", () => {
  it("reads the Starter plan's monthly price and currency", () => {
    expect(
      parseStarterPlanPrice({
        plans: [
          { id: "pro", monthlyPrice: 19 },
          { id: "starter", monthlyPrice: 9, currency: "cad" },
        ],
      }),
    ).toEqual({ monthlyPrice: 9, currency: "CAD" });
  });

  it("defaults a missing or malformed currency to USD", () => {
    expect(
      parseStarterPlanPrice({
        plans: [{ id: "starter", monthlyPrice: 9, currency: "dollars" }],
      }),
    ).toEqual({ monthlyPrice: 9, currency: "USD" });
  });

  it.each([
    null,
    "<html>",
    {},
    { plans: "starter" },
    { plans: [{ id: "pro", monthlyPrice: 19 }] },
    { plans: [{ id: "starter", monthlyPrice: 0 }] },
    { plans: [{ id: "starter", monthlyPrice: "9" }] },
    { plans: [{ id: "starter", monthlyPrice: Number.NaN }] },
  ])("never invents a price from %j", (body) => {
    expect(parseStarterPlanPrice(body)).toBeNull();
  });
});
