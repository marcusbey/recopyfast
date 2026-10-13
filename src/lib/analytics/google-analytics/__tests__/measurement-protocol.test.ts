/** @jest-environment node */
import {
  buildSignupPayload,
  sendSignupMeasurement,
} from "../measurement-protocol";

const now = Date.parse("2026-10-12T12:00:00Z");
const source = { clientId: "123.456", occurredAt: now - 1000 };
const config = {
  enabled: "1",
  environment: "production",
  measurementId: "G-DQ00NEM3WE",
  apiSecret: "dummy-only",
};

describe("consented signup Measurement Protocol transport", () => {
  const fetcher = jest.fn();
  beforeEach(() => fetcher.mockReset());

  test("constructs a fixed privacy allowlist without copying identity or private fields", () => {
    const input = {
      ...source,
      email: "private@example.invalid",
      user_id: "private",
      page_location: "https://example.invalid/auth?token=private",
      sessionId: "123",
    };
    expect(buildSignupPayload(input, now)).toEqual({
      client_id: "123.456",
      timestamp_micros: (now - 1000) * 1000,
      consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
      validation_behavior: "ENFORCE_RECOMMENDATIONS",
      events: [{ name: "sign_up", params: { method: "email" } }],
    });
  });
  test.each(["", "abc", "1.2\n", "1.2.3"])(
    "rejects invalid client ID %p",
    (clientId) =>
      expect(buildSignupPayload({ ...source, clientId }, now)).toBeNull(),
  );
  test.each([NaN, Infinity, now + 1, now - 72 * 60 * 60 * 1000 - 1, 1.5])(
    "rejects invalid or expired occurrence %p",
    (occurredAt) =>
      expect(buildSignupPayload({ ...source, occurredAt }, now)).toBeNull(),
  );
  test("does not invent a fresh time for a 72-hour-old event", () =>
    expect(
      buildSignupPayload(
        { ...source, occurredAt: now - 72 * 60 * 60 * 1000 },
        now,
      )?.timestamp_micros,
    ).toBe((now - 72 * 60 * 60 * 1000) * 1000));
  test.each([
    { enabled: undefined },
    { enabled: "true" },
    { environment: "preview" },
    { environment: "development" },
    { environment: undefined },
    { measurementId: "G-JHTG44WQ5W" },
    { measurementId: undefined },
    { apiSecret: undefined },
    { apiSecret: "" },
  ])("fails closed for unavailable configuration %p", async (override) => {
    expect(
      await sendSignupMeasurement(source, {
        config: { ...config, ...override },
        fetcher,
        now,
      }),
    ).toEqual({ state: "disabled" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  test("invalid source never makes a request", async () => {
    expect(
      await sendSignupMeasurement(
        { ...source, occurredAt: now + 1 },
        { config, fetcher, now },
      ),
    ).toEqual({ state: "invalid", code: "invalid_source" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  test("2xx means only accepted HTTP; fixed endpoint and no redirect", async () => {
    fetcher.mockResolvedValue({ ok: true, status: 204 });
    expect(
      await sendSignupMeasurement(source, { config, fetcher, now }),
    ).toEqual({ state: "accepted_http", code: "http_2xx" });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://www.google-analytics.com/mp/collect?measurement_id=G-DQ00NEM3WE&api_secret=dummy-only",
    );
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options.body)).toEqual(buildSignupPayload(source, now));
  });
  test.each([400, 429, 500])(
    "HTTP %i is uncertain and never automatically retried",
    async (status) => {
      fetcher.mockResolvedValue({ ok: false, status });
      expect(
        await sendSignupMeasurement(source, { config, fetcher, now }),
      ).toEqual({ state: "uncertain", code: "http_non_2xx" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  test("network exceptions cannot expose secret-bearing messages or cause retry", async () => {
    fetcher.mockRejectedValue(new Error("dummy-only provider secret URL"));
    expect(
      await sendSignupMeasurement(source, { config, fetcher, now }),
    ).toEqual({ state: "uncertain", code: "transport_error" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
