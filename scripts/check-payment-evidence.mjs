#!/usr/bin/env node
// No dotenv and no provider writes. Credentials must be supplied to this process
// deliberately; a primary checkout's local TEST env must not shadow Production.
import { createRequire } from "node:module";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let directory;
try {
  if (process.env.ANALYTICS_AUDIT_READONLY !== "1")
    throw new Error("Read-only audit opt-in required");
  if (
    process.argv.length > 3 ||
    (process.argv[2] &&
      !/^--accounts=(?:[1-9]|[1-9][0-9]|100)$/.test(process.argv[2]))
  )
    throw new Error("Invalid bounded readout");
  directory = await mkdtemp(path.join(root, ".omx-payment-audit-"));
  const outfile = path.join(directory, "audit.cjs");
  await build({
    entryPoints: [
      path.join(root, "src/lib/analytics/google-analytics/payment-audit.ts"),
    ],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    logLevel: "silent",
  });
  const { readPaymentEvidenceAudit } = createRequire(import.meta.url)(outfile);
  console.log(
    JSON.stringify(
      await readPaymentEvidenceAudit(
        process.argv[2] ? Number(process.argv[2].split("=")[1]) : 10,
      ),
    ),
  );
} catch {
  console.error(
    "Payment evidence audit unavailable; no financial or analytics writes were attempted.",
  );
  process.exitCode = 1;
} finally {
  if (directory) await rm(directory, { recursive: true, force: true });
}
