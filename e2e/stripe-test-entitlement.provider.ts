import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type Stripe from "stripe";
import {
  createStripeProviderFixture,
  type StripeProviderFixture,
} from "./support/stripe-provider-fixture";
import {
  writeProviderFailureEvidence,
  type ProviderFailureStage,
} from "./support/stripe-provider-failure";
import {
  performHostedFieldAction,
  performOptionalHostedFieldAction,
  waitForHostedCheckoutReturn,
} from "./support/stripe-hosted-fields";
import { checkAiAgentDisclosure } from "./support/stripe-agent-disclosure";
import { settleProviderFlowForTeardown } from "./support/stripe-provider-teardown";

interface CheckoutResponse {
  sessionId?: string;
  url?: string;
}

interface CheckoutStatus {
  mode?: string;
  status?: string | null;
  paymentStatus?: string;
  reconciled?: boolean;
}

interface BillingEventRow {
  id: string;
  event_type: string;
  processed: boolean;
  stripe_event_id: string;
}

interface SafeEvidence {
  mode: "test";
  runId: string;
  runIndex: number;
  generatedAtUnix: number;
  checkout: {
    id: string;
    status: string;
    paymentStatus: string;
    reconciled: true;
  };
  customerId: string;
  subscription: {
    id: string;
    plan: "pro";
    priceId: string;
    status: string;
  };
  processedEvents: Array<{ id: string; type: string }>;
  entitlement: { kind: "plan"; planId: "pro" };
  replay: { eventId: string; duplicate: true };
  cleanup?: {
    authUserDeleted: true;
    customerDeleted: true;
    databaseRowsDeleted: true;
    subscriptionCanceled: true;
    immutableCheckoutAndEventHistoryRetained: true;
  };
}

interface ProviderRunState {
  runIndex: number;
  failureFile: string;
  failedStage: ProviderFailureStage;
  fixture?: StripeProviderFixture;
  fixturePromise?: Promise<StripeProviderFixture>;
  flowPromise?: Promise<void>;
  abortController: AbortController;
  page: Page;
  evidence?: SafeEvidence;
  hasPrimaryFailure: boolean;
}

const PROVIDER_FLOW_SETTLEMENT_TIMEOUT_MS = 10_000;

let activeRunState: ProviderRunState | undefined;

test.describe("Stripe test Checkout entitlement provider proof", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(5 * 60_000);

  test.afterEach(async ({}, testInfo) => {
    const state = activeRunState;
    if (!state) return;

    testInfo.setTimeout(PROVIDER_FLOW_SETTLEMENT_TIMEOUT_MS + 5_000);
    try {
      if (testInfo.status !== "passed" && !state.hasPrimaryFailure) {
        state.hasPrimaryFailure = true;
        writeProviderFailureEvidence(state.failureFile, {
          runIndex: state.runIndex,
          failedStage: state.failedStage,
          error:
            testInfo.error ??
            new Error(`Provider test ended with status ${testInfo.status}.`),
        });
      }

      const didSettle = state.flowPromise
        ? await settleProviderFlowForTeardown(state.flowPromise, {
            timeoutMs: PROVIDER_FLOW_SETTLEMENT_TIMEOUT_MS,
            abort: () => state.abortController.abort(),
            closePage: () => state.page.close({ runBeforeUnload: false }),
          })
        : true;
      if (didSettle && !state.fixture && state.fixturePromise) {
        state.fixture = await state.fixturePromise.catch(() => undefined);
      }

      // The Playwright worker is not a cleanup authority. In particular, it
      // must leave a Customer created just before a timed-out Checkout response
      // active so the process-external parent can discover it and prove its
      // metadata ownership before the first destructive provider call.
      if (didSettle && state.evidence && testInfo.status === "passed") {
        state.failedStage = "evidence:capture";
        writeSafeEvidence(state.evidence);
      }
    } finally {
      activeRunState = undefined;
    }
  });

  test("a genuine paid test subscription provisions one durable Pro entitlement and replays idempotently", async ({
    context,
    page,
  }) => {
    const runIndex = Number.parseInt(
      process.env.STRIPE_PROVIDER_RUN_INDEX ?? "1",
      10,
    );
    const runId = process.env.STRIPE_PROVIDER_RUN_ID;
    if (!runId) {
      throw new Error("STRIPE_PROVIDER_RUN_ID is required.");
    }
    const failureFile =
      process.env.STRIPE_PROVIDER_FAILURE_FILE ??
      "test-results/stripe-provider-failure.json";
    const state: ProviderRunState = {
      runIndex,
      failureFile,
      failedStage: "fixture:create",
      hasPrimaryFailure: false,
      abortController: new AbortController(),
      page,
    };
    activeRunState = state;

    const flowPromise = (async () => {
      try {
        const fixturePromise = createStripeProviderFixture(
          context,
          process.env,
          { signal: state.abortController.signal },
        );
        state.fixturePromise = fixturePromise;
        const fixture = await fixturePromise;
        state.fixture = fixture;
        state.failedStage = "baseline:entitlement";
        const initialEntitlement = await page.request.get(
          `${fixture.environment.appUrl}/api/billing/entitlement`,
        );
        expect(initialEntitlement.ok()).toBe(true);
        expect(await initialEntitlement.json()).toMatchObject({
          kind: "none",
          planId: null,
        });

        state.failedStage = "checkout:create";
        fixture.markCheckoutRequested();
        const checkoutResponse = await page.request.post(
          `${fixture.environment.appUrl}/api/billing/checkout`,
          {
            timeout: 15_000,
            data: {
              intent: "subscription",
              planId: "pro",
              billingPeriod: "monthly",
            },
          },
        );
        expect(checkoutResponse.ok()).toBe(true);
        const checkout = (await checkoutResponse.json()) as CheckoutResponse;
        expect(checkout.sessionId).toMatch(/^cs_test_/);
        expect(checkout.url).toMatch(/^https:\/\//);
        fixture.captured.checkoutSessionId = checkout.sessionId!;

        state.failedStage = "checkout:inspect-open";
        const openSession = await fixture.stripe.checkout.sessions.retrieve(
          checkout.sessionId!,
        );
        expect(openSession.livemode).toBe(false);
        expect(openSession.status).toBe("open");
        fixture.captured.stripeCustomerId =
          idOf(openSession.customer) ?? undefined;

        state.failedStage = "checkout:hosted-form";
        await completeHostedCheckout(page, checkout.url!);

        state.failedStage = "checkout:reconcile";
        await expect
          .poll(
            async () =>
              readCheckoutStatus(
                page,
                fixture.environment.appUrl,
                checkout.sessionId!,
              ),
            { timeout: 90_000, intervals: [500, 1_000, 2_000] },
          )
          .toMatchObject({
            mode: "subscription",
            status: "complete",
            paymentStatus: "paid",
            reconciled: true,
          });

        state.failedStage = "checkout:inspect-complete";
        const completedSession =
          await fixture.stripe.checkout.sessions.retrieve(checkout.sessionId!);
        const customerId = idOf(completedSession.customer);
        const subscriptionId = idOf(completedSession.subscription);
        expect(completedSession.livemode).toBe(false);
        expect(completedSession.status).toBe("complete");
        expect(completedSession.payment_status).toBe("paid");
        expect(customerId).toMatch(/^cus_/);
        expect(subscriptionId).toMatch(/^sub_/);
        fixture.captured.stripeCustomerId = customerId!;
        fixture.captured.stripeSubscriptionId = subscriptionId!;

        state.failedStage = "billing:durable-state";
        const durable = await waitForDurableBillingState(fixture);
        state.failedStage = "billing:provider-subscription";
        const providerSubscription =
          await fixture.stripe.subscriptions.retrieve(subscriptionId!);
        const providerPriceId = providerSubscription.items.data[0]?.price.id;
        expect(providerSubscription.livemode).toBe(false);
        expect(providerSubscription.status).toBe("active");
        expect(providerSubscription.customer).toBe(customerId);
        expect(providerPriceId).toBe(fixture.environment.priceId);

        expect(durable.customer.stripe_customer_id).toBe(customerId);
        expect(durable.subscriptions).toHaveLength(1);
        expect(durable.subscriptions[0]).toMatchObject({
          customer_id: durable.customer.id,
          plan: "pro",
          status: "active",
          stripe_subscription_id: subscriptionId,
        });
        expect(durable.subscriptions[0].current_period_start).toBeTruthy();
        expect(durable.subscriptions[0].current_period_end).toBeTruthy();

        state.failedStage = "billing:events";
        const genuineEvents = await Promise.all(
          durable.events.map(async (row) => ({
            provider: await fixture.stripe.events.retrieve(row.stripe_event_id),
            row,
          })),
        );
        expect(
          genuineEvents.some(
            ({ row }) => row.event_type === "customer.subscription.created",
          ),
        ).toBe(true);
        for (const { provider, row } of genuineEvents) {
          expect(row.processed).toBe(true);
          expect(row.stripe_event_id).toMatch(/^evt_/);
          expect(provider.id).toBe(row.stripe_event_id);
          expect(provider.livemode).toBe(false);
        }
        fixture.captured.stripeEventIds = durable.events.map(
          (row) => row.stripe_event_id,
        );

        state.failedStage = "billing:entitlement";
        const entitlementResponse = await page.request.get(
          `${fixture.environment.appUrl}/api/billing/entitlement`,
        );
        expect(entitlementResponse.ok()).toBe(true);
        const entitlement = (await entitlementResponse.json()) as {
          kind?: string;
          planId?: string;
          trial?: unknown;
        };
        expect(entitlement).toMatchObject({ kind: "plan", planId: "pro" });
        expect(entitlement).not.toHaveProperty("trial");

        state.failedStage = "billing:replay";
        const replayRow = durable.events.find(
          (row) => row.event_type === "customer.subscription.created",
        )!;
        const replayEvent = await fixture.stripe.events.retrieve(
          replayRow.stripe_event_id,
        );
        const replayResult = await replaySignedEvent(fixture, replayEvent);

        state.failedStage = "evidence:capture";
        await fixture.captureDatabaseRows();
        state.evidence = {
          mode: "test",
          runId,
          runIndex,
          generatedAtUnix: Math.floor(Date.now() / 1_000),
          checkout: {
            id: checkout.sessionId!,
            status: "complete",
            paymentStatus: "paid",
            reconciled: true,
          },
          customerId: customerId!,
          subscription: {
            id: subscriptionId!,
            plan: "pro",
            priceId: providerPriceId!,
            status: providerSubscription.status,
          },
          processedEvents: durable.events.map((row) => ({
            id: row.stripe_event_id,
            type: row.event_type,
          })),
          entitlement: { kind: "plan", planId: "pro" },
          replay: replayResult,
        };
      } catch (error) {
        state.hasPrimaryFailure = true;
        writeProviderFailureEvidence(failureFile, {
          runIndex,
          failedStage: state.failedStage,
          error,
        });
        throw error;
      }
    })();
    state.flowPromise = flowPromise;
    await flowPromise;
  });
});

function idOf(value: string | { id: string } | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

async function fillOptionalHostedField(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  await performOptionalHostedFieldAction(
    page,
    selector,
    (field, deadline) =>
      field.fill(value, { timeout: deadline.playwrightTimeoutMs() }),
    { retryDetachedAction: "idempotent-setter" },
  );
}

async function selectHostedBillingCountry(
  page: Page,
  countryCode: "US",
): Promise<void> {
  await performHostedFieldAction(
    page,
    'select[name="billingCountry"], select[name="country"]',
    async (native, deadline) => {
      await native.selectOption(countryCode, {
        timeout: deadline.playwrightTimeoutMs(),
      });
      await expect(native).toHaveValue(countryCode, {
        timeout: deadline.playwrightTimeoutMs(),
      });
    },
    { retryDetachedAction: "idempotent-setter" },
  );
}

async function completeHostedCheckout(page: Page, checkoutUrl: string) {
  await page.goto(checkoutUrl, { waitUntil: "domcontentloaded" });
  expect(new URL(page.url()).hostname).toMatch(/(^|\.)stripe\.com$/);

  // Stripe's public success test value is assembled in memory so no complete
  // card-shaped value is retained in source, logs, traces or reports.
  const cardNumber = "4242".repeat(4);
  const cardExpiry = ["12", "34"].join("");
  const cardCvc = ["1", "2", "3"].join("");
  await performHostedFieldAction(
    page,
    'input[name="cardNumber"]',
    (field, deadline) =>
      field.fill(cardNumber, { timeout: deadline.playwrightTimeoutMs() }),
    { retryDetachedAction: "idempotent-setter" },
  );
  await performHostedFieldAction(
    page,
    'input[name="cardExpiry"]',
    (field, deadline) =>
      field.fill(cardExpiry, { timeout: deadline.playwrightTimeoutMs() }),
    { retryDetachedAction: "idempotent-setter" },
  );
  await performHostedFieldAction(
    page,
    'input[name="cardCvc"]',
    (field, deadline) =>
      field.fill(cardCvc, { timeout: deadline.playwrightTimeoutMs() }),
    { retryDetachedAction: "idempotent-setter" },
  );
  await fillOptionalHostedField(page, 'input[name="billingName"]', "S25 Test");
  await selectHostedBillingCountry(page, "US");
  await checkAiAgentDisclosure(page);
  await performHostedFieldAction(
    page,
    'input[name="billingPostalCode"]',
    async (postalCode, deadline) => {
      await postalCode.fill("10001", {
        timeout: deadline.playwrightTimeoutMs(),
      });
      await expect(postalCode).toHaveValue("10001", {
        timeout: deadline.playwrightTimeoutMs(),
      });
    },
    { retryDetachedAction: "idempotent-setter" },
  );

  await page.locator('button[type="submit"]').last().click();
  await waitForHostedCheckoutReturn(page);
}

async function readCheckoutStatus(
  page: Page,
  appUrl: string,
  sessionId: string,
): Promise<CheckoutStatus | null> {
  const response = await page.request.get(
    `${appUrl}/api/billing/checkout?session_id=${encodeURIComponent(sessionId)}`,
  );
  if (!response.ok()) return null;
  return (await response.json()) as CheckoutStatus;
}

async function waitForDurableBillingState(fixture: StripeProviderFixture) {
  type DurableState = {
    customer: { id: string; stripe_customer_id: string };
    subscriptions: Array<{
      id: string;
      customer_id: string;
      stripe_subscription_id: string;
      plan: string;
      status: string;
      current_period_start: string | null;
      current_period_end: string | null;
    }>;
    events: BillingEventRow[];
  };

  const readState = async (): Promise<DurableState | null> => {
    const [customers, subscriptions, events] = await Promise.all([
      fixture.serviceClient
        .from("billing_customers")
        .select("id, stripe_customer_id")
        .eq("user_id", fixture.user.userId),
      fixture.serviceClient
        .from("billing_subscriptions")
        .select(
          "id, customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end",
        )
        .eq("user_id", fixture.user.userId),
      fixture.serviceClient
        .from("billing_events")
        .select("id, event_type, processed, stripe_event_id")
        .eq("user_id", fixture.user.userId),
    ]);
    for (const result of [customers, subscriptions, events]) {
      if (result.error) throw result.error;
    }

    const customerRows = customers.data ?? [];
    const subscriptionRows = subscriptions.data ?? [];
    const eventRows = (events.data ?? []) as BillingEventRow[];
    const processedTypes = new Set(
      eventRows
        .filter((row) => row.processed === true)
        .map((row) => row.event_type),
    );
    const isReady =
      customerRows.length === 1 &&
      subscriptionRows.length === 1 &&
      subscriptionRows[0].status === "active" &&
      processedTypes.has("customer.subscription.created") &&
      processedTypes.has("checkout.session.completed") &&
      processedTypes.has("invoice.payment_succeeded") &&
      eventRows.every((row) => row.processed === true);
    if (!isReady) return null;

    return {
      customer: customerRows[0] as DurableState["customer"],
      subscriptions: subscriptionRows as DurableState["subscriptions"],
      events: eventRows,
    };
  };

  await expect
    .poll(async () => Boolean(await readState()), {
      timeout: 90_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(true);

  const durable = await readState();
  if (!durable) throw new Error("Durable billing state was not captured.");
  return durable;
}

async function replaySignedEvent(
  fixture: StripeProviderFixture,
  event: Stripe.Event,
): Promise<{ eventId: string; duplicate: true }> {
  const payload = JSON.stringify(event);
  const signature = fixture.stripe.webhooks.generateTestHeaderString({
    payload,
    secret: fixture.environment.webhookSecret,
  });
  const response = await fetch(
    `${fixture.environment.appUrl}/api/webhooks/stripe`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      body: payload,
    },
  );
  expect(response.ok).toBe(true);
  expect(await response.json()).toMatchObject({ duplicate: true });

  const [subscriptions, events] = await Promise.all([
    fixture.serviceClient
      .from("billing_subscriptions")
      .select("id")
      .eq("user_id", fixture.user.userId),
    fixture.serviceClient
      .from("billing_events")
      .select("id")
      .eq("stripe_event_id", event.id),
  ]);
  if (subscriptions.error) throw subscriptions.error;
  if (events.error) throw events.error;
  expect(subscriptions.data).toHaveLength(1);
  expect(events.data).toHaveLength(1);

  return { eventId: event.id, duplicate: true };
}

function writeSafeEvidence(evidence: SafeEvidence): void {
  const output =
    process.env.STRIPE_PROVIDER_EVIDENCE_FILE ??
    "test-results/stripe-provider-evidence.json";
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
