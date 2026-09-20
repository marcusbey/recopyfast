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

  it("runs all 39 tests and always cleans up and uploads the redacted summary", () => {
    expect(workflow).toContain('RUN_RECOPYFAST_CORE_E2E: "1"');
    expect(workflow).toContain('RUN_RECOPYFAST_PARITY: "1"');
    expect(workflow).toContain("trap cleanup EXIT INT TERM");
    expect(workflow).toContain("supabase stop --no-backup");
    expect(workflow).toContain('report.contract !== "passed"');
    expect(workflow).toContain("if: ${{ always() }}");
    expect(workflow).toContain("test-results/playwright-summary.json");
    expect(workflow).toContain("if-no-files-found: error");
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
});
