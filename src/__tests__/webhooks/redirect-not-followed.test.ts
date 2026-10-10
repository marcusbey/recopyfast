/**
 * @jest-environment node
 */
import http from "http";
import type { AddressInfo } from "net";
import { createServerClient } from "@supabase/ssr";
import { WebhookManager, WEBHOOK_EVENTS } from "@/lib/webhooks/manager";

/**
 * SSRF BY REDIRECT, PROVEN ON REAL SOCKETS (s68b M1).
 *
 * The unit suite asserts the `redirect: "manual"` option; this one proves what
 * the option is for. Two loopback servers: A answers `302 Location: <B>`, B is
 * the "internal" target. The webhook guard is mocked to accept loopback (the
 * real guard refuses 127.0.0.1 — that is the point of it, and it only ever sees
 * A). With redirects followed, Node's fetch sent B a request on our behalf and
 * its body was stored on the delivery row. B must receive nothing.
 *
 * Node environment on purpose: jsdom's `whatwg-fetch` polyfill would replace the
 * undici fetch the route actually runs on.
 */
jest.mock("@supabase/ssr");
jest.mock("@/lib/security/webhook-url-safety", () => ({
  assertSafeWebhookUrl: jest.fn(async (url: string) => ({
    ok: true,
    value: url,
  })),
  describeDeliveryRefusal: jest.fn((reason: string) => reason),
}));

type Recorded = { method?: string; url?: string };

function listen(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

describe("webhook delivery against a redirecting endpoint", () => {
  const targetRequests: Recorded[] = [];
  const endpointRequests: Recorded[] = [];
  let target: { server: http.Server; url: string };
  let endpoint: { server: http.Server; url: string };
  const inserted: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    target = await listen((req, res) => {
      targetRequests.push({ method: req.method, url: req.url });
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("internal secret");
    });
    endpoint = await listen((req, res) => {
      endpointRequests.push({ method: req.method, url: req.url });
      req.resume();
      res.writeHead(302, { Location: `${target.url}latest/meta-data` });
      res.end();
    });

    const webhookRow = {
      id: "webhook-1",
      site_id: "site-123",
      url: endpoint.url,
      secret: "secret-key",
      failure_count: 0,
      max_failures: 5,
    };

    const builder = (result: unknown) => {
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      for (const method of ["select", "eq", "contains", "update"]) {
        chain[method] = () => chain;
      }
      chain.insert = (row: Record<string, unknown>) => {
        inserted.push(row);
        return chain;
      };
      return chain;
    };

    (createServerClient as jest.Mock).mockReturnValue({
      from: (table: string) =>
        builder(
          table === "webhooks"
            ? { data: [webhookRow], error: null }
            : { data: null, error: null },
        ),
    });
  });

  afterAll(async () => {
    await close(endpoint.server);
    await close(target.server);
  });

  it("sends nothing to the redirect target and stores nothing from it", async () => {
    await new WebhookManager().triggerEvent({
      siteId: "site-123",
      eventType: WEBHOOK_EVENTS.CONTENT_UPDATED,
      payload: { elementId: "elem-1" },
    });

    expect(endpointRequests).toHaveLength(1);
    expect(targetRequests).toHaveLength(0);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      success: false,
      response_status: 302,
      response_body: null,
      error_message:
        "Endpoint redirected (302). Webhooks do not follow redirects.",
    });
  });
});
