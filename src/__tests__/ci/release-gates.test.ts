/**
 * @jest-environment node
 */

/**
 * s75 — CI proves what production runs.
 *
 * Every assertion here pins a gap that was open on `main` at `72f4cff`, each of
 * which let a green CI run say nothing about production:
 *
 *   - the migration replay ran on PostgreSQL 14 and the Supabase stack on 15,
 *     while production is 17.4;
 *   - seven database suites were named by no CI step, so each run recorded a
 *     "[gated]" placeholder or a describe.skip for them;
 *   - the coverage thresholds were read only by a local prepush script;
 *   - format:check, part of the Definition of Done, ran in no CI step;
 *   - ci.yml had no `permissions:` and every action was pinned by a tag;
 *   - CI tested Node 20 (past end of life) and the realtime image ran it,
 *     while nothing declared what Vercel runs;
 *   - a Playwright spec sat outside testDir and had never run.
 *
 * Text contracts, like `src/__tests__/e2e/playwright-ci-contract.test.ts`: the
 * workflow cannot run locally, so what it says is the thing to pin. The live
 * proof is the PR's own CI run.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/** Production's major (docs/research/s56-rls-content-writes-need-plan.md:7). */
const PRODUCTION_PG_MAJOR = 17;

const ciWorkflow = read(".github/workflows/ci.yml");
const runner = read("scripts/run-db-invariants.mjs");

describe("the database replay runs the production PostgreSQL major", () => {
  it("the replay checks require the production major", () => {
    // The pure check lives beside the runner so `node --test` can exercise it.
    const checks = read("scripts/db/replay-checks.mjs");
    const declared = /export const REQUIRED_PG_MAJOR = (\d+);/.exec(checks);

    expect(declared?.[1]).toBe(String(PRODUCTION_PG_MAJOR));
    expect(runner).toContain("assertServerMajor(");
  });

  it("the CI replay service is the official image of that major", () => {
    const images = [
      ...ciWorkflow.matchAll(/^\s+image:\s*postgres:(\S+)\s*$/gm),
    ].map((match) => match[1]);

    expect(images).toEqual([String(PRODUCTION_PG_MAJOR)]);
  });

  it("the Supabase CLI stack the e2e job starts is that major", () => {
    const config = read("supabase/config.toml");
    const majors = [...config.matchAll(/^major_version\s*=\s*(\d+)\s*$/gm)].map(
      (match) => Number(match[1]),
    );

    expect(majors).toEqual([PRODUCTION_PG_MAJOR]);
  });

  it("names the replay's node test in the main CI job", () => {
    expect(mainJob()).toContain(
      "node --test scripts/__tests__/replay-checks.test.mjs",
    );
  });
});

describe("every database suite runs against a database in CI", () => {
  // A DB suite gates itself out of a plain `npm test` (db-harness.ts), so the
  // only runs that prove anything are the ones that name it. Until s75, seven
  // of these files were named nowhere and every CI run recorded their
  // "[gated]" placeholder or a describe.skip instead.
  const suites = readdirSync(join(ROOT, "src/__tests__/db"))
    .filter((file) => /\.test\.tsx?$/.test(file))
    .map((file) => `src/__tests__/db/${file}`)
    .sort();

  it("finds the suites it is checking", () => {
    expect(suites.length).toBeGreaterThanOrEqual(20);
  });

  it("names each one in the replay runner or in a CI step", () => {
    // Comments do not count: a path mentioned in a comment runs nothing.
    const replaySuites = withoutComments(
      /const REPLAY_SUITES = \[([\s\S]*?)\];/.exec(runner)?.[1] ?? "",
      "//",
    );
    const workflowSteps = withoutComments(ciWorkflow, "#");
    const unnamed = suites.filter(
      (suite) =>
        !replaySuites.includes(`"${suite}"`) && !workflowSteps.includes(suite),
    );

    expect(replaySuites).toContain(
      '"src/__tests__/db/column-privileges.test.ts"',
    );
    expect(unnamed).toEqual([]);
  });
});

/**
 * The coverage floor measured on the s75 tree, each metric rounded down
 * (docs/research/s75-ci-release-gates.md). The thresholds in jest.config.js may
 * rise above these, never fall below: lowering a floor takes an edit here too,
 * in plain sight of review — the same two-place ratchet as the embed ceilings.
 */
const COVERAGE_FLOOR: Record<string, number> = {
  branches: 61,
  functions: 65,
  lines: 69,
  statements: 68,
};

describe("the coverage ratchet gates CI, not just a local hook", () => {
  // Until s75 only `npm run test:coverage` read the thresholds, and only the
  // local prepush script ran it; CI ran `npm test` without --coverage, so the
  // ratchet held nowhere a reviewer could see.
  it("the main job's Jest run collects coverage", () => {
    const jestSteps = steps(mainJob()).filter((step) =>
      /run: npm test -- /.test(step),
    );

    expect(jestSteps).toHaveLength(1);
    expect(jestSteps[0]).toMatch(/\s--coverage(\s|$)/);
  });

  it("holds every jest.config.js threshold at or above the s75 floor", () => {
    const config = read("jest.config.js");
    const block =
      /coverageThreshold:\s*{\s*global:\s*{([^}]*)}/.exec(config)?.[1] ?? "";
    const thresholds = Object.fromEntries(
      [...block.matchAll(/(\w+):\s*(\d+(?:\.\d+)?)/g)].map((match) => [
        match[1],
        Number(match[2]),
      ]),
    );

    const belowFloor = Object.entries(COVERAGE_FLOOR)
      .filter(([metric, floor]) => !(thresholds[metric] >= floor))
      .map(([metric, floor]) => `${metric}: ${thresholds[metric]} < ${floor}`);

    expect(Object.keys(thresholds).sort()).toEqual(
      Object.keys(COVERAGE_FLOOR).sort(),
    );
    expect(belowFloor).toEqual([]);
  });
});

describe("formatting is a CI gate", () => {
  // AGENTS.md's Definition of Done lists format:check; until s75 only the
  // local pre-commit hook ran it.
  it("the main job runs npm run format:check", () => {
    const formatSteps = steps(mainJob()).filter((step) =>
      /^\s+run: npm run format:check\s*$/m.test(step),
    );

    expect(formatSteps).toHaveLength(1);
  });
});

describe("workflows run with least privilege and pinned actions (s69 L19)", () => {
  const workflows = readdirSync(join(ROOT, ".github/workflows"))
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .map((file) => ({
      file,
      text: read(`.github/workflows/${file}`),
    }));

  it("finds the workflows it is checking", () => {
    expect(workflows.map((workflow) => workflow.file)).toEqual(
      expect.arrayContaining(["ci.yml", "server-security.yml"]),
    );
  });

  it("gives every workflow a read-only token, and no job more", () => {
    // Without a `permissions:` key the token gets the repository default,
    // which can be read-write. No job here pushes, comments or publishes:
    // caches and artifacts use the runtime token, not GITHUB_TOKEN.
    const offenders = workflows.flatMap(({ file, text }) => {
      const topLevel = /^permissions:\n((?:[ \t]+\S.*\n)+)/m.exec(text);
      const granted = (topLevel?.[1] ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const problems: string[] = [];
      if (granted.join(",") !== "contents: read") {
        problems.push(
          `${file}: top-level permissions are [${granted.join(", ")}]`,
        );
      }
      if (/^\s*(?:[a-z-]+:\s*write|permissions:\s*write-all)\s*$/m.test(text)) {
        problems.push(`${file}: grants a write permission`);
      }
      return problems;
    });

    expect(offenders).toEqual([]);
  });

  it("pins every action to a full commit SHA with its version beside it", () => {
    // A tag is movable by whoever controls the action's repository; a SHA is
    // not. The comment keeps the pin reviewable.
    const unpinned = workflows.flatMap(({ file, text }) =>
      [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(.+)$/gm)]
        .map((match) => match[1].trim())
        .filter(
          (reference) =>
            !/^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(reference),
        )
        .map((reference) => `${file}: ${reference}`),
    );

    expect(unpinned).toEqual([]);
  });
});

/**
 * The Node major CI tests and production runs (s75 plan, decision 5): 24 LTS.
 * Node 20 reached end of life on 2026-04-30 and Vercel discontinued `20.x` on
 * 2026-10-01, while CI still tested on 20 and the realtime image ran it.
 */
const NODE_MAJOR = 24;

describe("CI, the realtime image and Vercel run one Node major", () => {
  it("every workflow sets up that major", () => {
    const versions = readdirSync(join(ROOT, ".github/workflows"))
      .filter((file) => /\.ya?ml$/.test(file))
      .flatMap((file) =>
        [
          ...read(`.github/workflows/${file}`).matchAll(
            /^\s+node-version:\s*"?([^"\s]+)"?\s*$/gm,
          ),
        ].map((match) => `${file}: ${match[1]}`),
      );

    expect(versions.length).toBeGreaterThanOrEqual(4);
    expect(
      versions.filter(
        (entry) => !new RegExp(`: ${NODE_MAJOR}(\\.\\d+){0,2}$`).test(entry),
      ),
    ).toEqual([]);
  });

  it("the realtime server image is built on it", () => {
    const froms = [
      ...read("server/Dockerfile").matchAll(/^FROM\s+(\S+)/gm),
    ].map((match) => match[1]);

    expect(froms).toEqual([`node:${NODE_MAJOR}-alpine`]);
  });

  it("package.json declares it, so Vercel builds and runs on it too", () => {
    // Vercel honours engines.node over the dashboard setting; without it the
    // production runtime is whatever the dashboard says, untested by CI.
    const manifest = JSON.parse(read("package.json")) as {
      engines?: { node?: string };
    };

    expect(manifest.engines?.node).toBe(`${NODE_MAJOR}.x`);
  });
});

describe("every Playwright spec lives where Playwright looks", () => {
  // e2e-billing-tests.spec.ts sat at the repo root from 30c3b76 until s75,
  // outside testDir, so it never ran — a spec nobody could see fail.
  it("keeps testDir at ./e2e and no spec at the repo root", () => {
    const stray = readdirSync(ROOT).filter((file) =>
      /\.spec\.[cm]?[jt]sx?$/.test(file),
    );

    expect(read("playwright.config.ts")).toContain('testDir: "./e2e"');
    expect(stray).toEqual([]);
  });
});

/** Drops every line whose first non-blank characters are `marker`. */
function withoutComments(text: string, marker: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(marker))
    .join("\n");
}

/** Splits a job into its steps, each starting at its `- name:` line. */
function steps(job: string): string[] {
  return job.split(/^(?=\s+- name: )/m);
}

/** The `ci:` job only — from its key to the next job's key. */
function mainJob(): string {
  return ciWorkflow.slice(
    ciWorkflow.indexOf("\n  ci:\n"),
    ciWorkflow.indexOf("\n  e2e:\n"),
  );
}
