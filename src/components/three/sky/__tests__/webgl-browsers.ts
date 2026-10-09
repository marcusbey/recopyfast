/**
 * Fake browsers for the sky's tests, described by what they grant.
 *
 * jsdom has no WebGL: its `getContext` logs "Not implemented" and returns
 * null. Left alone, every sky test would pass on the no-WebGL branch and prove
 * nothing, so each test installs the browser it describes.
 *
 * They decide the way a real one does: a software renderer (SwiftShader in
 * CI's Chromium, llvmpipe, WARP) still hands out a context, and only refuses
 * when the caller says it will not accept a major performance caveat.
 */
export type FakeBrowser =
  | "gpu"
  | "software-only"
  | "webgl1-only"
  | "no-webgl"
  | "throws-on-probe";

export function installBrowser(browser: FakeBrowser): {
  loseContext: jest.Mock;
} {
  const loseContext = jest.fn();
  const context = {
    getExtension: jest.fn((name: string) =>
      name === "WEBGL_lose_context" ? { loseContext } : null,
    ),
  };

  const getContext = (
    type: string,
    attributes?: WebGLContextAttributes,
  ): unknown => {
    const isWebGL = type === "webgl2" || type === "webgl";
    switch (browser) {
      case "gpu":
        return isWebGL ? context : null;
      case "software-only":
        return isWebGL && !attributes?.failIfMajorPerformanceCaveat
          ? context
          : null;
      case "webgl1-only":
        return type === "webgl" ? context : null;
      case "no-webgl":
        return null;
      case "throws-on-probe":
        throw new Error("GPU process crashed");
    }
  };

  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(
      getContext as unknown as typeof HTMLCanvasElement.prototype.getContext,
    );

  return { loseContext };
}
