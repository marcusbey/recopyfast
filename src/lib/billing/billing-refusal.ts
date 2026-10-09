import { NextResponse } from "next/server";

/**
 * A billing refusal written for the customer: its message is safe to show and
 * its status is the HTTP answer.
 *
 * s82 (s69 L5): the subscription and payment-method routes answered every
 * failure with `error.message`, so whatever an exception carried reached the
 * page — Stripe's "No such customer: 'cus_…'", PostgREST's errors, and the
 * difference between "that card does not exist" and "that card is not yours".
 * Answering everything generically would have lost the sentences that were
 * written for the customer on purpose ("You are already on this plan", "No
 * active subscription found"), which the plan dialog and the card print.
 *
 * So the distinction is a type, not a message: only a `BillingRefusal` keeps
 * its words. Do not throw one around a provider's or a database's text, and do
 * not "simplify" the routes back to `error.message` — that is the leak.
 */
export class BillingRefusal extends Error {
  readonly status: 404 | 409;

  constructor(message: string, status: 404 | 409) {
    super(message);
    this.name = "BillingRefusal";
    this.status = status;
  }
}

/**
 * The response for anything a billing route caught: a `BillingRefusal` as
 * written, everything else as `fallbackMessage` with the detail logged here.
 */
export function billingErrorResponse(
  error: unknown,
  logContext: string,
  fallbackMessage: string,
): NextResponse {
  if (error instanceof BillingRefusal) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  console.error(`${logContext}:`, error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
