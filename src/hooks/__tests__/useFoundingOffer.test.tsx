import { act, renderHook, waitFor } from "@testing-library/react";
import {
  parseFoundingOfferAvailability,
  toFoundingOfferView,
  useFoundingOffer,
} from "../useFoundingOffer";

/**
 * s47b — the landing page's founding-offer count.
 *
 * One request, reduced to three views. "loading" promises nothing, "open"
 * carries the count, and "closed" is sold out OR unknown: a failure must never
 * put a number on screen, and must never render differently from a sell-out.
 */

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("parseFoundingOfferAvailability", () => {
  it.each([
    { limit: 20, remaining: 17, soldOut: false },
    { limit: 20, remaining: 1, soldOut: false },
    { limit: 20, remaining: 0, soldOut: true },
    { limit: 30, remaining: 30, soldOut: false },
  ])("accepts %j", (body) => {
    expect(parseFoundingOfferAvailability(body)).toEqual(body);
  });

  it.each<[string, unknown]>([
    ["remaining above the limit", { limit: 20, remaining: 21, soldOut: false }],
    ["remaining below zero", { limit: 20, remaining: -1, soldOut: false }],
    ["a fractional remaining", { limit: 20, remaining: 1.5, soldOut: false }],
    ["a string remaining", { limit: 20, remaining: "17", soldOut: false }],
    ["a zero limit", { limit: 0, remaining: 0, soldOut: true }],
    ["a fractional limit", { limit: 2.5, remaining: 1, soldOut: false }],
    ["soldOut with spots left", { limit: 20, remaining: 3, soldOut: true }],
    ["not soldOut at zero", { limit: 20, remaining: 0, soldOut: false }],
    ["a string soldOut", { limit: 20, remaining: 17, soldOut: "false" }],
    ["a missing key", { limit: 20, remaining: 17 }],
    ["null", null],
    ["an array", []],
    ["a string", "x"],
    ["an error body", { error: "Founding offer availability is unavailable" }],
  ])("refuses %s", (_label, body) => {
    expect(parseFoundingOfferAvailability(body)).toBeNull();
  });
});

describe("toFoundingOfferView", () => {
  it("is loading while the request is in flight", () => {
    expect(
      toFoundingOfferView({ data: null, loading: true, error: null }),
    ).toEqual({ status: "loading" });
  });

  it("is open with the count while spots remain", () => {
    expect(
      toFoundingOfferView({
        data: { limit: 20, remaining: 17, soldOut: false },
        loading: false,
        error: null,
      }),
    ).toEqual({ status: "open", remaining: 17, limit: 20 });
  });

  it("is open on the last spot", () => {
    expect(
      toFoundingOfferView({
        data: { limit: 20, remaining: 1, soldOut: false },
        loading: false,
        error: null,
      }),
    ).toEqual({ status: "open", remaining: 1, limit: 20 });
  });

  it("is closed when sold out", () => {
    expect(
      toFoundingOfferView({
        data: { limit: 20, remaining: 0, soldOut: true },
        loading: false,
        error: null,
      }),
    ).toEqual({ status: "closed" });
  });

  it("is closed when the count could not be read", () => {
    expect(
      toFoundingOfferView({
        data: null,
        loading: false,
        error: "Could not load the founding offer count",
      }),
    ).toEqual({ status: "closed" });
  });

  it("a failure and a sell-out are the same view", () => {
    const failed = toFoundingOfferView({
      data: null,
      loading: false,
      error: "Could not load the founding offer count",
    });
    const soldOut = toFoundingOfferView({
      data: { limit: 20, remaining: 0, soldOut: true },
      loading: false,
      error: null,
    });

    expect(failed).toEqual(soldOut);
  });
});

describe("useFoundingOffer", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  it("is loading, with no data, on its first render", () => {
    global.fetch = jest.fn(
      () => new Promise<Response>(() => {}),
    ) as typeof fetch;
    const renders: Array<ReturnType<typeof useFoundingOffer>> = [];

    renderHook(() => {
      const state = useFoundingOffer();
      renders.push(state);
      return state;
    });

    // The first render is what the server paints. Anything but "loading" here
    // is a promise the hydrated page then takes back.
    expect(renders[0]).toMatchObject({
      data: null,
      loading: true,
      error: null,
    });
  });

  it("requests the count once, uncached", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        response({ limit: 20, remaining: 17, soldOut: false }),
      );
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useFoundingOffer());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/offers/founding",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reads a valid count", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        response({ limit: 20, remaining: 17, soldOut: false }),
      ) as typeof fetch;

    const { result } = renderHook(() => useFoundingOffer());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({
      limit: 20,
      remaining: 17,
      soldOut: false,
    });
    expect(result.current.error).toBeNull();
  });

  it.each<[string, () => Promise<Response>]>([
    [
      "a 503",
      async () =>
        response({ error: "Founding offer availability is unavailable" }, 503),
    ],
    ["a 429", async () => response({ error: "Too many requests" }, 429)],
    [
      "an out-of-bounds 200",
      async () => response({ limit: 20, remaining: 21, soldOut: false }),
    ],
    [
      "a body that will not parse",
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected token <");
          },
        }) as unknown as Response,
    ],
    [
      "a network error",
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("reports %s as an error, never a number", async (_label, answer) => {
    global.fetch = jest.fn(answer) as typeof fetch;

    const { result } = renderHook(() => useFoundingOffer());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toEqual(expect.any(String));
    expect(result.current.data).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it.each<[string, Response]>([
    ["a 503", response({ error: "late" }, 503)],
    ["a valid 200", response({ limit: 20, remaining: 17, soldOut: false })],
  ])("drops a response that lands after unmount (%s)", async (_label, late) => {
    const answer = pending<Response>();
    const fetchMock = jest.fn(() => answer.promise);
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result, unmount } = renderHook(() => useFoundingOffer());
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const before = result.current;
    unmount();

    expect(init.signal?.aborted).toBe(true);

    // A late 503 that still ran the error path would log. A late 200 runs the
    // success path to its end; React ignores a set on an unmounted tree, so
    // what this pins is that neither answer throws, logs or re-renders.
    await act(async () => {
      answer.resolve(late);
      await answer.promise;
      await new Promise((settle) => setTimeout(settle, 0));
    });

    expect(console.error).not.toHaveBeenCalled();
    expect(result.current).toBe(before);
  });
});
