# Design — s74-deflake-landing-pricing

No new screen, no new component, no copy change. Surface: Marketing (landing `/`), the WebGL sky
behind it. What changes is which of the sky's two existing renderings a browser gets.

The static rendering already exists twice in the code: the `dynamic()` loading placeholder
(`src/app/page.tsx:26-28`) and the layer behind the canvas that shows through when WebGL is
missing or its context is lost (`src/components/three/sky/SkyBackground.tsx:280-283`). Both are the
same horizon-to-zenith ramp, `bg-gradient-to-b from-[#5a9ce4] via-[#aed3f4] to-[#d6eafa]`, chosen
to match the shader so that losing it is "a flatter sky, not a different one". This story uses
that same layer, unchanged.

## States

| Browser | Before | After |
|---|---|---|
| WebGL2 on a GPU, motion allowed, pointer fine | Volumetric raymarcher while `#hero` is visible, layered sky below the fold | Unchanged |
| WebGL2 on a GPU, coarse pointer or narrow screen | Layered sky only | Unchanged |
| WebGL2 on a GPU, `prefers-reduced-motion` | Drawn on demand, 40 scroll steps | Unchanged |
| WebGL2 only in software (major performance caveat: SwiftShader, llvmpipe, WARP) | Shader sky shaded on the CPU, 1–2 s per frame, page and input stall | Static gradient. No canvas, no frame loop |
| No WebGL2 at all | Canvas mounted, context creation fails, gradient shows through | Static gradient. No canvas |
| While the sky's chunk loads | Gradient placeholder | Unchanged |

What a software-WebGL visitor loses: cloud motion, mouse parallax, and the scroll-driven sunset at
the bottom of the page. Their sky is the blue ramp all the way down, which is what a no-WebGL
visitor already sees. Every section, the pricing cards and every call to action are unaffected.
The glass panes still blur what is behind them; behind them is now a gradient.

No design-system token, palette or ADR 050/051/053 rule applies to this layer: it sits under the
Marketing surface (`docs/design-system.md:35`) and keeps its existing colours.
