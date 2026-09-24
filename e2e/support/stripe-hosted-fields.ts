import type { Frame, Locator, Page } from "@playwright/test";

export const HOSTED_FIELD_TIMEOUT_MS = 30_000;
const HOSTED_FIELD_POLL_INTERVAL_MS = 250;
const CHECKOUT_RETURN_TIMEOUT_MS = 90_000;

interface HostedFrameWaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

interface HostedFrameActionOptions extends HostedFrameWaitOptions {
  /** Only setters that are safe to repeat after a detached frame may opt in. */
  retryDetachedAction?: "idempotent-setter";
}

interface HostedFrameSnapshotOptions extends HostedFrameWaitOptions {
  exhaustedMessage: string;
}

export type HostedFrameDecision<T> =
  | { kind: "complete"; value: T }
  | { kind: "retry" };

export const completeHostedFrameSnapshot = <T>(
  value: T,
): HostedFrameDecision<T> => ({
  kind: "complete",
  value,
});
export const retryHostedFrameSnapshot: HostedFrameDecision<never> = {
  kind: "retry",
};

class HostedFrameDeadlineExpiredError extends Error {}

class NonRetryableHostedFrameActionError {
  constructor(readonly original: unknown) {}
}

export interface HostedFrameDeadline {
  remainingMs(): number;
  playwrightTimeoutMs(): number;
  cap(timeoutMs: number): HostedFrameDeadline;
}

function createHostedFrameDeadline(expiresAt: number): HostedFrameDeadline {
  return {
    remainingMs: () => Math.max(0, expiresAt - Date.now()),
    playwrightTimeoutMs: () => {
      const remainingMs = expiresAt - Date.now();
      // Playwright treats zero as "no timeout". Never turn an exhausted outer
      // deadline into an accidentally unbounded provider action.
      if (remainingMs <= 0) throw new HostedFrameDeadlineExpiredError();
      return remainingMs;
    },
    cap: (timeoutMs) =>
      createHostedFrameDeadline(
        Math.min(expiresAt, Date.now() + Math.max(0, timeoutMs)),
      ),
  };
}

function isDetachedFrameError(error: unknown): error is Error {
  return (
    error instanceof Error && /(?:^|: )Frame was detached$/.test(error.message)
  );
}

/**
 * A disclosure click or submit can change provider state before its frame
 * detaches. Preserve that exact failure instead of replaying a non-idempotent
 * action against a replacement frame.
 */
export async function performNonIdempotentHostedFrameAction<T>(
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (isDetachedFrameError(error)) {
      throw new NonRetryableHostedFrameActionError(error);
    }
    throw error;
  }
}

/**
 * Stripe replaces its hosted iframes during ordinary Checkout transitions. A
 * provider run first exposed that replacement during `locator.count()`, and a
 * later run detached the post-submit text scan. Treat every current frame set
 * as one snapshot: if inspection or an explicitly idempotent setter reports
 * Playwright's exact detached-frame error, discard every partial result and
 * spend the next existing caller check on a freshly acquired `page.frames()`
 * set. The caller's original bound is never restarted, non-idempotent actions
 * are never replayed, and a different browser/locator failure is never hidden.
 */
export async function runHostedFrameSnapshots<T>(
  page: Pick<Page, "frames" | "waitForTimeout">,
  inspect: (
    frames: Frame[],
    deadline: HostedFrameDeadline,
  ) => Promise<HostedFrameDecision<T>>,
  options: HostedFrameSnapshotOptions,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? HOSTED_FIELD_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? HOSTED_FIELD_POLL_INTERVAL_MS;
  const checks = Math.max(1, Math.ceil(timeoutMs / intervalMs) + 1);
  const deadline = createHostedFrameDeadline(Date.now() + timeoutMs);

  for (let check = 0; check < checks; check += 1) {
    if (check > 0 && deadline.remainingMs() <= 0) break;
    try {
      const decision = await inspect(page.frames(), deadline);
      if (decision.kind === "complete") return decision.value;
    } catch (error) {
      if (error instanceof NonRetryableHostedFrameActionError) {
        throw error.original;
      }
      if (error instanceof HostedFrameDeadlineExpiredError) break;
      if (!isDetachedFrameError(error)) throw error;
    }

    if (check + 1 < checks) {
      const remainingMs = deadline.remainingMs();
      if (remainingMs <= 0) break;
      await page.waitForTimeout(Math.min(intervalMs, remainingMs));
    }
  }

  throw new Error(options.exhaustedMessage);
}

async function performFieldAction<T>(
  page: Pick<Page, "frames" | "waitForTimeout">,
  selector: string,
  action: (field: Locator, deadline: HostedFrameDeadline) => Promise<T>,
  isOptional: boolean,
  options: HostedFrameActionOptions,
): Promise<T | null> {
  return runHostedFrameSnapshots(
    page,
    async (frames, deadline) => {
      for (const frame of frames) {
        const candidates = frame.locator(selector);
        deadline.playwrightTimeoutMs();
        const candidateCount = await candidates.count();
        for (let index = 0; index < candidateCount; index += 1) {
          const candidate = candidates.nth(index);
          if (
            !(await candidate.isVisible({
              timeout: deadline.playwrightTimeoutMs(),
            }))
          ) {
            continue;
          }
          try {
            return completeHostedFrameSnapshot(
              await action(candidate, deadline),
            );
          } catch (error) {
            if (
              isDetachedFrameError(error) &&
              options.retryDetachedAction !== "idempotent-setter"
            ) {
              throw new NonRetryableHostedFrameActionError(error);
            }
            throw error;
          }
        }
      }
      return isOptional
        ? completeHostedFrameSnapshot(null)
        : retryHostedFrameSnapshot;
    },
    {
      ...options,
      exhaustedMessage: isOptional
        ? `Stripe-hosted Checkout could not stably inspect optional field ${selector}.`
        : `Stripe-hosted Checkout did not render required field ${selector}.`,
    },
  );
}

export async function performHostedFieldAction<T>(
  page: Pick<Page, "frames" | "waitForTimeout">,
  selector: string,
  action: (field: Locator, deadline: HostedFrameDeadline) => Promise<T>,
  options: HostedFrameActionOptions = {},
): Promise<T> {
  return (await performFieldAction(
    page,
    selector,
    action,
    false,
    options,
  )) as T;
}

export async function performOptionalHostedFieldAction<T>(
  page: Pick<Page, "frames" | "waitForTimeout">,
  selector: string,
  action: (field: Locator, deadline: HostedFrameDeadline) => Promise<T>,
  options: HostedFrameActionOptions = {},
): Promise<T | null> {
  return performFieldAction(page, selector, action, true, options);
}

export async function waitForHostedCheckoutReturn(
  page: Pick<Page, "frames" | "url" | "waitForTimeout">,
  options: HostedFrameWaitOptions = {},
): Promise<void> {
  await runHostedFrameSnapshots(
    page,
    async (frames, deadline) => {
      if (
        page
          .url()
          .startsWith(
            "http://127.0.0.1:3000/dashboard/billing?checkout=success",
          )
      ) {
        return completeHostedFrameSnapshot(undefined);
      }

      let postalCodeIncompleteCount = 0;
      for (const frame of frames) {
        deadline.playwrightTimeoutMs();
        postalCodeIncompleteCount += await frame
          .getByText(/postal code incomplete/i)
          .count();
      }
      if (postalCodeIncompleteCount > 0) {
        throw new Error(
          "Stripe-hosted Checkout reported a postal code incomplete after explicit US selection.",
        );
      }
      return retryHostedFrameSnapshot;
    },
    {
      timeoutMs: options.timeoutMs ?? CHECKOUT_RETURN_TIMEOUT_MS,
      intervalMs: options.intervalMs ?? HOSTED_FIELD_POLL_INTERVAL_MS,
      exhaustedMessage:
        "Stripe-hosted Checkout did not return to the application.",
    },
  );
}
