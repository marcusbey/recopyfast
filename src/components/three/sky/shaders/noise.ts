/**
 * Shared GLSL noise for the sky shaders.
 *
 * The 2D and 3D simplex implementations are the ones that were already running
 * in MeshBackground.tsx, moved here verbatim rather than rewritten — they were
 * never the problem with that component. What is new is `fbm3`, the height
 * remap, and the hash used to dither raymarch step offsets.
 */

/** Ashima simplex 3D. Used by the volumetric density field. */
export const SIMPLEX_3D = /* glsl */ `
  vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
`;

/** Ashima simplex 2D. Used by the cheap layered sky. */
export const SIMPLEX_2D = /* glsl */ `
  vec3 mod289_3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289_2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute3(vec3 x) { return mod289_3(((x*34.0)+1.0)*x); }

  float snoise2D(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289_2(i);
    vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm2(vec2 p, int octaves) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 6; i++) {
      if (i >= octaves) break;
      value += amp * (snoise2D(p) * 0.5 + 0.5);
      p *= 2.02;
      amp *= 0.5;
    }
    return value;
  }
`;

/**
 * 3D fbm plus the shaping helpers the raymarcher needs.
 *
 * `octaves` is a parameter because the light march can afford far fewer octaves
 * than the primary march — it only needs to know roughly how much cloud is
 * between this point and the sun, not what that cloud looks like.
 */
export const FBM_3D = /* glsl */ `
  float fbm3(vec3 p, int octaves) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      if (i >= octaves) break;
      float n = snoise(p);
      value += amp * n;
      /* Each octave is displaced by the one below it before being sampled —
         a domain warp that costs nothing because the offset is a value the
         loop already computed. Plain octave stacking lines every feature up on
         the same lattice, which reads as regular ripples once it is stretched
         across a sky; folding the lattice by an amount that itself varies is
         what turns ripples into billows. The offsets differ per axis so the
         fold has no single diagonal to it. */
      p = p * 2.03 + vec3(n * 0.26, n * 0.11, -n * 0.26);
      amp *= 0.5;
    }
    return value;
  }

  /* Remap a value from one range to another, clamped to 0..1. The standard
     cloud-shaping primitive: it turns raw noise into a density you can control. */
  float remap(float v, float lo, float hi) {
    return clamp((v - lo) / (hi - lo), 0.0, 1.0);
  }

  /* Vertical density profile through the cloud slab. Real cumulus have flat,
     sharply-cut bases and billowy tops, so the gradient is asymmetric: it opens
     fast at the bottom and tapers slowly toward the top. A symmetric falloff is
     the single most common reason procedural clouds read as fog.

     The swell argument is how much cloud this column holds, 0..1, and both
     ends of the taper rise with it. A thin column stays a shallow patch on the
     base; a dense one towers to the top of the slab. Giving every column the
     same ceiling — which a one-argument profile has no choice but to do — is
     what flattens a cumulus field into a single stretched sheet, because the
     silhouette is then entirely horizontal and carries no vertical shape at
     all. */
  float heightProfile(float h, float swell) {
    float base = remap(h, 0.0, 0.07);
    float top  = 1.0 - remap(h, mix(0.14, 0.52, swell), mix(0.42, 1.0, swell));
    return base * top;
  }

  /* Cheap hash for per-pixel raymarch step dithering. Trading banding for
     high-frequency noise is always the right trade — the eye forgives grain and
     does not forgive concentric rings. */
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
`;

/**
 * Atmosphere shared by both sky paths, so the cheap one and the expensive one
 * agree about what colour the sky is and where the sun sits. Without this the
 * cross-fade between them would be visible.
 *
 * Not a real Rayleigh integral — a fitted approximation. It has the two
 * properties that actually sell a sky: the horizon desaturates toward white,
 * and there is a broad warm halo around the sun rather than a hard disc.
 */
export const ATMOSPHERE = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSunColor;

  vec3 skyColor(vec3 rd) {
    float h = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
    /* pow() biases the gradient toward the horizon, where the interesting part
       of a sky lives. A linear mix puts the transition uselessly high up. */
    vec3 col = mix(uSkyHorizon, uSkyZenith, pow(h, 0.62));

    float sunDot = max(dot(rd, uSunDir), 0.0);
    /* Two lobes: a wide atmospheric bloom and a tight disc. */
    col += uSunColor * pow(sunDot, 8.0) * 0.28;
    col += uSunColor * pow(sunDot, 900.0) * 1.6;
    return col;
  }

  /* Henyey-Greenstein phase function. g > 0 biases scattering forward, which is
     what makes cloud edges glow when the sun is behind them. This is the term
     that was entirely missing before, and the main reason the old clouds looked
     flat: they were lit uniformly from nowhere. */
  float henyeyGreenstein(float cosTheta, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (12.5663706 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
  }
`;
