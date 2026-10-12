interface ProviderOwnership {
  authUserId: string;
  startedAtUnix: number;
}

interface ProviderObject {
  created: number;
  livemode: boolean;
  metadata?: Record<string, string> | null;
}

interface ProviderCustomer extends ProviderObject {
  id: string;
}

interface ProviderCheckoutSession extends ProviderObject {
  id: string;
  client_reference_id: string | null;
  customer: string | { id: string } | null;
}

interface ProviderSubscription extends ProviderObject {
  id: string;
  customer: string | { id: string };
}

function refusal(kind: string): never {
  // Never include the rejected provider ID here. This message is allowed into
  // the bounded operator diagnostic, while the ID may belong to another test
  // account object that this run must preserve untouched.
  throw new Error(`Refusing provider mutation: ${kind} is not run-owned.`);
}

function hasRunIdentity(
  value: ProviderObject,
  ownership: ProviderOwnership,
): boolean {
  return (
    value.livemode === false &&
    Number.isFinite(value.created) &&
    value.created >= ownership.startedAtUnix &&
    value.metadata?.user_id === ownership.authUserId
  );
}

function referenceId(value: string | { id: string } | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Prove a Customer from Stripe truth before deleting it. */
export function assertOwnedCustomer(
  customer: ProviderCustomer,
  ownership: ProviderOwnership,
): void {
  if (!hasRunIdentity(customer, ownership)) refusal("Customer");
}

/**
 * Prove a Checkout Session from Stripe truth before expiring it. The app puts
 * the user ID in both ownership fields. If Checkout has attached a Customer,
 * that relationship must also point at a separately provider-proven Customer.
 */
export function assertOwnedCheckoutSession(
  session: ProviderCheckoutSession,
  ownership: ProviderOwnership,
  ownedCustomerIds: ReadonlySet<string>,
): void {
  const customerId = referenceId(session.customer);
  const ownsSession =
    hasRunIdentity(session, ownership) &&
    session.client_reference_id === ownership.authUserId &&
    (customerId === null || ownedCustomerIds.has(customerId));
  if (!ownsSession) refusal("Checkout Session");
}

/** Prove both Subscription metadata and its Customer relationship. */
export function assertOwnedSubscription(
  subscription: ProviderSubscription,
  ownership: ProviderOwnership,
  ownedCustomerIds: ReadonlySet<string>,
): void {
  const customerId = referenceId(subscription.customer);
  if (
    !hasRunIdentity(subscription, ownership) ||
    customerId === null ||
    !ownedCustomerIds.has(customerId)
  ) {
    refusal("Subscription");
  }
}

export async function deleteOwnedCustomer<T>(
  customer: ProviderCustomer,
  ownership: ProviderOwnership,
  mutate: (customerId: string) => Promise<T>,
): Promise<T> {
  assertOwnedCustomer(customer, ownership);
  return mutate(customer.id);
}

export async function expireOwnedCheckoutSession<T>(
  session: ProviderCheckoutSession,
  ownership: ProviderOwnership,
  ownedCustomerIds: ReadonlySet<string>,
  mutate: (sessionId: string) => Promise<T>,
): Promise<T> {
  assertOwnedCheckoutSession(session, ownership, ownedCustomerIds);
  return mutate(session.id);
}

export async function cancelOwnedSubscription<T>(
  subscription: ProviderSubscription,
  ownership: ProviderOwnership,
  ownedCustomerIds: ReadonlySet<string>,
  mutate: (subscriptionId: string) => Promise<T>,
): Promise<T> {
  assertOwnedSubscription(subscription, ownership, ownedCustomerIds);
  return mutate(subscription.id);
}
