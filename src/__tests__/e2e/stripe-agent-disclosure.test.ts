import { checkAiAgentDisclosure } from "../../../e2e/support/stripe-agent-disclosure";

function collection(candidate: unknown) {
  return {
    count: jest.fn().mockResolvedValue(candidate ? 1 : 0),
    first: jest.fn().mockReturnValue(candidate),
  };
}

const detachedFrameError = () => new Error("locator.count: Frame was detached");

function checkedDisclosureFrame() {
  const checkbox = {
    isChecked: jest.fn().mockResolvedValue(true),
  };
  const label = {
    isVisible: jest.fn().mockResolvedValue(true),
    dispatchEvent: jest.fn().mockResolvedValue(undefined),
  };

  return {
    checkbox,
    frame: {
      getByText: jest.fn().mockReturnValue(collection(label)),
      getByRole: jest.fn().mockReturnValue(collection(checkbox)),
    },
    label,
  };
}

describe("checkAiAgentDisclosure", () => {
  it("rescans frames, dispatches a click on the visible exact text, and asserts the hidden input state", async () => {
    const checkbox = {
      isChecked: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };
    const label = {
      isVisible: jest.fn().mockResolvedValue(true),
      dispatchEvent: jest.fn().mockResolvedValue(undefined),
    };
    const frame = {
      getByText: jest.fn().mockReturnValue(collection(label)),
      getByRole: jest.fn().mockReturnValue(collection(checkbox)),
    };
    const page = {
      frames: jest.fn().mockReturnValueOnce([]).mockReturnValueOnce([frame]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    await checkAiAgentDisclosure(page as never, {
      discoveryTimeoutMs: 1_000,
      pollIntervalMs: 250,
      actionTimeoutMs: 5_000,
    });

    expect(frame.getByText).toHaveBeenCalledWith(
      "I am an AI agent acting on behalf of someone else",
      { exact: true },
    );
    expect(label.dispatchEvent).toHaveBeenCalledWith("click", undefined, {
      timeout: expect.any(Number),
    });
    expect(label.dispatchEvent.mock.calls[0][2].timeout).toBeGreaterThan(0);
    expect(label.dispatchEvent.mock.calls[0][2].timeout).toBeLessThanOrEqual(
      1_000,
    );
    expect(checkbox.isChecked).toHaveBeenCalledTimes(2);
    expect(page.waitForTimeout).toHaveBeenCalledWith(250);
  });

  it("shares one real wall-clock budget across disclosure dispatch and polling", async () => {
    const observedTimeouts: number[] = [];
    const checkbox = {
      isChecked: jest.fn().mockResolvedValue(false),
    };
    const label = {
      isVisible: jest.fn().mockResolvedValue(true),
      dispatchEvent: jest
        .fn()
        .mockImplementation(
          (
            _event: string,
            _eventInit: unknown,
            { timeout }: { timeout: number },
          ) => {
            observedTimeouts.push(timeout);
            return new Promise((resolve) => setTimeout(resolve, timeout));
          },
        ),
    };
    const frame = {
      getByText: jest.fn().mockReturnValue(collection(label)),
      getByRole: jest.fn().mockReturnValue(collection(checkbox)),
    };
    const page = {
      frames: jest.fn().mockReturnValue([frame]),
      waitForTimeout: jest
        .fn()
        .mockImplementation(
          (timeout: number) =>
            new Promise((resolve) => setTimeout(resolve, timeout)),
        ),
    };
    const startedAt = Date.now();

    await expect(
      checkAiAgentDisclosure(page as never, {
        discoveryTimeoutMs: 40,
        pollIntervalMs: 10,
        actionTimeoutMs: 500,
      }),
    ).rejects.toThrow();

    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(observedTimeouts).toHaveLength(1);
    expect(observedTimeouts[0]).toBeGreaterThan(0);
    expect(observedTimeouts[0]).toBeLessThanOrEqual(40);
  });

  it("fails clearly after the bounded discovery window when the exact control is absent", async () => {
    const page = {
      frames: jest.fn().mockReturnValue([]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      checkAiAgentDisclosure(page as never, {
        discoveryTimeoutMs: 500,
        pollIntervalMs: 250,
        actionTimeoutMs: 5_000,
      }),
    ).rejects.toThrow(/AI-agent disclosure control did not appear/i);

    expect(page.frames).toHaveBeenCalledTimes(3);
  });

  it.each([
    "label count",
    "control count",
    "label visibility",
    "initial checked state",
  ])(
    "abandons a frame detached during %s and succeeds through its replacement",
    async (detachedAt) => {
      const staleCheckbox = {
        isChecked: jest
          .fn()
          .mockImplementationOnce(() => {
            if (detachedAt === "initial checked state") {
              return Promise.reject(detachedFrameError());
            }
            return Promise.resolve(false);
          })
          .mockImplementationOnce(() => {
            return Promise.resolve(true);
          }),
      };
      const staleLabel = {
        isVisible: jest.fn().mockImplementation(() => {
          if (detachedAt === "label visibility") {
            return Promise.reject(detachedFrameError());
          }
          return Promise.resolve(true);
        }),
        dispatchEvent: jest.fn().mockResolvedValue(undefined),
      };
      const staleLabels = collection(staleLabel);
      const staleControls = collection(staleCheckbox);
      if (detachedAt === "label count") {
        staleLabels.count.mockRejectedValue(detachedFrameError());
      }
      if (detachedAt === "control count") {
        staleControls.count.mockRejectedValue(detachedFrameError());
      }
      const staleFrame = {
        getByText: jest.fn().mockReturnValue(staleLabels),
        getByRole: jest.fn().mockReturnValue(staleControls),
      };
      const replacement = checkedDisclosureFrame();
      const page = {
        frames: jest
          .fn()
          .mockReturnValueOnce([staleFrame])
          .mockReturnValue([replacement.frame]),
        waitForTimeout: jest.fn().mockResolvedValue(undefined),
      };

      await checkAiAgentDisclosure(page as never, {
        discoveryTimeoutMs: 500,
        pollIntervalMs: 250,
        actionTimeoutMs: 500,
      });

      expect(page.frames).toHaveBeenCalledTimes(2);
      expect(replacement.checkbox.isChecked).toHaveBeenCalledTimes(1);
    },
  );

  it("does not retry a detached disclosure dispatch", async () => {
    const dispatchError = detachedFrameError();
    const checkbox = {
      isChecked: jest.fn().mockResolvedValue(false),
    };
    const label = {
      isVisible: jest.fn().mockResolvedValue(true),
      dispatchEvent: jest.fn().mockRejectedValue(dispatchError),
    };
    const frame = {
      getByText: jest.fn().mockReturnValue(collection(label)),
      getByRole: jest.fn().mockReturnValue(collection(checkbox)),
    };
    const page = {
      frames: jest.fn().mockReturnValue([frame]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      checkAiAgentDisclosure(page as never, {
        discoveryTimeoutMs: 500,
        pollIntervalMs: 250,
        actionTimeoutMs: 500,
      }),
    ).rejects.toBe(dispatchError);

    expect(page.frames).toHaveBeenCalledTimes(1);
    expect(label.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it("does not redispatch after a checked-state read detaches", async () => {
    const checkedStateError = detachedFrameError();
    const checkbox = {
      isChecked: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(checkedStateError)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };
    const label = {
      isVisible: jest.fn().mockResolvedValue(true),
      dispatchEvent: jest.fn().mockResolvedValue(undefined),
    };
    const frame = {
      getByText: jest.fn().mockReturnValue(collection(label)),
      getByRole: jest.fn().mockReturnValue(collection(checkbox)),
    };
    const page = {
      frames: jest.fn().mockReturnValue([frame]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      checkAiAgentDisclosure(page as never, {
        discoveryTimeoutMs: 500,
        pollIntervalMs: 250,
        actionTimeoutMs: 500,
      }),
    ).rejects.toBe(checkedStateError);

    expect(page.frames).toHaveBeenCalledTimes(1);
    expect(label.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(checkbox.isChecked).toHaveBeenCalledTimes(2);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });

  it("fails within the existing discovery bound when every current frame detaches", async () => {
    const detachedLabels = {
      count: jest.fn().mockRejectedValue(detachedFrameError()),
      first: jest.fn(),
    };
    const detachedFrame = {
      getByText: jest.fn().mockReturnValue(detachedLabels),
      getByRole: jest.fn(),
    };
    const page = {
      frames: jest.fn().mockReturnValue([detachedFrame]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      checkAiAgentDisclosure(page as never, {
        discoveryTimeoutMs: 500,
        pollIntervalMs: 250,
        actionTimeoutMs: 500,
      }),
    ).rejects.toThrow(/AI-agent disclosure control did not appear/i);

    expect(page.frames).toHaveBeenCalledTimes(3);
    expect(detachedLabels.count).toHaveBeenCalledTimes(3);
    expect(page.waitForTimeout).toHaveBeenCalledTimes(2);
  });

  it("does not hide unrelated locator failures", async () => {
    const unrelatedError = new Error("locator.count: browser process exited");
    const labels = {
      count: jest.fn().mockRejectedValue(unrelatedError),
      first: jest.fn(),
    };
    const frame = {
      getByText: jest.fn().mockReturnValue(labels),
      getByRole: jest.fn(),
    };
    const page = {
      frames: jest.fn().mockReturnValue([frame]),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      checkAiAgentDisclosure(page as never, {
        discoveryTimeoutMs: 500,
        pollIntervalMs: 250,
        actionTimeoutMs: 500,
      }),
    ).rejects.toBe(unrelatedError);

    expect(page.frames).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });
});
