import { settleProviderFlowForTeardown } from "../../../e2e/support/stripe-provider-teardown";

describe("settleProviderFlowForTeardown", () => {
  it("aborts and closes the page after a short hard settlement bound", async () => {
    const neverSettles = new Promise<void>(() => {});
    const abort = jest.fn();
    const closePage = jest.fn().mockResolvedValue(undefined);
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      settleProviderFlowForTeardown(neverSettles, {
        timeoutMs: 5_000,
        abort,
        closePage,
        sleep,
      }),
    ).resolves.toBe(false);

    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(closePage).toHaveBeenCalledTimes(1);
  });

  it("does not cancel a flow that has already settled", async () => {
    const abort = jest.fn();
    const closePage = jest.fn();

    await expect(
      settleProviderFlowForTeardown(Promise.resolve(), {
        timeoutMs: 5_000,
        abort,
        closePage,
        sleep: jest.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBe(true);

    expect(abort).not.toHaveBeenCalled();
    expect(closePage).not.toHaveBeenCalled();
  });
});
