import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { redactDiagnostic } from "./redacted-diagnostics";

export type ProviderFailureStage =
  | "fixture:create"
  | "baseline:entitlement"
  | "checkout:create"
  | "checkout:inspect-open"
  | "checkout:hosted-form"
  | "checkout:reconcile"
  | "checkout:inspect-complete"
  | "billing:durable-state"
  | "billing:provider-subscription"
  | "billing:events"
  | "billing:entitlement"
  | "billing:replay"
  | "evidence:capture"
  | "cleanup"
  | "cleanup:assert";

interface ProviderFailureInput {
  runIndex: number;
  failedStage: ProviderFailureStage;
  error: unknown;
}

export interface ProviderFailureEvidence {
  mode: "test";
  runIndex: number;
  failedStage: ProviderFailureStage;
  diagnostic: string;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Unknown provider failure";
}

export function buildProviderFailureEvidence(
  input: ProviderFailureInput,
): ProviderFailureEvidence {
  return {
    mode: "test",
    runIndex: input.runIndex,
    failedStage: input.failedStage,
    diagnostic: redactDiagnostic(safeErrorMessage(input.error), 800),
  };
}

export function writeProviderFailureEvidence(
  outputFile: string,
  input: ProviderFailureInput,
): void {
  const evidence = buildProviderFailureEvidence(input);
  writeFailureFile(outputFile, evidence);
}

function writeFailureFile(
  outputFile: string,
  evidence: ProviderFailureEvidence,
): void {
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  // `mode` applies only when the file is created. A direct rerun can replace
  // an existing file, so chmod is the fail-closed guarantee that the safe
  // diagnostic remains owner-only in both runner and direct Playwright lanes.
  chmodSync(outputFile, 0o600);
}
