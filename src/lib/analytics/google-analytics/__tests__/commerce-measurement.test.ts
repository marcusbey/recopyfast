/** @jest-environment node */
import {
  buildCommercePayload,
  sendCommerceMeasurement,
  checkQaCommerceMeasurement,
} from "../measurement-protocol";
const now = Date.parse("2026-10-12T12:00:00Z");
const source = {
  clientId: "123.456",
  occurredAt: now - 1000,
  kind: "purchase" as const,
  mode: "live" as const,
  transactionId: "a1197dee-1dde-423a-81b9-b9372a7286de",
  valueMinor: 1900,
  taxMinor: 0,
  itemId: "pro",
  quantity: 1,
};
const config = {
  enabled: "1",
  environment: "production",
  measurementId: "G-DQ00NEM3WE",
  apiSecret: "dummy",
};
test("purchase and refund use the same opaque transaction id and allowlisted money", () => {
  const payload = buildCommercePayload(
    {
      ...source,
      customerType: "returning",
      user_id: "private",
      email: "private",
    } as typeof source,
    now,
  );
  expect(payload?.events).toEqual([
    {
      name: "purchase",
      params: {
        transaction_id: source.transactionId,
        currency: "USD",
        value: 19,
        tax: 0,
        customer_type: "returning",
        items: [{ item_id: "pro", price: 19, quantity: 1 }],
      },
    },
  ]);
  expect(
    buildCommercePayload({ ...source, kind: "refund", valueMinor: 500 }, now)
      ?.events[0],
  ).toMatchObject({
    name: "refund",
    params: { transaction_id: source.transactionId, value: 5 },
  });
  expect(JSON.stringify(payload)).not.toMatch(
    /private|session_id|engagement_time/,
  );
});
test.each([
  { transactionId: "pi_raw" },
  { valueMinor: -1 },
  { valueMinor: 0.5 },
  { quantity: 0 },
  { itemId: "unknown" },
  { taxMinor: -1 },
  { occurredAt: now + 1 },
])("rejects invalid payload %p", (override) =>
  expect(buildCommercePayload({ ...source, ...override }, now)).toBeNull(),
);
test("TEST purchases never reach production transport", async () => {
  const fetcher = jest.fn();
  expect(
    await sendCommerceMeasurement(
      { ...source, mode: "test" },
      { config, now, fetcher },
    ),
  ).toEqual({ state: "disabled" });
  expect(fetcher).not.toHaveBeenCalled();
});
test("QA uses the shared commerce builder with only QA destination", async () => {
  const fetcher = jest
    .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
    .mockResolvedValue(new Response(null, { status: 204 }));
  expect(
    await checkQaCommerceMeasurement(
      { ...source, mode: "test" },
      { mode: "receipt", apiSecret: "dummy", now, fetcher },
    ),
  ).toMatchObject({ state: "accepted_http" });
  expect(fetcher.mock.calls[0][0]).toContain("G-JHTG44WQ5W");
});
test("a cash partial refund never invents a refunded item quantity", () => {
  const refund = buildCommercePayload(
    { ...source, kind: "refund", valueMinor: 500, quantity: 10 },
    now,
  );
  expect(refund?.events[0].params).not.toHaveProperty("items");
});
