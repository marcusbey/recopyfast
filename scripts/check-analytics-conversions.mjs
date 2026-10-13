#!/usr/bin/env node
// Node 24 executes the exact application payload/transport core via native type
// stripping. No independent payload copy and no package/runtime dependency.
import { pathToFileURL } from "node:url";
import { checkQaSignupMeasurement } from "../src/lib/analytics/google-analytics/measurement-protocol.ts";

export async function runCheck(
  args,
  { env = process.env, fetcher = fetch, now = Date.now() } = {},
) {
  if (
    args.length > 1 ||
    (args.length === 1 &&
      !["--mode=validate", "--mode=receipt"].includes(args[0]))
  ) {
    throw new Error(
      "Unsupported arguments; use --mode=validate or --mode=receipt",
    );
  }
  const mode = args[0] === "--mode=receipt" ? "receipt" : "validate";
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
        "QA HTTP accepted only: verify actual sign_up ingestion in RecopyFast QA. This is synthetic, not traction.",
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
