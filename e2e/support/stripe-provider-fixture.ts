import { randomBytes, randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  assertStripeProviderEnvironment,
  assertStripeProviderPrice,
  type StripeProviderEnvironment,
} from "./stripe-provider-guard";
import {
  assertOwnedCustomer,
  cancelOwnedSubscription,
  deleteOwnedCustomer,
  expireOwnedCheckoutSession,
} from "./stripe-provider-ownership";

export const CAPTURED_DATABASE_TABLES = [
  "billing_invoices",
  "billing_payment_methods",
  "billing_subscriptions",
  "billing_events",
  "plan_entitlements",
  "checkout_reservations",
  "billing_customers",
] as const;

export type CapturedDatabaseTable = (typeof CAPTURED_DATABASE_TABLES)[number];
export type CapturedDatabaseRows = Record<CapturedDatabaseTable, string[]>;

/**
 * Captured cleanup values are table identities, not universally `id` values.
 * `checkout_reservations` deliberately uses `user_id` as its primary key so
 * two concurrent Checkout attempts cannot create two reservation rows. The
 * first provider janitor assumed every table exposed `id`; PostgREST rejected
 * discovery before cleanup could begin and the thrown object degraded to
 * `[object Object]` in the parent diagnostic.
 */
export const CAPTURED_DATABASE_IDENTITIES = {
  billing_invoices: "id",
  billing_payment_methods: "id",
  billing_subscriptions: "id",
  billing_events: "id",
  plan_entitlements: "id",
  checkout_reservations: "user_id",
  billing_customers: "id",
} as const satisfies Record<CapturedDatabaseTable, "id" | "user_id">;

type CleanupOperationLabel =
  | "expire_checkout"
  | "cancel_subscription"
  | "delete_customer"
  | "wait_deliveries"
  | "discover_rows"
  | "delete_billing_invoices"
  | "delete_billing_payment_methods"
  | "delete_billing_subscriptions"
  | "delete_billing_events"
  | "delete_plan_entitlements"
  | "delete_checkout_reservations"
  | "delete_billing_customers"
  | "delete_auth_user";

const TABLE_DELETE_LABELS: Record<
  CapturedDatabaseTable,
  CleanupOperationLabel
> = {
  billing_invoices: "delete_billing_invoices",
  billing_payment_methods: "delete_billing_payment_methods",
  billing_subscriptions: "delete_billing_subscriptions",
  billing_events: "delete_billing_events",
  plan_entitlements: "delete_plan_entitlements",
  checkout_reservations: "delete_checkout_reservations",
  billing_customers: "delete_billing_customers",
};

export interface CapturedFixtureIds {
  authUserId: string;
  checkoutRequestedAtUnix?: number;
  checkoutSessionId?: string;
  checkoutSessionIds?: string[];
  stripeCustomerId?: string;
  stripeCustomerIds?: string[];
  stripeSubscriptionId?: string;
  stripeSubscriptionIds?: string[];
  stripeEventIds?: string[];
  databaseRows: CapturedDatabaseRows;
}

interface InitialBillingState {
  customerIds: string[];
  subscriptionIds: string[];
  entitlementIds: string[];
}

interface DisposableUserCredentials {
  email: string;
  password: string;
}

interface DisposableUser {
  email: string;
  password: string;
  userId: string;
}

interface ProvisionDependencies {
  createConfirmedUser(credentials: {
    email: string;
    password: string;
    emailConfirm: true;
  }): Promise<{ id: string }>;
  deleteAuthUser(userId: string): Promise<void>;
  readInitialBillingState(userId: string): Promise<InitialBillingState>;
  signInWithPassword(credentials: DisposableUserCredentials): Promise<{
    userId: string;
  }>;
}

export interface ProvisionalAuthOwnership {
  userId: string;
  cleanup(): Promise<void>;
}

interface ProvisionOptions {
  onAuthUserCreated?(ownership: ProvisionalAuthOwnership): void;
  signal?: AbortSignal;
}

interface CleanupDependencies {
  reconcileCheckout?(): Promise<void>;
  captureBeforeProviderCleanup?(): Promise<void>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  deleteAuthUser(userId: string): Promise<void>;
  deleteCustomer(customerId: string): Promise<void>;
  deleteDatabaseRows(
    table: CapturedDatabaseTable,
    rowIds: string[],
  ): Promise<void>;
  waitForProviderDeliveries?(): Promise<void>;
  refreshCapturedDatabaseRows?(): Promise<Partial<CapturedDatabaseRows>>;
}

interface CheckoutSessionForCleanup {
  id?: string;
  status: string | null;
  customer: string | { id: string } | null;
  subscription: string | { id: string } | null;
}

interface OwnedCheckoutSession {
  id: string;
  created: number;
  client_reference_id: string | null;
  metadata?: Record<string, string> | null;
}

interface CheckoutCleanupDependencies {
  retrieveCheckoutSession(
    sessionId: string,
  ): Promise<CheckoutSessionForCleanup>;
  expireCheckoutSession(sessionId: string): Promise<CheckoutSessionForCleanup>;
}

interface CleanupEventRow {
  id: string;
  stripe_event_id: string | null;
  event_type: string;
  processed: boolean | null;
  data: unknown;
}

export interface StripeProviderFixture {
  captured: CapturedFixtureIds;
  environment: StripeProviderEnvironment;
  serviceClient: SupabaseClient;
  stripe: Stripe;
  user: { userId: string };
  assertNoMutableResidue(): Promise<void>;
  captureDatabaseRows(): Promise<CapturedDatabaseRows>;
  cleanup(options?: CleanupCapturedFixtureOptions): Promise<void>;
  markCheckoutRequested(): void;
}

export interface CleanupCapturedFixtureOptions {
  deferLocalCleanupToJanitor?: boolean;
}

interface CreateFixtureOptions {
  onAuthUserCreated?(ownership: ProvisionalAuthOwnership): void;
  signal?: AbortSignal;
}

function emptyCapturedRows(): CapturedDatabaseRows {
  return {
    billing_customers: [],
    billing_events: [],
    billing_invoices: [],
    billing_payment_methods: [],
    billing_subscriptions: [],
    checkout_reservations: [],
    plan_entitlements: [],
  };
}

function mergeIds(current: string[], incoming: string[]): string[] {
  return [...new Set([...current, ...incoming])];
}

function recordCapturedId(
  captured: CapturedFixtureIds,
  singular: "checkoutSessionId" | "stripeCustomerId" | "stripeSubscriptionId",
  plural: "checkoutSessionIds" | "stripeCustomerIds" | "stripeSubscriptionIds",
  id: string | null,
): void {
  if (!id) return;
  captured[singular] ??= id;
  captured[plural] = mergeIds(captured[plural] ?? [], [id]);
}

export function captureOwnedCheckoutSessions(
  captured: CapturedFixtureIds,
  input: {
    userId: string;
    startedAtUnix: number;
    sessions: OwnedCheckoutSession[];
  },
): OwnedCheckoutSession[] {
  const owned = input.sessions.filter(
    (session) =>
      session.created >= input.startedAtUnix &&
      (session.client_reference_id === input.userId ||
        session.metadata?.user_id === input.userId),
  );
  for (const session of owned) {
    recordCapturedId(
      captured,
      "checkoutSessionId",
      "checkoutSessionIds",
      session.id,
    );
  }
  return owned;
}

function mergeCapturedRows(
  target: CapturedDatabaseRows,
  incoming: Partial<CapturedDatabaseRows>,
): void {
  for (const table of CAPTURED_DATABASE_TABLES) {
    target[table] = mergeIds(target[table], incoming[table] ?? []);
  }
}

function referenceId(value: string | { id: string } | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function captureCheckoutReferences(
  captured: CapturedFixtureIds,
  session: CheckoutSessionForCleanup,
): void {
  if (session.id) {
    recordCapturedId(
      captured,
      "checkoutSessionId",
      "checkoutSessionIds",
      session.id,
    );
  }
  recordCapturedId(
    captured,
    "stripeCustomerId",
    "stripeCustomerIds",
    referenceId(session.customer),
  );
  recordCapturedId(
    captured,
    "stripeSubscriptionId",
    "stripeSubscriptionIds",
    referenceId(session.subscription),
  );
}

function eventObjectId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const object = (data as { object?: unknown }).object;
  if (!object || typeof object !== "object") return null;
  const id = (object as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

export function capturedCleanupDeliveries(
  captured: Pick<
    CapturedFixtureIds,
    | "stripeCustomerId"
    | "stripeCustomerIds"
    | "stripeSubscriptionId"
    | "stripeSubscriptionIds"
  >,
  rows: CleanupEventRow[],
): CleanupEventRow[] {
  const customerIds = new Set(
    mergeIds(
      captured.stripeCustomerIds ?? [],
      captured.stripeCustomerId ? [captured.stripeCustomerId] : [],
    ),
  );
  const subscriptionIds = new Set(
    mergeIds(
      captured.stripeSubscriptionIds ?? [],
      captured.stripeSubscriptionId ? [captured.stripeSubscriptionId] : [],
    ),
  );
  return rows.filter((row) => {
    if (row.processed !== true) return false;
    const objectId = eventObjectId(row.data);
    if (row.event_type === "customer.deleted") {
      return objectId !== null && customerIds.has(objectId);
    }
    if (row.event_type === "customer.subscription.deleted") {
      return objectId !== null && subscriptionIds.has(objectId);
    }
    return false;
  });
}

export function hasAllCapturedCleanupDeliveries(
  captured: Pick<
    CapturedFixtureIds,
    | "stripeCustomerId"
    | "stripeCustomerIds"
    | "stripeSubscriptionId"
    | "stripeSubscriptionIds"
  >,
  rows: CleanupEventRow[],
): boolean {
  const matched = capturedCleanupDeliveries(captured, rows);
  const customerIds = new Set(
    matched
      .filter((row) => row.event_type === "customer.deleted")
      .map((row) => eventObjectId(row.data))
      .filter((id): id is string => id !== null),
  );
  const subscriptionIds = new Set(
    matched
      .filter((row) => row.event_type === "customer.subscription.deleted")
      .map((row) => eventObjectId(row.data))
      .filter((id): id is string => id !== null),
  );
  const expectedCustomerIds = mergeIds(
    captured.stripeCustomerIds ?? [],
    captured.stripeCustomerId ? [captured.stripeCustomerId] : [],
  );
  const expectedSubscriptionIds = mergeIds(
    captured.stripeSubscriptionIds ?? [],
    captured.stripeSubscriptionId ? [captured.stripeSubscriptionId] : [],
  );
  return (
    expectedCustomerIds.every((id) => customerIds.has(id)) &&
    expectedSubscriptionIds.every((id) => subscriptionIds.has(id))
  );
}

/**
 * Checkout can create its Customer only after the hosted form is submitted.
 * The first s25 provider attempt failed validation on that form, so the
 * Session was still open and the fixture had never reached its post-success
 * refresh; cleanup consequently knew neither the late Customer nor that the
 * Session itself was still mutable. Re-read the Session in every finally path,
 * capture provider IDs from both the read and expire responses, and close an
 * open Session before customer/subscription cleanup begins.
 */
export async function reconcileCapturedCheckoutForCleanup(
  captured: CapturedFixtureIds,
  dependencies: CheckoutCleanupDependencies,
): Promise<void> {
  const sessionIds = mergeIds(
    captured.checkoutSessionIds ?? [],
    captured.checkoutSessionId ? [captured.checkoutSessionId] : [],
  );
  for (const sessionId of sessionIds) {
    const session = await dependencies.retrieveCheckoutSession(sessionId);
    captureCheckoutReferences(captured, { ...session, id: sessionId });

    if (session.status !== "open") continue;

    const expired = await dependencies.expireCheckoutSession(sessionId);
    captureCheckoutReferences(captured, { ...expired, id: sessionId });
    if (expired.status === "open") {
      throw new Error(
        "Stripe Checkout Session remained open after expiration.",
      );
    }
  }
}

/**
 * Create the one account this proof owns and refuse to continue if anything
 * already grants or bills it. The production magic-link callbacks deliberately
 * are not involved: both callbacks start a trial, which would let a broken
 * payment path pass this story by resolving Pro before Checkout ever runs.
 */
export async function provisionDisposableBillingUser(
  dependencies: ProvisionDependencies,
  credentials: DisposableUserCredentials,
  options: ProvisionOptions = {},
): Promise<DisposableUser> {
  const created = await dependencies.createConfirmedUser({
    ...credentials,
    emailConfirm: true,
  });

  try {
    options.onAuthUserCreated?.({
      userId: created.id,
      cleanup: () => dependencies.deleteAuthUser(created.id),
    });
    options.signal?.throwIfAborted();
    const signedIn = await dependencies.signInWithPassword(credentials);
    options.signal?.throwIfAborted();
    if (signedIn.userId !== created.id) {
      throw new Error(
        "Stripe provider fixture sign-in returned a different Auth user.",
      );
    }

    const initial = await dependencies.readInitialBillingState(created.id);
    options.signal?.throwIfAborted();
    if (
      initial.customerIds.length > 0 ||
      initial.subscriptionIds.length > 0 ||
      initial.entitlementIds.length > 0
    ) {
      throw new Error(
        "Stripe provider fixture did not start from a clean billing baseline.",
      );
    }

    return { ...credentials, userId: created.id };
  } catch (error) {
    await dependencies.deleteAuthUser(created.id);
    throw error;
  }
}

/**
 * Provider cleanup happens before local deletion so Stripe cannot keep billing
 * an object whose local owner has disappeared. Every database delete receives
 * primary keys captured by this process; passing a user id or a wildcard here
 * is intentionally impossible through the type/shape of the API.
 */
export async function cleanupCapturedFixture(
  captured: CapturedFixtureIds,
  dependencies: CleanupDependencies,
  options: CleanupCapturedFixtureOptions = {},
): Promise<void> {
  const failures = new Set<CleanupOperationLabel>();
  const attempt = async (
    label: CleanupOperationLabel,
    operation: () => Promise<void>,
  ) => {
    try {
      await operation();
    } catch {
      failures.add(label);
    }
  };

  if (dependencies.reconcileCheckout) {
    await attempt("expire_checkout", () => dependencies.reconcileCheckout!());
  }
  if (dependencies.captureBeforeProviderCleanup) {
    await attempt("discover_rows", () =>
      dependencies.captureBeforeProviderCleanup!(),
    );
  }

  const subscriptionIds = mergeIds(
    captured.stripeSubscriptionIds ?? [],
    captured.stripeSubscriptionId ? [captured.stripeSubscriptionId] : [],
  );
  for (const subscriptionId of subscriptionIds) {
    await attempt("cancel_subscription", () =>
      dependencies.cancelSubscription(subscriptionId),
    );
  }
  const customerIds = mergeIds(
    captured.stripeCustomerIds ?? [],
    captured.stripeCustomerId ? [captured.stripeCustomerId] : [],
  );
  for (const customerId of customerIds) {
    await attempt("delete_customer", () =>
      dependencies.deleteCustomer(customerId),
    );
  }

  if (
    dependencies.waitForProviderDeliveries &&
    (subscriptionIds.length > 0 || customerIds.length > 0)
  ) {
    await attempt("wait_deliveries", () =>
      dependencies.waitForProviderDeliveries!(),
    );
  }

  if (dependencies.refreshCapturedDatabaseRows) {
    await attempt("discover_rows", async () => {
      mergeCapturedRows(
        captured.databaseRows,
        await dependencies.refreshCapturedDatabaseRows!(),
      );
    });
  }

  if (!options.deferLocalCleanupToJanitor) {
    for (const table of CAPTURED_DATABASE_TABLES) {
      await attempt(TABLE_DELETE_LABELS[table], () =>
        dependencies.deleteDatabaseRows(table, captured.databaseRows[table]),
      );
    }
    await attempt("delete_auth_user", () =>
      dependencies.deleteAuthUser(captured.authUserId),
    );
  }

  if (failures.size > 0) {
    const labels = [...failures];
    throw new Error(
      `Stripe provider fixture cleanup failed in ${labels.length} steps: ` +
        `${labels.join(", ")}.`,
    );
  }
}

function sameSite(
  value: string | boolean | undefined,
): "Strict" | "Lax" | "None" | undefined {
  if (value === "strict") return "Strict";
  if (value === "lax") return "Lax";
  if (value === "none") return "None";
  return undefined;
}

function createAppBrowserClient(
  context: BrowserContext,
  environment: StripeProviderEnvironment,
) {
  return createBrowserClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey,
    {
      isSingleton: false,
      cookies: {
        getAll: async () =>
          (await context.cookies(environment.appUrl)).map(
            ({ name, value }) => ({
              name,
              value,
            }),
          ),
        setAll: async (cookies) => {
          await context.addCookies(
            cookies.map(({ name, value, options }) => ({
              name,
              value,
              url: environment.appUrl,
              httpOnly: options.httpOnly,
              secure: false,
              sameSite: sameSite(options.sameSite),
              ...(typeof options.maxAge === "number"
                ? {
                    expires: Math.floor(Date.now() / 1000) + options.maxAge,
                  }
                : {}),
            })),
          );
        },
      },
    },
  );
}

async function idsForUser(
  client: SupabaseClient,
  table: "billing_customers" | "billing_subscriptions" | "plan_entitlements",
  userId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from(table)
    .select("id")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => String(row.id));
}

async function readInitialBillingState(
  client: SupabaseClient,
  userId: string,
): Promise<InitialBillingState> {
  const [customerIds, subscriptionIds, entitlementIds] = await Promise.all([
    idsForUser(client, "billing_customers", userId),
    idsForUser(client, "billing_subscriptions", userId),
    idsForUser(client, "plan_entitlements", userId),
  ]);
  return { customerIds, subscriptionIds, entitlementIds };
}

async function selectIds(
  client: SupabaseClient,
  table: CapturedDatabaseTable,
  column: string,
  values: string[],
): Promise<string[]> {
  if (values.length === 0) return [];
  const identity = CAPTURED_DATABASE_IDENTITIES[table];
  const query = client.from(table).select(identity);
  const { data, error } =
    values.length === 1
      ? await query.eq(column, values[0])
      : await query.in(column, values);
  if (error) throw error;
  return (data ?? []).map((row) =>
    String((row as unknown as Record<string, unknown>)[identity]),
  );
}

async function captureRowsForUser(
  client: SupabaseClient,
  userId: string,
): Promise<CapturedDatabaseRows> {
  const [
    customerIds,
    subscriptionIds,
    eventIds,
    entitlementIds,
    reservationIds,
  ] = await Promise.all([
    selectIds(client, "billing_customers", "user_id", [userId]),
    selectIds(client, "billing_subscriptions", "user_id", [userId]),
    selectIds(client, "billing_events", "user_id", [userId]),
    selectIds(client, "plan_entitlements", "user_id", [userId]),
    selectIds(client, "checkout_reservations", "user_id", [userId]),
  ]);
  const [invoiceIds, paymentMethodIds] = await Promise.all([
    selectIds(client, "billing_invoices", "customer_id", customerIds),
    selectIds(client, "billing_payment_methods", "customer_id", customerIds),
  ]);

  return {
    billing_customers: customerIds,
    billing_events: eventIds,
    billing_invoices: invoiceIds,
    billing_payment_methods: paymentMethodIds,
    billing_subscriptions: subscriptionIds,
    checkout_reservations: reservationIds,
    plan_entitlements: entitlementIds,
  };
}

/** Build the concrete local fixture only after both safety gates pass. */
export async function createStripeProviderFixture(
  context: BrowserContext,
  rawEnvironment: Record<string, string | undefined> = process.env,
  options: CreateFixtureOptions = {},
): Promise<StripeProviderFixture> {
  const environment = assertStripeProviderEnvironment(rawEnvironment);
  const fixtureStartedAt = new Date(Date.now() - 1_000).toISOString();
  const fixtureStartedAtUnix = Math.floor(Date.now() / 1_000) - 1;
  const fixtureOwnership = {
    authUserId: rawEnvironment.STRIPE_PROVIDER_AUTH_USER_ID ?? "",
    startedAtUnix: fixtureStartedAtUnix,
  };
  const stripe = new Stripe(environment.secretKey, {
    apiVersion: "2025-07-30.basil",
  });
  options.signal?.throwIfAborted();
  const price = await stripe.prices.retrieve(environment.priceId);
  options.signal?.throwIfAborted();
  assertStripeProviderPrice(price, environment.priceId);

  const serviceClient = createClient(
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
  const browserClient = createAppBrowserClient(context, environment);
  const requestedAuthUserId = rawEnvironment.STRIPE_PROVIDER_AUTH_USER_ID;
  const providerRunId = rawEnvironment.STRIPE_PROVIDER_RUN_ID;
  const credentials = {
    email:
      rawEnvironment.STRIPE_PROVIDER_USER_EMAIL ??
      `s25-${randomUUID()}@recopyfast.invalid`,
    password: randomBytes(32).toString("base64url"),
  };
  let hasDeletedAuthUser = false;
  const deleteAuthUser = async (capturedUserId: string) => {
    if (hasDeletedAuthUser) return;
    const { error } = await serviceClient.auth.admin.deleteUser(capturedUserId);
    if (error) throw error;
    hasDeletedAuthUser = true;
  };

  const { userId } = await provisionDisposableBillingUser(
    {
      createConfirmedUser: async ({ email, password, emailConfirm }) => {
        const attributes = {
          ...(requestedAuthUserId ? { id: requestedAuthUserId } : {}),
          email,
          password,
          email_confirm: emailConfirm,
          ...(providerRunId
            ? { user_metadata: { provider_run_id: providerRunId } }
            : {}),
        } as Parameters<typeof serviceClient.auth.admin.createUser>[0] & {
          id?: string;
        };
        const { data, error } =
          await serviceClient.auth.admin.createUser(attributes);
        if (error || !data.user) throw error ?? new Error("Auth user missing");
        if (requestedAuthUserId && data.user.id !== requestedAuthUserId) {
          await serviceClient.auth.admin.deleteUser(data.user.id);
          throw new Error(
            "Supabase did not honor the pre-generated provider Auth user ID.",
          );
        }
        return { id: data.user.id };
      },
      deleteAuthUser,
      readInitialBillingState: (userId) =>
        readInitialBillingState(serviceClient, userId),
      signInWithPassword: async ({ email, password }) => {
        const { data, error } = await browserClient.auth.signInWithPassword({
          email,
          password,
        });
        if (error || !data.user)
          throw error ?? new Error("Auth session missing");
        return { userId: data.user.id };
      },
    },
    credentials,
    {
      onAuthUserCreated: options.onAuthUserCreated,
      signal: options.signal,
    },
  );
  fixtureOwnership.authUserId = userId;

  const captured: CapturedFixtureIds = {
    authUserId: userId,
    databaseRows: emptyCapturedRows(),
    stripeEventIds: [],
  };

  const captureDatabaseRows = async () => {
    const [rows, customerLinks, subscriptionLinks, eventLinks] =
      await Promise.all([
        captureRowsForUser(serviceClient, userId),
        serviceClient
          .from("billing_customers")
          .select("stripe_customer_id")
          .eq("user_id", userId),
        serviceClient
          .from("billing_subscriptions")
          .select("stripe_subscription_id")
          .eq("user_id", userId),
        serviceClient
          .from("billing_events")
          .select("stripe_event_id")
          .eq("user_id", userId),
      ]);
    for (const result of [customerLinks, subscriptionLinks, eventLinks]) {
      if (result.error) throw result.error;
    }

    const customerId = customerLinks.data?.find(
      (row) => typeof row.stripe_customer_id === "string",
    )?.stripe_customer_id;
    const subscriptionId = subscriptionLinks.data?.find(
      (row) => typeof row.stripe_subscription_id === "string",
    )?.stripe_subscription_id;
    if (typeof customerId === "string") {
      recordCapturedId(
        captured,
        "stripeCustomerId",
        "stripeCustomerIds",
        customerId,
      );
    }
    if (typeof subscriptionId === "string") {
      recordCapturedId(
        captured,
        "stripeSubscriptionId",
        "stripeSubscriptionIds",
        subscriptionId,
      );
    }
    captured.stripeEventIds = mergeIds(
      captured.stripeEventIds ?? [],
      (eventLinks.data ?? [])
        .map((row) => row.stripe_event_id)
        .filter((id): id is string => typeof id === "string"),
    );
    mergeCapturedRows(captured.databaseRows, rows);
    return rows;
  };

  const waitForCleanupDeliveries = async () => {
    const expectedTypes = new Set<string>();
    if (
      (captured.stripeSubscriptionIds?.length ?? 0) > 0 ||
      captured.stripeSubscriptionId
    ) {
      expectedTypes.add("customer.subscription.deleted");
    }
    if (
      (captured.stripeCustomerIds?.length ?? 0) > 0 ||
      captured.stripeCustomerId
    ) {
      expectedTypes.add("customer.deleted");
    }
    if (expectedTypes.size === 0) return;

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const { data, error } = await serviceClient
        .from("billing_events")
        .select("id, stripe_event_id, event_type, processed, data")
        .gte("created_at", fixtureStartedAt)
        .in("event_type", [
          "customer.subscription.deleted",
          "customer.deleted",
        ]);
      if (error) throw error;

      const candidates = (data ?? []) as CleanupEventRow[];
      const rows = capturedCleanupDeliveries(captured, candidates);
      if (hasAllCapturedCleanupDeliveries(captured, candidates)) {
        captured.databaseRows.billing_events = mergeIds(
          captured.databaseRows.billing_events,
          rows.map((row) => row.id),
        );
        captured.stripeEventIds = mergeIds(
          captured.stripeEventIds ?? [],
          rows
            .map((row) => row.stripe_event_id)
            .filter((id): id is string => typeof id === "string"),
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      "Stripe provider cleanup events did not reach the local signed webhook before cleanup.",
    );
  };

  const assertNoMutableResidue = async () => {
    for (const table of CAPTURED_DATABASE_TABLES) {
      const ids = captured.databaseRows[table];
      if (ids.length === 0) continue;
      const identity = CAPTURED_DATABASE_IDENTITIES[table];
      const { data, error } = await serviceClient
        .from(table)
        .select(identity)
        .in(identity, ids);
      if (error) throw error;
      if ((data ?? []).length > 0) {
        throw new Error(
          `Stripe provider cleanup left captured rows in ${table}.`,
        );
      }
    }

    for (const table of [
      "billing_customers",
      "billing_events",
      "billing_subscriptions",
      "checkout_reservations",
      "plan_entitlements",
    ] as const) {
      const identity = CAPTURED_DATABASE_IDENTITIES[table];
      const { data, error } = await serviceClient
        .from(table)
        .select(identity)
        .eq("user_id", userId);
      if (error) throw error;
      if ((data ?? []).length > 0) {
        throw new Error(
          `Stripe provider cleanup left uncaptured user rows in ${table}.`,
        );
      }
    }

    const { data: authData } =
      await serviceClient.auth.admin.getUserById(userId);
    if (authData.user) {
      throw new Error("Stripe provider cleanup left the captured Auth user.");
    }

    const customerIds = mergeIds(
      captured.stripeCustomerIds ?? [],
      captured.stripeCustomerId ? [captured.stripeCustomerId] : [],
    );
    for (const customerId of customerIds) {
      const customer = await stripe.customers.retrieve(customerId);
      if (!("deleted" in customer && customer.deleted)) {
        throw new Error(
          "Stripe provider cleanup left the captured customer mutable.",
        );
      }
    }
    const subscriptionIds = mergeIds(
      captured.stripeSubscriptionIds ?? [],
      captured.stripeSubscriptionId ? [captured.stripeSubscriptionId] : [],
    );
    for (const subscriptionId of subscriptionIds) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (subscription.status !== "canceled") {
        throw new Error(
          "Stripe provider cleanup left the captured subscription billable.",
        );
      }
    }
    const checkoutSessionIds = mergeIds(
      captured.checkoutSessionIds ?? [],
      captured.checkoutSessionId ? [captured.checkoutSessionId] : [],
    );
    for (const checkoutSessionId of checkoutSessionIds) {
      const session =
        await stripe.checkout.sessions.retrieve(checkoutSessionId);
      if (session.status === "open") {
        throw new Error(
          "Stripe provider cleanup left the captured Checkout Session open.",
        );
      }
    }
    for (const eventId of captured.stripeEventIds ?? []) {
      await stripe.events.retrieve(eventId);
    }
  };

  return {
    captured,
    environment,
    serviceClient,
    stripe,
    user: { userId },
    assertNoMutableResidue,
    captureDatabaseRows,
    markCheckoutRequested: () => {
      captured.checkoutRequestedAtUnix = Math.floor(Date.now() / 1_000) - 1;
    },
    cleanup: async (cleanupOptions = {}) => {
      try {
        await cleanupCapturedFixture(
          captured,
          {
            reconcileCheckout: async () => {
              const discoveryChecks = captured.checkoutRequestedAtUnix ? 61 : 1;
              for (let check = 0; check < discoveryChecks; check += 1) {
                const sessions = await stripe.checkout.sessions.list({
                  created: { gte: fixtureStartedAtUnix },
                  limit: 100,
                });
                const owned = captureOwnedCheckoutSessions(captured, {
                  userId,
                  startedAtUnix: fixtureStartedAtUnix,
                  sessions: sessions.data,
                });
                if (owned.length > 0 || check + 1 === discoveryChecks) break;
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
              await reconcileCapturedCheckoutForCleanup(captured, {
                retrieveCheckoutSession: (sessionId) =>
                  stripe.checkout.sessions.retrieve(sessionId),
                expireCheckoutSession: async (sessionId) => {
                  const session =
                    await stripe.checkout.sessions.retrieve(sessionId);
                  const customerId = referenceId(session.customer);
                  const ownedCustomerIds = new Set<string>();
                  if (customerId) {
                    const customer =
                      await stripe.customers.retrieve(customerId);
                    if ("deleted" in customer && customer.deleted) {
                      throw new Error(
                        "Refusing provider mutation: Checkout Customer is already deleted.",
                      );
                    }
                    assertOwnedCustomer(customer, fixtureOwnership);
                    ownedCustomerIds.add(customer.id);
                  }
                  return expireOwnedCheckoutSession(
                    session,
                    fixtureOwnership,
                    ownedCustomerIds,
                    (id) => stripe.checkout.sessions.expire(id),
                  );
                },
              });
            },
            captureBeforeProviderCleanup: async () => {
              await captureDatabaseRows();
            },
            cancelSubscription: async (subscriptionId) => {
              const subscription =
                await stripe.subscriptions.retrieve(subscriptionId);
              if (subscription.status !== "canceled") {
                const customerId = referenceId(subscription.customer);
                if (!customerId) {
                  throw new Error(
                    "Refusing provider mutation: Subscription Customer is missing.",
                  );
                }
                const customer = await stripe.customers.retrieve(customerId);
                if ("deleted" in customer && customer.deleted) {
                  throw new Error(
                    "Refusing provider mutation: Subscription Customer is already deleted.",
                  );
                }
                assertOwnedCustomer(customer, fixtureOwnership);
                await cancelOwnedSubscription(
                  subscription,
                  fixtureOwnership,
                  new Set([customer.id]),
                  (id) => stripe.subscriptions.cancel(id),
                );
              }
            },
            deleteCustomer: async (customerId) => {
              const customer = await stripe.customers.retrieve(customerId);
              if (!("deleted" in customer && customer.deleted)) {
                await deleteOwnedCustomer(customer, fixtureOwnership, (id) =>
                  stripe.customers.del(id),
                );
              }
            },
            waitForProviderDeliveries: waitForCleanupDeliveries,
            refreshCapturedDatabaseRows: captureDatabaseRows,
            deleteDatabaseRows: async (table, rowIds) => {
              if (rowIds.length === 0) return;
              const identity = CAPTURED_DATABASE_IDENTITIES[table];
              const { error } = await serviceClient
                .from(table)
                .delete()
                .in(identity, rowIds);
              if (error) throw error;
            },
            deleteAuthUser,
          },
          cleanupOptions,
        );
      } finally {
        await context.clearCookies();
      }
    },
  };
}
