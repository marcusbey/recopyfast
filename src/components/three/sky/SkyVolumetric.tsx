"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ATMOSPHERE, FBM_3D, SIMPLEX_3D } from "./shaders/noise";
import {
  CLOUD_BOTTOM,
  CLOUD_TOP,
  SKY_HORIZON,
  SKY_ZENITH,
  SUN_COLOR,
  SUN_DIR,
} from "./palette";

/**
 * Raymarched volumetric clouds. Hero only — see SkyBackground for why.
 *
 * This is a fullscreen quad, not geometry in the scene: the vertex shader
 * writes clip space directly and ignores the camera entirely, so the virtual
 * camera lives in uniforms and nothing here depends on where the R3F camera is.
 * That keeps the shader independent of the rest of the scene graph and makes
 * the scroll-driven flight a single uniform rather than a transform chain.
 */

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uAspect;
  uniform vec2  uMouse;
  uniform float uPitch;
  uniform float uAltitude;
  uniform float uOpacity;
  uniform float uCloudBottom;
  uniform float uCloudTop;
  uniform float uCoverage;

  varying vec2 vUv;

  ${SIMPLEX_3D}
  ${FBM_3D}
  ${ATMOSPHERE}

  /* Marching further than this near the horizon costs a great deal and buys
     almost nothing — the clouds out there are a handful of pixels tall. */
  const float MAX_DIST = 420.0;
  /* Measured, not guessed. At 32 primary x 4 light steps this held 33fps on an
     M-series laptop — half the budget. The march is the entire cost of this
     shader, and step count multiplies through the light march underneath it, so
     these two numbers are the only performance dials that matter here. */
  const int   PRIMARY_STEPS = 26;
  const int   LIGHT_STEPS = 3;

  float cloudDensity(vec3 pos, int octaves) {
    float h = (pos.y - uCloudBottom) / (uCloudTop - uCloudBottom);
    if (h < 0.0 || h > 1.0) return 0.0;

    /* Wind. The two axes move at different rates so the field never reads as a
       single texture sliding past. */
    vec3 q = pos * 0.021;
    q.z += uTime * 0.021;
    q.x += uTime * 0.009;

    float base = fbm3(q, octaves) * 0.5 + 0.5;

    /* remap() sets coverage: everything below the low bound is clear sky, and
       the narrow window between the bounds is what gives cloud a defined edge
       rather than a gradual fade. Widening this window is the difference
       between cumulus and haze — and unlike adding octaves, tightening it costs
       nothing at runtime. */
    return remap(base, 0.54, 0.93) * heightProfile(h) * uCoverage;
  }

  /* March toward the sun and accumulate how much cloud is in the way. Two
     octaves is deliberate — this only needs the bulk, not the silhouette, and
     it runs at every populated primary step. */
  float lightMarch(vec3 pos) {
    float depth = 0.0;
    float stepSize = 3.5;
    vec3 p = pos;
    for (int i = 0; i < LIGHT_STEPS; i++) {
      p += uSunDir * stepSize;
      depth += cloudDensity(p, 2) * stepSize;
      /* Widening steps — cone sampling. Occlusion far from the shaded point
         only needs a coarse estimate, so spending equal samples near and far is
         waste. Covers ~2.5x the distance of a fixed step for the same count. */
      stepSize *= 1.75;
    }
    return depth;
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    p.x *= uAspect;

    /* Mouse shifts the view rather than deforming the clouds. Deforming a
       volume around the pointer is the tell of a demo; a parallax shift reads
       as the sky simply being somewhere you are looking. */
    vec2 m = (uMouse - 0.5) * 0.06;

    vec3 ro = vec3(0.0, uAltitude, 0.0);
    /* The pitch offset exceeds the vertical half-extent on purpose, so the
       horizon sits just below the bottom edge of the viewport and the entire
       frame is sky with cloud in it. A smaller offset points the lower half of
       the screen below the deck, where there is nothing to draw — which is
       exactly what left the bottom half of the hero a flat empty blue. */
    vec3 rd = normalize(vec3(p.x + m.x, p.y * 0.62 + uPitch + m.y, 1.35));

    vec3 bg = skyColor(rd);

    /* Fade the cloud contribution out as the ray approaches the horizon rather
       than cutting it off. A hard early-out leaves a visible seam straight
       across the page where the slab stops being intersected. */
    float horizonFade = smoothstep(0.006, 0.14, rd.y);

    if (horizonFade < 0.001) {
      gl_FragColor = vec4(bg, uOpacity);
      return;
    }

    float tNear = (uCloudBottom - ro.y) / rd.y;
    float tFar  = (uCloudTop - ro.y) / rd.y;
    if (tNear > MAX_DIST) {
      gl_FragColor = vec4(bg, uOpacity);
      return;
    }
    tFar = min(tFar, MAX_DIST);

    float cosTheta = dot(rd, uSunDir);
    /* Dual-lobe phase. A single forward lobe makes the sun side glow correctly
       but leaves the anti-sun side dead flat; the small backward lobe puts some
       light back into the clouds facing away.
     *
     * The 4pi factor is not decoration. Henyey-Greenstein is normalised to
     * integrate to 1 over the sphere, so raw values sit around 0.014 broadside
     * to the sun — multiply that into a radiance and every cloud renders as
     * dark grey mush. Scaling by 4pi restores it to "1.0 means average", and
     * the clamp keeps the g=0.72 lobe's 250x dynamic range from blowing the
     * highlight out to a white disc when looking near the sun. */
    float phase = mix(
      henyeyGreenstein(cosTheta, 0.72),
      henyeyGreenstein(cosTheta, -0.22),
      0.3
    ) * 12.566;
    /* The lower clamp is the brightness floor for cloud facing away from the
       sun. Physically it wants to be near zero, but at 0.28 the anti-sun side
       goes storm-grey and the sky reads as ominous rather than bright. */
    phase = clamp(phase, 0.62, 4.2);

    float stepSize = (tFar - tNear) / float(PRIMARY_STEPS);

    /* Dither the ray start by up to one step. Without this, 32 steps across a
       soft volume produce visible concentric banding. */
    float dither = hash12(gl_FragCoord.xy + uTime);
    float t = tNear + stepSize * dither;

    /* Biased toward the horizon colour, which is the pale end of the ramp. Sky
       ambient on a real overcast-free day is bright — weighting this toward the
       deep zenith is what made the cloud bases read as slate. */
    vec3 ambient = mix(uSkyHorizon, uSkyZenith, 0.28);
    float transmittance = 1.0;
    vec3 scattering = vec3(0.0);

    for (int i = 0; i < PRIMARY_STEPS; i++) {
      /* Once the ray is this occluded, remaining steps cannot change the pixel.
         Most rays that hit thick cloud exit here well before step 32. */
      if (transmittance < 0.02) break;

      vec3 pos = ro + rd * t;
      float d = cloudDensity(pos, 3);

      if (d > 0.002) {
        float lightDepth = lightMarch(pos);

        /* Three-octave multiple-scattering approximation. Each successive term
           attenuates more weakly, standing in for light that bounced several
           times inside the cloud before reaching the eye. Single scattering on
           its own — one exp() of Beer's law — renders cloud interiors nearly
           black, which is the opposite of what a real cloud does: they are
           bright precisely because light bounces around inside them. */
        float ms = exp(-lightDepth * 0.85)
                 + 0.55 * exp(-lightDepth * 0.30)
                 + 0.30 * exp(-lightDepth * 0.10);

        /* Powder term. Attenuation alone makes thin cloud edges too bright,
           because a wisp barely blocks the sun. Powder darkens optically-thin
           regions and is what produces the crisp cauliflower edge. */
        float powder = 1.0 - exp(-d * 9.0);

        vec3 lum = uSunColor * ms * mix(0.8, 1.0, powder) * phase * 0.8;
        lum += ambient * 1.05;

        /* Energy-conserving integration: take the light scattered in this slab
           weighted by how much of it survives back to the eye. */
        float extinction = exp(-d * stepSize * 0.85);
        scattering += transmittance * (1.0 - extinction) * lum;
        transmittance *= extinction;
      }

      t += stepSize;
    }

    vec3 col = bg * transmittance + scattering;
    col = mix(bg, col, horizonFade);

    /* Tonemap. Scattering can exceed 1.0 around the sun and clipping it turns
       the highlight into a flat white blob with a hard edge. */
    col = col / (col + vec3(0.72)) * 1.42;

    gl_FragColor = vec4(col, uOpacity);
  }
`;

interface SkyVolumetricProps {
  mouseRef: React.RefObject<{ x: number; y: number }>;
  scrollProgress: number;
  /**
   * Cross-fade to the layered sky; 1 = fully visible. A mutable object rather
   * than a number so the fade can be driven at frame rate without re-rendering.
   */
  fade: { value: number };
  isAnimating: boolean;
}

export default function SkyVolumetric({
  mouseRef,
  scrollProgress,
  fade,
  isAnimating,
}: SkyVolumetricProps) {
  const { size } = useThree();
  const smoothedMouse = useRef(new THREE.Vector2(0.5, 0.5));

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uPitch: { value: 0.78 },
      uAltitude: { value: 0 },
      uOpacity: { value: 1 },
      uCloudBottom: { value: CLOUD_BOTTOM },
      uCloudTop: { value: CLOUD_TOP },
      /* Brightness and coverage trade against each other: once the clouds are
         lit properly, this much of them leaves no blue anywhere. Lower coverage
         is what keeps the sky reading as a bright day rather than as overcast. */
      uCoverage: { value: 1.05 },
      uSunDir: { value: SUN_DIR.clone() },
      uSkyZenith: { value: SKY_ZENITH.clone() },
      uSkyHorizon: { value: SKY_HORIZON.clone() },
      uSunColor: { value: SUN_COLOR.clone() },
    }),
    [],
  );

  useFrame((state) => {
    uniforms.uAspect.value = size.width / Math.max(size.height, 1);
    uniforms.uOpacity.value = fade.value;

    if (isAnimating) {
      uniforms.uTime.value = state.clock.elapsedTime;
      /* Lerped toward the target rather than snapped, so a fast pointer sweep
         glides instead of stuttering. Mutated in place — allocating a Vector2
         per frame is what the previous implementation did at 60Hz. */
      smoothedMouse.current.x +=
        (mouseRef.current.x - smoothedMouse.current.x) * 0.045;
      smoothedMouse.current.y +=
        (mouseRef.current.y - smoothedMouse.current.y) * 0.045;
      uniforms.uMouse.value.copy(smoothedMouse.current);
    }

    /* Scroll flies the camera up into the deck and levels the view off, so the
       hero's sky opens out as it leaves rather than simply sliding away. */
    const eased = 1 - Math.pow(1 - Math.min(scrollProgress / 0.35, 1), 3);
    uniforms.uAltitude.value = eased * 9.0;
    uniforms.uPitch.value = 0.78 - eased * 0.16;
  });

  return (
    <mesh renderOrder={1} frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
