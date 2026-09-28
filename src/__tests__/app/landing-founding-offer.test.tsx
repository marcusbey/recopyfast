import React from "react";
import { renderToString } from "react-dom/server";
import { render, screen, waitFor } from "@testing-library/react";

// Everything on the page that does not name the founding offer is mocked out.
// Hero, Pricing and FinalCTA stay real: the claim under test is that the three
// of them read one count.
jest.mock("@/lib/hooks/useLenis", () => ({ useLenis: jest.fn() }));
jest.mock("next/dynamic", () => () => () => null);
jest.mock("@/components/layout/Header", () => ({ Header: () => null }));
jest.mock("@/components/layout/Footer", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/landing/HeroDemo", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/sections/ValueProposition", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/sections/HowItWorks", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/sections/Benefits", () => ({
  __esModule: true,
  default: () => null,
}));

import Home from "@/app/page";

/**
 * s47b — the landing page names the founding offer in three places: the hero
 * pill, the pricing card, and both trust rows. They are fed by one request, so
 * they cannot disagree; loading promises neither the offer nor the trial; and
 * every way the count can fail lands on the 14-day trial, never on a number.
 */

type OfferAnswer = () => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const OFFER_URL = "/api/offers/founding";

function mockFetch(offer: OfferAnswer): jest.Mock {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/pricing") return json({ plans: [], oneTimeProducts: [] });
    if (url === OFFER_URL) return offer();
    throw new Error(`Unexpected request to ${url}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function offerCalls(fetchMock: jest.Mock): number {
  return fetchMock.mock.calls.filter(([input]) => String(input) === OFFER_URL)
    .length;
}

const NEVER: OfferAnswer = () => new Promise<Response>(() => {});

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("landing page founding offer", () => {
  it("asks for the count once, and the three places agree", async () => {
    const fetchMock = mockFetch(async () =>
      json({ limit: 20, remaining: 17, soldOut: false }),
    );

    const { container } = render(<Home />);

    const counts = await screen.findAllByText("17 of 20 spots left");
    expect(counts).toHaveLength(2);
    expect(container.querySelector("#hero")).toContainElement(counts[0]);
    expect(container.querySelector("#pricing")).toContainElement(counts[1]);
    expect(screen.getAllByText("3 months free for the first 20")).toHaveLength(
      2,
    );
    expect(offerCalls(fetchMock)).toBe(1);
  });

  it("shows neither promise while the count loads", async () => {
    mockFetch(NEVER);
    const promises = /14 days of Pro|14-day free trial|3 months|spots left/;

    // The server's first paint: no effect has run, so this is what a visitor
    // sees before hydration. It must already be the loading state.
    const html = renderToString(<Home />);
    expect(html).toMatch(
      /<div aria-hidden="true" class="glass [^"]*animate-pulse/,
    );
    expect(html).not.toMatch(promises);

    const { container } = render(<Home />);
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Loading pricing" }),
      ).not.toBeInTheDocument(),
    );

    expect(screen.getAllByText("Free trial")).toHaveLength(2);
    expect(container.textContent).not.toMatch(promises);
    expect(screen.queryByText("Claim your spot")).not.toBeInTheDocument();
  });

  it.each<[string, OfferAnswer]>([
    [
      "503",
      async () =>
        json({ error: "Founding offer availability is unavailable" }, 503),
    ],
    ["429", async () => json({ error: "Too many requests" }, 429)],
    [
      "a network error",
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ],
    [
      "an out-of-bounds body",
      async () => json({ limit: 20, remaining: 21, soldOut: false }),
    ],
    ["sold out", async () => json({ limit: 20, remaining: 0, soldOut: true })],
  ])(
    "falls back to the 14-day trial everywhere (%s)",
    async (_case, answer) => {
      mockFetch(answer);

      const { container } = render(<Home />);

      await waitFor(() =>
        expect(screen.getAllByText("14-day free trial")).toHaveLength(2),
      );
      expect(
        container.querySelector('#hero a[href="#pricing"]')?.textContent,
      ).toContain("Every new account gets 14 days of Pro, free");
      expect(screen.queryByText("Claim your spot")).not.toBeInTheDocument();
      expect(container.textContent).not.toMatch(/\d+ of \d+/);
    },
  );
});
