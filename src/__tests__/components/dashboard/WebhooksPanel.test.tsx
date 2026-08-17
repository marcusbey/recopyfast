/**
 * WebhooksPanel — the only surface any of this has ever had (AC 1, 4, 7).
 *
 * Before this component nothing in the dashboard rendered /api/webhooks at all:
 * the configuration API, the delivery engine and the tables existed, and there
 * was no way for an owner to reach any of them.
 *
 * Two moments here carry the whole story's weight and are asserted directly:
 *
 *   - The secret is shown ONCE. The dialog cannot be dismissed by accident,
 *     because the value behind it is not recoverable.
 *   - The two SSRF refusals read differently. A configuration-time refusal is a
 *     correctable mistake shown under the field; a delivery-time refusal is a
 *     changed DNS record shown in the history, and telling an owner "connection
 *     failed" for the second would send them looking at the wrong thing.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WebhooksPanel } from "@/components/dashboard/WebhooksPanel";

beforeAll(() => {
  Element.prototype.hasPointerCapture = jest.fn(() => false);
  Element.prototype.setPointerCapture = jest.fn();
  Element.prototype.releasePointerCapture = jest.fn();
  Element.prototype.scrollIntoView = jest.fn();
});

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const WEBHOOK_ID = "22222222-2222-4222-8222-222222222222";

const CONFIGURED_WEBHOOK = {
  id: WEBHOOK_ID,
  site_id: SITE_ID,
  url: "https://build.example.com/hook",
  events: ["content.updated"],
  secret_prefix: "a1b2c3d4",
  is_active: true,
  failure_count: 0,
  max_failures: 5,
  coalesce_window_seconds: 30,
  created_at: "2026-08-16T00:00:00.000Z",
  updated_at: "2026-08-16T00:00:00.000Z",
};

const DELIVERIES = [
  {
    id: "d-1",
    webhook_id: WEBHOOK_ID,
    event_type: "content.updated",
    payload: {},
    attempt_number: 1,
    success: true,
    status: "delivered",
    response_status: 200,
    next_retry_at: null,
    delivered_at: "2026-08-16T14:02:00.000Z",
  },
  {
    id: "d-2",
    webhook_id: WEBHOOK_ID,
    event_type: "content.updated",
    payload: {},
    attempt_number: 2,
    success: false,
    status: "retrying",
    next_retry_at: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
    delivered_at: "2026-08-16T13:47:00.000Z",
  },
  {
    id: "d-3",
    webhook_id: WEBHOOK_ID,
    event_type: "content.updated",
    payload: {},
    attempt_number: 5,
    success: false,
    status: "failed",
    next_retry_at: null,
    error_message:
      "Blocked before sending — this endpoint resolved to a disallowed address at send time. 169.254.169.254 is a link-local address. If the URL passed validation when you saved it, its DNS record may have changed since (DNS rebinding); update the URL if this persists.",
    delivered_at: "2026-08-16T09:15:00.000Z",
  },
  {
    id: "d-4",
    webhook_id: WEBHOOK_ID,
    event_type: "content.updated",
    payload: {},
    attempt_number: 1,
    success: false,
    status: "pending",
    next_retry_at: null,
    delivered_at: "2026-08-16T14:09:00.000Z",
  },
];

type Handler = (init?: RequestInit) => {
  ok: boolean;
  status: number;
  body: unknown;
};

const handlers = new Map<string, Handler>();
const fetchMock = jest.fn();

function route(key: string, handler: Handler) {
  handlers.set(key, handler);
}

function keyFor(url: string, method: string) {
  if (url.startsWith("/api/webhooks/deliveries")) return "GET deliveries";
  if (url.startsWith("/api/webhooks/test")) return "POST test";
  return `${method} webhooks`;
}

beforeEach(() => {
  handlers.clear();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;

  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const handler = handlers.get(keyFor(url, init?.method ?? "GET"));
    if (!handler) {
      return Promise.reject(new Error(`No handler for ${init?.method} ${url}`));
    }
    const { ok, status, body } = handler(init);
    return Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(body),
    });
  });

  route("GET webhooks", () => ({ ok: true, status: 200, body: [] }));
  route("GET deliveries", () => ({
    ok: true,
    status: 200,
    body: { deliveries: [] },
  }));
});

function renderPanel() {
  return render(<WebhooksPanel siteId={SITE_ID} />);
}

describe("WebhooksPanel", () => {
  describe("states", () => {
    it("shows a loading skeleton before the configuration arrives", async () => {
      renderPanel();

      expect(screen.getByLabelText("Loading webhooks")).toBeInTheDocument();

      // Let the load settle inside the test. Leaving it in flight makes React
      // apply the state update after teardown, which is both an act() warning
      // and a real source of cross-test flakiness.
      await waitFor(() =>
        expect(
          screen.queryByLabelText("Loading webhooks"),
        ).not.toBeInTheDocument(),
      );
    });

    it("shows the empty state when no webhook is configured", async () => {
      renderPanel();

      expect(
        await screen.findByText(/No webhook configured for this site/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /add webhook/i }),
      ).toBeInTheDocument();
    });

    it("shows an error alert — not the empty state — when the load fails", async () => {
      route("GET webhooks", () => ({
        ok: false,
        status: 500,
        body: { error: "boom" },
      }));

      renderPanel();

      expect(
        await screen.findByText(/Couldn't load webhook settings/i),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/No webhook configured for this site/i),
      ).not.toBeInTheDocument();
    });

    it("shows the configured URL and the coalescing default in words", async () => {
      route("GET webhooks", () => ({
        ok: true,
        status: 200,
        body: [CONFIGURED_WEBHOOK],
      }));

      renderPanel();

      expect(await screen.findByLabelText(/webhook url/i)).toHaveValue(
        "https://build.example.com/hook",
      );
      // AC 4: a closed Select hides its own meaning, so the default is stated.
      expect(screen.getByText(/Default: 30 seconds/i)).toBeInTheDocument();
    });
  });

  describe("creating a webhook", () => {
    it("posts the URL and shows the secret exactly once, in a dialog that cannot be dismissed by accident", async () => {
      const user = userEvent.setup();
      route("POST webhooks", () => ({
        ok: true,
        status: 201,
        body: {
          webhook: CONFIGURED_WEBHOOK,
          secret: "f".repeat(64),
          warning: "Store this signing secret securely.",
        },
      }));
      route("GET webhooks", () => ({ ok: true, status: 200, body: [] }));

      renderPanel();
      await user.click(
        await screen.findByRole("button", { name: /add webhook/i }),
      );
      await user.type(
        screen.getByLabelText(/webhook url/i),
        "https://build.example.com/hook",
      );
      await user.click(screen.getByRole("button", { name: /^save$/i }));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("f".repeat(64))).toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: "Close" }),
      ).not.toBeInTheDocument();

      // Escape must not take the secret away — it cannot be shown again.
      await user.keyboard("{Escape}");
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      await user.click(
        within(dialog).getByRole("button", { name: /saved it|copied/i }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
    });

    it("renders a refused address under the URL field, naming the class", async () => {
      const user = userEvent.setup();
      route("POST webhooks", () => ({
        ok: false,
        status: 400,
        body: {
          error:
            "169.254.169.254 is a link-local address — not something reachable from the public internet.",
        },
      }));

      renderPanel();
      await user.click(
        await screen.findByRole("button", { name: /add webhook/i }),
      );
      await user.type(
        screen.getByLabelText(/webhook url/i),
        "http://169.254.169.254/rebuild",
      );
      await user.click(screen.getByRole("button", { name: /^save$/i }));

      expect(
        await screen.findByText(/This address can't be used/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/link-local address/i)).toBeInTheDocument();
    });
  });

  describe("delivery history", () => {
    beforeEach(() => {
      route("GET webhooks", () => ({
        ok: true,
        status: 200,
        body: [CONFIGURED_WEBHOOK],
      }));
      route("GET deliveries", () => ({
        ok: true,
        status: 200,
        body: { deliveries: DELIVERIES },
      }));
    });

    it("renders one row per delivery with its own outcome", async () => {
      renderPanel();

      const rows = await screen.findAllByRole("listitem");
      expect(rows).toHaveLength(4);
      expect(screen.getByText("Delivered")).toBeInTheDocument();
      expect(screen.getByText("Retrying")).toBeInTheDocument();
      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getByText("Pending")).toBeInTheDocument();
    });

    it("counts attempts against the stated limit and says when the next one is due", async () => {
      renderPanel();

      expect(await screen.findByText("2 of 5")).toBeInTheDocument();
      expect(screen.getByText(/next attempt in/i)).toBeInTheDocument();
    });

    it("says a delivery-time SSRF refusal happened at send time, not that the server was unreachable", async () => {
      renderPanel();

      const reason = await screen.findByText(/DNS rebinding/i);
      expect(reason).toHaveTextContent(/at send time/i);
    });

    it("explains a pending row as batching, with the window that is open", async () => {
      renderPanel();

      expect(await screen.findByText(/Batching/i)).toHaveTextContent(
        /30-second window/i,
      );
    });
  });

  describe("manual test delivery", () => {
    beforeEach(() => {
      route("GET webhooks", () => ({
        ok: true,
        status: 200,
        body: [CONFIGURED_WEBHOOK],
      }));
    });

    it("reports a successful test inline", async () => {
      const user = userEvent.setup();
      route("POST test", () => ({
        ok: true,
        status: 200,
        body: { success: true, statusCode: 200, responseTime: 340 },
      }));

      renderPanel();
      await user.click(
        await screen.findByRole("button", { name: /send test delivery/i }),
      );

      expect(
        await screen.findByText(/Test delivery sent/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/340/)).toBeInTheDocument();
    });

    it("reports a failed test inline, with the reason", async () => {
      const user = userEvent.setup();
      route("POST test", () => ({
        ok: true,
        status: 200,
        body: { success: false, error: "Endpoint refused the connection" },
      }));

      renderPanel();
      await user.click(
        await screen.findByRole("button", { name: /send test delivery/i }),
      );

      expect(
        await screen.findByText(/Endpoint refused the connection/i),
      ).toBeInTheDocument();
    });
  });
});
