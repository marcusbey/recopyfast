import { redactDiagnostic } from "./redacted-diagnostics";

export interface JanitorStageTracker {
  run<T>(stage: string, operation: () => PromiseLike<T>): Promise<T>;
  diagnostic(error: unknown): string;
}

function ownStringField(value: object, field: "code" | "message"): string {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  return descriptor &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : "";
}

function safeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message || "Unknown error";
  if (!error || typeof error !== "object") return "Unknown error";

  // PostgREST rejects are plain objects. Only its stable code/message fields
  // are diagnostic; details and hints can contain customer data or credentials,
  // and stringifying the object both leaks them and produced `[object Object]`.
  const code = ownStringField(error, "code");
  const message = ownStringField(error, "message");
  return (
    [code ? `code=${code}` : "", message ? `message=${message}` : ""]
      .filter(Boolean)
      .join(" ") || "Unknown error"
  );
}

export function createJanitorStageTracker(): JanitorStageTracker {
  let currentStage = "startup";
  const failedStages = new WeakMap<object, string>();
  return {
    async run<T>(stage: string, operation: () => PromiseLike<T>): Promise<T> {
      currentStage = stage;
      try {
        return await operation();
      } catch (error) {
        if (error !== null && typeof error === "object") {
          // Nested reconciliation stages legitimately replace currentStage while
          // they run. Preserve the innermost stage that actually rejected, but
          // attribute an error created by the outer quiescence loop to that
          // outer stage instead of whichever successful DB probe ran last.
          if (!failedStages.has(error)) failedStages.set(error, stage);
        }
        throw error;
      }
    },
    diagnostic(error: unknown): string {
      const failedStage =
        error !== null && typeof error === "object"
          ? failedStages.get(error)
          : undefined;
      return `${failedStage ?? currentStage}: ${redactDiagnostic(safeUnknownError(error), 600)}`;
    },
  };
}

interface JanitorPassResult {
  mutableCount: number;
  hadActivity?: boolean;
}

interface JanitorDependencies {
  reconcilePass(pass: number): Promise<JanitorPassResult>;
  sleep(milliseconds: number): Promise<void>;
  now?(): number;
}

interface JanitorQuiescenceOptions {
  maxPasses: number;
  quietPasses: number;
  intervalMs: number;
  minObservationMs?: number;
}

export function calculateJanitorMaxPasses({
  minObservationMs,
  intervalMs,
  quietPasses,
}: {
  minObservationMs: number;
  intervalMs: number;
  quietPasses: number;
}): number {
  const horizonPasses = Math.ceil(minObservationMs / intervalMs);

  // A successful provider flow can still create webhook/local activity during
  // the first nominal quiet window. The 2026-09-24 proof did exactly that and
  // exhausted the former horizon + quiet + 1 bound after 17 passes, although
  // its automatic retry then reconciled cleanly. Reserve a second full quiet
  // window so one invocation can observe that activity and still prove a fresh
  // sequence; the final pass is bounded slack for the horizon boundary.
  return horizonPasses + 2 * quietPasses + 1;
}

interface ProviderListPage<T extends { id: string }> {
  data: T[];
  has_more: boolean;
}

interface TerminalDeliverySnapshot {
  customerIds: string[];
  subscriptionIds: string[];
}

interface TerminalDeliveryObservation {
  eventType: "customer.deleted" | "customer.subscription.deleted";
  objectId: string;
}

export function createTerminalDeliveryLedger(
  initial: TerminalDeliverySnapshot = { customerIds: [], subscriptionIds: [] },
) {
  const customerIds = new Set(initial.customerIds);
  const subscriptionIds = new Set(initial.subscriptionIds);
  return {
    observe(observations: TerminalDeliveryObservation[]): void {
      for (const observation of observations) {
        if (observation.eventType === "customer.deleted") {
          customerIds.add(observation.objectId);
        } else {
          subscriptionIds.add(observation.objectId);
        }
      }
    },
    hasEvery(
      expectedCustomerIds: ReadonlySet<string>,
      expectedSubscriptionIds: ReadonlySet<string>,
    ): boolean {
      return (
        [...expectedCustomerIds].every((id) => customerIds.has(id)) &&
        [...expectedSubscriptionIds].every((id) => subscriptionIds.has(id))
      );
    },
    snapshot(): TerminalDeliverySnapshot {
      return {
        customerIds: [...customerIds],
        subscriptionIds: [...subscriptionIds],
      };
    },
  };
}

/**
 * Stripe list endpoints are cursor based. Cleanup must never treat the first
 * 100 objects as a complete ownership inventory, and it must fail closed if a
 * provider response claims another page without giving us a usable new cursor.
 */
export async function paginateProviderList<T extends { id: string }>(
  fetchPage: (
    startingAfter: string | undefined,
  ) => Promise<ProviderListPage<T>>,
  maxPages = 100,
): Promise<T[]> {
  const discovered: T[] = [];
  let startingAfter: string | undefined;

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchPage(startingAfter);
    discovered.push(...response.data);
    if (!response.has_more) return discovered;

    const nextCursor = response.data.at(-1)?.id;
    if (!nextCursor || nextCursor === startingAfter) {
      throw new Error(
        "Stripe provider janitor found incomplete provider discovery.",
      );
    }
    startingAfter = nextCursor;
  }

  throw new Error(
    "Stripe provider janitor found incomplete provider discovery after its page bound.",
  );
}

/**
 * Provider cleanup is authoritative only after repeated discovery observes no
 * mutable run-owned objects. One clean snapshot can race a Checkout request
 * that outlived the Playwright child, so require consecutive clean passes and
 * fail closed when the bounded window expires.
 */
export async function reconcileUntilQuiescent(
  dependencies: JanitorDependencies,
  options: JanitorQuiescenceOptions,
): Promise<{ passes: number; mutableCount: number }> {
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const minObservationMs = options.minObservationMs ?? 0;
  let consecutiveQuiet = 0;
  let mutableCount = Number.POSITIVE_INFINITY;

  for (let pass = 1; pass <= options.maxPasses; pass += 1) {
    const result = await dependencies.reconcilePass(pass);
    ({ mutableCount } = result);
    // A timed-out Next route can still be inside Stripe's ordinary SDK retry
    // lifetime after the browser process has gone away. Quiet observations
    // before that failure horizon are discovery only; they cannot contribute
    // to terminal proof. The consecutive proof starts after the horizon.
    consecutiveQuiet =
      now() - startedAt >= minObservationMs &&
      mutableCount === 0 &&
      result.hadActivity !== true
        ? consecutiveQuiet + 1
        : 0;
    if (consecutiveQuiet >= options.quietPasses) {
      return { passes: pass, mutableCount };
    }
    if (pass < options.maxPasses) {
      await dependencies.sleep(options.intervalMs);
    }
  }

  throw new Error(
    `Stripe provider janitor did not reach quiescence after ` +
      `${options.maxPasses} passes.`,
  );
}
