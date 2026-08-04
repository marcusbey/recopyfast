"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ATMOSPHERE, SIMPLEX_2D } from "./shaders/noise";
import {
  SKY_HORIZON,
  SKY_ZENITH,
  SUN_COLOR,
  SUN_DIR,
  SUNSET_END,
  SUNSET_HORIZON,
  SUNSET_START,
  SUNSET_SUN,
  SUNSET_SUN_DIR,
  SUNSET_ZENITH,
} from "./palette";

/** Hermite ramp, matching GLSL `smoothstep`, so the turn has no hard edges. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The cheap sky: everything below the fold, and every mobile device.
 *
 * Six cloud layers at increasing depth, each an FBM field projected onto a
 * horizontal plane and composited far-to-near. Scroll moves all six at rates
 * inversely proportional to their depth, which is real parallax — the near
 * layers genuinely slide past the far ones rather than the whole image panning.
 *
 * Implementation note: the plan described six depth-sorted quads. They are six
 * composited layers inside one fullscreen shader instead. Same parallax, same
 * look, but one draw call rather than six transparent ones — which also sidesteps
 * having to depth-sort transparent geometry every frame.
 *
 * Lighting here is analytic, not marched: a rim term brightens thin cloud edges
 * facing the sun. It is a convincing approximation and costs nothing, but it is
 * an approximation, which is exactly why the hero gets the raymarcher instead.
 */

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;

  uniform float uTime;
  uniform float uAspect;
  uniform vec2  uMouse;
  uniform float uPitch;
  uniform float uScroll;
  uniform float uDisperse;
  uniform float uOpacity;

  varying vec2 vUv;

  ${SIMPLEX_2D}
  ${ATMOSPHERE}

  float remap(float v, float lo, float hi) {
    return clamp((v - lo) / (hi - lo), 0.0, 1.0);
  }

  const int LAYERS = 6;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    p.x *= uAspect;

    vec2 m = (uMouse - 0.5) * 0.035;
    /* Matches SkyVolumetric exactly — uPitch 0 and a 0.72 vertical scale — which
       puts the horizon at the vertical centre of the viewport. The two paths
       must agree on both numbers or the cross-fade tilts as the hero leaves.
       Both used to carry a 0.78 pitch offset, which pushed the horizon off the
       bottom edge and pointed every ray in the frame upward. */
    vec3 rd = normalize(vec3(p.x + m.x, p.y * 0.72 + uPitch + m.y, 1.35));

    vec3 col = skyColor(rd);
    float sunDot = max(dot(rd, uSunDir), 0.0);

    /* The upper storey. The deck below only ever draws under the horizon, so
       the top half of every viewport was a bare gradient — the whole sky
       flattened onto one plane. Three thin layers of high cloud, projected
       onto planes *above* the eye, put cloud on the other side of the horizon
       at its own parallax rates. Far layer is sheared cirrus (domain stretched
       ~4:1 into filaments); the near ones are softer alto patches. These are
       optically thin on purpose — never past ~0.3 alpha — because a second
       opaque deck overhead would just rebuild the compactness complaint one
       storey up. At sunset they matter most: uSunColor has turned gold and the
       rim term paints it along their edges, which is what a sunset actually
       looks like. */
    float upFade = smoothstep(0.01, 0.12, rd.y);
    if (upFade > 0.001) {
      for (int i = 0; i < 3; i++) {
        float near = float(i) / 2.0;

        float planeH = mix(150.0, 55.0, near);
        float t = planeH / max(rd.y, 0.2);
        vec2 uvH = rd.xz * t * mix(vec2(0.0015, 0.0062), vec2(0.0052, 0.0088), near);

        uvH += vec2(uTime * 0.004, uTime * 0.009) * mix(0.4, 1.0, near);
        uvH += vec2(0.0, uScroll * mix(0.08, 0.4, near));

        float d = fbm2(uvH, 3);
        float lo = mix(0.56, 0.50, near) + uDisperse * 0.10;
        d = remap(d, lo, 1.0);

        if (d > 0.001) {
          float rim = pow(1.0 - d, 3.0) * sunDot;
          vec3 cloudColH = mix(
            mix(uSkyHorizon, vec3(1.0), 0.55),
            uSunColor,
            clamp(rim * 1.2, 0.0, 1.0)
          );
          float alphaH = d * mix(0.14, 0.3, near)
                       * (1.0 - uDisperse * 0.25) * upFade;
          col = mix(col, cloudColH, clamp(alphaH, 0.0, 1.0));
        }
      }
    }

    /* The layers are a cloud floor *below* the eye now, so it is the downward
       rays that carry them and the sky above the horizon is left open. That
       matches the raymarched path, where the eye sits above the deck looking
       down at its tops.

       Near the horizon the projection below diverges as it always did, so the
       fade still exists for the same reason — it is only which side of the
       horizon it applies to that changed. */
    float horizonFade = smoothstep(0.006, 0.16, -rd.y);

    if (horizonFade > 0.001) {
      for (int i = 0; i < LAYERS; i++) {
        /* 0 = farthest, 1 = nearest. Every per-layer property keys off this. */
        float near = float(i) / float(LAYERS - 1);

        /* Depth below the eye rather than height above it. Wider spread than
           the old 46..9: the far layers now sit much deeper, so the six planes
           separate visibly under parallax instead of reading as one deck with
           a slight shimmer. */
        float planeDepth = mix(60.0, 8.0, near);
        /* The floor on the divisor is the anti-streak dial. At the old 0.05 a
           ray near the horizon sampled the noise field at 20x the scale directly
           below, which stretched every cloud into a radial smear. 0.22 caps that
           at ~4.5x — still perspective, no longer a storm wall. */
        float t = planeDepth / max(-rd.y, 0.22);
        vec2 uvL = rd.xz * t * mix(0.020, 0.058, near);

        /* Wind, and the scroll parallax. Near layers move furthest — that
           inverse-depth relationship is the entire effect. The scroll rates
           are less than half what they were: at 5.5 field-units per page the
           near layer streamed past faster than the content, which read as
           the sky rushing rather than the reader drifting down through it.
           The near/far ratio (not the absolute speed) carries the depth. */
        uvL += vec2(uTime * 0.007, uTime * 0.016) * mix(0.35, 1.0, near);
        uvL += vec2(0.0, uScroll * mix(0.3, 2.4, near));

        float d = fbm2(uvL, 4);
        /* Far layers get a higher coverage threshold so they read as sparse
           haze rather than as a second identical deck stacked behind. The
           baseline is higher than it used to be — full coverage on every layer
           left no sky anywhere, which is precisely what stopped the clouds
           reading as clouds. uDisperse raises the floor further as the reader
           scrolls, so the deck visibly breaks up and clears. */
        float lo = mix(0.65, 0.55, near) + uDisperse * 0.16;
        d = remap(d, lo, 1.0);

        if (d > 0.001) {
          /* Thin edges facing the sun catch light — the silver lining. Cubed
             so it stays confined to genuinely thin cloud. The 0.38 floor is
             the same correction the raymarcher's phase clamp makes: the sun
             sits behind the camera all day, so without a floor sunDot is
             zero everywhere and every cloud rendered at half-shadow — a grey
             deck against a blue sky. Front-lit cloud is bright, and at sunset
             the floor pulls the deck toward the gold sun colour, which is what
             lights the closing section's clouds. */
          float rim = pow(1.0 - d, 3.0) * sunDot;
          float lit = clamp(0.38 + d * 0.5 + rim * 0.9, 0.0, 1.0);

          /* Kept in step with the volumetric path's ambient term — if one path
             renders brighter cloud than the other the cross-fade shows. */
          vec3 shadow = mix(uSkyHorizon * 0.97, uSkyZenith * 1.05, 0.22);
          vec3 cloudCol = mix(shadow, uSunColor, lit);

          /* Distant layers wash toward the horizon colour — aerial perspective.
             Without it six layers of the same white read as one flat mass. */
          cloudCol = mix(uSkyHorizon, cloudCol, mix(0.45, 1.0, near));

          /* Dispersal also thins what survives the coverage floor, so scrolled
             sky carries a few translucent wisps rather than a faded deck. The
             ceiling is 0.62 where it was 0.85 — a near layer at 0.85 was a
             solid object, and solidity is thickness. Below ~0.65 the sky reads
             through every cloud and the deck goes from wall to vapour. */
          float alpha = d * mix(0.28, 0.62, near)
                      * (1.0 - uDisperse * 0.45) * horizonFade;
          col = mix(col, cloudCol, clamp(alpha, 0.0, 1.0));
        }
      }
    }

    col = col / (col + vec3(0.72)) * 1.42;
    gl_FragColor = vec4(col, uOpacity);
  }
`;

interface SkyLayeredProps {
  mouseRef: React.RefObject<{ x: number; y: number }>;
  /**
   * Scroll progress as a mutable object, read once per frame. A number prop
   * would put this subtree back on React's render path on every scroll step,
   * which is the cost useLenis exists to avoid.
   */
  scroll: { value: number };
  /**
   * Opacity of the volumetric sky drawn over this one, or null when that path
   * is not mounted at all. Read at frame rate for the same reason as `scroll`.
   */
  coveredBy: { value: number } | null;
  isAnimating: boolean;
}

export default function SkyLayered({
  mouseRef,
  scroll,
  coveredBy,
  isAnimating,
}: SkyLayeredProps) {
  const { size } = useThree();
  const mesh = useRef<THREE.Mesh>(null);
  const smoothedMouse = useRef(new THREE.Vector2(0.5, 0.5));

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      /* Level, so the horizon lands mid-viewport. Must match SkyVolumetric. */
      uPitch: { value: 0 },
      uScroll: { value: 0 },
      uDisperse: { value: 0 },
      uOpacity: { value: 1 },
      uSunDir: { value: SUN_DIR.clone() },
      uSkyZenith: { value: SKY_ZENITH.clone() },
      uSkyHorizon: { value: SKY_HORIZON.clone() },
      uSunColor: { value: SUN_COLOR.clone() },
    }),
    [],
  );

  useFrame((state) => {
    /* The raymarched sky is a fullscreen quad drawn over this one. While it is
       at full opacity nothing here reaches the screen, so shading it is pure
       waste — and it is not small waste: six noise layers over every pixel is
       roughly a third of the hero's fragment budget, spent on an image that is
       completely covered. Both still draw through the cross-fade, which is the
       only time any of it is visible. */
    if (mesh.current) {
      mesh.current.visible = coveredBy === null || coveredBy.value < 0.995;
      if (!mesh.current.visible) return;
    }

    const scrollProgress = scroll.value;

    uniforms.uAspect.value = size.width / Math.max(size.height, 1);
    uniforms.uScroll.value = scrollProgress;

    /* Day turns to sunset across the bottom of the page. Driven by scroll
       rather than by a timer, so the colour is a function of where the reader
       is and scrolling back up returns the sky to blue.

       `copy().lerp()` writes through the Color the uniform already holds, so
       this allocates nothing on a frame that runs at 60fps. */
    const sunset = smoothstep(SUNSET_START, SUNSET_END, scrollProgress);
    uniforms.uSkyZenith.value.copy(SKY_ZENITH).lerp(SUNSET_ZENITH, sunset);
    uniforms.uSkyHorizon.value.copy(SKY_HORIZON).lerp(SUNSET_HORIZON, sunset);
    uniforms.uSunColor.value.copy(SUN_COLOR).lerp(SUNSET_SUN, sunset);

    /* The sun itself moves. The daytime vector points *behind* the camera —
       deliberately, so the hero carries no blown highlight — which meant the
       halo and disc in skyColor never rendered anywhere on the page, and the
       sunset was a gradient with no sun in it: a flat orange wall. At dusk the
       sun swings into frame and sinks to the horizon, and the CTA gets a low
       glow that reads as an actual evening sky. Renormalised because lerping
       two unit vectors does not produce one. */
    uniforms.uSunDir.value
      .copy(SUN_DIR)
      .lerp(SUNSET_SUN_DIR, sunset)
      .normalize();

    /* Scrolling scatters the deck: coverage drops and what remains thins, so
       the clouds read as spreading away from the reader rather than as one
       static texture that follows them down the page. Scrolling back up
       reassembles the sky, because the value is a function of position.

       Starts where the raymarcher's own dispersal finishes, so the two paths
       hand over mid-movement and the sky keeps opening across the cross-fade
       rather than restarting behind it.

       Damped by the sunset: full dispersal at the bottom of the page deleted
       every cloud exactly where the sky turns gold, leaving the sunset with
       nothing to light. The weather comes back for the finale — thin, and lit
       from the horizon. */
    uniforms.uDisperse.value =
      smoothstep(0.12, 0.55, scrollProgress) * (1 - 0.75 * sunset);

    if (isAnimating) {
      uniforms.uTime.value = state.clock.elapsedTime;
      smoothedMouse.current.x +=
        (mouseRef.current.x - smoothedMouse.current.x) * 0.045;
      smoothedMouse.current.y +=
        (mouseRef.current.y - smoothedMouse.current.y) * 0.045;
      uniforms.uMouse.value.copy(smoothedMouse.current);
    }
  });

  return (
    <mesh ref={mesh} renderOrder={0} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
