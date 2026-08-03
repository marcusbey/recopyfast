"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ATMOSPHERE, FBM_3D, SIMPLEX_2D, SIMPLEX_3D } from "./shaders/noise";
import {
  CLOUD_BOTTOM,
  CLOUD_GATE_CLEAR,
  CLOUD_GATE_DENSE,
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
  uniform float uGateFloor;
  uniform float uSpread;
  uniform vec3  uWind;

  varying vec2 vUv;

  ${SIMPLEX_3D}
  ${SIMPLEX_2D}
  ${FBM_3D}
  ${ATMOSPHERE}

  /* How far away a ray will still look for the slab at all. This is what puts
     cloud at the bottom of the frame: those rays leave the eye almost level, so
     they do not reach a deck 30 units up until several hundred units out. Cut
     it short and the lower frame goes flat empty blue. It is not the same dial
     as MAX_SPAN below, which governs how far a ray marches once it arrives —
     starting far away is cheap, marching far is not. */
  const float MAX_DIST = 850.0;
  /* Measured, not guessed. At 32 primary x 4 light steps this held 33fps on an
     M-series laptop — half the budget. The march is the entire cost of this
     shader, and step count multiplies through the light march underneath it, so
     these two numbers are the only performance dials that matter here. */
  const int   PRIMARY_STEPS = 26;
  const int   LIGHT_STEPS = 3;

  /* How far one ray may travel through the slab before it gives up.
   *
   * Step size is the march span over PRIMARY_STEPS, and near the horizon that
   * span runs to several hundred units, so a single step was integrating ten
   * units of optical depth at once. Every wisp a low ray grazed therefore came
   * out fully opaque whatever its density, and the sky welded itself into one
   * overcast smear across the lower frame — the "looking out from inside a
   * storm" reading. Capping the span means opacity comes from what a ray
   * passes through rather than from how long it spent doing it. */
  const float MAX_SPAN = 90.0;

  /* Horizontal scale of the cloud field. Its reciprocal is roughly how wide a
     cloud is in world units, putting one at about 25 units against a slab 13
     units thick — the proportions of a fair-weather cumulus, which is a wide
     flat thing rather than a tower. */
  const float FIELD_SCALE = 0.040;
  /* The coverage gate's features are around twice the width of a cloud. That
     ratio is what sorts clouds into groups with open sky between the groups
     instead of spreading them evenly across the whole sky, and open sky between
     groups is what makes the rest read as cloud at all. */
  const float GATE_SCALE = 0.016;
  /* Where the density window opens. fbm3 lands near 0.5 with a spread of about
     0.13, so this sits just above the mean and only the upper tail is cloud. */
  const float SHAPE_FLOOR = 0.52;
  /* Width of that window, and the single most consequential number here. The
     old one spanned 0.39 against that same field, so no sample ever reached a
     quarter of full density: every cloud was the same faint grey, and what
     opacity there was came from path length rather than from density. Narrow
     enough to saturate is what gives a cloud a core, an edge and a silhouette. */
  const float SHAPE_WINDOW = 0.16;
  /* How much of the gate's range is a soft edge rather than a hard boundary.
     Wide, and every cloud group trails a broad skirt of optically thin cloud
     that fills the gaps back in with haze — which is the version of "too many
     clouds" that survives lowering the coverage. */
  const float GATE_WINDOW = 0.20;

  float cloudDensity(vec3 pos, int octaves) {
    float h = (pos.y - uCloudBottom) / (uCloudTop - uCloudBottom);
    if (h < 0.0 || h > 1.0) return 0.0;

    /* Wind. The two axes move at different rates so the field never reads as a
       single texture sliding past. Applied in world units before the field is
       scaled, so the drift speed stays put while uSpread stretches the field
       out underneath it. */
    vec3 wp = pos + uWind;

    /* The gate is tested first and returns early, and it is a 2D sample because
       large-scale coverage does not vary with altitude. A ray crossing open sky
       therefore pays one cheap sample instead of a three-octave 3D fbm and the
       light march under it. Opening the sky up makes this shader cheaper, which
       is what lets the scroll dispersal below be free. */
    float gate = snoise2D(wp.xz * (GATE_SCALE / uSpread)) * 0.5 + 0.5;
    gate = remap(gate, uGateFloor, uGateFloor + GATE_WINDOW);
    if (gate <= 0.0) return 0.0;

    /* Shear: a cloud's top sits downwind of its base, because wind runs faster
       further up. Without it every cloud is one horizontal pattern extruded
       vertically, which is most of why these read as columns of fog rather than
       as weather — the slab is only half a noise feature tall, so the field has
       almost no vertical variation of its own to supply. */
    vec3 q = wp;
    q.xz += vec2(0.62, 0.34) * (pos.y - uCloudBottom);
    q *= FIELD_SCALE / uSpread;

    float base = fbm3(q, octaves) * 0.5 + 0.5;
    float shape = remap(base, SHAPE_FLOOR, SHAPE_FLOOR + SHAPE_WINDOW) * gate;
    if (shape <= 0.0) return 0.0;

    /* Height is driven by the gate, not by the shape. A whole cloud is tall or
       short; the lumps on its surface are not each their own tower. Feeding the
       fine-grained shape in here instead makes the ceiling vary at the scale of
       the smallest octave, and the cloud grows vertical spikes — it reads as
       flame rather than as billow. */
    return shape * heightProfile(h, gate) * uCoverage;
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
      /* The 0.3 rescales for a density field that now saturates at 1.0 where
         the old one topped out near 0.23. Without it every optical depth below
         is four times deeper and each cloud core turns to slate. */
      depth += cloudDensity(p, 2) * stepSize * 0.3;
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
    /* The pitch offset keeps the horizon at the very bottom edge of the
       viewport so the frame is sky with cloud in it, without pointing the lower
       half of the screen below the deck. The 0.72 vertical scale matches
       SkyLayered — the old 0.62 squash is what stretched every cloud into a
       horizontal smear. */
    vec3 rd = normalize(vec3(p.x + m.x, p.y * 0.72 + uPitch + m.y, 1.35));

    vec3 bg = skyColor(rd);

    /* Fade the cloud contribution out as the ray approaches the horizon rather
       than cutting it off. A hard early-out leaves a visible seam straight
       across the page where the slab stops being intersected. */
    float horizonFade = smoothstep(0.004, 0.03, rd.y);

    float tNear = (uCloudBottom - ro.y) / rd.y;
    float tFar  = (uCloudTop - ro.y) / rd.y;

    /* Aerial perspective, and the reason there is no hard line across the lower
       frame. Cutting the march off at MAX_DIST leaves a seam exactly where rays
       stop reaching the slab — the cloud field simply ends, mid-sky, along a
       line. Fading it out over the last stretch instead is both free and what
       distance actually does to contrast. */
    /* Starts early on purpose. A deck seen at a shallow angle stacks cloud
       behind cloud, so without a strong distance term the lower frame fills
       with a carpet of small identical shapes — the same "too many of them"
       problem the coverage gate solves overhead, arriving by a different route.
       Fading toward bg rather than to nothing is what makes it read as a hazy
       horizon instead of a hole, because bg down there is already the pale end
       of the sky ramp. */
    float distanceFade = 1.0 - smoothstep(MAX_DIST * 0.22, MAX_DIST * 0.85, tNear);
    float cloudFade = horizonFade * distanceFade;

    if (cloudFade < 0.002) {
      gl_FragColor = vec4(bg, uOpacity);
      return;
    }

    tFar = min(tFar, tNear + MAX_SPAN);

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
      /* Four octaves, where three used to be enough. Raising the deck to 30
         units put the nearest cloud far enough away that its finest octave —
         12 world units — subtends about fifteen degrees, three hundred pixels
         of soft gradient with no edge in it. The fourth octave halves that. It
         is affordable now only because the coverage gate returns before any of
         them are sampled across the majority of the frame that is open sky. */
      float d = cloudDensity(pos, 4);

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
           weighted by how much of it survives back to the eye. The 0.3 pairs
           with the light march's rescale — density saturates at 1.0 now, so the
           old 0.85 drove a whole cloud opaque inside one step and threw away
           every edge it had. */
        float extinction = exp(-d * stepSize * 0.3);
        scattering += transmittance * (1.0 - extinction) * lum;
        transmittance *= extinction;
      }

      t += stepSize;
    }

    vec3 col = bg * transmittance + scattering;
    col = mix(bg, col, cloudFade);

    /* Tonemap. Scattering can exceed 1.0 around the sun and clipping it turns
       the highlight into a flat white blob with a hard edge. */
    col = col / (col + vec3(0.72)) * 1.42;

    gl_FragColor = vec4(col, uOpacity);
  }
`;

/**
 * Scroll fraction the hero's sky opens out over.
 *
 * The hero is about one viewport of a nine-viewport page, so the raymarcher is
 * only alive for the first eighth of the scroll. Keyed any wider, the dispersal
 * would still be getting started when this path hands over to the layered sky,
 * and nobody would ever see it happen.
 */
const DISPERSE_OVER = 0.16;

interface SkyVolumetricProps {
  mouseRef: React.RefObject<{ x: number; y: number }>;
  /**
   * Scroll progress as a mutable object, read once per frame. A number prop
   * would put this subtree back on React's render path on every scroll step,
   * which is the cost useLenis exists to avoid.
   */
  scroll: { value: number };
  /**
   * Cross-fade to the layered sky; 1 = fully visible. A mutable object rather
   * than a number so the fade can be driven at frame rate without re-rendering.
   */
  fade: { value: number };
  isAnimating: boolean;
}

export default function SkyVolumetric({
  mouseRef,
  scroll,
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
      /* Deliberately below full coverage: distinct cumulus with blue between
         them is what reads as a real sky. 1.05 filled every gap and turned the
         hero into the inside of an overcast — dense enough that the deck read
         as storm, not weather. */
      uCoverage: { value: 0.92 },
      uGateFloor: { value: CLOUD_GATE_DENSE },
      uSpread: { value: 1 },
      uWind: { value: new THREE.Vector3() },
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
      uniforms.uWind.value.set(
        state.clock.elapsedTime * 0.43,
        0,
        state.clock.elapsedTime,
      );
      /* Lerped toward the target rather than snapped, so a fast pointer sweep
         glides instead of stuttering. Mutated in place — allocating a Vector2
         per frame is what the previous implementation did at 60Hz. */
      smoothedMouse.current.x +=
        (mouseRef.current.x - smoothedMouse.current.x) * 0.045;
      smoothedMouse.current.y +=
        (mouseRef.current.y - smoothedMouse.current.y) * 0.045;
      uniforms.uMouse.value.copy(smoothedMouse.current);
    }

    const progress = scroll.value;

    /* Scroll flies the camera up into the deck and levels the view off, so the
       hero's sky opens out as it leaves rather than simply sliding away. */
    const eased = 1 - Math.pow(1 - Math.min(progress / 0.35, 1), 3);
    /* Scaled with the slab: the climb has to stay a visible fraction of the 30
       units up to the cloud base, or raising the deck quietly turns the flight
       into a drift. */
    uniforms.uAltitude.value = eased * 14.0;
    uniforms.uPitch.value = 0.78 - eased * 0.16;

    /* Dispersal. Raising the gate floor shrinks every cloud toward its own core
       so the gaps between them widen, and stretching the field moves the cores
       apart while that happens. Together they read as the sky opening; fading
       the field's opacity instead reads as a backdrop being turned down, which
       is the one thing that would give away that it is one. */
    const t = Math.min(progress / DISPERSE_OVER, 1);
    const disperse = t * t * (3 - 2 * t);
    uniforms.uGateFloor.value =
      CLOUD_GATE_DENSE + disperse * (CLOUD_GATE_CLEAR - CLOUD_GATE_DENSE);
    uniforms.uSpread.value = 1 + disperse * 0.22;
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
