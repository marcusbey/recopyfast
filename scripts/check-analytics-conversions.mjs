#!/usr/bin/env node
// Node 24 executes the exact application payload/transport core via native type
// stripping. No independent payload copy and no package/runtime dependency.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  checkQaSignupMeasurement,
  checkQaCommerceMeasurement,
} from "../src/lib/analytics/google-analytics/measurement-protocol.ts";

export async function runCheck(
  args,
  { env = process.env, fetcher = fetch, now = Date.now() } = {},
) {
  if (
    args.length > 2 ||
    args.some(
      (arg) =>
        !["--mode=validate", "--mode=receipt", "--scenario=payments"].includes(
          arg,
        ),
    ) ||
    args.filter((arg) => arg.startsWith("--mode=")).length > 1 ||
    args.filter((arg) => arg.startsWith("--scenario=")).length > 1
  ) {
    throw new Error(
      "Unsupported arguments; use --mode=validate or --mode=receipt, optionally --scenario=payments",
    );
  }
  const mode = args.includes("--mode=receipt") ? "receipt" : "validate";
  if (args.includes("--scenario=payments")) {
    const transactionId = randomUUID();
    const purchase = {
      clientId: `${now}.112`,
      occurredAt: now,
      kind: "purchase",
      mode: "test",
      transactionId,
      valueMinor: 1900,
      taxMinor: 0,
      itemId: "pro",
      quantity: 1,
      customerType: "new",
    };
    const fixtures = [
      purchase,
      purchase,
      { ...purchase, transactionId: randomUUID(), customerType: "returning" },
      { ...purchase, kind: "refund", valueMinor: 500 },
    ];
    const results = [];
    for (const fixture of fixtures)
      results.push(
        await checkQaCommerceMeasurement(fixture, {
          mode,
          apiSecret: env.GA4_MP_QA_API_SECRET,
          fetcher,
          now,
        }),
      );
    const expected = mode === "validate" ? "validated" : "accepted_http";
    return {
      state: results.every((r) => r.state === expected) ? expected : "invalid",
      scenario: "payments",
      synthetic: true,
      results,
    };
  }
  return checkQaSignupMeasurement(
    { clientId: `${now}.111`, occurredAt: now },
    { mode, apiSecret: env.GA4_MP_QA_API_SECRET, fetcher, now },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = await runCheck(process.argv.slice(2));
    console.log(JSON.stringify(result));
    if (result.state === "validated") {
      console.log(
        "Validation only: no event was recorded and the API secret was not verified.",
      );
    } else if (result.state === "accepted_http") {
      console.log(
        "QA HTTP accepted only: verify actual event ingestion in RecopyFast QA. This is synthetic, not traction.",
      );
    } else {
      process.exitCode = 1;
    }
  } catch {
    console.error(
      "Analytics QA check refused. Use only --mode=validate or --mode=receipt.",
    );
    process.exitCode = 1;
  }
}
