/**
 * Server-only conversion transport. The auth path never calls Google directly;
 * the durable dispatcher must claim a frozen, still-eligible source first.
 * A successful HTTP response is not proof Google processed an event. In
 * particular, retrying a timeout can count one signup twice, so this layer never
 * retries and returns only bounded diagnostics, never a secret-bearing URL.
 *
 * This module also runs directly under Node 24's type stripping for the QA
 * command. Keep it free of application initialization and environment-file reads.
 */
const PRODUCTION_MEASUREMENT_ID = "G-DQ00NEM3WE";
const QA_MEASUREMENT_ID = "G-JHTG44WQ5W";
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

export type SignupMeasurementSource = Readonly<{
  clientId: string;
  occurredAt: number;
}>;
export type MeasurementResult =
  | { state: "disabled" }
  | { state: "accepted_http"; code: "http_2xx" }
  | { state: "validated"; code: "validation_only" }
  | { state: "invalid"; code: "invalid_source" }
  | { state: "invalid"; code: "validation_failed"; validationCodes: string[] }
  | {
      state: "uncertain";
      code: "http_non_2xx" | "transport_error" | "invalid_validation_response";
    };

type MeasurementConfig = {
  enabled?: string;
  environment?: string;
  measurementId?: string;
  apiSecret?: string;
};

/** Copy only reviewed fields; an extra runtime property never reaches Google. */
export function buildSignupPayload(
  source: SignupMeasurementSource,
  now: number,
) {
  if (
    !source ||
    typeof source.clientId !== "string" ||
    !/^[0-9]{1,32}\.[0-9]{1,32}$/.test(source.clientId) ||
    source.clientId.trim() !== source.clientId ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(source.occurredAt) ||
    source.occurredAt <= 0 ||
    !Number.isSafeInteger(source.occurredAt * 1000) ||
    source.occurredAt > now ||
    now - source.occurredAt > MAX_AGE_MS
  )
    return null;
  return {
    client_id: source.clientId,
    timestamp_micros: source.occurredAt * 1000,
    consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
    validation_behavior: "ENFORCE_RECOMMENDATIONS",
    // s110 does not establish a real session boundary. Neither a random session
    // nor invented engagement time may be added merely to appear in Realtime.
    events: [{ name: "sign_up", params: { method: "email" } }],
  };
}

async function postSignup(
  source: SignupMeasurementSource,
  target: {
    measurementId: string;
    apiSecret: string;
    validation: boolean;
    qa: boolean;
  },
  fetcher: typeof fetch,
  now: number,
): Promise<MeasurementResult> {
  const payload = buildSignupPayload(source, now);
  if (!payload) return { state: "invalid", code: "invalid_source" };
  const body = target.qa
    ? {
        ...payload,
        events: payload.events.map((event) => ({
          ...event,
          params: { ...event.params, debug_mode: true },
        })),
      }
    : payload;
  const query = new URLSearchParams({
    measurement_id: target.measurementId,
    api_secret: target.apiSecret,
  });
  const path = target.validation ? "debug/mp/collect" : "mp/collect";
  try {
    const response = await fetcher(
      `https://www.google-analytics.com/${path}?${query}`,
      {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) return { state: "uncertain", code: "http_non_2xx" };
    if (!target.validation) return { state: "accepted_http", code: "http_2xx" };
    // Validation does not authenticate the API secret or ingest the event. Do
    // not echo Google's field paths/descriptions: they can contain sent values.
    try {
      const data = await response.json();
      if (!Array.isArray(data?.validationMessages))
        return { state: "uncertain", code: "invalid_validation_response" };
      if (data.validationMessages.length === 0)
        return { state: "validated", code: "validation_only" };
      return {
        state: "invalid",
        code: "validation_failed",
        validationCodes: data.validationMessages
          .slice(0, 10)
          .map((message: { validationCode?: unknown }) =>
            typeof message?.validationCode === "string" &&
            /^[A-Z_]{1,64}$/.test(message.validationCode)
              ? message.validationCode
              : "UNKNOWN_VALIDATION_ERROR",
          ),
      };
    } catch {
      return { state: "uncertain", code: "invalid_validation_response" };
    }
  } catch {
    return { state: "uncertain", code: "transport_error" };
  }
}

export async function sendSignupMeasurement(
  source: SignupMeasurementSource,
  options: {
    config?: MeasurementConfig;
    fetcher?: typeof fetch;
    now?: number;
  } = {},
): Promise<MeasurementResult> {
  const config = options.config ?? {
    enabled: process.env.GA4_MP_ENABLED,
    environment: process.env.VERCEL_ENV,
    measurementId: process.env.GA4_MP_MEASUREMENT_ID,
    apiSecret: process.env.GA4_MP_API_SECRET,
  };
  if (
    typeof window !== "undefined" ||
    config.enabled !== "1" ||
    config.environment !== "production" ||
    config.measurementId !== PRODUCTION_MEASUREMENT_ID ||
    !config.apiSecret?.trim()
  )
    return { state: "disabled" };
  return postSignup(
    source,
    {
      measurementId: PRODUCTION_MEASUREMENT_ID,
      apiSecret: config.apiSecret,
      validation: false,
      qa: false,
    },
    options.fetcher ?? fetch,
    options.now ?? Date.now(),
  );
}

/** Operator-only, synthetic QA path; cannot select the production destination. */
export async function checkQaSignupMeasurement(
  source: SignupMeasurementSource,
  options: {
    mode: "validate" | "receipt";
    apiSecret?: string;
    fetcher?: typeof fetch;
    now?: number;
  },
): Promise<MeasurementResult> {
  if (
    typeof window !== "undefined" ||
    !options.apiSecret?.trim() ||
    !["validate", "receipt"].includes(options.mode)
  )
    return { state: "disabled" };
  return postSignup(
    source,
    {
      measurementId: QA_MEASUREMENT_ID,
      apiSecret: options.apiSecret,
      validation: options.mode === "validate",
      qa: true,
    },
    options.fetcher ?? fetch,
    options.now ?? Date.now(),
  );
}
