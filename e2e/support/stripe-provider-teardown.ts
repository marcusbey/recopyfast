interface TeardownSettlementOptions {
  timeoutMs: number;
  abort(): void;
  closePage(): Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Playwright races the test body against its timeout and can start afterEach
 * while the original async flow is still running. Give that flow one short,
 * independent chance to settle; then abort its harness signal and close the
 * page so browser actions cannot keep mutating while provider cleanup begins.
 * Cleanup never awaits the original flow without a hard bound.
 */
export async function settleProviderFlowForTeardown(
  flowPromise: Promise<void>,
  options: TeardownSettlementOptions,
): Promise<boolean> {
  const sleep = options.sleep ?? defaultSleep;
  const settled = await Promise.race([
    flowPromise.then(
      () => true,
      () => true,
    ),
    sleep(options.timeoutMs).then(() => false),
  ]);
  if (settled) return true;

  try {
    options.abort();
  } catch {
    // Cleanup still has to run even if an observer attached a bad abort hook.
  }
  try {
    await options.closePage();
  } catch {
    // A page can already be closed by the timeout. Provider cleanup is the
    // load-bearing action and must not be skipped for that benign condition.
  }
  return false;
}
