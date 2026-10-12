import type { Page } from "@playwright/test";

const CHECKOUT_RETURN_TIMEOUT_MS = 10 * 60_000;
const CHECKOUT_RETURN_POLL_INTERVAL_MS = 250;

interface HostedCheckoutReturnOptions {
  expectedAppOrigin: string;
  expectedCheckoutSessionId: string;
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

type CheckoutPage = Pick<Page, "isClosed" | "url" | "waitForTimeout">;

function fixedFailure(message: string): Error {
  return new Error(`Stripe-hosted Checkout ${message}.`);
}

function assertLoopbackOrigin(origin: string): string {
  const parsed = new URL(origin);
  const isLoopback =
    parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (!isLoopback || parsed.origin !== origin) {
    throw fixedFailure("requires an exact loopback application origin");
  }
  return parsed.origin;
}

function isStripeHostedUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"))
  );
}

function isExactOwnedSuccessReturn(
  url: URL,
  expectedAppOrigin: string,
  expectedCheckoutSessionId: string,
): boolean {
  const entries = [...url.searchParams.entries()];
  const checkoutValues = url.searchParams.getAll("checkout");
  const sessionValues = url.searchParams.getAll("session_id");
  return (
    url.origin === expectedAppOrigin &&
    url.pathname === "/dashboard/billing" &&
    url.hash === "" &&
    entries.length === 2 &&
    checkoutValues.length === 1 &&
    checkoutValues[0] === "success" &&
    sessionValues.length === 1 &&
    sessionValues[0] === expectedCheckoutSessionId
  );
}

async function waitForNextPoll(
  page: CheckoutPage,
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  try {
    if (!signal) {
      await page.waitForTimeout(milliseconds);
      return;
    }
    if (signal.aborted) {
      throw fixedFailure("human completion was interrupted");
    }

    let rejectAbort: ((error: Error) => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const onAbort = () =>
      rejectAbort?.(fixedFailure("human completion was interrupted"));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await Promise.race([page.waitForTimeout(milliseconds), interrupted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  } catch (error) {
    if (
      page.isClosed() ||
      (error instanceof Error &&
        /page.*closed|browser.*closed/i.test(error.message))
    ) {
      throw fixedFailure("page was closed before human completion");
    }
    throw error;
  }
}

/**
 * The 10 October provider run proved that Stripe's hosted payment DOM is not
 * an automation contract: private field and agent-steering selectors changed
 * while the supported success redirect remained stable. During the approved
 * human checkpoint, observe only the top-level return location. Card fields,
 * disclosure controls, Link markers and hosted text stay entirely outside the
 * harness; closing, interrupting or returning anywhere except the exact
 * loopback success route fails with an identity-free diagnostic.
 */
export async function waitForHostedCheckoutReturn(
  page: CheckoutPage,
  options: HostedCheckoutReturnOptions,
): Promise<void> {
  const expectedAppOrigin = assertLoopbackOrigin(options.expectedAppOrigin);
  if (!/^cs_test_[A-Za-z0-9]+$/.test(options.expectedCheckoutSessionId)) {
    throw fixedFailure("requires the exact owned test Checkout Session");
  }
  const timeoutMs = options.timeoutMs ?? CHECKOUT_RETURN_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? CHECKOUT_RETURN_POLL_INTERVAL_MS;
  const checks = Math.max(1, Math.ceil(timeoutMs / intervalMs) + 1);

  for (let check = 0; check < checks; check += 1) {
    if (options.signal?.aborted) {
      throw fixedFailure("human completion was interrupted");
    }
    if (page.isClosed()) {
      throw fixedFailure("page was closed before human completion");
    }

    const current = new URL(page.url());
    if (current.origin === expectedAppOrigin) {
      if (
        isExactOwnedSuccessReturn(
          current,
          expectedAppOrigin,
          options.expectedCheckoutSessionId,
        )
      ) {
        return;
      }
      throw fixedFailure("returned without the exact owned success contract");
    }
    if (!isStripeHostedUrl(current)) {
      throw fixedFailure("used an unexpected return origin");
    }

    if (check + 1 < checks) {
      await waitForNextPoll(page, intervalMs, options.signal);
    }
  }

  throw fixedFailure(
    "did not return to the application within the human completion window",
  );
}
