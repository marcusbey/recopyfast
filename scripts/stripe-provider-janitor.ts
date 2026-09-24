import { createClient } from "@supabase/supabase-js";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import Stripe from "stripe";
import {
  CAPTURED_DATABASE_IDENTITIES,
  CAPTURED_DATABASE_TABLES,
  capturedCleanupDeliveries,
  type CapturedDatabaseRows,
  type CapturedFixtureIds,
} from "../e2e/support/stripe-provider-fixture";
import {
  assertStripeProviderEnvironment,
  assertStripeProviderPrice,
  type StripeProviderEnvironment,
} from "../e2e/support/stripe-provider-guard";
import {
  calculateJanitorMaxPasses,
  createJanitorStageTracker,
  createTerminalDeliveryLedger,
  paginateProviderList,
  reconcileUntilQuiescent,
} from "../e2e/support/stripe-provider-janitor";
import {
  assertOwnedCheckoutSession,
  assertOwnedCustomer,
  assertOwnedSubscription,
  cancelOwnedSubscription,
  deleteOwnedCustomer,
  expireOwnedCheckoutSession,
} from "../e2e/support/stripe-provider-ownership";

const QUIET_PASSES = 16;
const PASS_INTERVAL_MS = 2_000;
const TERMINAL_DELIVERY_ATTEMPTS = 20;
const TERMINAL_DELIVERY_INTERVAL_MS = 500;
const LIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);

let environment: StripeProviderEnvironment;
let supabase: ReturnType<typeof createClient>;
let stripe: Stripe;
let janitorStateFile: string;

const runId = required("STRIPE_PROVIDER_RUN_ID");
const authUserId = required("STRIPE_PROVIDER_AUTH_USER_ID");
const userEmail = required("STRIPE_PROVIDER_USER_EMAIL");
const startedAtUnix = Number.parseInt(
  required("STRIPE_PROVIDER_STARTED_AT_UNIX"),
  10,
);
if (!Number.isFinite(startedAtUnix)) {
  throw new Error("STRIPE_PROVIDER_STARTED_AT_UNIX must be an integer.");
}

const ownership = { authUserId, startedAtUnix };
const captured = emptyCaptured();
const candidateCustomerIds = new Set<string>();
const candidateSubscriptionIds = new Set<string>();
const ownedCheckoutSessionIds = new Set<string>();
const ownedCustomerIds = new Set<string>();
const ownedSubscriptionIds = new Set<string>();
const terminalCustomerIds = new Set<string>();
const expectedCustomerDeliveries = new Set<string>();
const expectedSubscriptionDeliveries = new Set<string>();
let terminalDeliveryLedger = createTerminalDeliveryLedger();
let hasOwnedAuthUser = false;
const janitorStage = createJanitorStageTracker();

void main().catch((error: unknown) => {
  process.stderr.write(
    `[stripe-provider janitor] ${janitorStage.diagnostic(error)}\n`,
  );
  process.exitCode = 1;
});

async function main(): Promise<void> {
  // This process is a separate cleanup authority, so it must earn access on
  // its own. Never rely on the runner or browser fixture having performed the
  // guard: either can be the process that timed out or was interrupted.
  environment = assertStripeProviderEnvironment(process.env);
  janitorStateFile = validateJanitorStatePath(
    required("STRIPE_PROVIDER_JANITOR_STATE_FILE"),
  );
  terminalDeliveryLedger = restoreTerminalDeliveryLedger();

  // Client construction is deliberately below the complete environment guard.
  supabase = createClient(
    environment.supabaseUrl,
    environment.supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  stripe = new Stripe(environment.secretKey, {
    apiVersion: "2025-07-30.basil",
  });

  const price = await janitorStage.run("stripe:retrieve:price", () =>
    stripe.prices.retrieve(environment.priceId),
  );
  assertStripeProviderPrice(price, environment.priceId);

  const minObservationMs = readMinObservationMs();
  const maxPasses = calculateJanitorMaxPasses({
    minObservationMs,
    intervalMs: PASS_INTERVAL_MS,
    quietPasses: QUIET_PASSES,
  });

  const result = await janitorStage.run("reconcile:quiescence", () =>
    reconcileUntilQuiescent(
      { reconcilePass, sleep },
      {
        maxPasses,
        quietPasses: QUIET_PASSES,
        intervalMs: PASS_INTERVAL_MS,
        minObservationMs,
      },
    ),
  );

  if (hasOwnedAuthUser) {
    const { error } = await janitorStage.run("auth:delete", () =>
      supabase.auth.admin.deleteUser(authUserId),
    );
    if (error && !/not found/i.test(error.message)) throw error;
    hasOwnedAuthUser = false;
  }
  const finalResult = await janitorStage.run("reconcile:final", reconcilePass);
  if (finalResult.mutableCount !== 0) {
    throw new Error(
      "Stripe provider janitor found residue after Auth deletion.",
    );
  }

  process.stdout.write(
    `[stripe-provider janitor] clean after ${result.passes} passes; ` +
      `auth_user=${hasOwnedAuthUser ? "present" : "absent"}\n`,
  );
}

function readMinObservationMs(): number {
  const raw = required("STRIPE_PROVIDER_MIN_OBSERVATION_MS");
  const milliseconds = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error(
      "STRIPE_PROVIDER_MIN_OBSERVATION_MS must be a non-negative integer.",
    );
  }
  return milliseconds;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the provider janitor.`);
  return value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validateJanitorStatePath(path: string): string {
  const resolved = resolve(path);
  const requiredPrefix = resolve(
    process.cwd(),
    "test-results/stripe-provider-janitor-state-run-",
  );
  if (!resolved.startsWith(requiredPrefix)) {
    throw new Error(
      "Stripe provider janitor state must use its exact test-results path.",
    );
  }
  return resolved;
}

function restoreTerminalDeliveryLedger() {
  if (!existsSync(janitorStateFile)) return createTerminalDeliveryLedger();
  const parsed = JSON.parse(readFileSync(janitorStateFile, "utf8")) as {
    mode?: unknown;
    runId?: unknown;
    authUserId?: unknown;
    startedAtUnix?: unknown;
    customerIds?: unknown;
    subscriptionIds?: unknown;
  };
  const validIds = (value: unknown, prefix: string): value is string[] =>
    Array.isArray(value) &&
    value.every((id) => typeof id === "string" && id.startsWith(prefix));
  if (
    parsed.mode !== "test" ||
    parsed.runId !== runId ||
    parsed.authUserId !== authUserId ||
    parsed.startedAtUnix !== startedAtUnix ||
    !validIds(parsed.customerIds, "cus_") ||
    !validIds(parsed.subscriptionIds, "sub_")
  ) {
    throw new Error(
      "Stripe provider janitor refused stale or mismatched delivery state.",
    );
  }
  return createTerminalDeliveryLedger({
    customerIds: parsed.customerIds,
    subscriptionIds: parsed.subscriptionIds,
  });
}

function persistTerminalDeliveryLedger(): void {
  const snapshot = terminalDeliveryLedger.snapshot();
  mkdirSync(dirname(janitorStateFile), { recursive: true });
  writeFileSync(
    janitorStateFile,
    `${JSON.stringify(
      {
        mode: "test",
        runId,
        authUserId,
        startedAtUnix,
        customerIds: snapshot.customerIds,
        subscriptionIds: snapshot.subscriptionIds,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  chmodSync(janitorStateFile, 0o600);
}

function emptyCaptured(): CapturedFixtureIds {
  return {
    authUserId,
    checkoutSessionIds: [],
    stripeCustomerIds: [],
    stripeSubscriptionIds: [],
    stripeEventIds: [],
    databaseRows: CAPTURED_DATABASE_TABLES.reduce(
      (rows, table) => ({ ...rows, [table]: [] }),
      {} as CapturedDatabaseRows,
    ),
  };
}

async function reconcilePass(): Promise<{
  mutableCount: number;
  hadActivity: boolean;
}> {
  const activityBefore = activityFingerprint();
  let didMutate = false;
  await discoverAuthUser();
  await discoverDatabaseRows();
  const sessions = await discoverProviderObjects();

  for (const session of sessions) {
    if (session.status !== "open") continue;
    await janitorStage.run(`stripe:expire:checkout_session`, () =>
      expireOwnedCheckoutSession(
        session,
        ownership,
        providerOwnedCustomerRelationships(),
        (sessionId) => stripe.checkout.sessions.expire(sessionId),
      ),
    );
    didMutate = true;
  }

  for (const subscriptionId of ownedSubscriptionIds) {
    const subscription = await janitorStage.run(
      "stripe:retrieve:subscription",
      () => stripe.subscriptions.retrieve(subscriptionId),
    );
    assertOwnedSubscription(
      subscription,
      ownership,
      providerOwnedCustomerRelationships(),
    );
    expectedSubscriptionDeliveries.add(subscription.id);
    if (LIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
      await janitorStage.run("stripe:cancel:subscription", () =>
        cancelOwnedSubscription(
          subscription,
          ownership,
          providerOwnedCustomerRelationships(),
          (id) => stripe.subscriptions.cancel(id),
        ),
      );
      didMutate = true;
    }
  }

  for (const customerId of ownedCustomerIds) {
    const customer = await janitorStage.run("stripe:retrieve:customer", () =>
      stripe.customers.retrieve(customerId),
    );
    if (isDeletedCustomer(customer)) {
      ownedCustomerIds.delete(customer.id);
      terminalCustomerIds.add(customer.id);
      expectedCustomerDeliveries.add(customer.id);
      continue;
    }
    assertOwnedCustomer(customer, ownership);
    expectedCustomerDeliveries.add(customer.id);
    await janitorStage.run("stripe:delete:customer", () =>
      deleteOwnedCustomer(customer, ownership, (id) =>
        stripe.customers.del(id),
      ),
    );
    didMutate = true;
  }

  await waitForTerminalDeliveries();
  await discoverDatabaseRows();
  didMutate = (await deleteCapturedRows()) || didMutate;
  const mutableCount = await countMutableResidue();
  return {
    mutableCount,
    hadActivity: didMutate || activityBefore !== activityFingerprint(),
  };
}

function activityFingerprint(): string {
  const sorted = (values: Iterable<string>) => [...values].sort();
  const deliveries = terminalDeliveryLedger.snapshot();
  return JSON.stringify({
    hasOwnedAuthUser,
    candidateCustomerIds: sorted(candidateCustomerIds),
    candidateSubscriptionIds: sorted(candidateSubscriptionIds),
    ownedCheckoutSessionIds: sorted(ownedCheckoutSessionIds),
    ownedCustomerIds: sorted(ownedCustomerIds),
    ownedSubscriptionIds: sorted(ownedSubscriptionIds),
    terminalCustomerIds: sorted(terminalCustomerIds),
    expectedCustomerDeliveries: sorted(expectedCustomerDeliveries),
    expectedSubscriptionDeliveries: sorted(expectedSubscriptionDeliveries),
    deliveredCustomerIds: [...deliveries.customerIds].sort(),
    deliveredSubscriptionIds: [...deliveries.subscriptionIds].sort(),
    databaseRows: Object.fromEntries(
      CAPTURED_DATABASE_TABLES.map((table) => [
        table,
        [...captured.databaseRows[table]].sort(),
      ]),
    ),
  });
}

async function discoverAuthUser(): Promise<void> {
  const { data, error } = await janitorStage.run("auth:discover", () =>
    supabase.auth.admin.getUserById(authUserId),
  );
  if (error) {
    if (/not found/i.test(error.message)) {
      hasOwnedAuthUser = false;
      return;
    }
    throw error;
  }
  if (!data.user) {
    hasOwnedAuthUser = false;
    return;
  }
  if (
    data.user.email !== userEmail ||
    data.user.user_metadata?.provider_run_id !== runId
  ) {
    throw new Error(
      "Refusing local Auth cleanup because the pre-generated identity is not run-owned.",
    );
  }
  hasOwnedAuthUser = true;
}

async function discoverProviderObjects(): Promise<Stripe.Checkout.Session[]> {
  const allSessions = await janitorStage.run(
    "stripe:discover:checkout_sessions",
    () =>
      paginateProviderList((startingAfter) =>
        stripe.checkout.sessions.list({
          created: { gte: startedAtUnix },
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        }),
      ),
  );
  const candidateSessions = allSessions.filter(
    (session) =>
      session.client_reference_id === authUserId ||
      session.metadata?.user_id === authUserId,
  );

  for (const session of candidateSessions) {
    const customerId = referenceId(session.customer);
    const subscriptionId = referenceId(session.subscription);
    if (customerId) candidateCustomerIds.add(customerId);
    if (subscriptionId) candidateSubscriptionIds.add(subscriptionId);
  }

  const allCustomers = await janitorStage.run("stripe:discover:customers", () =>
    paginateProviderList((startingAfter) =>
      stripe.customers.list({
        created: { gte: startedAtUnix },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      }),
    ),
  );
  for (const customer of allCustomers) {
    if (customer.metadata?.user_id !== authUserId) continue;
    assertOwnedCustomer(customer, ownership);
    ownedCustomerIds.add(customer.id);
    expectedCustomerDeliveries.add(customer.id);
  }

  for (const customerId of candidateCustomerIds) {
    const customer = await janitorStage.run("stripe:retrieve:customer", () =>
      stripe.customers.retrieve(customerId),
    );
    if (isDeletedCustomer(customer)) {
      const linkedByOwnedSession = candidateSessions.some(
        (session) =>
          session.livemode === false &&
          session.created >= startedAtUnix &&
          session.client_reference_id === authUserId &&
          session.metadata?.user_id === authUserId &&
          referenceId(session.customer) === customer.id,
      );
      if (!linkedByOwnedSession) {
        throw new Error(
          "Refusing provider mutation because a deleted Customer candidate is not linked by provider truth.",
        );
      }
      ownedCustomerIds.delete(customer.id);
      terminalCustomerIds.add(customer.id);
      expectedCustomerDeliveries.add(customer.id);
      continue;
    }
    assertOwnedCustomer(customer, ownership);
    ownedCustomerIds.add(customer.id);
    expectedCustomerDeliveries.add(customer.id);
  }

  const relationshipCustomerIds = providerOwnedCustomerRelationships();
  const ownedSessions: Stripe.Checkout.Session[] = [];
  for (const listedSession of candidateSessions) {
    const session = await janitorStage.run(
      "stripe:retrieve:checkout_session",
      () => stripe.checkout.sessions.retrieve(listedSession.id),
    );
    assertOwnedCheckoutSession(session, ownership, relationshipCustomerIds);
    ownedCheckoutSessionIds.add(session.id);
    ownedSessions.push(session);
    const subscriptionId = referenceId(session.subscription);
    if (subscriptionId) candidateSubscriptionIds.add(subscriptionId);
  }

  for (const customerId of ownedCustomerIds) {
    const subscriptions = await janitorStage.run(
      "stripe:discover:subscriptions",
      () =>
        paginateProviderList((startingAfter) =>
          stripe.subscriptions.list({
            customer: customerId,
            status: "all",
            limit: 100,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
          }),
        ),
    );
    for (const subscription of subscriptions) {
      candidateSubscriptionIds.add(subscription.id);
    }
  }

  for (const subscriptionId of candidateSubscriptionIds) {
    const subscription = await janitorStage.run(
      "stripe:retrieve:subscription",
      () => stripe.subscriptions.retrieve(subscriptionId),
    );
    assertOwnedSubscription(
      subscription,
      ownership,
      providerOwnedCustomerRelationships(),
    );
    ownedSubscriptionIds.add(subscription.id);
    expectedSubscriptionDeliveries.add(subscription.id);
  }

  captured.checkoutSessionIds = [...ownedCheckoutSessionIds];
  captured.stripeCustomerIds = [
    ...new Set([...ownedCustomerIds, ...terminalCustomerIds]),
  ];
  captured.stripeSubscriptionIds = [...ownedSubscriptionIds];
  return ownedSessions;
}

function providerOwnedCustomerRelationships(): ReadonlySet<string> {
  return new Set([...ownedCustomerIds, ...terminalCustomerIds]);
}

async function discoverDatabaseRows(): Promise<void> {
  const customers = await rowsForUser(
    "billing_customers",
    "stripe_customer_id",
  );
  const subscriptions = await rowsForUser(
    "billing_subscriptions",
    "stripe_subscription_id",
  );
  recordRows("billing_customers", customers);
  recordRows("billing_subscriptions", subscriptions);
  for (const row of customers) {
    if (typeof row.stripe_customer_id === "string") {
      candidateCustomerIds.add(row.stripe_customer_id);
    }
  }
  for (const row of subscriptions) {
    if (typeof row.stripe_subscription_id === "string") {
      candidateSubscriptionIds.add(row.stripe_subscription_id);
    }
  }

  for (const table of [
    "billing_events",
    "plan_entitlements",
    "checkout_reservations",
  ] as const) {
    recordRows(table, await rowsForUser(table));
  }
  const customerRowIds = captured.databaseRows.billing_customers;
  if (customerRowIds.length > 0) {
    for (const table of [
      "billing_invoices",
      "billing_payment_methods",
    ] as const) {
      const { data, error } = await janitorStage.run(
        `database:discover:${table}`,
        () =>
          supabase
            .from(table)
            .select(CAPTURED_DATABASE_IDENTITIES[table])
            .in("customer_id", customerRowIds),
      );
      if (error) throw error;
      recordRows(table, data ?? []);
    }
  }
}

async function rowsForUser(
  table: keyof CapturedDatabaseRows,
  extraColumns = "",
): Promise<Array<Record<string, unknown>>> {
  const identity = CAPTURED_DATABASE_IDENTITIES[table];
  const columns = [identity, extraColumns].filter(Boolean).join(", ");
  const { data, error } = await janitorStage.run(
    `database:discover:${table}`,
    () => supabase.from(table).select(columns).eq("user_id", authUserId),
  );
  if (error) throw error;
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

function recordRows(table: keyof CapturedDatabaseRows, rows: object[]): void {
  const identity = CAPTURED_DATABASE_IDENTITIES[table];
  captured.databaseRows[table] = merge(
    captured.databaseRows[table],
    rows
      .map((row) => (row as Record<string, unknown>)[identity])
      .filter((id): id is string => typeof id === "string"),
  );
}

function referenceId(value: string | { id: string } | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function isDeletedCustomer(
  customer: Stripe.Customer | Stripe.DeletedCustomer,
): customer is Stripe.DeletedCustomer {
  return "deleted" in customer && customer.deleted === true;
}

function eventObjectId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const object = (data as { object?: unknown }).object;
  if (!object || typeof object !== "object") return null;
  const id = (object as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

async function waitForTerminalDeliveries(): Promise<void> {
  if (
    expectedSubscriptionDeliveries.size === 0 &&
    expectedCustomerDeliveries.size === 0
  ) {
    return;
  }

  const expected: CapturedFixtureIds = {
    ...emptyCaptured(),
    stripeSubscriptionIds: [...expectedSubscriptionDeliveries],
    stripeCustomerIds: [...expectedCustomerDeliveries],
  };
  for (let attempt = 0; attempt < TERMINAL_DELIVERY_ATTEMPTS; attempt += 1) {
    const { data, error } = await janitorStage.run(
      "database:discover:terminal_deliveries",
      () =>
        supabase
          .from("billing_events")
          .select("id, stripe_event_id, event_type, processed, data")
          .gte("created_at", new Date(startedAtUnix * 1000).toISOString())
          .in("event_type", [
            "customer.subscription.deleted",
            "customer.deleted",
          ]),
    );
    if (error) throw error;
    const rows = (data ?? []) as Parameters<
      typeof capturedCleanupDeliveries
    >[1];
    const matched = capturedCleanupDeliveries(expected, rows);
    recordRows("billing_events", matched);
    terminalDeliveryLedger.observe(
      matched.flatMap((row) => {
        const objectId = eventObjectId(row.data);
        if (
          !objectId ||
          (row.event_type !== "customer.deleted" &&
            row.event_type !== "customer.subscription.deleted")
        ) {
          return [];
        }
        return [{ eventType: row.event_type, objectId }];
      }),
    );
    persistTerminalDeliveryLedger();
    if (
      terminalDeliveryLedger.hasEvery(
        expectedCustomerDeliveries,
        expectedSubscriptionDeliveries,
      )
    ) {
      return;
    }
    await janitorStage.run("wait:terminal_deliveries", () =>
      sleep(TERMINAL_DELIVERY_INTERVAL_MS),
    );
  }
  throw new Error(
    "Stripe provider janitor did not observe every per-object terminal delivery.",
  );
}

async function deleteCapturedRows(): Promise<boolean> {
  let didDelete = false;
  for (const table of CAPTURED_DATABASE_TABLES) {
    const ids = captured.databaseRows[table];
    if (ids.length === 0) continue;
    const identity = CAPTURED_DATABASE_IDENTITIES[table];
    const { error } = await janitorStage.run(`database:delete:${table}`, () =>
      supabase.from(table).delete().in(identity, ids),
    );
    if (error) throw error;
    didDelete = true;
    captured.databaseRows[table] = [];
  }
  return didDelete;
}

async function countMutableResidue(): Promise<number> {
  let count = 0;
  for (const sessionId of ownedCheckoutSessionIds) {
    const session = await janitorStage.run(
      "stripe:assert:checkout_session",
      () => stripe.checkout.sessions.retrieve(sessionId),
    );
    if (session.status === "open") count += 1;
  }
  for (const subscriptionId of ownedSubscriptionIds) {
    const subscription = await janitorStage.run(
      "stripe:assert:subscription",
      () => stripe.subscriptions.retrieve(subscriptionId),
    );
    if (LIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) count += 1;
  }
  for (const customerId of ownedCustomerIds) {
    const customer = await janitorStage.run("stripe:assert:customer", () =>
      stripe.customers.retrieve(customerId),
    );
    if (!isDeletedCustomer(customer)) count += 1;
  }
  await discoverDatabaseRows();
  count += Object.values(captured.databaseRows).reduce(
    (total, ids) => total + ids.length,
    0,
  );
  return count;
}

function merge(current: string[], incoming: string[]): string[] {
  return [...new Set([...current, ...incoming])];
}
