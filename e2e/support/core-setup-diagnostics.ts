import {
  MAX_REDACTED_DIAGNOSTIC_LENGTH,
  redactDiagnostic,
} from "./redacted-diagnostics";

export type CoreSetupStage =
  | "create local client"
  | "delete captured fixture"
  | "seed site"
  | "seed staging access"
  | "seed edit session"
  | "start target server";

type ErrorRecord = Record<string, unknown>;

function readableField(error: ErrorRecord, field: string): string | null {
  const value = error[field];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function describeUnknownError(error: unknown): string {
  if (typeof error === "string") return error;

  if (error && typeof error === "object") {
    const record = error as ErrorRecord;
    const rawMessage =
      error instanceof Error ? error.message : readableField(record, "message");
    const fields = [
      redactDiagnostic(rawMessage || "Unknown setup error", 700),
      ...(["code", "details", "hint"] as const).flatMap((field) => {
        const value = readableField(record, field);
        const limits = { code: 100, details: 300, hint: 300 } as const;
        return value
          ? [`${field}=${redactDiagnostic(value, limits[field])}`]
          : [];
      }),
    ];
    return fields.join(" | ");
  }

  return `Unknown setup error (${typeof error})`;
}

/**
 * Surface the exact failing fixture boundary without retaining database rows,
 * raw stacks or credentials. The original error is rethrown so Playwright's
 * pass/fail behavior is unchanged.
 */
export async function withCoreSetupDiagnostic<T>(
  stage: CoreSetupStage,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const prefix = `[core-e2e setup] ${stage}: `;
    const diagnostic = redactDiagnostic(
      describeUnknownError(error),
      MAX_REDACTED_DIAGNOSTIC_LENGTH - prefix.length,
    );
    console.error(`${prefix}${diagnostic}`);
    throw error;
  }
}
