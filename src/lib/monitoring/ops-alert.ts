import { logger } from "./logger";

type AlertContext = Parameters<typeof logger.error>[2];
type AlertMetadata = Parameters<typeof logger.error>[3];

/**
 * Tell ops about something a person must act on — a customer billed for a
 * plan they own, a payment to refund by hand — with `message` as the Sentry
 * event itself.
 *
 * WHY NOT `logger.error(message, error)` — s82 review (m-4): given an `Error`,
 * the logger sends `Sentry.captureException(error)`, whose title is the
 * error's own text ("Stripe is down"), and the sentence saying what to do
 * reaches the stdout log only. Sentry is the one alarm when money is owed, so
 * the sentence has to be what it shows. Without an `Error` the logger sends
 * `Sentry.captureMessage(message, "error")`; the error rides in the metadata
 * (`cause`), which the logger attaches to the event as its `log_metadata`
 * context and writes to stdout.
 *
 * Ids only in `context` and `metadata`, as everywhere in billing logs.
 */
export function alertOps(
  message: string,
  error: unknown,
  context: AlertContext,
  metadata: AlertMetadata,
): void {
  logger.error(message, undefined, context, {
    ...metadata,
    cause: describeCause(error),
  });
}

/** What went wrong, as plain data the log and Sentry can both carry. */
function describeCause(
  error: unknown,
): { name?: string; message: string; stack?: string } | undefined {
  if (error === undefined) return undefined;
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
