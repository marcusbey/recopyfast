import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("Stripe provider E2E operator contract", () => {
  const packageJson = read("package.json");
  const defaultConfig = read("playwright.config.ts");
  const providerConfig = read("playwright.stripe-provider.config.ts");
  const providerSpec = read("e2e/stripe-test-entitlement.provider.ts");
  const providerFixture = read("e2e/support/stripe-provider-fixture.ts");
  const failureSupport = read("e2e/support/stripe-provider-failure.ts");
  const hostedFieldSupport = read("e2e/support/stripe-hosted-fields.ts");
  const disclosureSupport = read("e2e/support/stripe-agent-disclosure.ts");
  const teardownSupport = read("e2e/support/stripe-provider-teardown.ts");
  const janitor = read("scripts/stripe-provider-janitor.ts");
  const ownershipSupport = read("e2e/support/stripe-provider-ownership.ts");
  const runner = read("scripts/run-stripe-provider-e2e.mjs");
  const processSupport = read("scripts/stripe-provider-process.cjs");
  const workflow = read(".github/workflows/ci.yml");
  const runbook = read("docs/operations/stripe-test-entitlement-e2e.md");
  const s24CliVersion = workflow.match(
    /supabase\/setup-cli@v3[\s\S]*?version: "([^"]+)"/,
  )?.[1];
  const s24SupabaseExclusions =
    "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";

  it("keeps the credentialed provider proof outside the default 39-test CI lane", () => {
    expect(defaultConfig).toContain("expected: 39");
    expect(defaultConfig).not.toContain("stripe-test-entitlement.provider.ts");
    expect(providerConfig).toContain(
      'testMatch: "stripe-test-entitlement.provider.ts"',
    );
    expect(providerConfig).toContain("expected: 1");
    expect(providerConfig).toContain('trace: "off"');
    expect(providerConfig).toContain('screenshot: "off"');
    expect(providerConfig).toContain('video: "off"');
    expect(providerConfig).toContain('preserveOutput: "never"');
    expect(providerConfig).toContain("STRIPE_PROVIDER_OUTPUT_DIR");
    expect(workflow).not.toContain("RUN_RECOPYFAST_STRIPE_E2E");
    expect(workflow).not.toContain("STRIPE_PROVIDER_EVIDENCE_FILE");
  });

  it("runs two clean local stacks and a real Stripe CLI forwarder by default", () => {
    expect(JSON.parse(packageJson).scripts["test:e2e:stripe-provider"]).toBe(
      "node scripts/run-stripe-provider-e2e.mjs",
    );
    expect(runner).toContain("DEFAULT_RUNS = 2");
    expect(s24CliVersion).toBe("2.117.0");
    expect(runner).toContain(`const SUPABASE_CLI_VERSION = "${s24CliVersion}"`);
    expect(runner).toContain(`"${s24SupabaseExclusions}"`);
    expect(runner).toContain("RECOPYFAST_SUPABASE_CLI_BIN");
    expect(runner).toContain("command(supabaseCliBin");
    expect(runner).toContain('["start", "-x", SUPABASE_EXCLUSIONS]');
    expect(runner).toContain('["stop", "--no-backup"]');
    expect(runner).toContain('"redis:7-alpine"');
    expect(runner).toContain('"listen"');
    expect(runner).toContain('"--forward-to"');
    expect(runner).toContain("STRIPE_WEBHOOK_SECRET: webhookSecret");
    expect(runner).not.toContain('"--live"');
    expect(runner).not.toContain("stripe config --list");
    expect(runner).toContain("STRIPE_PROVIDER_OUTPUT_DIR");
    expect(runner).toContain("removeProviderOutput(providerOutputDir)");
    expect(runner).toContain("STRIPE_PROVIDER_FAILURE_FILE");
    expect(runner).toContain("readAndValidateFailure");
    expect(runner).toContain("removeSafeFailureFile(providerFailureFile)");
    expect(runner).toContain("randomUUID");
    expect(runner).toContain("STRIPE_PROVIDER_RUN_ID");
    expect(runner).toContain("STRIPE_PROVIDER_AUTH_USER_ID");
    expect(runner).toContain("STRIPE_PROVIDER_USER_EMAIL");
    expect(runner).toContain("STRIPE_PROVIDER_STARTED_AT_UNIX");
    expect(runner).toContain("scripts/stripe-provider-janitor.ts");
    expect(runner).toContain("PLAYWRIGHT_PROCESS_TIMEOUT_MS");
    expect(runner.indexOf("runJanitor:")).toBeLessThan(
      runner.indexOf("stopServices:"),
    );
    expect(runner).not.toContain('"--api-key"');
    expect(runner).toContain("STRIPE_API_KEY");
    expect(runner).toContain("removeSafeRunArtifact(providerSummaryFile)");
    expect(runner).toContain("removeSafeRunArtifact(providerEvidenceFile)");
    expect(runner).toContain("writeRunManifest");
    expect(runner).toContain("SIGINT");
    expect(runner).toContain("SIGTERM");
    expect(processSupport).toContain("detached:");
    expect(processSupport).toContain('process.platform !== "win32"');
    expect(runner).toContain("terminateProcessGroup");
    expect(
      runner.indexOf("registerProcess(serviceChildren, child)"),
    ).toBeLessThan(runner.indexOf("webhookSecret = await new Promise"));
    expect(runner).toContain("STRIPE_PROVIDER_JANITOR_STATE_FILE");
    expect(runner).toContain("FAILURE_MIN_OBSERVATION_MS = 5 * 60_000");
    expect(runner).toContain("STRIPE_PROVIDER_MIN_OBSERVATION_MS");
    expect(runner).toContain("hasCompletedParentJanitor");
    expect(runner).toContain(
      "if (!appEnvironment || hasCompletedParentJanitor) return",
    );
    expect(runner).toContain("hasCompletedParentJanitor = true");
    expect(runner).toContain("assertNoUncleanRunManifests(TEST_RESULTS_DIR)");
    expect(runner).toContain('STRIPE_PROVIDER_RUNNER_OWNED: "1"');
    expect(providerConfig).toContain("assertRunnerOwnedProviderInvocation");
    expect(processSupport).toContain("validateProviderEvidence");
    expect(
      runner.indexOf('await cleanupMachine.cleanup("finally")'),
    ).toBeLessThan(runner.indexOf("finalizeSafeEvidence(providerEvidenceFile"));

    for (const retainedService of [
      "storage",
      "auth",
      "postgrest",
      "kong",
      "db",
    ]) {
      expect(s24SupabaseExclusions.split(",")).not.toContain(retainedService);
    }
    expect(runbook).toContain(`Supabase CLI ${s24CliVersion}`);
    expect(runbook).toContain(s24SupabaseExclusions);
    expect(runbook).toContain("RECOPYFAST_SUPABASE_CLI_BIN");
  });

  it("exercises authenticated hosted Checkout and proves the durable outcome plus replay idempotency", () => {
    expect(providerSpec).toContain("createStripeProviderFixture");
    expect(providerSpec).toContain("/api/billing/checkout");
    expect(providerSpec).toContain('intent: "subscription"');
    expect(providerSpec).toContain('planId: "pro"');
    expect(providerSpec).toContain('billingPeriod: "monthly"');
    expect(providerSpec).toContain('input[name="cardNumber"]');
    expect(providerSpec).toContain("performHostedFieldAction");
    expect(providerSpec).toContain("performOptionalHostedFieldAction");
    expect(providerSpec).toContain("waitForHostedCheckoutReturn");
    expect(hostedFieldSupport).toContain(
      "const HOSTED_FIELD_TIMEOUT_MS = 30_000",
    );
    expect(hostedFieldSupport).toContain("page.frames()");
    expect(hostedFieldSupport).toContain("page.waitForTimeout");
    expect(hostedFieldSupport).toContain("Frame was detached$");
    const countrySelection = providerSpec.indexOf(
      'selectHostedBillingCountry(page, "US")',
    );
    const postalEntry = providerSpec.indexOf('input[name="billingPostalCode"]');
    expect(countrySelection).toBeGreaterThan(-1);
    expect(postalEntry).toBeGreaterThan(countrySelection);
    expect(providerSpec).toContain("checkAiAgentDisclosure(page)");
    expect(disclosureSupport).toContain(
      '"I am an AI agent acting on behalf of someone else"',
    );
    expect(disclosureSupport).toContain("getByText");
    expect(disclosureSupport).toContain("exact: true");
    expect(disclosureSupport).toContain('.dispatchEvent("click"');
    expect(disclosureSupport).not.toContain(".click(");
    expect(disclosureSupport).toContain(".isChecked({");
    expect(disclosureSupport).toContain(
      "timeout: actionDeadline.playwrightTimeoutMs()",
    );
    expect(disclosureSupport).not.toContain(".check(");
    expect(hostedFieldSupport).toMatch(/postal code incomplete/i);
    expect(providerSpec).toContain("failedStage: ProviderFailureStage");
    expect(providerSpec).toContain("writeProviderFailureEvidence");
    expect(providerSpec).toContain("billing_customers");
    expect(providerSpec).toContain("billing_subscriptions");
    expect(providerSpec).toContain("billing_events");
    expect(providerSpec).toContain("/api/billing/entitlement");
    expect(providerSpec).toContain("generateTestHeaderString");
    expect(providerSpec).toContain("duplicate: true");
    expect(providerSpec).toContain('.eq("stripe_event_id", event.id)');
    expect(providerSpec).toMatch(/try\s*\{/);
    expect(providerSpec).toContain("test.afterEach");
    expect(providerSpec).toContain("state.fixturePromise");
    expect(providerSpec).toContain("state.flowPromise");
    expect(providerSpec).toContain("state.abortController");
    expect(
      providerSpec.indexOf("fixture.markCheckoutRequested()"),
    ).toBeLessThan(providerSpec.indexOf("page.request.post"));
    const teardownBlock = providerSpec.slice(
      providerSpec.indexOf("test.afterEach"),
      providerSpec.indexOf('test("a genuine paid test subscription'),
    );
    expect(teardownBlock).toContain("testInfo.setTimeout");
    expect(teardownBlock).toContain("settleProviderFlowForTeardown");
    expect(teardownBlock).not.toContain("fixture.cleanup");
    expect(teardownBlock).not.toContain("provisionalAuthOwnership.cleanup");
    expect(teardownBlock).not.toContain("deleteAuthUser");
    expect(teardownBlock).not.toContain("expireOwnedCheckoutSession");
    expect(teardownBlock).not.toContain("cancelOwnedSubscription");
    expect(teardownBlock).not.toContain("deleteOwnedCustomer");
    expect(teardownBlock.indexOf("writeProviderFailureEvidence")).toBeLessThan(
      teardownBlock.indexOf("settleProviderFlowForTeardown"),
    );
    const testBody = providerSpec.slice(
      providerSpec.indexOf('test("a genuine paid test subscription'),
      providerSpec.indexOf("function idOf"),
    );
    expect(testBody).not.toContain("} finally {");
  });

  it("proves post-cleanup provider history and clears the browser session", () => {
    expect(providerFixture).toContain("stripe.checkout.sessions.retrieve");
    expect(providerFixture).toContain("stripe.checkout.sessions.expire");
    expect(providerFixture).toContain("stripe.checkout.sessions.list");
    expect(providerFixture).toContain("client_reference_id");
    expect(providerFixture).toContain("metadata?.user_id");
    expect(providerFixture).toContain("onAuthUserCreated");
    expect(providerFixture).toContain("id: requestedAuthUserId");
    expect(providerFixture).toContain("reconcileCapturedCheckoutForCleanup");
    expect(providerFixture).toContain("expireOwnedCheckoutSession");
    expect(providerFixture).toContain("cancelOwnedSubscription");
    expect(providerFixture).toContain("deleteOwnedCustomer");
    expect(providerFixture).toContain("stripe.events.retrieve");
    expect(providerFixture).toContain("context.clearCookies()");
    for (const cleanupLabel of [
      "expire_checkout",
      "cancel_subscription",
      "delete_customer",
      "wait_deliveries",
      "discover_rows",
      "delete_billing_events",
      "delete_auth_user",
    ]) {
      expect(providerFixture).toContain(cleanupLabel);
    }
    expect(failureSupport).toContain("redactDiagnostic");
    expect(failureSupport).toContain("mode: 0o600");
    expect(teardownSupport).toContain("Promise.race");
    expect(teardownSupport).toContain("options.abort()");
    expect(janitor).toContain("auth.admin.getUserById");
    expect(janitor).toContain("checkout.sessions.list");
    expect(janitor).toContain("customers.list");
    expect(janitor).toContain("subscriptions.list");
    expect(janitor).toContain("client_reference_id");
    expect(janitor).toContain("metadata?.user_id");
    expect(janitor).toContain("reconcileUntilQuiescent");
    expect(janitor).toContain("assertStripeProviderEnvironment");
    expect(janitor).toContain("assertStripeProviderPrice");
    expect(janitor).toContain("paginateProviderList");
    expect(
      janitor.indexOf("environment = assertStripeProviderEnvironment"),
    ).toBeLessThan(janitor.indexOf("supabase = createClient"));
    expect(janitor).toContain("expireOwnedCheckoutSession");
    expect(janitor).toContain("cancelOwnedSubscription");
    expect(janitor).toContain("deleteOwnedCustomer");
    expect(janitor).toContain("persistTerminalDeliveryLedger");
    expect(ownershipSupport).toContain("assertOwnedCustomer");
    expect(ownershipSupport).toContain("assertOwnedCheckoutSession");
    expect(ownershipSupport).toContain("assertOwnedSubscription");
    expect(janitor).toMatch(/return \{\s*authUserId,/);
  });

  it("documents the test-only boundary, immutable history, exact cleanup, and live-payment human gate", () => {
    expect(runbook).toMatch(/test mode/i);
    expect(runbook).toMatch(/immutable.*Checkout.*event/i);
    expect(runbook).toMatch(/captured IDs/i);
    expect(runbook).toMatch(/twice/i);
    expect(runbook).toMatch(/maximum total[\s\S]*payer/i);
    expect(runbook).toMatch(/retain[\s\S]*cancel[\s\S]*refund/i);
    expect(runbook).toMatch(/never.*production/i);
  });
});
