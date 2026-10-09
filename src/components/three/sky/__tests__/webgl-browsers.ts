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
 * `software-unflagged` is Chromium launched with `--use-angle=swiftshader`:
 * it grants even the caveat-free context and only its renderer name tells
 * (Devin review, PR #80).
 */
export type FakeBrowser =
  | "gpu"
  | "software-only"
  | "software-unflagged"
  | "webgl1-only"
  | "no-webgl"
  | "throws-on-probe";

export function installBrowser(browser: FakeBrowser): {
  loseContext: jest.Mock;
} {
  const loseContext = jest.fn();
  const UNMASKED_RENDERER_WEBGL = 0x9246;
  const renderer =
    browser === "software-unflagged"
      ? "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"
      : "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)";
  const context = {
    RENDERER: 0x1f01,
    getExtension: jest.fn((name: string) => {
      if (name === "WEBGL_lose_context") return { loseContext };
      if (name === "WEBGL_debug_renderer_info") {
        return { UNMASKED_RENDERER_WEBGL };
      }
      return null;
    }),
    getParameter: jest.fn((pname: number) =>
      pname === UNMASKED_RENDERER_WEBGL ? renderer : "WebKit WebGL",
    ),
  };

  const getContext = (
    type: string,
    attributes?: WebGLContextAttributes,
  ): unknown => {
    const isWebGL = type === "webgl2" || type === "webgl";
    switch (browser) {
      case "gpu":
      case "software-unflagged":
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
