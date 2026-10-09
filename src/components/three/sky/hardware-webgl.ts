/**
 * Whether this browser draws WebGL2 on a GPU, as opposed to in software or not
 * at all. The landing sky's shaders are only worth running when it does.
 *
 * WHY THIS EXISTS — a software renderer turned the landing page into a slideshow.
 *
 * A browser with no usable GPU (blocklisted driver, hardware acceleration off,
 * a VM or remote desktop, and GitHub's standard GPU-less runners) can still
 * hand out a WebGL context: it shades on the CPU through SwiftShader, llvmpipe
 * or WARP. The sky is a full-screen raymarcher plus a six-layer noise field on
 * a free-running frame loop, and on that path a frame took 1–2 s and kept the
 * main thread busy for 1.2–4.8 s of every 3 s, on a 10-core laptop. Hydration,
 * the pricing fetch and every click queued behind it. That is how `main` went
 * red on 2026-10-09: CI's Chromium (Playwright launches it with
 * `--enable-unsafe-swiftshader`) waited more than 10 s for the Starter card.
 * See docs/research/s74-deflake-landing-pricing.md.
 *
 * `failIfMajorPerformanceCaveat` is the WebGL spec's own signal for exactly
 * this: the browser refuses the context when it would perform dramatically
 * worse than a native GPU application. It is the primary check, because the
 * browser maintains its list. It is not sufficient on its own: Chromium
 * launched with `--use-angle=swiftshader` grants even the caveat-free context
 * (Devin review, PR #80), so the renderer's name is checked as a second fence
 * — the software rasterisers that ship in browsers, nothing broader.
 *
 * `webgl2`, not `webgl`: three dropped WebGL 1 in r163, so a browser offering
 * only WebGL 1 cannot draw the sky either. The probe gets its own canvas (one
 * canvas holds one context type) and gives the context back at once, because
 * browsers cap how many live WebGL contexts a page may hold. Any failure means
 * "no": the static sky is always a correct answer, a stalled page never is.
 */
/** Software rasterisers browsers ship: SwiftShader (Chromium), llvmpipe and
 * softpipe (Mesa), WARP / "Microsoft Basic Render Driver" (Windows). */
const SOFTWARE_RENDERER =
  /swiftshader|llvmpipe|softpipe|basic render|software/i;

function rendererName(context: WebGL2RenderingContext): string {
  const info = context.getExtension("WEBGL_debug_renderer_info");
  const name: unknown = context.getParameter(
    info ? info.UNMASKED_RENDERER_WEBGL : context.RENDERER,
  );
  return typeof name === "string" ? name : "";
}

export function hasHardwareWebGL(): boolean {
  try {
    const context = document
      .createElement("canvas")
      .getContext("webgl2", { failIfMajorPerformanceCaveat: true });
    if (!context) {
      return false;
    }
    const isSoftware = SOFTWARE_RENDERER.test(rendererName(context));
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return !isSoftware;
  } catch {
    return false;
  }
}
