/**
 * s47a — the founding offer's service-role RPC wrappers.
 *
 * The database decides every outcome (20260928120000_founding_offer.sql); these
 * wrappers only translate. What matters is that nothing unexpected is
 * translated into something plausible: an unknown outcome is not "claimed",
 * and a count outside the offer's own bounds is not a number to put on a page.
 */

const rpcMock = jest.fn();

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => ({ rpc: rpcMock })),
}));

import {
  FOUNDING_OFFER_ID,
  FOUNDING_OFFER_TERMS,
  claimFoundingOfferSpot,
  getFoundingOfferAvailability,
  isFoundingOfferId,
} from "@/lib/billing/founding-offer";

const USER = "user-1";

beforeEach(() => {
  rpcMock.mockReset();
});

describe("the offer's terms", () => {
  it("meters founding_20 at 100 AI credits a month", () => {
    expect(FOUNDING_OFFER_ID).toBe("founding_20");
    expect(FOUNDING_OFFER_TERMS.founding_20.monthlyCredits).toBe(100);
  });

  it("recognises only offer ids it has terms for", () => {
    expect(isFoundingOfferId("founding_20")).toBe(true);
    expect(isFoundingOfferId("founding_21")).toBe(false);
    expect(isFoundingOfferId("__proto__")).toBe(false);
    expect(isFoundingOfferId(null)).toBe(false);
  });
});

describe("claimFoundingOfferSpot", () => {
  it("sends only the user id and maps a claim", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          outcome: "claimed",
          entitlement_id: "grant-1",
          expires_at: "2026-12-27T10:00:00+00:00",
        },
      ],
      error: null,
    });

    await expect(claimFoundingOfferSpot(USER)).resolves.toEqual({
      outcome: "claimed",
      entitlementId: "grant-1",
      expiresAt: "2026-12-27T10:00:00+00:00",
    });
    expect(rpcMock).toHaveBeenCalledWith("claim_founding_offer_spot", {
      p_user_id: USER,
    });
  });

  it.each(["sold_out", "ineligible"])("maps %s", async (outcome) => {
    rpcMock.mockResolvedValue({
      data: [{ outcome, entitlement_id: null, expires_at: null }],
      error: null,
    });

    await expect(claimFoundingOfferSpot(USER)).resolves.toEqual({ outcome });
  });

  it("throws on an RPC error", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "function does not exist" },
    });

    await expect(claimFoundingOfferSpot(USER)).rejects.toThrow(
      /founding offer/i,
    );
  });

  it("throws when the RPC returns no row", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    await expect(claimFoundingOfferSpot(USER)).rejects.toThrow(/no row/);
  });

  it.each([
    [{ outcome: "reserved", entitlement_id: null, expires_at: null }],
    [{ outcome: "claimed", entitlement_id: null, expires_at: null }],
    [{ outcome: "claimed", entitlement_id: "grant-1", expires_at: 42 }],
  ])("throws on an outcome it does not recognise (%j)", async (row) => {
    rpcMock.mockResolvedValue({ data: [row], error: null });

    await expect(claimFoundingOfferSpot(USER)).rejects.toThrow(/invalid/);
  });
});

describe("getFoundingOfferAvailability", () => {
  it("maps a valid row", async () => {
    rpcMock.mockResolvedValue({
      data: [{ spot_limit: 20, claimed: 3, remaining: 17, sold_out: false }],
      error: null,
    });

    await expect(getFoundingOfferAvailability()).resolves.toEqual({
      limit: 20,
      remaining: 17,
      soldOut: false,
    });
    expect(rpcMock).toHaveBeenCalledWith("get_founding_offer_availability");
  });

  it("maps a sold-out row", async () => {
    rpcMock.mockResolvedValue({
      data: [{ spot_limit: 20, claimed: 20, remaining: 0, sold_out: true }],
      error: null,
    });

    await expect(getFoundingOfferAvailability()).resolves.toEqual({
      limit: 20,
      remaining: 0,
      soldOut: true,
    });
  });

  it("throws on an RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "down" } });

    await expect(getFoundingOfferAvailability()).rejects.toThrow(
      /founding offer/i,
    );
  });

  it("throws when the RPC returns no row", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    await expect(getFoundingOfferAvailability()).rejects.toThrow(/no row/);
  });

  it.each([
    [
      "remaining below zero",
      { spot_limit: 20, remaining: -1, sold_out: false },
    ],
    [
      "remaining above the limit",
      { spot_limit: 20, remaining: 21, sold_out: false },
    ],
    [
      "a fractional remaining",
      { spot_limit: 20, remaining: 1.5, sold_out: false },
    ],
    ["a null remaining", { spot_limit: 20, remaining: null, sold_out: false }],
    ["a string remaining", { spot_limit: 20, remaining: "5", sold_out: false }],
    [
      "a non-integer limit",
      { spot_limit: 20.5, remaining: 5, sold_out: false },
    ],
    ["a zero limit", { spot_limit: 0, remaining: 0, sold_out: true }],
    [
      "sold_out contradicting remaining",
      { spot_limit: 20, remaining: 0, sold_out: false },
    ],
    [
      "a non-boolean sold_out",
      { spot_limit: 20, remaining: 5, sold_out: "no" },
    ],
  ])("throws on %s", async (_label, row) => {
    rpcMock.mockResolvedValue({ data: [row], error: null });

    await expect(getFoundingOfferAvailability()).rejects.toThrow(/invalid/);
  });
});
