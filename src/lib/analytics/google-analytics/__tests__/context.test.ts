import {
  captureAnalyticsContext,
  revokeAnalyticsContext,
  signOutAnalyticsContext,
} from "../context";
import { setAnalyticsActive } from "../gtag";

describe("consented attribution capture", () => {
  beforeEach(() => {
    document.cookie = "rcf_analytics_consent=granted; Path=/";
    setAnalyticsActive("G-TEST", true);
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    (window as unknown as { gtag: jest.Mock }).gtag = jest.fn(
      (_cmd, _id, field, callback) =>
        callback(field === "client_id" ? "123.456" : "123"),
    );
  });
  it("captures only validated client identity with no private URL/session guess", async () => {
    await captureAnalyticsContext("G-TEST");
    expect(fetch).toHaveBeenCalledWith(
      "/api/analytics/context",
      expect.objectContaining({
        body: JSON.stringify({ action: "capture", clientId: "123.456" }),
      }),
    );
  });
  it.each(["bad@email.test", "", "a".repeat(129), null])(
    "rejects invalid identity %s",
    async (value) => {
      (window as unknown as { gtag: jest.Mock }).gtag.mockImplementation(
        (_cmd, _id, _field, callback) => callback(value),
      );
      await captureAnalyticsContext("G-TEST");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("never captures after denial during the callback", async () => {
    (window as unknown as { gtag: jest.Mock }).gtag.mockImplementation(
      (_cmd, _id, _field, callback) => {
        document.cookie = "rcf_analytics_consent=denied; Path=/";
        callback("123.456");
      },
    );
    await captureAnalyticsContext("G-TEST");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not read identity on inactive documents", async () => {
    setAnalyticsActive("G-TEST", false);
    await captureAnalyticsContext("G-TEST");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("revocation failure never rejects and requests a bounded same-origin revoke", async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error("offline"));
    await expect(revokeAnalyticsContext()).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "/api/analytics/context",
      expect.objectContaining({
        body: JSON.stringify({ action: "revoke" }),
        keepalive: true,
      }),
    );
  });
});

describe("late callbacks and withdrawal retry", () => {
  beforeEach(() => {
    document.cookie = "rcf_analytics_pending=; Max-Age=0; Path=/";
    document.cookie = "rcf_analytics_consent=granted; Path=/";
    setAnalyticsActive("G-TEST", true);
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });
  it("times out a get callback and never sends its late result", async () => {
    jest.useFakeTimers();
    let callback: ((value: unknown) => void) | undefined;
    (window as unknown as { gtag: jest.Mock }).gtag = jest.fn(
      (_cmd, _id, _field, cb) => {
        callback = cb;
      },
    );
    const pending = captureAnalyticsContext("G-TEST");
    await jest.advanceTimersByTimeAsync(1001);
    await pending;
    callback?.("1.2");
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
  it("pending offline withdrawal blocks later capture until retry succeeds", async () => {
    document.cookie = "rcf_analytics_pending=revoke; Path=/";
    (fetch as jest.Mock).mockResolvedValue({ ok: false });
    await captureAnalyticsContext("G-TEST");
    expect(
      (fetch as jest.Mock).mock.calls.every(
        (call) => JSON.parse(call[1].body).action === "revoke",
      ),
    ).toBe(true);
    expect(document.cookie).toContain("rcf_analytics_pending=revoke");
  });
});

it("withdrawal waits for an in-flight first capture before erasing its returned capability", async () => {
  document.cookie = "rcf_analytics_pending=; Max-Age=0; Path=/";
  document.cookie = "rcf_analytics_consent=granted; Path=/";
  setAnalyticsActive("G-TEST", true);
  (window as unknown as { gtag: jest.Mock }).gtag = jest.fn(
    (_cmd, _id, _field, cb) => cb("1.2"),
  );
  let finish: ((value: { ok: boolean }) => void) | undefined;
  global.fetch = jest.fn().mockImplementation((_url, init) =>
    JSON.parse(init.body).action === "capture"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ ok: true }),
  );
  const capture = captureAnalyticsContext("G-TEST");
  await Promise.resolve();
  const revoke = revokeAnalyticsContext();
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(1);
  finish?.({ ok: true });
  await capture;
  await revoke;
  expect(
    (fetch as jest.Mock).mock.calls.map(
      (call) => JSON.parse(call[1].body).action,
    ),
  ).toEqual(["capture", "revoke"]);
});

it("a late Google get callback cannot recreate context after successful sign-out revocation", async () => {
  document.cookie = "rcf_analytics_pending=; Max-Age=0; Path=/";
  document.cookie = "rcf_analytics_consent=granted; Path=/";
  setAnalyticsActive("G-TEST", true);
  let callback: ((value: unknown) => void) | undefined;
  (window as unknown as { gtag: jest.Mock }).gtag = jest.fn(
    (_cmd, _id, _field, cb) => {
      callback = cb;
    },
  );
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  const capture = captureAnalyticsContext("G-TEST");
  await signOutAnalyticsContext();
  expect(document.cookie).not.toContain("rcf_analytics_pending=");
  callback?.("1.2");
  await capture;
  expect(
    (fetch as jest.Mock).mock.calls.map(
      (call) => JSON.parse(call[1].body).action,
    ),
  ).toEqual(["signout"]);
});

it("a capture waiting on older withdrawal cannot absorb a newer sign-out generation", async () => {
  document.cookie = "rcf_analytics_pending=revoke; Path=/";
  document.cookie = "rcf_analytics_consent=granted; Path=/";
  setAnalyticsActive("G-TEST", true);
  (window as unknown as { gtag: jest.Mock }).gtag = jest.fn(
    (_cmd, _id, _field, cb) => cb("1.2"),
  );
  let finish: ((value: { ok: boolean }) => void) | undefined;
  global.fetch = jest.fn().mockImplementation((_url, init) =>
    JSON.parse(init.body).action === "revoke"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ ok: true }),
  );
  const capture = captureAnalyticsContext("G-TEST");
  const signout = signOutAnalyticsContext();
  finish?.({ ok: true });
  await capture;
  await signout;
  expect(
    (fetch as jest.Mock).mock.calls.map(
      (call) => JSON.parse(call[1].body).action,
    ),
  ).toEqual(["revoke"]);
});
