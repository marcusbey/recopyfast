import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { resolve } from "node:path";
import process from "node:process";
import dotenv from "dotenv";
import processHelpers from "./stripe-provider-process.cjs";

const {
  PROVIDER_FAILURE_STAGES,
  assertNoUncleanRunManifest,
  assertNoUncleanRunManifests,
  createCleanupStateMachine,
  recordExternalJanitorFailure,
  registerProcess,
  spawnDetached,
  terminateProcessGroup,
  validateProviderEvidence,
  writeRunManifest,
} = processHelpers;

const DEFAULT_RUNS = 2;
const PLAYWRIGHT_PROCESS_TIMEOUT_MS = 9 * 60_000;
const JANITOR_PROCESS_TIMEOUT_MS = 10 * 60_000;
const FAILURE_MIN_OBSERVATION_MS = 5 * 60_000;
const SUCCESS_MIN_OBSERVATION_MS = 0;
const SUPABASE_CLI_VERSION = "2.117.0";
const SUPABASE_EXCLUSIONS =
  "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
const APP_URL = "http://127.0.0.1:3000";
const SUPABASE_URL = "http://127.0.0.1:54321";
const WS_URL = "http://127.0.0.1:4001";
const REDIS_URL = "redis://127.0.0.1:6379";
const ROOT = process.cwd();
const TEST_RESULTS_DIR = resolve(ROOT, "test-results");
const STRIPE_EVENTS = [
  "checkout.session.completed",
  "customer.created",
  "customer.deleted",
  "customer.subscription.created",
  "customer.subscription.deleted",
  "customer.subscription.updated",
  "invoice.payment_succeeded",
].join(",");
let activeRunCleanup;
let activeCommandRegistry;
let signalExitPromise;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (signalExitPromise) return;
    signalExitPromise = (async () => {
      let exitCode = signal === "SIGINT" ? 130 : 143;
      try {
        if (activeRunCleanup) await activeRunCleanup(signal);
      } catch {
        process.stderr.write(
          "[stripe-provider] interrupted cleanup did not complete.\n",
        );
        exitCode = 1;
      }
      process.exit(exitCode);
    })();
  });
}

const runs = parseRuns(process.argv.slice(2));
loadPrivateEnvironment();
assertTestStripeInputs(process.env);
const supabaseCliBin = process.env.RECOPYFAST_SUPABASE_CLI_BIN || "supabase";
await assertSupabaseCliVersion(supabaseCliBin);
mkdirSync(TEST_RESULTS_DIR, { recursive: true });
assertNoUncleanRunManifests(TEST_RESULTS_DIR);

for (let index = 1; index <= runs; index += 1) {
  await runOnce(index);
}

function parseRuns(args) {
  const argument = args.find((value) => value.startsWith("--runs="));
  if (!argument) return DEFAULT_RUNS;
  const value = Number.parseInt(argument.slice("--runs=".length), 10);
  if (value !== 1 && value !== 2) {
    throw new Error(
      "--runs must be 1 or 2; the release proof uses the default 2.",
    );
  }
  return value;
}

function loadPrivateEnvironment() {
  const configured = process.env.RECOPYFAST_STRIPE_ENV_FILE;
  const candidate = resolve(ROOT, configured || ".env.local");
  if (configured || existsSync(candidate)) {
    dotenv.config({ path: candidate, override: false, quiet: true });
  }
}

function assertTestStripeInputs(env) {
  if (env.STRIPE_LIVE_MODE === "true" || env.VERCEL_ENV === "production") {
    throw new Error(
      "Refusing provider run because Stripe live mode is selected.",
    );
  }
  const required = [
    ["STRIPE_SECRET_KEY", "sk_test_"],
    ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_"],
    ["STRIPE_PRO_PRICE_ID", "price_"],
  ];
  for (const [name, prefix] of required) {
    const value = env[name];
    if (!value || !value.startsWith(prefix) || /placeholder/i.test(value)) {
      throw new Error(
        `${name} must be a non-placeholder Stripe test value before this operator lane can run.`,
      );
    }
  }
}

async function assertSupabaseCliVersion(binary) {
  const result = await command(binary, ["--version"], { capture: true });
  const reported = `${result.stdout}\n${result.stderr}`.match(
    /\b\d+\.\d+\.\d+\b/,
  )?.[0];
  if (reported !== SUPABASE_CLI_VERSION) {
    throw new Error(
      `Supabase CLI ${SUPABASE_CLI_VERSION} is required for the s24 local stack; ` +
        `found ${reported ?? "an unreadable version"}. Point ` +
        `RECOPYFAST_SUPABASE_CLI_BIN at an executable pinned to that version.`,
    );
  }
}

async function runOnce(index) {
  const runId = randomUUID();
  const authUserId = randomUUID();
  const userEmail = `s25-${runId}@recopyfast.invalid`;
  const startedAtUnix = Math.floor(Date.now() / 1_000) - 1;
  const redisName = `recopyfast-s25-redis-${process.pid}-${index}`;
  const providerOutputDir = resolve(
    TEST_RESULTS_DIR,
    `stripe-provider-output-run-${index}`,
  );
  const providerFailureFile = resolve(
    TEST_RESULTS_DIR,
    `stripe-provider-failure-run-${index}.json`,
  );
  const providerSummaryFile = resolve(
    TEST_RESULTS_DIR,
    `stripe-provider-summary-run-${index}.json`,
  );
  const providerEvidenceFile = resolve(
    TEST_RESULTS_DIR,
    `stripe-provider-evidence-run-${index}.json`,
  );
  const providerManifestFile = resolve(
    TEST_RESULTS_DIR,
    `stripe-provider-run-manifest-run-${index}.json`,
  );
  const providerJanitorStateFile = resolve(
    TEST_RESULTS_DIR,
    `stripe-provider-janitor-state-run-${index}.json`,
  );
  const serviceChildren = [];
  const activeCommands = new Set();
  const manifest = {
    mode: "test",
    runId,
    authUserId,
    runIndex: index,
    startedAtUnix,
    expectedPriceId: process.env.STRIPE_PRO_PRICE_ID,
  };
  let webhookSecret;
  let appEnvironment;
  let pendingEvidence;
  let janitorMinimumObservationMs = FAILURE_MIN_OBSERVATION_MS;
  let hasCompletedParentJanitor = false;

  assertNoUncleanRunManifest(providerManifestFile);
  removeProviderOutput(providerOutputDir);
  removeSafeFailureFile(providerFailureFile);
  removeSafeRunArtifact(providerSummaryFile);
  removeSafeRunArtifact(providerEvidenceFile);
  removeSafeRunArtifact(providerManifestFile);
  removeSafeRunArtifact(providerJanitorStateFile);
  writeRunManifest(providerManifestFile, {
    ...manifest,
    status: "starting",
  });

  const cleanupMachine = createCleanupStateMachine({
    writeState: (reason) => {
      writeRunManifest(providerManifestFile, {
        ...manifest,
        status: "cleaning",
        cleanupReason: reason,
      });
    },
    writeComplete: () => {
      writeRunManifest(providerManifestFile, {
        ...manifest,
        status: "cleaned",
      });
    },
    terminateActiveCommands: async () => {
      for (const child of [...activeCommands]) {
        await terminateProcessGroup(child);
      }
    },
    runJanitor: async () => {
      if (!appEnvironment || hasCompletedParentJanitor) return;
      await command("npx", ["tsx", "scripts/stripe-provider-janitor.ts"], {
        env: {
          ...appEnvironment,
          STRIPE_PROVIDER_MIN_OBSERVATION_MS: String(
            janitorMinimumObservationMs,
          ),
        },
        timeoutMs: JANITOR_PROCESS_TIMEOUT_MS,
        cleanupCommand: true,
      });
      hasCompletedParentJanitor = true;
    },
    stopServices: async () => {
      for (const child of serviceChildren.reverse()) {
        await terminateProcessGroup(child);
      }
      removeProviderOutput(providerOutputDir);
      await command("docker", ["stop", redisName], {
        capture: true,
        allowFailure: true,
        cleanupCommand: true,
      });
      await command(supabaseCliBin, ["stop", "--no-backup"], {
        capture: true,
        allowFailure: true,
        cleanupCommand: true,
      });
      webhookSecret = undefined;
    },
  });
  activeCommandRegistry = activeCommands;
  activeRunCleanup = cleanupMachine.cleanup;

  try {
    process.stdout.write(
      `[stripe-provider] run ${index}/${runs}: starting a clean local stack\n`,
    );
    await command(supabaseCliBin, ["stop", "--no-backup"], {
      capture: true,
      allowFailure: true,
    });
    await command(supabaseCliBin, ["start", "-x", SUPABASE_EXCLUSIONS], {
      capture: true,
    });
    const status = await command(supabaseCliBin, ["status", "-o", "env"], {
      capture: true,
    });
    const anonKey = readStatusValue(status.stdout, "ANON_KEY");
    const serviceRoleKey = readStatusValue(status.stdout, "SERVICE_ROLE_KEY");

    await command(
      "docker",
      [
        "run",
        "--rm",
        "-d",
        "--name",
        redisName,
        "-p",
        "127.0.0.1:6379:6379",
        "redis:7-alpine",
      ],
      { capture: true },
    );
    await waitForTcp(6379, "Redis");

    const localEnvironment = {
      ...process.env,
      RUN_RECOPYFAST_STRIPE_E2E: "1",
      STRIPE_LIVE_MODE: "false",
      VERCEL_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      NEXT_PUBLIC_APP_URL: APP_URL,
      PLAYWRIGHT_BASE_URL: APP_URL,
      NEXT_PUBLIC_WS_URL: WS_URL,
      REDIS_URL,
      WS_PORT: "4001",
      CI: "true",
      STRIPE_PROVIDER_RUN_INDEX: String(index),
      STRIPE_PROVIDER_RUN_ID: runId,
      STRIPE_PROVIDER_AUTH_USER_ID: authUserId,
      STRIPE_PROVIDER_USER_EMAIL: userEmail,
      STRIPE_PROVIDER_STARTED_AT_UNIX: String(startedAtUnix),
      STRIPE_PROVIDER_SUMMARY_FILE: providerSummaryFile,
      STRIPE_PROVIDER_EVIDENCE_FILE: providerEvidenceFile,
      STRIPE_PROVIDER_OUTPUT_DIR: providerOutputDir,
      STRIPE_PROVIDER_FAILURE_FILE: providerFailureFile,
      STRIPE_PROVIDER_JANITOR_STATE_FILE: providerJanitorStateFile,
      STRIPE_PROVIDER_RUNNER_OWNED: "1",
      STRIPE_PROVIDER_MANIFEST_FILE: providerManifestFile,
    };

    const listener = await startStripeListener(
      localEnvironment,
      serviceChildren,
    );
    webhookSecret = listener.webhookSecret;
    appEnvironment = {
      ...localEnvironment,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
    };

    // Production Next is part of the s24 proof shape. Build inside each fresh
    // stack so the public Supabase/Stripe values baked into the browser bundle
    // are the same local/test values the server uses for this run.
    await command("npm", ["run", "build"], { env: appEnvironment });

    const ws = spawnQuiet(
      "npm",
      ["--prefix", "server", "start"],
      appEnvironment,
    );
    const app = spawnQuiet("npm", ["run", "start"], appEnvironment);
    serviceChildren.push(ws, app);
    await waitForUrl(`${WS_URL}/health`, "WebSocket service");
    await waitForUrl(`${APP_URL}/login`, "Next.js application");

    let playwrightError;
    let diagnosticError;
    let hasValidatedPrimaryFailure = false;
    try {
      await command(
        "npx",
        ["playwright", "test", "--config=playwright.stripe-provider.config.ts"],
        { env: appEnvironment, timeoutMs: PLAYWRIGHT_PROCESS_TIMEOUT_MS },
      );
      janitorMinimumObservationMs = SUCCESS_MIN_OBSERVATION_MS;
    } catch (error) {
      playwrightError = error;
      try {
        const failure = readAndValidateFailure(providerFailureFile, index);
        hasValidatedPrimaryFailure = true;
        process.stderr.write(
          `[stripe-provider] run ${index}/${runs} failed at ` +
            `${failure.failedStage}: ${failure.diagnostic}\n`,
        );
      } catch (failureError) {
        diagnosticError = failureError;
      }
    }

    let janitorError;
    try {
      await command("npx", ["tsx", "scripts/stripe-provider-janitor.ts"], {
        env: {
          ...appEnvironment,
          STRIPE_PROVIDER_MIN_OBSERVATION_MS: String(
            janitorMinimumObservationMs,
          ),
        },
        timeoutMs: JANITOR_PROCESS_TIMEOUT_MS,
      });
      hasCompletedParentJanitor = true;
    } catch (error) {
      janitorError = error;
      recordExternalJanitorFailure(
        providerFailureFile,
        index,
        hasValidatedPrimaryFailure,
      );
    }
    if (janitorError) throw janitorError;
    if (diagnosticError) throw diagnosticError;
    if (playwrightError) throw playwrightError;

    pendingEvidence = readAndValidateEvidence(providerEvidenceFile, {
      expectedRunId: runId,
      expectedRunIndex: index,
      expectedPriceId: appEnvironment.STRIPE_PRO_PRICE_ID,
      startedAtUnix,
      requireCleanup: false,
    });
  } finally {
    try {
      await cleanupMachine.cleanup("finally");
    } finally {
      if (activeRunCleanup === cleanupMachine.cleanup) {
        activeRunCleanup = undefined;
      }
      if (activeCommandRegistry === activeCommands) {
        activeCommandRegistry = undefined;
      }
    }
  }

  if (!pendingEvidence) {
    throw new Error("Provider run completed without fresh success evidence.");
  }
  finalizeSafeEvidence(providerEvidenceFile, pendingEvidence);
  const finalEvidence = readAndValidateEvidence(providerEvidenceFile, {
    expectedRunId: runId,
    expectedRunIndex: index,
    expectedPriceId: manifest.expectedPriceId,
    startedAtUnix,
    requireCleanup: true,
  });
  process.stdout.write(
    `[stripe-provider] run ${index}/${runs}: test mode checkout ${finalEvidence.checkout.id}, ` +
      `subscription ${finalEvidence.subscription.id}, ${finalEvidence.processedEvents.length} processed ` +
      `events, replay duplicate=${finalEvidence.replay.duplicate}, cleanup=proved\n`,
  );
}

function removeProviderOutput(providerOutputDir) {
  const resolvedOutput = resolve(providerOutputDir);
  const requiredPrefix = resolve(
    TEST_RESULTS_DIR,
    "stripe-provider-output-run-",
  );
  if (!resolvedOutput.startsWith(requiredPrefix)) {
    throw new Error("Refusing to remove an unexpected provider output path.");
  }
  rmSync(resolvedOutput, { recursive: true, force: true });
}

function removeSafeFailureFile(providerFailureFile) {
  const resolvedFailure = resolve(providerFailureFile);
  const requiredPrefix = resolve(
    TEST_RESULTS_DIR,
    "stripe-provider-failure-run-",
  );
  if (!resolvedFailure.startsWith(requiredPrefix)) {
    throw new Error("Refusing to remove an unexpected provider failure path.");
  }
  rmSync(resolvedFailure, { force: true });
}

function removeSafeRunArtifact(path) {
  const resolvedArtifact = resolve(path);
  const allowedPrefixes = [
    "stripe-provider-summary-run-",
    "stripe-provider-evidence-run-",
    "stripe-provider-run-manifest-run-",
    "stripe-provider-janitor-state-run-",
  ].map((name) => resolve(TEST_RESULTS_DIR, name));
  if (!allowedPrefixes.some((prefix) => resolvedArtifact.startsWith(prefix))) {
    throw new Error("Refusing to remove an unexpected provider artifact path.");
  }
  rmSync(resolvedArtifact, { force: true });
}

function readStatusValue(output, name) {
  const match = output.match(new RegExp(`^${name}="([^"]+)"$`, "m"));
  if (!match) {
    throw new Error(`Local Supabase did not return ${name}.`);
  }
  return match[1];
}

async function startStripeListener(env, serviceChildren) {
  const stripeBin = process.env.STRIPE_CLI_BIN || "/usr/local/bin/stripe";
  const child = spawnDetached(
    stripeBin,
    [
      "listen",
      "--skip-update",
      "--format",
      "JSON",
      "--events",
      STRIPE_EVENTS,
      "--forward-to",
      `${APP_URL}/api/webhooks/stripe`,
    ],
    {
      cwd: ROOT,
      env: { ...env, STRIPE_API_KEY: env.STRIPE_SECRET_KEY },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  registerProcess(serviceChildren, child);

  let webhookSecret;
  try {
    webhookSecret = await new Promise((resolveSecret, reject) => {
      let tail = "";
      const timeout = setTimeout(() => {
        reject(
          new Error(
            "Stripe CLI did not produce an ephemeral signing secret within 30 seconds.",
          ),
        );
      }, 30_000);
      const inspect = (chunk) => {
        tail = `${tail}${chunk.toString("utf8")}`.slice(-4096);
        const match = tail.match(/whsec_[A-Za-z0-9_]+/);
        if (!match) return;
        clearTimeout(timeout);
        resolveSecret(match[0]);
      };
      child.stdout.on("data", inspect);
      child.stderr.on("data", inspect);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(
          new Error(
            `Stripe CLI listener exited before readiness (code ${code ?? "unknown"}).`,
          ),
        );
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(
          new Error(`Stripe CLI listener could not start: ${error.message}`),
        );
      });
    });
  } catch (error) {
    await terminateProcessGroup(child);
    throw error;
  }

  return { child, webhookSecret };
}

function spawnQuiet(commandName, args, env) {
  const child = spawnDetached(commandName, args, {
    cwd: ROOT,
    env,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.once("error", () => {});
  return child;
}

async function command(commandName, args, options = {}) {
  return new Promise((resolveCommand, reject) => {
    const capture = options.capture === true;
    const child = spawnDetached(commandName, args, {
      cwd: ROOT,
      env: options.env || process.env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (!options.cleanupCommand) activeCommandRegistry?.add(child);
    let stdout = "";
    let stderr = "";
    let didTimeOut = false;
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          didTimeOut = true;
          void terminateProcessGroup(child);
        }, options.timeoutMs)
      : null;
    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
    }
    child.once("error", (error) => {
      activeCommandRegistry?.delete(child);
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      activeCommandRegistry?.delete(child);
      if (timeout) clearTimeout(timeout);
      if (code === 0 || options.allowFailure) {
        resolveCommand({ code, stdout, stderr });
        return;
      }
      reject(
        new Error(
          didTimeOut
            ? `${commandName} ${args[0] || ""} exceeded its process timeout.`
            : `${commandName} ${args[0] || ""} failed with exit code ${code}.`,
        ),
      );
    });
  });
}

async function waitForUrl(url, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The service is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error(`${label} did not become ready on its loopback URL.`);
}

async function waitForTcp(port, label) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const connected = await new Promise((resolveConnection) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolveConnection(true);
      });
      socket.once("error", () => resolveConnection(false));
    });
    if (connected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`${label} did not become ready on its loopback port.`);
}

function readAndValidateEvidence(path, expectations) {
  const text = readFileSync(path, "utf8");
  assertNoSensitiveArtifact(text, "Provider evidence");
  const evidence = JSON.parse(text);
  const nowUnix = Math.floor(Date.now() / 1_000);
  validateProviderEvidence(evidence, expectations, nowUnix);
  return evidence;
}

function finalizeSafeEvidence(path, evidence) {
  const finalized = {
    ...evidence,
    cleanup: {
      authUserDeleted: true,
      customerDeleted: true,
      databaseRowsDeleted: true,
      subscriptionCanceled: true,
      immutableCheckoutAndEventHistoryRetained: true,
    },
  };
  writeFileSync(path, `${JSON.stringify(finalized, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(path, 0o600);
}

function readAndValidateFailure(path, expectedRunIndex) {
  const text = readFileSync(path, "utf8");
  assertNoSensitiveArtifact(text, "Provider failure evidence");
  const failure = JSON.parse(text);
  const keys = Object.keys(failure).sort();
  if (
    JSON.stringify(keys) !==
      JSON.stringify(["diagnostic", "failedStage", "mode", "runIndex"]) ||
    failure.mode !== "test" ||
    failure.runIndex !== expectedRunIndex ||
    !PROVIDER_FAILURE_STAGES.has(failure.failedStage) ||
    typeof failure.diagnostic !== "string" ||
    failure.diagnostic.length === 0 ||
    failure.diagnostic.length > 800
  ) {
    throw new Error("Provider failure evidence violated its safe schema.");
  }
  return failure;
}

function assertNoSensitiveArtifact(text, label) {
  const forbidden = [
    /\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9_-]+\b/,
    /\bwhsec_[A-Za-z0-9_-]+\b/,
    /\b(?:\d[ -]?){13,19}\b/,
    /\b(?:card[_ -]?exp(?:iry|iration)?|expiry|expiration)\b\s*[:=]\s*(?:\d{1,2}\s*\/\s*\d{2,4}|\d{3,4})/i,
    /\b(?:card[_ -]?(?:cvc|cvv)|cvc|cvv)\b\s*[:=]\s*\d{3,4}/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
    /\bhttps:\/\/checkout\.stripe\.com\/[^\s"'<>]*/i,
    /\bcs_(?:test|live)_[A-Za-z0-9_-]*secret[A-Za-z0-9_-]*\b/i,
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error(`${label} contained a forbidden credential or card shape.`);
  }
}
