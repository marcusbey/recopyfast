import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

describe("Playwright CI contract", () => {
  const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const config = readFileSync(join(ROOT, "playwright.config.ts"), "utf8");
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
    expect(workflow).toContain("supabase/setup-cli@v3");
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
  it("runs all 81 tests and always cleans up and uploads the redacted summary", () => {
    expect(workflow).toContain('RUN_RECOPYFAST_CORE_E2E: "1"');
    expect(workflow).toContain('RUN_RECOPYFAST_PARITY: "1"');
    expect(workflow).toContain("trap cleanup EXIT INT TERM");
    expect(workflow).toContain("supabase stop --no-backup");
    expect(workflow).toContain('report.contract !== "passed"');
    expect(workflow).toContain("if: ${{ always() }}");
    expect(workflow).toContain("test-results/playwright-summary.json");
    expect(workflow).toContain('"expected":81');
    expect(workflow).toContain("report.expected !== 81");
    expect(workflow).toContain("report.total !== 81");
    expect(workflow).toContain("report.passed !== 81");
    expect(config).toContain("expected: 81");
    expect(workflow).toContain("if-no-files-found: error");
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

  it("runs the snapshot measurement tooling test beside the Stripe tooling test", () => {
    // s65a review m5: `node --test` files are not Jest suites, so `npm test`
    // never collects them. A script test that no CI step names guards nothing.
    const mainJob = workflow.slice(
      workflow.indexOf("\n  ci:\n"),
      workflow.indexOf("\n  e2e:\n"),
    );

    expect(mainJob).toContain(
      "node --test scripts/__tests__/sync-stripe-catalogue.test.mjs",
    );
    expect(mainJob).toContain(
      "node --test scripts/__tests__/measure-published-snapshot.test.mjs",
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
