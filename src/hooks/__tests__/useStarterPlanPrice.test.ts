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
          {
            id: "starter",
            monthlyPrice: 9,
            currency: "cad",
            limits: { websites: 1 },
          },
        ],
      }),
    ).toEqual({ monthlyPrice: 9, currency: "CAD", websites: 1 });
  });

  it("reads the websites limit, keeping the unlimited sentinel", () => {
    expect(
      parseStarterPlanPrice({
        plans: [{ id: "starter", monthlyPrice: 9, limits: { websites: -1 } }],
      })?.websites,
    ).toBe(-1);
  });

  it.each([
    undefined,
    null,
    {},
    { websites: 0 },
    { websites: "1" },
    { websites: 1.5 },
  ])("names no websites count from limits %j", (limits) => {
    expect(
      parseStarterPlanPrice({
        plans: [{ id: "starter", monthlyPrice: 9, limits }],
      }),
    ).toEqual({ monthlyPrice: 9, currency: "USD", websites: null });
  });

  it("defaults a missing or malformed currency to USD", () => {
    expect(
      parseStarterPlanPrice({
        plans: [{ id: "starter", monthlyPrice: 9, currency: "dollars" }],
      }),
    ).toEqual({ monthlyPrice: 9, currency: "USD", websites: null });
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
