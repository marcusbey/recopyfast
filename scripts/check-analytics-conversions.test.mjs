import { test } from "node:test";
import assert from "node:assert/strict";
import { runCheck } from "./check-analytics-conversions.mjs";

const env = { GA4_MP_QA_API_SECRET: "dummy-qa-only" };
const now = Date.parse("2026-10-12T12:00:00Z");
test("default validation uses shared allowlisted signup payload and QA endpoint", async () => {
  const calls = [];
  const result = await runCheck([], {
    env,
    now,
    fetcher: async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify({ validationMessages: [] }), {
        status: 200,
      });
    },
  });
  assert.equal(result.state, "validated");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0][0],
    "https://www.google-analytics.com/debug/mp/collect?measurement_id=G-JHTG44WQ5W&api_secret=dummy-qa-only",
  );
  const payload = JSON.parse(calls[0][1].body);
  assert.deepEqual(payload.events, [
    { name: "sign_up", params: { method: "email", debug_mode: true } },
  ]);
  assert.equal(payload.validation_behavior, "ENFORCE_RECOMMENDATIONS");
});
test("receipt explicitly requests real QA collection but never claims ingestion", async () => {
  let url;
  const result = await runCheck(["--mode=receipt"], {
    env,
    now,
    fetcher: async (target) => {
      url = target;
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(result.state, "accepted_http");
  assert.equal(new URL(url).pathname, "/mp/collect");
  assert.equal(new URL(url).searchParams.get("measurement_id"), "G-JHTG44WQ5W");
});
for (const args of [
  ["--measurement-id=G-DQ00NEM3WE"],
  ["--url=https://evil.invalid"],
  ["--mode=production"],
  ["--mode=receipt", "--mode=validate"],
  ["--event=purchase"],
]) {
  test(`rejects unsupported flags ${args.join(" ")}`, async () => {
    let count = 0;
    await assert.rejects(
      runCheck(args, {
        env,
        now,
        fetcher: async () => {
          count++;
        },
      }),
      /Unsupported arguments/,
    );
    assert.equal(count, 0);
  });
}
test("missing QA secret does not use production credential", async () => {
  let count = 0;
  const result = await runCheck([], {
    env: { GA4_MP_API_SECRET: "do-not-use" },
    now,
    fetcher: async () => {
      count++;
    },
  });
  assert.equal(result.state, "disabled");
  assert.equal(count, 0);
});
test("validation errors expose codes only, no provider descriptions or credential data", async () => {
  const result = await runCheck([], {
    env,
    now,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          validationMessages: [
            {
              validationCode: "VALUE_INVALID",
              description: "secret dummy-qa-only",
              fieldPath: "private",
            },
          ],
        }),
      ),
  });
  assert.deepEqual(result, {
    state: "invalid",
    code: "validation_failed",
    validationCodes: ["VALUE_INVALID"],
  });
});
test("malformed validation response is not accepted and no exception leaks", async () => {
  const result = await runCheck([], {
    env,
    now,
    fetcher: async () => new Response("private garbage"),
  });
  assert.deepEqual(result, {
    state: "uncertain",
    code: "invalid_validation_response",
  });
});
test("payment scenario validates duplicate, renewal and refund through shared QA core", async () => {
  const bodies = [];
  const result = await runCheck(["--scenario=payments"], {
    env,
    now,
    fetcher: async (url, options) => {
      assert.equal(
        new URL(url).searchParams.get("measurement_id"),
        "G-JHTG44WQ5W",
      );
      bodies.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ validationMessages: [] }), {
        status: 200,
      });
    },
  });
  assert.equal(result.state, "validated");
  assert.equal(bodies.length, 4);
  const transactions = bodies.map((b) => b.events[0].params.transaction_id);
  assert.equal(transactions[0], transactions[1]);
  assert.notEqual(transactions[0], transactions[2]);
  assert.equal(transactions[0], transactions[3]);
  assert.equal(bodies[3].events[0].name, "refund");
  assert.equal(bodies[2].events[0].params.customer_type, "returning");
});
