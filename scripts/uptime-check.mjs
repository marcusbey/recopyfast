#!/usr/bin/env node
/**
 * Production uptime check, run by `.github/workflows/uptime.yml` (s84).
 *
 * Why GitHub Actions: the Sentry plan has one uptime seat and another project
 * uses it; the two Sentry uptime monitors for this product exist but are
 * disabled (docs/operations/monitoring.md). A scheduled workflow in this
 * repository costs nothing and files its alarm where the owner already works.
 *
 * Each target is GET-requested with a timeout and retried twice. Any 2xx is up
 * — `/api/health` answers 200 for `degraded` on purpose, and the realtime
 * service has its own target. Then, per target:
 *
 *   down, no open issue   → ensure the `uptime` label, open "Production down: <target>"
 *   down, issue open      → comment on it (one comment per run while it lasts)
 *   up, issue open        → comment and close it
 *   up, no open issue     → nothing
 *
 * The repository is public, so an issue says nothing a `curl` of the public
 * URL would not: the HTTP status, "timeout" or a network error CODE — never a
 * response body, never an error message. The response body is not even read.
 *
 * Exits 1 while anything is down or any `gh` call failed, so the run itself
 * shows red as well. Every decision is tested in
 * `scripts/__tests__/uptime-check.test.mjs`.
 */

import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

export const TARGETS = Object.freeze([
  { name: "www.recopyfa.st/api/health", url: "https://www.recopyfa.st/api/health" },
  { name: "recopyfast-ws.fly.dev/health", url: "https://recopyfast-ws.fly.dev/health" },
]);

export const ISSUE_LABEL = "uptime";

/** Per attempt. Generous: a cold Vercel function plus a slow Supabase answer. */
export const ATTEMPT_TIMEOUT_MS = 20_000;
export const RETRIES = 2;
export const RETRY_DELAY_MS = 10_000;

const RUNBOOK = "docs/operations/monitoring.md";

export function issueTitle(target) {
  return `Production down: ${target.name}`;
}

const sleepFor = (ms) => new Promise((done) => setTimeout(done, ms));

/** The error's code (ECONNREFUSED, ENOTFOUND, …), never its message. */
function networkErrorCode(error) {
  const code = error?.cause?.code ?? error?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : "unknown";
}

/** One GET. `{ isOk, detail }`; the body is never read. */
export async function probeOnce(url, { timeoutMs = ATTEMPT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": "recopyfast-uptime (github-actions)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Release the socket without reading what the server said.
    await response.body?.cancel().catch(() => {});
    return { isOk: response.status >= 200 && response.status < 300, detail: `HTTP ${response.status}` };
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return { isOk: false, detail: `timeout after ${timeoutMs / 1000} s` };
    }
    return { isOk: false, detail: `network error (${networkErrorCode(error)})` };
  }
}

/** Up as soon as one attempt is; down after `1 + retries` failures. */
export async function probeTarget(
  target,
  {
    timeoutMs = ATTEMPT_TIMEOUT_MS,
    retries = RETRIES,
    retryDelayMs = RETRY_DELAY_MS,
    sleep = sleepFor,
    fetchImpl = fetch,
  } = {},
) {
  let last = { isOk: false, detail: "not probed" };
  for (let attempt = 1; attempt <= 1 + retries; attempt += 1) {
    if (attempt > 1) await sleep(retryDelayMs);
    last = await probeOnce(target.url, { timeoutMs, fetchImpl });
    if (last.isOk) return { target, isUp: true, attempts: attempt, detail: last.detail };
  }
  return { target, isUp: false, attempts: 1 + retries, detail: last.detail };
}

/** The open issue for this target, by exact title, or null. */
export function findOpenIssue(openIssues, target) {
  const title = issueTitle(target);
  return openIssues.find((issue) => issue.title === title)?.number ?? null;
}

function attemptsText(count) {
  return `${count} attempt${count === 1 ? "" : "s"}`;
}

/** The `gh` argument arrays for one target's result. Pure. */
export function planIssueCommands({ result, openIssue, runUrl, now }) {
  const at = now.toISOString();
  const { target } = result;

  if (!result.isUp && openIssue === null) {
    const body = [
      `The uptime workflow could not get a 2xx from \`${target.url}\`.`,
      "",
      `- Result: ${result.detail} (${attemptsText(result.attempts)})`,
      `- Checked at: ${at}`,
      `- Run: ${runUrl}`,
      "",
      "This issue is commented on at each check while the target stays down, and closed",
      `automatically when it answers again. Runbook: \`${RUNBOOK}\`.`,
    ].join("\n");
    return [
      ["label", "create", ISSUE_LABEL, "--color", "B60205", "--description", "Production uptime alarms", "--force"],
      ["issue", "create", "--title", issueTitle(target), "--label", ISSUE_LABEL, "--body", body],
    ];
  }

  if (!result.isUp) {
    const body = `Still down at ${at}: ${result.detail} (${attemptsText(result.attempts)}). Run: ${runUrl}`;
    return [["issue", "comment", String(openIssue), "--body", body]];
  }

  if (openIssue !== null) {
    const body = `Recovered at ${at}: ${result.detail} on attempt ${result.attempts}. Run: ${runUrl}`;
    return [["issue", "close", String(openIssue), "--comment", body]];
  }

  return [];
}

function ghCli(args) {
  return new Promise((resolve, reject) => {
    execFile("gh", args, { timeout: 60_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/** Probe every target, act on the issues, return the exit code. */
export async function run({
  targets = TARGETS,
  gh = ghCli,
  fetchImpl = fetch,
  sleep = sleepFor,
  timeoutMs = ATTEMPT_TIMEOUT_MS,
  retries = RETRIES,
  retryDelayMs = RETRY_DELAY_MS,
  runUrl = "",
  now = () => new Date(),
  log = (line) => console.log(line),
} = {}) {
  const results = await Promise.all(
    targets.map((target) => probeTarget(target, { timeoutMs, retries, retryDelayMs, sleep, fetchImpl })),
  );
  for (const result of results) {
    log(`${result.target.name}: ${result.isUp ? "up" : "DOWN"} (${result.detail}, ${attemptsText(result.attempts)})`);
  }

  let openIssues;
  try {
    openIssues = JSON.parse(
      await gh(["issue", "list", "--label", ISSUE_LABEL, "--state", "open", "--json", "number,title", "--limit", "100"]),
    );
  } catch (error) {
    // Without the list there is no knowing whether an issue is already open,
    // and opening one anyway turns a 10-minute schedule into a flood.
    log(`could not list open uptime issues: ${error.message}`);
    return 1;
  }

  let hasFailedCommand = false;
  for (const result of results) {
    const commands = planIssueCommands({
      result,
      openIssue: findOpenIssue(openIssues, result.target),
      runUrl,
      now: now(),
    });
    for (const args of commands) {
      try {
        await gh(args);
        log(`gh ${args.slice(0, 3).join(" ")}`);
      } catch (error) {
        hasFailedCommand = true;
        log(`gh ${args.slice(0, 3).join(" ")} failed: ${error.message}`);
        break;
      }
    }
  }

  return results.some((result) => !result.isUp) || hasFailedCommand ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const runUrl =
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : "(local run)";
  process.exitCode = await run({ runUrl });
}
