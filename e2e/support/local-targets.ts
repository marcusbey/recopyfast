const PRODUCTION_PROJECT_REF = "uexwowziiigweobgpmtk";

type Environment = Record<string, string | undefined>;

export interface LocalMutationTargets {
  supabaseUrl: string;
  appUrl: string;
  webSocketUrl: string;
}

export function assertMutatingRunEnabled(
  flagName: "RUN_RECOPYFAST_CORE_E2E" | "RUN_RECOPYFAST_PARITY",
  env: Environment = process.env,
): void {
  if (env[flagName] !== "1") {
    throw new Error(
      `${flagName} must equal 1 for this mutating E2E suite; these tests are never skipped.`,
    );
  }
}

interface RequiredLocalUrl {
  envName: string;
  port: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function refusal(reason: string): never {
  throw new Error(`Refusing mutating E2E: ${reason}`);
}

function readLocalUrl(
  env: Environment,
  { envName, port }: RequiredLocalUrl,
): string {
  const rawValue = env[envName];
  if (!rawValue) {
    refusal(`${envName} is required.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    refusal(`${envName} is not a valid URL.`);
  }

  const hasUnexpectedLocation =
    parsed.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(parsed.hostname) ||
    parsed.port !== port ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== "";

  if (hasUnexpectedLocation) {
    refusal(
      `${envName} must be an exact loopback HTTP origin on port ${port}.`,
    );
  }

  return parsed.origin;
}

function decodedJwtPayload(value: string): string {
  const segments = value.split(".");
  if (segments.length !== 3) return "";

  try {
    return Buffer.from(segments[1], "base64url").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Mutating Playwright runs use the service-role client, so a typo here can
 * delete rows in whichever Supabase project the shell happens to name. The
 * pre-s24 specs trusted environment variables directly and even documented a
 * production-backed parity run. Keep this check independent of the fixtures:
 * every caller must pass it before constructing a service-role client.
 */
export function assertLocalMutationTargets(
  env: Environment = process.env,
): LocalMutationTargets {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    refusal("SUPABASE_SERVICE_ROLE_KEY is required.");
  }

  const keyEvidence = `${serviceRoleKey}\n${decodedJwtPayload(serviceRoleKey)}`;
  if (keyEvidence.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error(
      "Refusing mutating E2E: the service-role credential names the production project.",
    );
  }

  return {
    supabaseUrl: readLocalUrl(env, {
      envName: "NEXT_PUBLIC_SUPABASE_URL",
      port: "54321",
    }),
    appUrl: readLocalUrl(env, {
      envName: "PLAYWRIGHT_BASE_URL",
      port: "3000",
    }),
    webSocketUrl: readLocalUrl(env, {
      envName: "NEXT_PUBLIC_WS_URL",
      port: "4001",
    }),
  };
}
