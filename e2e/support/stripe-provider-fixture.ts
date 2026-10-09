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

export interface CapturedFixtureIds {
  authUserId: string;
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
  readInitialBillingState(userId: string): Promise<InitialBillingState>;
  signInWithPassword(credentials: DisposableUserCredentials): Promise<{
    userId: string;
  }>;
}

interface ProvisionOptions {
  signal?: AbortSignal;
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
  captureDatabaseRows(): Promise<CapturedDatabaseRows>;
}

interface CreateFixtureOptions {
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

function mergeCapturedRows(
  target: CapturedDatabaseRows,
  incoming: Partial<CapturedDatabaseRows>,
): void {
  for (const table of CAPTURED_DATABASE_TABLES) {
    target[table] = mergeIds(target[table], incoming[table] ?? []);
  }
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
          throw new Error(
            "Supabase did not honor the pre-generated provider Auth user ID.",
          );
        }
        return { id: data.user.id };
      },
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
    { signal: options.signal },
  );

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

  return {
    captured,
    environment,
    serviceClient,
    stripe,
    user: { userId },
    captureDatabaseRows,
  };
}
