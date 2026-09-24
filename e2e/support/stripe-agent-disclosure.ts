import type { Page } from "@playwright/test";
import {
  completeHostedFrameSnapshot,
  performNonIdempotentHostedFrameAction,
  retryHostedFrameSnapshot,
  runHostedFrameSnapshots,
} from "./stripe-hosted-fields";

const AI_AGENT_DISCLOSURE_TEXT =
  "I am an AI agent acting on behalf of someone else";
const DISCLOSURE_DISCOVERY_TIMEOUT_MS = 5_000;
const DISCLOSURE_ACTION_TIMEOUT_MS = 5_000;
const DISCLOSURE_POLL_INTERVAL_MS = 250;

interface DisclosureOptions {
  discoveryTimeoutMs?: number;
  actionTimeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * Stripe renders the disclosure as a visible label associated with a hidden
 * checkbox input. Calling `check()` on that input timed out after five minutes
 * because it lives outside the viewport. A later real provider run proved that
 * ordinary `click()` has the same trap: Playwright found the exact visible label,
 * but Stripe's nested scrollport still reported it outside its internal viewport.
 * Dispatch the label's DOM click event without the actionability gate, then verify
 * the associated hidden control changed state within a short independent bound.
 */
export async function checkAiAgentDisclosure(
  page: Pick<Page, "frames" | "waitForTimeout">,
  options: DisclosureOptions = {},
): Promise<void> {
  const discoveryTimeoutMs =
    options.discoveryTimeoutMs ?? DISCLOSURE_DISCOVERY_TIMEOUT_MS;
  const actionTimeoutMs =
    options.actionTimeoutMs ?? DISCLOSURE_ACTION_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DISCLOSURE_POLL_INTERVAL_MS;
  await runHostedFrameSnapshots(
    page,
    async (frames, deadline) => {
      for (const frame of frames) {
        const labels = frame.getByText(AI_AGENT_DISCLOSURE_TEXT, {
          exact: true,
        });
        const controls = frame.getByRole("checkbox", {
          name: AI_AGENT_DISCLOSURE_TEXT,
          exact: true,
        });
        deadline.playwrightTimeoutMs();
        if ((await labels.count()) === 0) {
          continue;
        }
        deadline.playwrightTimeoutMs();
        if ((await controls.count()) === 0) {
          continue;
        }

        const label = labels.first();
        const control = controls.first();
        if (
          !(await label.isVisible({
            timeout: deadline.playwrightTimeoutMs(),
          }))
        ) {
          continue;
        }
        if (
          await control.isChecked({ timeout: deadline.playwrightTimeoutMs() })
        ) {
          return completeHostedFrameSnapshot(undefined);
        }

        const actionDeadline = deadline.cap(actionTimeoutMs);
        await performNonIdempotentHostedFrameAction(async () => {
          await label.dispatchEvent("click", undefined, {
            timeout: actionDeadline.playwrightTimeoutMs(),
          });
          while (actionDeadline.remainingMs() > 0) {
            if (
              await control.isChecked({
                timeout: actionDeadline.playwrightTimeoutMs(),
              })
            ) {
              return;
            }
            const remainingMs = actionDeadline.remainingMs();
            if (remainingMs <= 0) break;
            await page.waitForTimeout(Math.min(100, remainingMs));
          }
          throw new Error(
            "Stripe-hosted Checkout AI-agent disclosure did not become checked.",
          );
        });
        return completeHostedFrameSnapshot(undefined);
      }
      return retryHostedFrameSnapshot;
    },
    {
      timeoutMs: discoveryTimeoutMs,
      intervalMs: pollIntervalMs,
      exhaustedMessage:
        "Stripe-hosted Checkout AI-agent disclosure control did not appear.",
    },
  );
}
