import { hasHardwareWebGL } from "../hardware-webgl";
import { installBrowser } from "./webgl-browsers";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("hasHardwareWebGL", () => {
  it("says no to a browser that only draws WebGL in software", () => {
    installBrowser("software-only");

    expect(hasHardwareWebGL()).toBe(false);
  });

  // Devin review, PR #80: Chromium with `--use-angle=swiftshader` grants even
  // the caveat-free context; only the renderer name says it is software.
  it("says no to a software renderer that grants the caveat-free context", () => {
    const { loseContext } = installBrowser("software-unflagged");

    expect(hasHardwareWebGL()).toBe(false);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("says yes to a GPU, and releases the context it probed with", () => {
    const { loseContext } = installBrowser("gpu");

    expect(hasHardwareWebGL()).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("says no when only WebGL 1 is available, which three cannot draw on", () => {
    installBrowser("webgl1-only");

    expect(hasHardwareWebGL()).toBe(false);
  });

  it("says no when there is no WebGL at all", () => {
    installBrowser("no-webgl");

    expect(hasHardwareWebGL()).toBe(false);
  });

  it("says no, and throws nothing, when the probe itself fails", () => {
    installBrowser("throws-on-probe");

    expect(() => hasHardwareWebGL()).not.toThrow();
    expect(hasHardwareWebGL()).toBe(false);
  });
});
