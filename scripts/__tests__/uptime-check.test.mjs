// s84 — the uptime workflow's decisions, tested without GitHub or production.
//
// `.github/workflows/uptime.yml` runs `scripts/uptime-check.mjs` every 10
// minutes. Everything that decides something lives in the script — what counts
// as down, how often to retry, which issue to open, comment on or close, what
// the public issue may say — and is driven here against local HTTP servers and
// a recording stand-in for `gh`. The workflow file itself is pinned at the end:
// schedule, least privilege, SHA-pinned actions.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ISSUE_LABEL,
  TARGETS,
  findOpenIssue,
  issueTitle,
  planIssueCommands,
  probeOnce,
  probeTarget,
  run,
} from "../uptime-check.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RUN_URL = "https://github.com/marcusbey/recopyfast/actions/runs/1";
const NOW = new Date("2026-10-09T12:00:00Z");
const noSleep = async () => {};

/** A local server answering each request with the next status in `statuses`. */
async function withServer(statuses, runTest, { delayMs = 0, body = "{}" } = {}) {
  let calls = 0;
  const server = createServer((request, response) => {
    const status = statuses[Math.min(calls, statuses.length - 1)];
    calls += 1;
    setTimeout(() => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(body);
    }, delayMs);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  try {
    return await runTest(`http://127.0.0.1:${port}/health`, () => calls);
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}

/** A `gh` that records every call and answers `issue list` from `openIssues`. */
function recordingGh(openIssues = [], { failOn = null } = {}) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    if (failOn && args[0] === failOn[0] && args[1] === failOn[1]) {
      throw new Error("gh: HTTP 502");
    }
    if (args[0] === "issue" && args[1] === "list") {
      return JSON.stringify(openIssues);
    }
    return "";
  };
  return { gh, calls };
}

const APP = { name: "www.recopyfa.st/api/health", url: "https://www.recopyfa.st/api/health" };

// ── what the monitor watches ─────────────────────────────────────────────────

test("watches the app's health endpoint and the realtime service's", () => {
  assert.deepEqual(
    TARGETS.map((target) => target.url),
    [
      "https://www.recopyfa.st/api/health",
      "https://recopyfast-ws.fly.dev/health",
    ],
  );
  assert.equal(issueTitle(TARGETS[0]), "Production down: www.recopyfa.st/api/health");
  assert.equal(issueTitle(TARGETS[1]), "Production down: recopyfast-ws.fly.dev/health");
  assert.equal(ISSUE_LABEL, "uptime");
});

// ── one probe ────────────────────────────────────────────────────────────────

test("a 2xx is up; anything else is down, named by its status", async () => {
  await withServer([200], async (url) => {
    assert.deepEqual(await probeOnce(url, { timeoutMs: 1000 }), {
      isOk: true,
      detail: "HTTP 200",
    });
  });
  await withServer([503], async (url) => {
    assert.deepEqual(await probeOnce(url, { timeoutMs: 1000 }), {
      isOk: false,
      detail: "HTTP 503",
    });
  });
});

test("a slow answer is a timeout, not a hang", async () => {
  await withServer(
    [200],
    async (url) => {
      const started = Date.now();
      const result = await probeOnce(url, { timeoutMs: 100 });
      assert.deepEqual(result, { isOk: false, detail: "timeout after 0.1 s" });
      assert.ok(Date.now() - started < 1000, "gave up at the timeout");
    },
    { delayMs: 600 },
  );
});

test("a refused connection is a network error, named by its code only", async () => {
  // Bind a port, release it, then probe it: nothing is listening.
  const url = await withServer([200], async (liveUrl) => liveUrl);
  const result = await probeOnce(url, { timeoutMs: 1000 });
  assert.deepEqual(result, { isOk: false, detail: "network error (ECONNREFUSED)" });
});

// ── retries ──────────────────────────────────────────────────────────────────

test("retries twice, and a recovery on a retry counts as up", async () => {
  await withServer([503, 200], async (url, calls) => {
    const slept = [];
    const result = await probeTarget(
      { name: "local", url },
      { timeoutMs: 1000, retries: 2, retryDelayMs: 5000, sleep: async (ms) => slept.push(ms) },
    );
    assert.equal(result.isUp, true);
    assert.equal(result.attempts, 2);
    assert.equal(result.detail, "HTTP 200");
    assert.equal(calls(), 2);
    assert.deepEqual(slept, [5000]);
  });
});

test("three failures in a row is down", async () => {
  await withServer([503], async (url, calls) => {
    const result = await probeTarget(
      { name: "local", url },
      { timeoutMs: 1000, retries: 2, retryDelayMs: 0, sleep: noSleep },
    );
    assert.equal(result.isUp, false);
    assert.equal(result.attempts, 3);
    assert.equal(result.detail, "HTTP 503");
    assert.equal(calls(), 3);
  });
});

// ── which issue ──────────────────────────────────────────────────────────────

test("finds the open issue by its exact title only", () => {
  const title = issueTitle(APP);
  assert.equal(
    findOpenIssue(
      [
        { number: 3, title: `${title} (old)` },
        { number: 7, title },
        { number: 9, title: "Production down: recopyfast-ws.fly.dev/health" },
      ],
      APP,
    ),
    7,
  );
  assert.equal(findOpenIssue([{ number: 3, title: `${title} (old)` }], APP), null);
});

// ── what to do about it ──────────────────────────────────────────────────────

const DOWN = { target: APP, isUp: false, attempts: 3, detail: "HTTP 503" };
const UP = { target: APP, isUp: true, attempts: 1, detail: "HTTP 200" };

test("down with no open issue: ensure the label, open the issue", () => {
  const commands = planIssueCommands({ result: DOWN, openIssue: null, runUrl: RUN_URL, now: NOW });

  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0].slice(0, 3), ["label", "create", "uptime"]);
  assert.ok(commands[0].includes("--force"), "idempotent label creation");
  assert.deepEqual(commands[1].slice(0, 2), ["issue", "create"]);
  assert.equal(commands[1][commands[1].indexOf("--title") + 1], "Production down: www.recopyfa.st/api/health");
  assert.equal(commands[1][commands[1].indexOf("--label") + 1], "uptime");
  const body = commands[1][commands[1].indexOf("--body") + 1];
  assert.match(body, /HTTP 503/);
  assert.match(body, /3 attempts/);
  assert.match(body, /2026-10-09T12:00:00\.000Z/);
  assert.ok(body.includes(RUN_URL));
});

test("still down with an open issue: comment on it", () => {
  const commands = planIssueCommands({ result: DOWN, openIssue: 12, runUrl: RUN_URL, now: NOW });

  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].slice(0, 3), ["issue", "comment", "12"]);
  assert.match(commands[0][4], /Still down/);
  assert.match(commands[0][4], /HTTP 503/);
});

test("recovered with an open issue: comment and close it", () => {
  const commands = planIssueCommands({ result: UP, openIssue: 12, runUrl: RUN_URL, now: NOW });

  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].slice(0, 3), ["issue", "close", "12"]);
  assert.equal(commands[0][3], "--comment");
  assert.match(commands[0][4], /Recovered/);
  assert.match(commands[0][4], /HTTP 200/);
});

test("up with no open issue: nothing to do", () => {
  assert.deepEqual(planIssueCommands({ result: UP, openIssue: null, runUrl: RUN_URL, now: NOW }), []);
});

// ── the whole run ────────────────────────────────────────────────────────────

test("a down target opens an issue, the run fails, and the response body never reaches it", async () => {
  // The repository is public: an issue body must say nothing a curl of the
  // public URL would not, and the probe never reads the response body at all.
  await withServer(
    [503],
    async (downUrl) => {
      await withServer([200], async (upUrl) => {
        const { gh, calls } = recordingGh([]);
        const code = await run({
          targets: [
            { name: "down.example/health", url: downUrl },
            { name: "up.example/health", url: upUrl },
          ],
          gh,
          sleep: noSleep,
          retryDelayMs: 0,
          timeoutMs: 1000,
          runUrl: RUN_URL,
          now: () => NOW,
          log: () => {},
        });

        assert.equal(code, 1);
        const created = calls.filter((args) => args[0] === "issue" && args[1] === "create");
        assert.equal(created.length, 1);
        assert.equal(created[0][created[0].indexOf("--title") + 1], "Production down: down.example/health");
        assert.ok(!JSON.stringify(calls).includes("internal-db-host"));
      });
    },
    { body: '{"error":"internal-db-host refused"}' },
  );
});

test("a recovered target closes its issue, and an all-up run succeeds", async () => {
  await withServer([200], async (url) => {
    const target = { name: "up.example/health", url };
    const { gh, calls } = recordingGh([{ number: 41, title: issueTitle(target) }]);
    const code = await run({
      targets: [target],
      gh,
      sleep: noSleep,
      timeoutMs: 1000,
      runUrl: RUN_URL,
      now: () => NOW,
      log: () => {},
    });

    assert.equal(code, 0);
    assert.deepEqual(
      calls.filter((args) => args[0] === "issue" && args[1] !== "list").map((args) => args.slice(0, 3)),
      [["issue", "close", "41"]],
    );
  });
});

test("a gh failure fails the run but does not skip the other target", async () => {
  await withServer([503], async (url) => {
    const { gh, calls } = recordingGh([], { failOn: ["label", "create"] });
    const code = await run({
      targets: [
        { name: "a.example/health", url },
        { name: "b.example/health", url },
      ],
      gh,
      sleep: noSleep,
      retryDelayMs: 0,
      timeoutMs: 1000,
      runUrl: RUN_URL,
      now: () => NOW,
      log: () => {},
    });

    assert.equal(code, 1);
    const labelAttempts = calls.filter((args) => args[0] === "label");
    assert.equal(labelAttempts.length, 2, "both targets were handled");
  });
});

test("an unreadable issue list opens nothing and fails the run", async () => {
  // Without the list there is no way to know an issue is already open; opening
  // one anyway is how a 10-minute schedule becomes 144 duplicate issues a day.
  await withServer([503], async (url) => {
    const calls = [];
    const gh = async (args) => {
      calls.push(args);
      if (args[1] === "list") throw new Error("gh: HTTP 502");
      return "";
    };
    const code = await run({
      targets: [{ name: "a.example/health", url }],
      gh,
      sleep: noSleep,
      retryDelayMs: 0,
      timeoutMs: 1000,
      runUrl: RUN_URL,
      now: () => NOW,
      log: () => {},
    });

    assert.equal(code, 1);
    assert.deepEqual(calls.map((args) => args.slice(0, 2)), [["issue", "list"]]);
  });
});

// ── the workflow file ────────────────────────────────────────────────────────

const workflow = readFileSync(resolve(REPO_ROOT, ".github/workflows/uptime.yml"), "utf8");

test("runs every 10 minutes and on demand", () => {
  assert.match(workflow, /^\s+- cron: "\*\/10 \* \* \* \*"$/m);
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
});

test("holds exactly contents: read and issues: write, nowhere widened", () => {
  const block = workflow.match(/^permissions:\n((?:\s{2}\S.*\n)+)/m);
  assert.ok(block, "a top-level permissions block");
  const grants = block[1].trim().split("\n").map((line) => line.trim()).sort();
  assert.deepEqual(grants, ["contents: read", "issues: write"]);
  assert.equal(workflow.match(/^\s*permissions:/gm).length, 1, "no job-level override");
});

test("pins every action to a full commit SHA", () => {
  const uses = [...workflow.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((match) => match[1]);
  assert.ok(uses.length >= 2);
  for (const action of uses) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, action);
  }
});

test("runs the tested script with the job token, bounded and serialized", () => {
  assert.match(workflow, /run: node scripts\/uptime-check\.mjs/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /timeout-minutes: \d+/);
  assert.match(workflow, /concurrency:\n\s+group: uptime/);
  assert.match(workflow, /persist-credentials: false/);
});

test("this file is a blocking CI step", () => {
  const ci = readFileSync(resolve(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /run: node --test scripts\/__tests__\/uptime-check\.test\.mjs/);
});
