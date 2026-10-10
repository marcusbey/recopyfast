/**
 * @jest-environment node
 */

/**
 * s82 review (m-4): an alert that asks a person to act — "refund it by hand" —
 * must be the Sentry event's own message.
 *
 * `logger.error(message, error)` sends `Sentry.captureException(error)`, whose
 * title is the error's text ("Stripe is down"); the sentence saying what to do
 * reached the stdout log only. `alertOps` sends the sentence as the event and
 * carries the error in its metadata. The real logger runs here, in its
 * production branch, with Sentry mocked.
 */

const mockCaptureMessage = jest.fn();
const mockCaptureException = jest.fn();
const mockSetContext = jest.fn();

jest.mock("@sentry/nextjs", () => ({
  withScope: (callback: (scope: { setContext: jest.Mock }) => void) =>
    callback({ setContext: mockSetContext }),
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import { alertOps } from "@/lib/monitoring/ops-alert";

const SENTENCE =
  "Subscription sub_1 (pro) was cancelled, but its payment could not be refunded — refund it by hand.";

describe("alertOps", () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { ...env };

  beforeEach(() => {
    jest.clearAllMocks();
    env.NODE_ENV = "production";
    env.NEXT_PUBLIC_SENTRY_DSN = "https://public@sentry.example/1";
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    env.NODE_ENV = saved.NODE_ENV;
    env.NEXT_PUBLIC_SENTRY_DSN = saved.NEXT_PUBLIC_SENTRY_DSN;
    jest.restoreAllMocks();
  });

  it("makes the actionable sentence the Sentry event, at level error", () => {
    alertOps(
      SENTENCE,
      new Error("Stripe is down"),
      { userId: "user-1" },
      { component: "webhooks/stripe", subscriptionId: "sub_1" },
    );

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith(SENTENCE, "error");
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("carries the error, and the ids, in the event's context", () => {
    alertOps(
      SENTENCE,
      new Error("Stripe is down"),
      { userId: "user-1" },
      { component: "webhooks/stripe", subscriptionId: "sub_1" },
    );

    expect(mockSetContext).toHaveBeenCalledWith(
      "log_metadata",
      expect.objectContaining({
        component: "webhooks/stripe",
        subscriptionId: "sub_1",
        cause: expect.objectContaining({
          name: "Error",
          message: "Stripe is down",
        }),
      }),
    );
    expect(mockSetContext).toHaveBeenCalledWith("log_context", {
      userId: "user-1",
    });
  });

  it("describes a thrown value that is not an Error", () => {
    alertOps(SENTENCE, "connection reset", {}, {});

    expect(mockSetContext).toHaveBeenCalledWith(
      "log_metadata",
      expect.objectContaining({
        cause: { message: "connection reset" },
      }),
    );
    expect(mockCaptureMessage).toHaveBeenCalledWith(SENTENCE, "error");
  });
});
