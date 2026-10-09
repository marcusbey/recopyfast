import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import processHelpers from "../../../scripts/stripe-provider-process.cjs";

const {
  createCleanupStateMachine,
  registerProcess,
  assertNoUncleanRunManifest,
  assertNoUncleanRunManifests,
  assertRunnerOwnedProviderInvocation,
  recordExternalJanitorFailure,
  spawnDetached,
  terminateProcessGroup,
  waitForProcessGroupGone,
  validateProviderEvidence,
  writeRunManifest,
} = processHelpers as {
  createCleanupStateMachine(input: {
    writeState(reason: string): void;
    writeComplete?(): void;
    terminateActiveCommands(): Promise<void>;
    runJanitor(): Promise<void>;
    stopServices(): Promise<void>;
  }): { cleanup(reason: string): Promise<void> };
  registerProcess(
    registry: import("node:child_process").ChildProcess[],
    child: import("node:child_process").ChildProcess,
  ): import("node:child_process").ChildProcess;
  assertNoUncleanRunManifest(path: string): void;
  assertNoUncleanRunManifests(directory: string): void;
  assertRunnerOwnedProviderInvocation(
    env: Record<string, string | undefined>,
  ): void;
  recordExternalJanitorFailure(
    path: string,
    runIndex: number,
    hasPrimaryFailure: boolean,
  ): void;
  spawnDetached(
    command: string,
    args: string[],
    options: Record<string, unknown>,
  ): import("node:child_process").ChildProcess;
  terminateProcessGroup(
    child: import("node:child_process").ChildProcess,
    options?: {
      graceMs?: number;
      killGraceMs?: number;
      pollMs?: number;
      signal?: (
        child: import("node:child_process").ChildProcess,
        signal: NodeJS.Signals,
      ) => void;
    },
  ): Promise<void>;
  waitForProcessGroupGone(
    processGroupId: number,
    options: {
      timeoutMs: number;
      pollMs?: number;
      probe?: (processGroupId: number) => void;
      sleep?: (milliseconds: number) => Promise<void>;
      now?: () => number;
    },
  ): Promise<void>;
  writeRunManifest(path: string, manifest: Record<string, unknown>): void;
  validateProviderEvidence(
    evidence: Record<string, any>,
    expectations: {
      expectedRunId: string;
      expectedRunIndex: number;
      expectedPriceId: string;
      startedAtUnix: number;
      requireCleanup: boolean;
    },
    nowUnix: number,
  ): void;
};

describe("Stripe provider runner process cleanup", () => {
  it("preserves a primary failure and appends only the fixed external janitor label", () => {
    const directory = mkdtempSync(join(tmpdir(), "recopyfast-s25-failure-"));
    const path = join(directory, "failure.json");
    writeFileSync(
      path,
      `${JSON.stringify({
        mode: "test",
        runIndex: 2,
        failedStage: "checkout:hosted-form",
        diagnostic: "Test timeout of 300000ms exceeded",
      })}\n`,
      { mode: 0o644 },
    );

    recordExternalJanitorFailure(path, 2, true);

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      mode: "test",
      runIndex: 2,
      failedStage: "checkout:hosted-form",
      diagnostic:
        "Test timeout of 300000ms exceeded | cleanup failed: external_janitor",
    });
  });

  it("creates a closed-schema cleanup failure when only the external janitor fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "recopyfast-s25-failure-"));
    const path = join(directory, "failure.json");

    recordExternalJanitorFailure(path, 1, false);

    expect(statSync(path).mode & 0o777).toBe(0o600);
    const evidence = JSON.parse(readFileSync(path, "utf8"));
    expect(evidence).toEqual({
      mode: "test",
      runIndex: 1,
      failedStage: "cleanup",
      diagnostic: "cleanup failed: external_janitor",
    });
    expect(Object.keys(evidence).sort()).toEqual([
      "diagnostic",
      "failedStage",
      "mode",
      "runIndex",
    ]);
  });

  it("replaces malformed primary evidence instead of copying unsafe janitor detail", () => {
    const directory = mkdtempSync(join(tmpdir(), "recopyfast-s25-failure-"));
    const path = join(directory, "failure.json");
    writeFileSync(
      path,
      `${JSON.stringify({
        mode: "test",
        runIndex: 1,
        failedStage: "provider:raw",
        diagnostic: "janitor failed for cus_sensitive sub_sensitive",
      })}\n`,
    );

    recordExternalJanitorFailure(path, 1, true);

    const text = readFileSync(path, "utf8");
    expect(JSON.parse(text)).toEqual({
      mode: "test",
      runIndex: 1,
      failedStage: "cleanup",
      diagnostic: "cleanup failed: external_janitor",
    });
    expect(text).not.toContain("cus_sensitive");
    expect(text).not.toContain("sub_sensitive");
  });

  it("serializes interruption cleanup and runs the janitor before services stop", async () => {
    const order: string[] = [];
    const machine = createCleanupStateMachine({
      writeState: (reason) => order.push(`state:${reason}`),
      writeComplete: () => order.push("state:cleaned"),
      terminateActiveCommands: async () => {
        order.push("terminate_commands");
      },
      runJanitor: async () => {
        order.push("janitor");
      },
      stopServices: async () => {
        order.push("stop_services");
      },
    });

    await Promise.all([machine.cleanup("SIGTERM"), machine.cleanup("finally")]);

    expect(order).toEqual([
      "state:SIGTERM",
      "terminate_commands",
      "janitor",
      "stop_services",
      "state:cleaned",
    ]);
  });

  it("persists the bounded run identity in an owner-only manifest", () => {
    const directory = mkdtempSync(join(tmpdir(), "recopyfast-s25-manifest-"));
    const path = join(directory, "manifest.json");
    writeRunManifest(path, {
      mode: "test",
      runId: "run-25",
      authUserId: "user-25",
      status: "starting",
    });

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      mode: "test",
      runId: "run-25",
      authUserId: "user-25",
      status: "starting",
    });
  });

  it("refuses to erase ownership after an unclean interrupted run", () => {
    const directory = mkdtempSync(join(tmpdir(), "recopyfast-s25-unclean-"));
    const path = join(directory, "manifest.json");
    writeRunManifest(path, {
      mode: "test",
      runId: "interrupted-run",
      status: "cleaning",
    });

    expect(() => assertNoUncleanRunManifest(path)).toThrow(
      /unfinished Stripe provider run/i,
    );
    writeRunManifest(path, {
      mode: "test",
      runId: "completed-run",
      status: "cleaned",
    });
    expect(() => assertNoUncleanRunManifest(path)).not.toThrow();
  });

  it("blocks a new run when any indexed manifest is unfinished or malformed", () => {
    const directory = mkdtempSync(join(tmpdir(), "recopyfast-s25-manifests-"));
    writeRunManifest(
      join(directory, "stripe-provider-run-manifest-run-1.json"),
      {
        mode: "test",
        runId: "clean-run",
        status: "cleaned",
      },
    );
    writeRunManifest(
      join(directory, "stripe-provider-run-manifest-run-2.json"),
      {
        mode: "test",
        runId: "unfinished-run",
        status: "cleaning",
      },
    );

    expect(() => assertNoUncleanRunManifests(directory)).toThrow(
      /unfinished Stripe provider run/i,
    );

    writeFileSync(
      join(directory, "stripe-provider-run-manifest-run-2.json"),
      "not-json\n",
    );
    expect(() => assertNoUncleanRunManifests(directory)).toThrow(
      /unfinished Stripe provider run manifest/i,
    );
  });

  it("requires exact runner manifest ownership before dedicated Playwright can start", () => {
    const directory = mkdtempSync(join(tmpdir(), "recopyfast-s25-owned-"));
    const testResultsDirectory = join(directory, "test-results");
    mkdirSync(testResultsDirectory);
    const manifestPath = join(
      testResultsDirectory,
      "stripe-provider-run-manifest-run-1.json",
    );
    writeRunManifest(manifestPath, {
      mode: "test",
      runId: "run-owned",
      authUserId: "user-owned",
      runIndex: 1,
      status: "starting",
    });
    const environment = {
      STRIPE_PROVIDER_RUNNER_OWNED: "1",
      STRIPE_PROVIDER_MANIFEST_FILE: manifestPath,
      STRIPE_PROVIDER_RUN_ID: "run-owned",
      STRIPE_PROVIDER_AUTH_USER_ID: "user-owned",
      STRIPE_PROVIDER_RUN_INDEX: "1",
    };

    expect(() =>
      assertRunnerOwnedProviderInvocation(environment),
    ).not.toThrow();
    expect(() =>
      assertRunnerOwnedProviderInvocation({
        ...environment,
        STRIPE_PROVIDER_RUNNER_OWNED: undefined,
      }),
    ).toThrow(/runner-owned external janitor/i);
    expect(() =>
      assertRunnerOwnedProviderInvocation({
        ...environment,
        STRIPE_PROVIDER_RUN_ID: "wrong-run",
      }),
    ).toThrow(/runner-owned external janitor/i);
  });

  it("rejects stale or mismatched provider evidence from a previous run", () => {
    const evidence = {
      mode: "test",
      runId: "current-run",
      runIndex: 2,
      generatedAtUnix: 1_100,
      subscription: { priceId: "price_expected" },
      cleanup: {
        authUserDeleted: true,
        customerDeleted: true,
        databaseRowsDeleted: true,
        subscriptionCanceled: true,
      },
    };
    const expectations = {
      expectedRunId: "current-run",
      expectedRunIndex: 2,
      expectedPriceId: "price_expected",
      startedAtUnix: 1_000,
      requireCleanup: true,
    };

    expect(() =>
      validateProviderEvidence(evidence, expectations, 1_200),
    ).not.toThrow();
    for (const stale of [
      { ...evidence, runId: "previous-run" },
      { ...evidence, runIndex: 1 },
      { ...evidence, subscription: { priceId: "price_other" } },
      { ...evidence, generatedAtUnix: 999 },
      { ...evidence, generatedAtUnix: 1_200 - 15 * 60 - 1 },
    ]) {
      expect(() =>
        validateProviderEvidence(stale, expectations, 1_200),
      ).toThrow(/fresh test run and exact cleanup/i);
    }
  });

  it("terminates a detached process group including a surviving grandchild", async () => {
    const grandchildScript = [
      "process.on('SIGTERM', () => {});",
      "process.stdout.write(String(process.pid) + '\\n');",
      "setInterval(() => {}, 1000);",
    ].join("");
    const leaderScript = [
      "const { spawn } = require('node:child_process');",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildScript)}], { stdio: ['ignore', 'pipe', 'ignore'] });`,
      "child.stdout.once('data', (chunk) => process.stdout.write(chunk));",
      "setInterval(() => {}, 1000);",
    ].join("");
    const parent = spawnDetached(process.execPath, ["-e", leaderScript], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let grandchildPid: number | undefined;
    const signals: NodeJS.Signals[] = [];
    try {
      grandchildPid = await new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("grandchild PID was not reported")),
          3_000,
        );
        parent.stdout?.once("data", (chunk) => {
          clearTimeout(timeout);
          resolve(Number.parseInt(chunk.toString("utf8"), 10));
        });
      });
      expect(isAlive(parent.pid!)).toBe(true);
      expect(isAlive(grandchildPid)).toBe(true);
      await terminateProcessGroup(parent, {
        graceMs: 100,
        killGraceMs: 3_000,
        signal: (child, signal) => {
          signals.push(signal);
          process.kill(-child.pid!, signal);
        },
      });
      await waitUntilDead(grandchildPid);
      expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
      expect(isAlive(grandchildPid)).toBe(false);
    } finally {
      await terminateProcessGroup(parent, {
        graceMs: 50,
        killGraceMs: 3_000,
      });
    }
  });

  it("treats EPERM probes as present until ESRCH proves the process group is gone", async () => {
    let currentTime = 0;
    const probe = jest
      .fn(() => undefined)
      .mockImplementationOnce(() => {
        throw processError("EPERM");
      })
      .mockImplementationOnce(() => {
        throw processError("EPERM");
      })
      .mockImplementationOnce(() => {
        throw processError("ESRCH");
      });

    await expect(
      waitForProcessGroupGone(25, {
        timeoutMs: 25,
        pollMs: 10,
        probe,
        now: () => currentTime,
        sleep: async (milliseconds) => {
          currentTime += milliseconds;
        },
      }),
    ).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("fails closed when EPERM persists through the process-group deadline", async () => {
    let currentTime = 0;

    await expect(
      waitForProcessGroupGone(25, {
        timeoutMs: 20,
        pollMs: 10,
        probe: () => {
          throw processError("EPERM");
        },
        now: () => currentTime,
        sleep: async (milliseconds) => {
          currentTime += milliseconds;
        },
      }),
    ).rejects.toThrow(/process group 25.*20ms/i);
  });

  it("can clean an immediately registered listener before readiness resolves", async () => {
    const services: import("node:child_process").ChildProcess[] = [];
    const listener = registerProcess(
      services,
      spawnDetached(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      }),
    );
    const machine = createCleanupStateMachine({
      writeState: jest.fn(),
      terminateActiveCommands: async () => undefined,
      runJanitor: async () => undefined,
      stopServices: async () => {
        for (const child of services) await terminateProcessGroup(child);
      },
    });

    try {
      expect(isAlive(listener.pid!)).toBe(true);
      await machine.cleanup("SIGINT-before-listener-readiness");
      await waitUntilDead(listener.pid!);
      expect(isAlive(listener.pid!)).toBe(false);
    } finally {
      await terminateProcessGroup(listener, {
        graceMs: 50,
        killGraceMs: 3_000,
      });
    }
  });
});

function processError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (processErrorCode(error) === "ESRCH") return false;
    throw error;
  }
}

function processErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

async function waitUntilDead(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && isAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
