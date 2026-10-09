/* eslint-disable @typescript-eslint/no-require-imports -- This helper is intentionally CommonJS so both the ESM runner and Jest can load one process-control implementation. */
const { spawn } = require("node:child_process");
const {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require("node:fs");
const { dirname, normalize, sep } = require("node:path");

const PROVIDER_FAILURE_STAGES = new Set([
  "fixture:create",
  "baseline:entitlement",
  "checkout:create",
  "checkout:inspect-open",
  "checkout:hosted-form",
  "checkout:reconcile",
  "checkout:inspect-complete",
  "billing:durable-state",
  "billing:provider-subscription",
  "billing:events",
  "billing:entitlement",
  "billing:replay",
  "evidence:capture",
  "cleanup",
  "cleanup:assert",
]);

function spawnDetached(command, args, options = {}) {
  return spawn(command, args, {
    ...options,
    // Each provider process owns a process group. A browser, Next or npm child
    // can otherwise survive after its direct wrapper exits and mutate state
    // after cleanup has already observed a quiet snapshot.
    detached: process.platform !== "win32",
  });
}

function registerProcess(registry, child) {
  registry.push(child);
  return child;
}

function signalProcessGroup(child, signal) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error && error.code === "ESRCH") return;
    throw error;
  }
}

function probeProcessGroup(processGroupId) {
  process.kill(-processGroupId, 0);
}

function probeProcess(processId) {
  process.kill(processId, 0);
}

async function waitForProcessGroupGone(processGroupId, options) {
  const timeoutMs = options.timeoutMs;
  const pollMs = options.pollMs ?? 25;
  const probe = options.probe ?? probeProcessGroup;
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const deadline = now() + timeoutMs;

  for (;;) {
    try {
      probe(processGroupId);
    } catch (error) {
      if (error && error.code === "ESRCH") return;
      // Darwin can report EPERM while the process group contains only a
      // zombie awaiting reaping. That is not proof that the group is gone:
      // keep polling until the kernel gives the authoritative ESRCH answer.
      if (!error || error.code !== "EPERM") throw error;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      const error = new Error(
        `Process group ${processGroupId} remained observable after ${timeoutMs}ms.`,
      );
      error.code = "ETIMEDOUT";
      throw error;
    }
    await sleep(Math.min(pollMs, remainingMs));
  }
}

async function terminateProcessGroup(child, options = {}) {
  if (!child || !child.pid) return;
  const graceMs = options.graceMs ?? 5_000;
  const killGraceMs = options.killGraceMs ?? 5_000;
  const signal = options.signal ?? signalProcessGroup;
  const waitOptions = {
    pollMs: options.pollMs,
    probe:
      options.probe ??
      (process.platform === "win32" ? probeProcess : undefined),
    sleep: options.sleep,
    now: options.now,
  };

  signal(child, "SIGTERM");
  try {
    await waitForProcessGroupGone(child.pid, {
      ...waitOptions,
      timeoutMs: graceMs,
    });
    return;
  } catch (error) {
    if (!error || error.code !== "ETIMEDOUT") throw error;
  }

  signal(child, "SIGKILL");
  await waitForProcessGroupGone(child.pid, {
    ...waitOptions,
    timeoutMs: killGraceMs,
  });
}

function createCleanupStateMachine(dependencies) {
  let cleanupPromise;
  return {
    cleanup(reason) {
      if (cleanupPromise) return cleanupPromise;
      dependencies.writeState(reason);
      cleanupPromise = (async () => {
        const failures = [];
        for (const operation of [
          dependencies.terminateActiveCommands,
          dependencies.runJanitor,
          dependencies.stopServices,
        ]) {
          try {
            await operation();
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length > 0) {
          throw new AggregateError(
            failures,
            `Stripe provider runner cleanup failed in ${failures.length} steps.`,
          );
        }
        dependencies.writeComplete?.();
      })();
      return cleanupPromise;
    },
  };
}

function writeRunManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  // `mode` only affects a newly created file. An interrupted earlier attempt
  // may have left the same manifest path behind, so reassert owner-only access
  // on every state transition as part of the write itself.
  chmodSync(path, 0o600);
}

function recordExternalJanitorFailure(path, runIndex, hasPrimaryFailure) {
  const cleanupDiagnostic = "cleanup failed: external_janitor";
  let failure = {
    mode: "test",
    runIndex,
    failedStage: "cleanup",
    diagnostic: cleanupDiagnostic,
  };

  if (hasPrimaryFailure && existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, "utf8"));
    const keys = Object.keys(existing).sort();
    const hasSafePrimarySchema =
      JSON.stringify(keys) ===
        JSON.stringify(["diagnostic", "failedStage", "mode", "runIndex"]) &&
      existing.mode === "test" &&
      existing.runIndex === runIndex &&
      PROVIDER_FAILURE_STAGES.has(existing.failedStage) &&
      typeof existing.diagnostic === "string" &&
      existing.diagnostic.length > 0 &&
      existing.diagnostic.length <= 800;

    if (hasSafePrimarySchema) {
      const suffix = ` | ${cleanupDiagnostic}`;
      failure = {
        ...existing,
        diagnostic: `${existing.diagnostic.slice(0, 800 - suffix.length)}${suffix}`,
      };
    }
  }

  writeRunManifest(path, failure);
}

function assertNoUncleanRunManifest(path) {
  if (!existsSync(path)) return;
  let previous;
  try {
    previous = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "Refusing to start over an unfinished Stripe provider run manifest.",
    );
  }
  if (previous.mode !== "test" || previous.status !== "cleaned") {
    throw new Error(
      "Refusing to start over an unfinished Stripe provider run; recover its exact manifest ownership first.",
    );
  }
}

function assertNoUncleanRunManifests(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      /^stripe-provider-run-manifest-run-\d+\.json$/.test(entry.name)
    ) {
      assertNoUncleanRunManifest(`${directory}/${entry.name}`);
    }
  }
}

function assertRunnerOwnedProviderInvocation(env) {
  const refuse = () => {
    throw new Error(
      "Dedicated Stripe provider Playwright requires runner-owned external janitor context.",
    );
  };
  if (env.STRIPE_PROVIDER_RUNNER_OWNED !== "1") refuse();
  const manifestPath = env.STRIPE_PROVIDER_MANIFEST_FILE;
  const runIndex = env.STRIPE_PROVIDER_RUN_INDEX;
  const expectedSuffix = normalize(
    `${sep}test-results${sep}stripe-provider-run-manifest-run-${runIndex}.json`,
  );
  if (
    !manifestPath ||
    !runIndex ||
    !normalize(manifestPath).endsWith(expectedSuffix) ||
    !existsSync(manifestPath)
  ) {
    refuse();
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    refuse();
  }
  if (
    manifest.mode !== "test" ||
    manifest.status !== "starting" ||
    manifest.runId !== env.STRIPE_PROVIDER_RUN_ID ||
    manifest.authUserId !== env.STRIPE_PROVIDER_AUTH_USER_ID ||
    String(manifest.runIndex) !== runIndex
  ) {
    refuse();
  }
}

function validateProviderEvidence(evidence, expectations, nowUnix) {
  const isFresh =
    Number.isInteger(evidence.generatedAtUnix) &&
    evidence.generatedAtUnix >= expectations.startedAtUnix &&
    evidence.generatedAtUnix <= nowUnix + 5 &&
    nowUnix - evidence.generatedAtUnix <= 15 * 60;
  const hasCleanup =
    evidence.cleanup?.databaseRowsDeleted === true &&
    evidence.cleanup?.customerDeleted === true &&
    evidence.cleanup?.subscriptionCanceled === true &&
    evidence.cleanup?.authUserDeleted === true;
  if (
    evidence.mode !== "test" ||
    evidence.runId !== expectations.expectedRunId ||
    evidence.runIndex !== expectations.expectedRunIndex ||
    evidence.subscription?.priceId !== expectations.expectedPriceId ||
    !isFresh ||
    (expectations.requireCleanup && !hasCleanup)
  ) {
    throw new Error(
      "Provider evidence did not prove this fresh test run and exact cleanup.",
    );
  }
}

module.exports = {
  PROVIDER_FAILURE_STAGES,
  assertNoUncleanRunManifest,
  assertNoUncleanRunManifests,
  assertRunnerOwnedProviderInvocation,
  createCleanupStateMachine,
  recordExternalJanitorFailure,
  registerProcess,
  spawnDetached,
  terminateProcessGroup,
  waitForProcessGroupGone,
  validateProviderEvidence,
  writeRunManifest,
};
