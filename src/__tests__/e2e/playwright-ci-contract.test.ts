import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

describe("Playwright CI contract", () => {
  const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const config = readFileSync(join(ROOT, "playwright.config.ts"), "utf8");
  const embedConfig = readFileSync(
    join(ROOT, "playwright.embed.config.ts"),
    "utf8",
  );
  const packageManifest = readFileSync(join(ROOT, "package.json"), "utf8");
  const nodeRunner = readFileSync(
    join(ROOT, "scripts/run-node-tests.mjs"),
    "utf8",
  );
  const coreFlow = readFileSync(
    join(ROOT, "e2e/share-edit-publish.spec.ts"),
    "utf8",
  );

  it("cannot pass by omitting hosted E2E secrets", () => {
    expect(workflow).not.toContain("secrets.E2E_SUPABASE");
    expect(workflow).not.toContain("Skip if E2E Supabase secrets");
    expect(workflow).not.toMatch(/^\s*continue-on-error:/m);
  });

  it("pins and starts the disposable service stack", () => {
    // s75: pinned by commit SHA (s69 L19), still a v3 release of the action.
    expect(workflow).toMatch(/supabase\/setup-cli@[0-9a-f]{40} # v3\.\d+\.\d+/);
    expect(workflow).toContain('version: "2.117.0"');
    expect(workflow).toContain("image: redis:7-alpine");
    expect(workflow).toContain("supabase start");
    expect(workflow).toContain("npm ci --prefix server");
    expect(workflow).toContain('REDIS_URL: "redis://127.0.0.1:6379"');
    expect(workflow).toContain('NEXT_PUBLIC_WS_URL: "http://127.0.0.1:4001"');
    expect(workflow).not.toContain('      NODE_ENV: "production"');
    expect(workflow).toContain("NODE_ENV=production npm --prefix server start");
    expect(workflow).toContain("NODE_ENV=production npm run start");
  });

  // s66a: 45 -> 56, the eleven tests of e2e/app-layout.spec.ts.
  // s66b1: 56 -> 60, the four `app pages @<width>` tests in that spec.
  // s67: 60 -> 65, the five embed SPA tests (e2e/embed-spa.spec.ts, E1–E5).
  // s66b2: 65 -> 69, the four `standalone pages @<width>` tests in app-layout.spec.ts.
  // s66c1: 69 -> 78, the nine site-pages tests (e2e/site-pages.spec.ts).
  // s66c2: 78 -> 80, the two `quick setup walks a new site to Live @<width>`
  // tests in that spec.
  // s74: 80 -> 81, E2E-019 in e2e/landing.spec.ts (a software WebGL renderer
  // gets the static sky).
  // s70b: 81 -> 86, the five Changes page tests (e2e/changes.spec.ts).
  // s17: +2, the two request-only comparison route contract tests.
  // s79: 86 -> 91, the five e2e/csp.spec.ts tests (marketing surface, /login,
  // /signup, /edit, signed-in dashboard).
  // s98: +1, the maintenance cost calculator flow (e2e/tools-maintenance-cost.spec.ts).
  // s96: +3, the three e2e/tools.spec.ts tests (hub and tool page, a scan
  // landing on a nonce report document, a hostile report rendered inert).
  // s107: +7, the seven e2e/google-analytics.spec.ts tests (US visitor, auth
  // pages, a client navigation from /login to /terms and back, a page view
  // per client navigation, EEA visitor, no country hint, signed-in dashboard).
  // s110: +1 consented context capture/withdrawal/private-document regression.
  // s111: +1 real disposable signup route/outbox/repeat-login integration.
  // s99: +2, the static checker page and seeded nonce report.
  // Combined: 86 + 2 + 5 + 1 + 3 + 7 + 1 + 1 + 2 = 108 distinct tests.
  it("runs all 108 tests and always cleans up and uploads the redacted summary", () => {
    expect(workflow).toContain('RUN_RECOPYFAST_CORE_E2E: "1"');
    expect(workflow).toContain('RUN_RECOPYFAST_PARITY: "1"');
    expect(workflow).toContain("trap cleanup EXIT INT TERM");
    expect(workflow).toContain("supabase stop --no-backup");
    expect(workflow).toContain('report.contract !== "passed"');
    expect(workflow).toContain("if: ${{ always() }}");
    expect(workflow).toContain("test-results/playwright-summary.json");
    expect(workflow).toContain('"expected":108');
    expect(workflow).toContain("report.expected !== 108");
    expect(workflow).toContain("report.total !== 108");
    expect(workflow).toContain("report.passed !== 108");
    expect(config).toContain("expected: 108");
    expect(workflow).toContain("if-no-files-found: error");
  });

  // s107: the e2e job builds with a fake GA4 id, or e2e/google-analytics.spec.ts
  // would test a build with no analytics in it. The id must stay a fake one:
  // a real id would send this job's page views to the production property.
  it("builds the e2e app with a fake Google Analytics id", () => {
    const e2eJob = workflow.slice(workflow.indexOf("\n  e2e:\n"));

    expect(e2eJob).toContain('NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-E2ETEST000"');
    expect(workflow.match(/NEXT_PUBLIC_GA_MEASUREMENT_ID:/g)).toHaveLength(1);
  });

  it("keeps the credential-free built-embed harness outside the strict 108-test suite", () => {
    // s06b was recovered after the strict-count reporter became a hard CI contract.
    // Its specs live below e2e/ for shared Playwright conventions, so without an
    // explicit exclusion Playwright recursively collects seven extra tests into
    // the main job and makes that otherwise-correct job miss its exact count. The
    // second config and unguarded job are the ownership boundary: the harness
    // still has to run, just without Next, Supabase, or provider credentials.
    expect(config).toContain('testIgnore: ["**/embed-fixture/**"]');
    expect(embedConfig).toContain('testDir: "./e2e/embed-fixture"');
    expect(embedConfig).not.toContain("webServer:");
    expect(embedConfig).toContain('"./e2e/support/strict-reporter.ts"');
    expect(embedConfig).toContain("expected: 7");
    expect(embedConfig).toContain(
      'outputFile: "test-results/embed-fixture-summary.json"',
    );
    expect(packageManifest).toContain(
      '"test:embed:fixture": "playwright test --config=playwright.embed.config.ts"',
    );

    const fixtureJob = workflow.slice(
      workflow.indexOf("\n  embed-fixture:\n"),
      workflow.indexOf("\n  e2e:\n"),
    );
    expect(fixtureJob).toContain('node-version: "24"');
    expect(fixtureJob).toContain("run: npm ci");
    expect(fixtureJob).toContain("run: npm run build:embed");
    expect(fixtureJob).toContain("run: npm run test:embed:fixture");
    expect(fixtureJob).not.toContain("\n    if:");
    expect(fixtureJob).not.toContain("SUPABASE");
    expect(fixtureJob).not.toContain("STRIPE");
    expect(fixtureJob).not.toContain("NEXT_PUBLIC_");
  });

  it("runs the founding offer capacity suite against the disposable database", () => {
    // s47a: CI runs DB suites only by name. Without this step the real-Postgres
    // proof of the 20-spot cap never runs anywhere but a laptop.
    const suite = "src/__tests__/db/founding-offer-cap.test.ts";
    const steps = workflow.split(/^(?=\s+- name: )/m);
    const step = steps.find((candidate) => candidate.includes(suite));
    const buildIndex = steps.findIndex((candidate) =>
      /- name: Build production app\s*$/m.test(candidate),
    );

    expect(step).toBeDefined();
    expect(step).toContain(
      'RCF_TEST_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
    );
    expect(step).toContain('RCF_REQUIRE_TEST_DB: "1"');
    expect(buildIndex).toBeGreaterThan(-1);
    expect(steps.indexOf(step as string)).toBeLessThan(buildIndex);
  });

  it("runs the snapshot freshness proof by name, with the database and PostgREST required", () => {
    // s65a review M2: the direct-SQL freshness proof is the Freshness AC's
    // evidence, and it is a DB suite. The plain `npm test` step records it as a
    // "[gated]" pass, so unless a step names it with RCF_REQUIRE_TEST_DB=1, the
    // PostgREST URL and the service key, CI never runs it at all.
    const suite = "src/__tests__/db/published-snapshot-freshness.test.ts";
    const steps = workflow.split(/^(?=\s+- name: )/m);
    const step = steps.find((candidate) => candidate.includes(suite));
    const startIndex = steps.findIndex((candidate) =>
      /- name: Start Supabase and export local credentials\s*$/m.test(
        candidate,
      ),
    );
    const buildIndex = steps.findIndex((candidate) =>
      /- name: Build production app\s*$/m.test(candidate),
    );

    expect(step).toBeDefined();
    expect(step).toContain("src/__tests__/db/content-write-privileges.test.ts");
    expect(step).toContain(
      'RCF_TEST_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
    );
    expect(step).toContain('RCF_REQUIRE_TEST_DB: "1"');
    expect(step).toContain('RCF_TEST_POSTGREST_URL: "http://127.0.0.1:54321"');
    expect(step).toContain(
      'RCF_TEST_POSTGREST_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"',
    );
    expect(startIndex).toBeGreaterThan(-1);
    expect(steps.indexOf(step as string)).toBeGreaterThan(startIndex);
    expect(steps.indexOf(step as string)).toBeLessThan(buildIndex);
  });

  it("runs the editor-code attempt proof by name, with the database and PostgREST required", () => {
    // s68b M3: the compare-and-set charge rests on PostgREST reporting zero
    // rows to the loser of a conditional UPDATE. `npm test` records the DB
    // suite as "[gated]"; only a step that names it runs it.
    const suite = "src/__tests__/db/editor-code-attempts.test.ts";
    const steps = workflow.split(/^(?=\s+- name: )/m);
    const step = steps.find((candidate) => candidate.includes(suite));

    expect(step).toBeDefined();
    expect(step).toContain('RCF_REQUIRE_TEST_DB: "1"');
    expect(step).toContain('RCF_TEST_POSTGREST_URL: "http://127.0.0.1:54321"');
    expect(step).toContain(
      'RCF_TEST_POSTGREST_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"',
    );
  });

  it("runs the snapshot and Stripe tooling tests through the reviewed inventory", () => {
    // s65a review m5: `node --test` files are not Jest suites, so `npm test`
    // never collects them. s116 keeps the two files explicit, but one shared
    // runner now refuses any discovered script test that was not reviewed.
    const mainJob = workflow.slice(
      workflow.indexOf("\n  ci:\n"),
      workflow.indexOf("\n  e2e:\n"),
    );

    expect(mainJob).toContain("node scripts/run-node-tests.mjs");
    expect(nodeRunner).toContain(
      "scripts/__tests__/sync-stripe-catalogue.test.mjs",
    );
    expect(nodeRunner).toContain(
      "scripts/__tests__/measure-published-snapshot.test.mjs",
    );
  });

  it("disables credential-bearing browser media in CI and enables the strict reporter", () => {
    expect(config).toContain('"./e2e/support/strict-reporter.ts"');
    expect(config).not.toContain('["line"]');
    expect(config).toContain('trace: process.env.CI ? "off"');
    expect(config).toContain('screenshot: process.env.CI ? "off"');
    expect(config).toContain('video: process.env.CI ? "off"');
  });

  it("models invited-editor access through the current allowlist, verification and handoff flow", () => {
    expect(coreFlow).not.toContain('.from("staging_access")');
    expect(coreFlow).not.toContain('access_type: "link"');
    expect(coreFlow).toContain('.from("site_editors")');
    expect(coreFlow).toContain('permissions: ["view", "edit", "publish"]');
    expect(coreFlow).toContain('.from("editor_verification_codes")');
    expect(coreFlow).toContain("hashVerificationCode");
    expect(coreFlow).toContain("/api/editor/submit-code");
    expect(coreFlow).toContain("/api/editor/handoff/create");
    expect(coreFlow).toContain("rcf_handoff");
    expect(coreFlow).toContain('.eq("id", verificationCodeId)');
  });

  it("uses credential-specific editor chrome for invited editors and owner sessions", () => {
    expect(coreFlow).toContain(
      'type ShareCredentialKind = "invited-editor" | "edit-session"',
    );
    expect(coreFlow).toContain('"invited-editor": {');
    expect(coreFlow).toContain('banner: "#rcf-editor-banner"');
    expect(coreFlow).toContain(
      "publish: '.rcf-editor-banner-publish[aria-label=\"Publish\"]'",
    );
    expect(coreFlow).toContain('"edit-session": {');
    expect(coreFlow).toContain('banner: "#rcf-staging-banner"');
    expect(coreFlow).toContain('publish: "#rcf-publish-btn"');
    expect(coreFlow).toContain("credentialKind: ShareCredentialKind");
  });

  it("runs the credit spend suite against the disposable database", () => {
    // s48: the concurrency proof for AI credits lives in a DB suite, and DB
    // suites only register their real tests when a database answers. CI must
    // run it by name, with the database required, before the build.
    const stepStart = workflow.indexOf(
      "- name: Test AI credit spend and refund against disposable Postgres",
    );
    const buildStart = workflow.indexOf("- name: Build production app");
    expect(stepStart).toBeGreaterThan(-1);
    expect(buildStart).toBeGreaterThan(stepStart);

    const step = workflow.slice(stepStart, buildStart);
    expect(step).toContain(
      'RCF_TEST_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
    );
    expect(step).toContain('RCF_REQUIRE_TEST_DB: "1"');
    expect(step).toContain(
      "npx jest --runInBand src/__tests__/db/credit-spend.test.ts",
    );
  });
});
