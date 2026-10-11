import { existsSync, readFileSync } from "node:fs";
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
  const teardownSupport = read("e2e/support/stripe-provider-teardown.ts");
  const janitor = read("scripts/stripe-provider-janitor.ts");
  const ownershipSupport = read("e2e/support/stripe-provider-ownership.ts");
  const runner = read("scripts/run-stripe-provider-e2e.mjs");
  const processSupport = read("scripts/stripe-provider-process.cjs");
  const workflow = read(".github/workflows/ci.yml");
  const runbook = read("docs/operations/stripe-test-entitlement-e2e.md");
  const s24CliVersion = workflow.match(
    /supabase\/setup-cli@[^\n]+[\s\S]*?version: "([^"]+)"/,
  )?.[1];
  const s24SupabaseExclusions =
    "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";

  it("keeps the credentialed provider proof outside the default 86-test CI lane", () => {
    expect(defaultConfig).toContain("expected: 86");
    expect(defaultConfig).not.toContain("stripe-test-entitlement.provider.ts");
    expect(providerConfig).toContain(
      'testMatch: "stripe-test-entitlement.provider.ts"',
    );
    expect(providerConfig).toContain("expected: 1");
    expect(providerConfig).toContain('trace: "off"');
    expect(providerConfig).toContain('screenshot: "off"');
    expect(providerConfig).toContain('video: "off"');
    expect(providerConfig).toContain('preserveOutput: "never"');
    expect(providerConfig).toContain("headless: false");
    expect(providerConfig).toContain("STRIPE_PROVIDER_HUMAN_CHECKOUT");
    expect(providerConfig).toContain("STRIPE_PROVIDER_OUTPUT_DIR");
    expect(workflow).not.toContain("RUN_RECOPYFAST_STRIPE_E2E");
    expect(workflow).not.toContain("STRIPE_PROVIDER_EVIDENCE_FILE");
  });

  it("runs two clean local stacks and a real Stripe CLI forwarder by default", () => {
    expect(JSON.parse(packageJson).scripts["test:e2e:stripe-provider"]).toBe(
      "node scripts/run-stripe-provider-e2e.mjs",
    );
    expect(runner).toContain("DEFAULT_RUNS = 2");
    expect(runner).toContain('args.includes("--human-checkout")');
    expect(runner.indexOf("assertHumanCheckoutOptIn")).toBeLessThan(
      runner.indexOf("loadPrivateEnvironment()"),
    );
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
    expect(runner).toContain("recordExternalJanitorFailure");
    expect(runner.indexOf("recordExternalJanitorFailure(")).toBeLessThan(
      runner.indexOf("if (janitorError) throw janitorError"),
    );
    expect(runner).toContain("removeSafeFailureFile(providerFailureFile)");
    expect(runner).toContain("randomUUID");
    expect(runner).toContain("STRIPE_PROVIDER_RUN_ID");
    expect(runner).toContain("STRIPE_PROVIDER_AUTH_USER_ID");
    expect(runner).toContain("STRIPE_PROVIDER_USER_EMAIL");
    expect(runner).toContain("STRIPE_PROVIDER_STARTED_AT_UNIX");
    expect(runner).toContain("scripts/stripe-provider-janitor.ts");
    expect(runner).toContain("PLAYWRIGHT_PROCESS_TIMEOUT_MS");
    expect(runner).toContain("PLAYWRIGHT_PROCESS_TIMEOUT_MS = 21 * 60_000");
    expect(providerSpec).toContain("test.setTimeout(20 * 60_000)");
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
    expect(runner).toContain('STRIPE_PROVIDER_HUMAN_CHECKOUT: "1"');
    expect(runner).toContain("HUMAN_CHECKOUT_READY_NOTICE");
    expect(processSupport).toContain("Stripe TEST Checkout is ready");
    expect(runner).toContain("STRIPE_PROVIDER_HUMAN_CHECKOUT_NOTICE");
    expect(providerConfig).toContain("assertRunnerOwnedProviderInvocation");
    expect(processSupport).toContain(
      'env.STRIPE_PROVIDER_HUMAN_CHECKOUT !== "1"',
    );
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

  it("prints only aggregate success status while retaining IDs in owner-only evidence", () => {
    const completion = runner.slice(
      runner.indexOf("if (!pendingEvidence)"),
      runner.indexOf("function removeProviderOutput"),
    );

    expect(completion).toContain("finalEvidence.processedEvents.length");
    expect(completion).toContain("finalEvidence.replay.duplicate");
    expect(completion).toContain("cleanup=proved");
    expect(completion).not.toContain("finalEvidence.checkout.id");
    expect(completion).not.toContain("finalEvidence.subscription.id");
    expect(completion).not.toMatch(/checkout \$\{/i);
    expect(completion).not.toMatch(/subscription \$\{/i);
  });

  it("waits for bounded human Checkout without automating payment fields and proves the durable outcome plus replay idempotency", () => {
    expect(providerSpec).toContain("createStripeProviderFixture");
    expect(providerSpec).toContain("/api/billing/checkout");
    expect(providerSpec).toContain('intent: "subscription"');
    expect(providerSpec).toContain('planId: "pro"');
    expect(providerSpec).toContain('billingPeriod: "monthly"');
    expect(providerSpec).toContain("waitForHostedCheckoutReturn");
    expect(providerSpec).toContain("HUMAN_CHECKOUT_TIMEOUT_MS = 10 * 60_000");
    expect(providerSpec).toContain('failedStage = "checkout:human-completion"');
    expect(providerSpec).toContain(
      "process.stdout.write(HUMAN_CHECKOUT_READY_NOTICE)",
    );
    expect(providerSpec).toContain(
      "process.env.STRIPE_PROVIDER_HUMAN_CHECKOUT_NOTICE !==",
    );
    expect(providerSpec).toContain("expectedAppOrigin");
    expect(providerSpec).toContain(
      "expectedCheckoutSessionId: checkoutSessionId",
    );
    expect(providerSpec).toContain("state.abortController.signal");
    const humanCheckoutBlock = providerSpec.slice(
      providerSpec.indexOf("async function waitForHumanHostedCheckout"),
      providerSpec.indexOf("async function readCheckoutStatus"),
    );
    expect(humanCheckoutBlock.indexOf("await page.goto")).toBeLessThan(
      humanCheckoutBlock.indexOf(
        "process.stdout.write(HUMAN_CHECKOUT_READY_NOTICE)",
      ),
    );
    expect(
      humanCheckoutBlock.indexOf(
        "process.stdout.write(HUMAN_CHECKOUT_READY_NOTICE)",
      ),
    ).toBeLessThan(
      humanCheckoutBlock.indexOf("await waitForHostedCheckoutReturn"),
    );
    expect(hostedFieldSupport).toContain("page.isClosed()");
    expect(hostedFieldSupport).toContain("expectedAppOrigin");
    expect(hostedFieldSupport).toContain('searchParams.getAll("checkout")');
    expect(hostedFieldSupport).toContain('searchParams.getAll("session_id")');
    expect(hostedFieldSupport).toContain("expectedCheckoutSessionId");
    expect(hostedFieldSupport).toContain("page.waitForTimeout");
    expect(hostedFieldSupport).toContain("signal?.aborted");
    expect(
      existsSync(join(ROOT, "e2e/support/stripe-agent-disclosure.ts")),
    ).toBe(false);
    expect(
      existsSync(
        join(ROOT, "src/__tests__/e2e/stripe-agent-disclosure.test.ts"),
      ),
    ).toBe(false);
    for (const forbidden of [
      "cardNumber",
      "cardExpiry",
      "cardCvc",
      "billingName",
      "billingCountry",
      "billingPostalCode",
      "AiAgentPaymentSteering",
      "link_pay_token",
      "checkAiAgentDisclosure",
      "performHostedFieldAction",
      "performOptionalHostedFieldAction",
      'button[type="submit"]',
    ]) {
      expect(providerSpec).not.toContain(forbidden);
      expect(hostedFieldSupport).not.toContain(forbidden);
    }
    expect(providerSpec).toContain("failedStage: ProviderFailureStage");
    expect(providerSpec).toContain("writeProviderFailureEvidence");
    expect(providerSpec).toContain("billing_customers");
    expect(providerSpec).toContain("billing_subscriptions");
    expect(providerSpec).toContain("billing_events");
    expect(providerSpec).toContain("checkout_pending_intents");
    expect(providerSpec).toContain('status: "completed"');
    expect(providerSpec).toContain("/api/billing/entitlement");
    expect(providerSpec).toContain("generateTestHeaderString");
    expect(providerSpec).toContain("duplicate: true");
    expect(providerSpec).toContain('.eq("stripe_event_id", event.id)');
    expect(providerSpec).toMatch(/try\s*\{/);
    expect(providerSpec).toContain("test.afterEach");
    expect(providerSpec).toContain("state.fixturePromise");
    expect(providerSpec).toContain("state.flowPromise");
    expect(providerSpec).toContain("state.abortController");
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

  it("keeps worker teardown non-destructive and assigns cleanup to the external janitor", () => {
    expect(providerFixture).toContain("id: requestedAuthUserId");
    expect(providerFixture).not.toContain("cleanupCapturedFixture");
    expect(providerFixture).not.toContain(
      "reconcileCapturedCheckoutForCleanup",
    );
    expect(providerFixture).not.toContain("auth.admin.deleteUser");
    expect(providerFixture).not.toContain("stripe.checkout.sessions.expire");
    expect(providerFixture).not.toContain("stripe.subscriptions.cancel");
    expect(providerFixture).not.toContain("stripe.customers.del");
    expect(providerFixture).not.toContain("cleanup(options");
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
    expect(janitor).toContain("EXPLICITLY_DELETED_DATABASE_TABLES");
    expect(janitor).toContain("databaseTablesCountedAsResidue");
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
    expect(runbook).toMatch(/--human-checkout/);
    expect(runbook).toMatch(/headed/i);
    expect(runbook).toMatch(/ten minutes/i);
    expect(runbook).toMatch(/CAPTCHA/i);
    expect(runbook).toMatch(/two.*independently cleaned/i);
    expect(runbook).toMatch(/Link Pay Token/i);
  });
});
