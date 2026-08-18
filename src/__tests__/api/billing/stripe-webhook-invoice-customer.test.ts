/**
 * The invoice and customer handlers must not report success for work they did
 * not do.
 *
 * THREE DEFECTS, ONE FAMILY — all three are supabase-js resolving where another
 * client would reject, and a handler reading the result too loosely.
 *
 * 1. `handleInvoicePaymentSucceeded` destructured `{ data: customer }` from a
 *    `.single()` and dropped the error, so a genuine query failure and a real
 *    "no such customer" were indistinguishable. Both took the same bare
 *    `return`, which produces HTTP 200: Stripe never redelivers and the invoice
 *    is lost for good. `requireBillingCustomer` was written for exactly this and
 *    this call site was never migrated to it.
 *
 * 2. `handleInvoicePaymentFailed` and 3. `handleCustomerUpdated` guard their
 *    UPDATE with `assertWritten`, which inspects only `error` — and supabase-js
 *    reports a zero-row UPDATE as `{ error: null }`. Both silently succeeded on
 *    a write that touched nothing.
 *
 * Neither of those two is a `assertRowMatched` case, and that is the point of
 * the tests below: `billing_invoices` rows are only ever written by
 * `payment_succeeded`, so a `payment_failed` for an invoice that never
 * succeeded is the COMMON case, and refusing it would put ordinary events into
 * Stripe's retry queue forever. Same for a `customer.updated` about a Stripe
 * customer this app never created. They are answered 200 — and said out loud,
 * which is the whole difference from before.
 */

const mockConstructEvent = jest.fn();

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  })),
);

process.env.STRIPE_SECRET_KEY = "sk_test_fake";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fake";

jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers({ "stripe-signature": "sig_test" })),
}));

type Row = Record<string, unknown>;
type FakeError = { code?: string; message: string; details?: string };
type RowsResult = { data: Row[] | null; error: FakeError | null };

let db: Record<string, Row[]> = {};

/**
 * When set, every read of `billing_customers` answers with this error instead
 * of rows — a connection failure mid-query, which is what the swallowed error
 * used to be indistinguishable from.
 */
let customerReadError: FakeError | null = null;

/** supabase-js-shaped client over `db`. See stripe-webhook-ordering.test.ts. */
function createFakeClient() {
  const from = (table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    let operation: "select" | "insert" | "update" | "upsert" = "select";
    let values: Row = {};
    let conflictColumn: string | null = null;

    const rows = (): Row[] => db[table] ?? [];
    const matched = (): Row[] =>
      rows().filter((row) => predicates.every((predicate) => predicate(row)));

    const run = (): RowsResult => {
      if (table === "billing_customers" && customerReadError) {
        return { data: null, error: customerReadError };
      }

      switch (operation) {
        case "insert":
          db[table] = [...rows(), { ...values }];
          return { data: [{ ...values }], error: null };

        case "upsert": {
          const key = conflictColumn;
          const existing = key
            ? rows().find((row) => row[key] === values[key])
            : undefined;
          db[table] = existing
            ? rows().map((row) =>
                row === existing ? { ...row, ...values } : row,
              )
            : [...rows(), { ...values }];
          return { data: [{ ...values }], error: null };
        }

        case "update": {
          const hits = matched();
          db[table] = rows().map((row) =>
            hits.includes(row) ? { ...row, ...values } : row,
          );
          // THE MECHANISM: zero rows matched is not an error.
          return {
            data: hits.map((row) => ({ ...row, ...values })),
            error: null,
          };
        }

        default:
          return { data: matched(), error: null };
      }
    };

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        predicates.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, allowed: unknown[]) => {
        predicates.push((row) => allowed.includes(row[column]));
        return builder;
      },
      is: (column: string, value: unknown) => {
        predicates.push((row) => (row[column] ?? null) === value);
        return builder;
      },
      returns: () => builder,
      insert: (payload: Row) => {
        operation = "insert";
        values = payload;
        return builder;
      },
      upsert: (payload: Row, options?: { onConflict?: string }) => {
        operation = "upsert";
        values = payload;
        conflictColumn = options?.onConflict ?? null;
        return builder;
      },
      update: (payload: Row) => {
        operation = "update";
        values = payload;
        return builder;
      },
      single: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        if (!data || data.length !== 1) {
          return {
            data: null,
            error: {
              code: "PGRST116",
              message: "JSON object requested, multiple (or no) rows returned",
            },
          };
        }
        return { data: data[0], error: null };
      },
      maybeSingle: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        return { data: data?.[0] ?? null, error: null };
      },
      then: <T>(
        resolve: (result: RowsResult) => T,
        reject?: (reason: unknown) => T,
      ) => Promise.resolve(run()).then(resolve, reject),
    };

    return builder;
  };

  return { from };
}

jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: jest.fn(() => createFakeClient()),
}));

import { POST } from "@/app/api/webhooks/stripe/route";

interface WebhookResponse {
  status: number;
  json: () => Promise<Record<string, unknown>>;
}

async function deliver(event: unknown): Promise<WebhookResponse> {
  mockConstructEvent.mockReturnValue(event);
  const request = { text: async () => JSON.stringify(event) };
  return POST(request as never) as unknown as WebhookResponse;
}

/** Everything the route said, whichever console channel it said it on. */
function loggedLines(): string {
  return [console.log, console.warn, console.error]
    .flatMap((channel) => (channel as jest.Mock).mock.calls)
    .map((call) => call.map(String).join(" "))
    .join("\n");
}

function invoiceEvent(
  eventId: string,
  type: string,
  overrides: Row = {},
): unknown {
  return {
    id: eventId,
    type,
    data: {
      object: {
        id: "in_1",
        customer: "cus_1",
        subscription: "sub_1",
        amount_paid: 1900,
        amount_due: 1900,
        currency: "usd",
        status: "paid",
        hosted_invoice_url: null,
        invoice_pdf: null,
        ...overrides,
      },
    },
  };
}

function customerUpdatedEvent(eventId: string, customerId: string): unknown {
  return {
    id: eventId,
    type: "customer.updated",
    data: {
      object: { id: customerId, email: "new@example.com", name: "New Name" },
    },
  };
}

function storedInvoice(): Row | undefined {
  return db.billing_invoices?.find((row) => row.stripe_invoice_id === "in_1");
}

describe("invoice and customer handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    customerReadError = null;
    db = {
      billing_events: [],
      billing_invoices: [],
      billing_subscriptions: [
        {
          id: "sub_row_1",
          user_id: "user-1",
          customer_id: "cust_row_1",
          stripe_subscription_id: "sub_1",
          plan: "pro",
          status: "active",
        },
      ],
      billing_customers: [
        {
          id: "cust_row_1",
          user_id: "user-1",
          stripe_customer_id: "cus_1",
          email: "old@example.com",
          name: "Old Name",
        },
      ],
    };
  });

  describe("invoice.payment_succeeded when the customer cannot be resolved", () => {
    /**
     * Companion guard: the same fixture DOES land an invoice row when the
     * customer is there, so the refusals below are about the customer lookup
     * and not about a payload that never reached the handler.
     */
    it("guard: an invoice for a known customer is recorded", async () => {
      const response = await deliver(
        invoiceEvent("evt_paid", "invoice.payment_succeeded"),
      );

      expect(response.status).toBe(200);
      expect(storedInvoice()?.customer_id).toBe("cust_row_1");
      expect(storedInvoice()?.subscription_id).toBe("sub_row_1");
    });

    it("refuses an invoice whose customer row is not there yet", async () => {
      // The row is committed by checkout; an invoice that overtakes it is a
      // race Stripe's retry schedule fixes on its own — but only if we refuse.
      db.billing_customers = [];

      const response = await deliver(
        invoiceEvent("evt_paid", "invoice.payment_succeeded"),
      );

      expect(response.status).toBe(500);
      expect(db.billing_invoices).toHaveLength(0);
    });

    it("refuses an invoice when the customer lookup itself fails", async () => {
      // Indistinguishable from "no such customer" while the error was dropped,
      // and the worse of the two: the row exists and the invoice is discarded.
      customerReadError = {
        code: "08006",
        message: "connection failure",
        details: "server closed the connection unexpectedly",
      };

      const response = await deliver(
        invoiceEvent("evt_paid", "invoice.payment_succeeded"),
      );

      expect(response.status).toBe(500);
      expect(db.billing_invoices).toHaveLength(0);
    });
  });

  describe("invoice.payment_failed matching no invoice row", () => {
    /**
     * Companion guard: the same fixture does update the row when it exists, so
     * the case below is genuinely about matching zero rows.
     */
    it("guard: the status lands on an invoice we recorded", async () => {
      db.billing_invoices = [
        {
          id: "inv_row_1",
          customer_id: "cust_row_1",
          stripe_invoice_id: "in_1",
          status: "paid",
        },
      ];

      const response = await deliver(
        invoiceEvent("evt_failed", "invoice.payment_failed", {
          status: "open",
        }),
      );

      expect(response.status).toBe(200);
      expect(storedInvoice()?.status).toBe("open");
      expect(loggedLines()).not.toContain("matched no billing_invoices row");
    });

    /**
     * Fix-stable, and the reason this is not an `assertRowMatched`:
     * `billing_invoices` rows are only ever written by `payment_succeeded`, so
     * a first-attempt failure on a brand-new subscription invoice legitimately
     * matches nothing. A 500 here would retry an event that can never succeed.
     */
    it("is still answered 200, because that is the common case", async () => {
      const response = await deliver(
        invoiceEvent("evt_failed", "invoice.payment_failed", {
          status: "open",
        }),
      );

      expect(response.status).toBe(200);
    });

    it("says so instead of reporting a write that did nothing", async () => {
      await deliver(
        invoiceEvent("evt_failed", "invoice.payment_failed", {
          status: "open",
        }),
      );

      expect(loggedLines()).toContain("matched no billing_invoices row");
      expect(loggedLines()).toContain("in_1");
    });
  });

  describe("customer.updated matching no customer row", () => {
    /**
     * Companion guard: the same fixture does update the row when it exists.
     */
    it("guard: the new email and name land on a customer we track", async () => {
      const response = await deliver(customerUpdatedEvent("evt_cust", "cus_1"));

      expect(response.status).toBe(200);
      expect(db.billing_customers[0].email).toBe("new@example.com");
      expect(db.billing_customers[0].name).toBe("New Name");
      expect(loggedLines()).not.toContain("matched no billing_customers row");
    });

    /**
     * Fix-stable: a Stripe customer this app never created — made in the
     * dashboard, or left behind by a failed enrolment — emits `customer.updated`
     * like any other. There is nothing to update and nothing to fix, so a 500
     * would only fill Stripe's retry queue.
     */
    it("is still answered 200, because an untracked customer is legitimate", async () => {
      const response = await deliver(
        customerUpdatedEvent("evt_cust", "cus_untracked"),
      );

      expect(response.status).toBe(200);
    });

    it("says so instead of reporting a write that did nothing", async () => {
      await deliver(customerUpdatedEvent("evt_cust", "cus_untracked"));

      expect(loggedLines()).toContain("matched no billing_customers row");
      expect(loggedLines()).toContain("cus_untracked");
    });
  });
});
