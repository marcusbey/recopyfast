/** @jest-environment node */

/**
 * s122 — the owner's "Install detected" email.
 *
 * The provider is mocked at the `resend` package, so the real renderer and the
 * real `send()` run: the assertions on the body are about what would actually
 * leave. The database is an in-memory fake whose `site_install_emails` insert
 * is insert-if-absent on `site_id`, which is what the primary key gives the
 * real table (exercised on PostgreSQL in src/__tests__/db/site-install-emails).
 */

// A module, not a script: with no import of its own, its top-level names would
// share one global scope with every other import-free test file under tsc.
export {};

const mockResendSend = jest.fn();
const mockCaptureMessage = jest.fn();
const mockResolveUserIdentity = jest.fn();
const mockCreateServiceRoleClient = jest.fn();

jest.mock("resend", () => ({
  Resend: jest.fn(() => ({ emails: { send: mockResendSend } })),
}));
jest.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}));
jest.mock("@/lib/auth/user-identity", () => ({
  resolveUserIdentity: (...args: unknown[]) => mockResolveUserIdentity(...args),
}));
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => mockCreateServiceRoleClient(),
}));

const SITE_ID = "6f1c2b9e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const OWNER_ID = "0c9d8e7f-6a5b-4c3d-2e1f-0a9b8c7d6e5f";
const OWNER_EMAIL = "owner@example.test";

interface LedgerRow {
  site_id: string;
  status: string;
  error_code?: string | null;
  sent_at?: string | null;
}

interface FakeOptions {
  ledgerError?: { code: string; message: string } | null;
  site?: { name: string; domain: string } | null;
  ownerUserId?: string | null;
}

/** Just enough of the PostgREST builder for the module under test. */
function fakeDb(options: FakeOptions = {}) {
  const ledger = new Map<string, LedgerRow>();
  const site =
    options.site === undefined
      ? { name: "Corner Bakery", domain: "cornerbakery.example" }
      : options.site;
  const ownerUserId =
    options.ownerUserId === undefined ? OWNER_ID : options.ownerUserId;

  function from(table: string) {
    const filters: Record<string, unknown> = {};
    let op: "select" | "upsert" | "update" = "select";
    let payload: Record<string, unknown> = {};

    const resolve = (): { data: unknown; error: unknown } => {
      if (table === "site_install_emails") {
        if (options.ledgerError)
          return { data: null, error: options.ledgerError };
        if (op === "upsert") {
          const id = payload.site_id as string;
          // ON CONFLICT DO NOTHING: synchronous check-and-set, so two
          // interleaved claims cannot both win, exactly like the PK.
          if (ledger.has(id)) return { data: [], error: null };
          ledger.set(id, { ...(payload as unknown as LedgerRow) });
          return { data: [{ site_id: id }], error: null };
        }
        if (op === "update") {
          const row = ledger.get(filters.site_id as string);
          if (row && row.status === filters.status) {
            ledger.set(row.site_id, { ...row, ...payload } as LedgerRow);
          }
          return { data: null, error: null };
        }
      }
      if (table === "sites") return { data: site, error: null };
      if (table === "site_permissions") {
        return {
          data: ownerUserId ? { user_id: ownerUserId } : null,
          error: null,
        };
      }
      throw new Error(`unexpected table ${table}`);
    };

    const builder = {
      upsert(row: Record<string, unknown>) {
        op = "upsert";
        payload = row;
        return builder;
      },
      update(patch: Record<string, unknown>) {
        op = "update";
        payload = patch;
        return builder;
      },
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters[column] = value;
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(resolve());
      },
      then<T>(
        onFulfilled: (value: { data: unknown; error: unknown }) => T,
        onRejected?: (reason: unknown) => T,
      ) {
        return Promise.resolve().then(resolve).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  return { client: { from }, ledger };
}

async function loadInstallEmail() {
  return import("../install-detected-email");
}

describe("notifyOwnerOfInstall", () => {
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = "re_test_placeholder";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    mockResendSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
    mockResolveUserIdentity.mockResolvedValue({
      email: OWNER_EMAIL,
      name: "Owner",
    });
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("emails the site owner once on the first live flip and records the send", async () => {
    const db = fakeDb();
    mockCreateServiceRoleClient.mockReturnValue(db.client);
    const { notifyOwnerOfInstall } = await loadInstallEmail();

    await expect(notifyOwnerOfInstall(SITE_ID)).resolves.toBe("sent");

    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const message = mockResendSend.mock.calls[0][0];
    expect(message.to).toBe(OWNER_EMAIL);
    expect(message.subject).toBe(
      "Your site is connected — you can edit it now",
    );
    expect(mockResolveUserIdentity).toHaveBeenCalledWith(OWNER_ID);
    expect(db.ledger.get(SITE_ID)).toMatchObject({
      status: "sent",
      sent_at: expect.any(String),
    });
  });

  it("does not send again on a later call for the same site", async () => {
    const db = fakeDb();
    mockCreateServiceRoleClient.mockReturnValue(db.client);
    const { notifyOwnerOfInstall } = await loadInstallEmail();

    await notifyOwnerOfInstall(SITE_ID);
    await expect(notifyOwnerOfInstall(SITE_ID)).resolves.toBe("duplicate");
    await expect(notifyOwnerOfInstall(SITE_ID)).resolves.toBe("duplicate");

    expect(mockResendSend).toHaveBeenCalledTimes(1);
  });

  it("sends exactly once when concurrent invocations race for the same site", async () => {
    const db = fakeDb();
    mockCreateServiceRoleClient.mockReturnValue(db.client);
    const { notifyOwnerOfInstall } = await loadInstallEmail();

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => notifyOwnerOfInstall(SITE_ID)),
    );

    expect(outcomes.filter((o) => o === "sent")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(4);
    expect(mockResendSend).toHaveBeenCalledTimes(1);
  });

  it("does not resend after a failed attempt, and records the failure without the address", async () => {
    const db = fakeDb();
    mockCreateServiceRoleClient.mockReturnValue(db.client);
    mockResendSend.mockResolvedValueOnce({
      data: null,
      error: { message: `rejected ${OWNER_EMAIL}` },
    });
    const { notifyOwnerOfInstall } = await loadInstallEmail();

    await expect(notifyOwnerOfInstall(SITE_ID)).resolves.toBe("failed");
    await expect(notifyOwnerOfInstall(SITE_ID)).resolves.toBe("duplicate");

    expect(mockResendSend).toHaveBeenCalledTimes(1);
    expect(db.ledger.get(SITE_ID)).toMatchObject({
      status: "failed",
      error_code: "provider_rejected",
    });
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      "[install-email] owner email not sent",
      expect.objectContaining({
        tags: expect.objectContaining({
          install_email_stage: "send",
          install_email_code: "provider_rejected",
        }),
      }),
    );
    expect(JSON.stringify(mockCaptureMessage.mock.calls)).not.toContain(
      OWNER_EMAIL,
    );
  });

  it("puts only the token-free dashboard link in the body", async () => {
    mockCreateServiceRoleClient.mockReturnValue(fakeDb().client);
    const { notifyOwnerOfInstall } = await loadInstallEmail();

    await notifyOwnerOfInstall(SITE_ID);

    const { html, text } = mockResendSend.mock.calls[0][0];
    const dashboard = `http://localhost:3000/dashboard/sites/${SITE_ID}`;
    const hrefs = Array.from(
      (html as string).matchAll(/href="([^"]*)"/g),
      (match) => match[1],
    );
    expect(hrefs).toEqual([dashboard]);
    expect(text).toContain(`Open your dashboard: ${dashboard}`);
    for (const body of [html, text] as string[]) {
      // Every URL in either body is the dashboard, with no query or fragment.
      expect(body.match(/https?:\/\/[^\s"<]+/g)).toEqual([dashboard]);
      expect(body).not.toMatch(/token|staging|session/i);
    }
  });

  it("names the site, says the line is installed, gives three tips and thanks the developer", async () => {
    mockCreateServiceRoleClient.mockReturnValue(fakeDb().client);
    const { notifyOwnerOfInstall } = await loadInstallEmail();

    await notifyOwnerOfInstall(SITE_ID);

    const { html, text } = mockResendSend.mock.calls[0][0];
    expect(text).toContain(
      "ReCopyFast is now installed on Corner Bakery (cornerbakery.example).",
    );
    expect(text).toMatch(/1\. .*click any text/);
    expect(text).toMatch(/2\. .*Publish/);
    expect(text).toMatch(/3\. .*Changes.*revert/);
    expect(text).toContain(
      "If your developer installed it, thank them — they won't need to touch it again.",
    );
    expect((html as string).match(/<li\b/g)).toHaveLength(3);
    // s120 messaging rules: no promise the product cannot keep.
    expect(`${html}\n${text}`).not.toMatch(/surviv|redesign|forever|always/i);
  });

  it("escapes an owner-controlled site name in the HTML body and the header", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      fakeDb({
        site: {
          name: "Bad <script>alert(1)</script>\r\nBcc: x@y.z",
          domain: "evil.example",
        },
      }).client,
    );
    const { notifyOwnerOfInstall } = await loadInstallEmail();

    await notifyOwnerOfInstall(SITE_ID);

    const { html, subject } = mockResendSend.mock.calls[0][0];
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/\r|\nBcc/);
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it("skips the send when the ledger table is missing (code deployed before the migration)", async () => {
    mockCreateServiceRoleClient.mockReturnValue(
      fakeDb({
        ledgerError: {
          code: "PGRST205",
          message: "Could not find the table 'public.site_install_emails'",
        },
      }).client,
    );
    const { notifyOwnerOfInstall } = await loadInstallEmail();

    await expect(notifyOwnerOfInstall(SITE_ID)).resolves.toBe("skipped");
    expect(mockResendSend).not.toHaveBeenCalled();
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      "[install-email] owner email not sent",
      expect.objectContaining({
        tags: expect.objectContaining({ install_email_stage: "claim" }),
      }),
    );
  });

  it("claims nothing and sends nothing when no email provider is configured", async () => {
    delete process.env.RESEND_API_KEY;
    const db = fakeDb();
    mockCreateServiceRoleClient.mockReturnValue(db.client);
    const { notifyOwnerOfInstall } = await loadInstallEmail();

    await expect(notifyOwnerOfInstall(SITE_ID)).resolves.toBe("disabled");
    expect(db.ledger.size).toBe(0);
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it("records a failure when the site has no owner", async () => {
    const db = fakeDb({ ownerUserId: null });
    mockCreateServiceRoleClient.mockReturnValue(db.client);
    const { notifyOwnerOfInstall } = await loadInstallEmail();

    await expect(notifyOwnerOfInstall(SITE_ID)).resolves.toBe("failed");
    expect(mockResendSend).not.toHaveBeenCalled();
    expect(db.ledger.get(SITE_ID)).toMatchObject({
      status: "failed",
      error_code: "no_owner",
    });
  });

  it("never rejects when the database, the identity lookup or the provider throws", async () => {
    const { notifyOwnerOfInstall } = await loadInstallEmail();

    mockCreateServiceRoleClient.mockImplementation(() => {
      throw new Error("service role misconfigured");
    });
    await expect(notifyOwnerOfInstall(SITE_ID)).resolves.toBe("skipped");

    mockCreateServiceRoleClient.mockReturnValue(fakeDb().client);
    mockResolveUserIdentity.mockRejectedValueOnce(new Error("GoTrue down"));
    await expect(notifyOwnerOfInstall(SITE_ID)).resolves.toBe("failed");

    mockCreateServiceRoleClient.mockReturnValue(fakeDb().client);
    mockResendSend.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(notifyOwnerOfInstall(SITE_ID)).resolves.toBe("failed");
  });
});
