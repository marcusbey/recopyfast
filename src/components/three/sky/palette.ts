import * as THREE from "three";

/**
 * One palette, shared by the volumetric and layered sky paths.
 *
 * Both paths have to agree on where the sun is and what colour the sky is,
 * because the page cross-fades between them as the hero scrolls away. Any
 * disagreement here shows up as a visible colour pop mid-fade.
 *
 * On the colours themselves: the sky this replaces ran a zenith of
 * rgb(0.60, 0.80, 1.00) against clouds at rgb(1.00, 1.00, 1.00). Both sit above
 * 0.8 relative luminance, so cloud-against-sky contrast was a few percent and
 * the result read as grey mush at any distance. The zenith below is materially
 * deeper, which is what buys the clouds somewhere to be bright against.
 */

/** Deep enough that a white cloud has somewhere to be bright against.
    Leans cyan rather than violet — the blue of a clear morning. The previous
    (0.24, 0.47, 0.86) sat far enough toward violet that the page read as a
    late-afternoon steel blue. */
export const SKY_ZENITH = new THREE.Color(0.26, 0.55, 0.92);

/** Horizon desaturates toward white — real atmosphere does this via scattering. */
export const SKY_HORIZON = new THREE.Color(0.78, 0.88, 0.97);

/** Very slightly warm. A pure-white sun reads as a blown highlight, not light. */
export const SUN_COLOR = new THREE.Color(1.0, 0.96, 0.88);

/**
 * High and off to one side. Directly overhead flattens everything (no visible
 * shadow direction); on the horizon turns the whole page orange, which is the
 * other brief. Normalised at module scope so no frame allocates it.
 */
export const SUN_DIR = new THREE.Vector3(0.42, 0.58, -0.7).normalize();

/* ---------------------------------------------------------------------------
 * Sunset — where the page ends.
 *
 * The closing call to action gets no panel of its own. Every other section sits
 * on glass or on white, so the one that asks for the signup is the only place
 * the sky is the background, and it turns over as you scroll into it.
 *
 * The ZENITH carries this — but that reasoning has an expiry date on it, and it
 * has now expired. It held because the sky was pitched so the frame sampled rd.y
 * well above the horizon line, making the visible page nearly all zenith, so
 * colouring the horizon would have tinted a band that was mostly off-screen.
 *
 * The camera now sits level with the horizon at mid-viewport, so roughly half
 * the frame is horizon-side and SKY_HORIZON is load-bearing where it used to be
 * nearly invisible. Warming only the zenith will leave the bottom half of the
 * closing section pale while the top half turns orange. The colours below are
 * deliberately unchanged pending someone looking at the CTA and deciding how the
 * sunset should read now that half of it is sky the reader can actually see.
 * ------------------------------------------------------------------------- */

/** Dusk overhead is violet, not orange — the orange lives at the horizon.
    A single-hue orange ramp is what made the CTA read as a flat fill: both
    ends of the gradient were the same colour at two brightnesses. Splitting
    the ramp across two hue families is what makes it read as an actual sky. */
export const SUNSET_ZENITH = new THREE.Color(0.38, 0.3, 0.55);

/** Hot amber-gold at the horizon, saturated enough to survive the tonemap. */
export const SUNSET_HORIZON = new THREE.Color(1.0, 0.6, 0.26);

/** A low sun is redder — it is the same light through more atmosphere. Values
    above 1.0 are deliberate: this feeds skyColor's bloom and disc terms before
    the tonemap, and at unit brightness the dusk halo was too faint to read.
    The excess is what makes the sun visibly glow low on the closing section. */
export const SUNSET_SUN = new THREE.Color(1.45, 0.76, 0.4);

/**
 * Where the sun goes at sunset: low, left of centre, and — critically — in
 * front of the camera. The daytime SUN_DIR has negative z, which is behind
 * every ray the shaders cast, so skyColor's halo and disc never rendered at
 * all. At dusk the sun swings into frame and drops to the horizon, which is
 * what a sunset is; the glow low on the CTA is this vector, not a decoration.
 */
export const SUNSET_SUN_DIR = new THREE.Vector3(-0.3, 0.09, 0.95).normalize();

/**
 * Scroll window the turn happens over, as a fraction of total page scroll.
 *
 * Wide on purpose, and smoothstepped rather than linear. The brief was that
 * nothing should change suddenly: at this width the shift is never perceptible
 * frame to frame, only as "the page got warmer" once you are at the bottom.
 * Ends slightly before 1.0 so the CTA is fully orange when it is reached rather
 * than still arriving.
 */
export const SUNSET_START = 0.55;
export const SUNSET_END = 0.92;

/**
 * Cloud slab in world units. Bottom is flat, top is where billowing tapers.
 *
 * What matters is not the height but the height against the width of a cloud,
 * which the shader's field scale puts at about 25 units. That ratio is the
 * angle a cloud subtends. At the old base of 12 against 48-unit clouds the
 * nearest one was wider than it was far away and filled most of the hero, so
 * there was no perspective left in the field at all — every cloud on screen was
 * the same enormous near one, which is the other half of why this read as being
 * inside the weather rather than under it. At 30 against 25-unit clouds the
 * nearest reads at about thirty degrees and the field recedes properly, small
 * cumulus along the bottom of the frame and larger ones overhead.
 *
 * The slab is deliberately half as thick as a cloud is wide. Cumulus humilis —
 * the flat-bottomed fair-weather kind — are wider than they are tall; a slab as
 * thick as the clouds are wide grows towers instead.
 */
export const CLOUD_BOTTOM = 30.0;
/* Raised from 43 so a fully swelled column can tower. heightProfile keys its
   ceiling off the coverage gate, so most clouds stay flat humilis while the
   densest few climb the extra headroom — and with the eye just above the old
   ceiling, those few are the ones that break the horizon line. A deck whose
   silhouette never crosses the horizon is what read as everything sitting on
   one plane. */
export const CLOUD_TOP = 47.0;

/* ---------------------------------------------------------------------------
 * Coverage gate.
 *
 * The volumetric shader samples a wide, slow noise field and only grows cloud
 * where that field clears a floor. The floor is therefore the dial for how much
 * sky is open, and moving it is what disperses the deck as the page scrolls:
 * raising it shrinks every cloud toward its own core, so the gaps between them
 * widen rather than the whole field fading out.
 *
 * These are the two ends of that travel, not arbitrary limits. DENSE is a
 * summer afternoon with distinct cumulus and blue between them — the sky the
 * hero opens on. CLEAR is the same weather an hour later: a few survivors, most
 * of the frame open. Going much above CLEAR empties the sky entirely, which
 * loses the parallax that makes the backdrop feel like depth at all.
 * ------------------------------------------------------------------------- */
/* Raised from 0.52 when the eye moved above the deck. Looking up, a ray crossed
   the slab once and the gaps between cloud groups were most of the frame. Looking
   down, the same field is seen in plan across a huge area, so every gap is filled
   by another group further out and 0.52 rendered as one continuous white floor —
   fog, not weather. A higher floor is what puts sky back between the groups.

   Raised again from 0.60/0.72: at 0.60 the groups still touched and the deck
   rendered as one unbroken white field with no blue through it anywhere — the
   compact, heavy version of this sky. At 0.66 the groups separate and the deck
   reads as individual cumulus over open air. */
export const CLOUD_GATE_DENSE = 0.66;
export const CLOUD_GATE_CLEAR = 0.78;

/**
 * Blur radius, in CSS pixels, of the `.glass` panes that sit over this sky.
 * Kept here so the sky's detail frequency and the glass blur stay related: if
 * the clouds carry detail far finer than the panes can transmit, that detail is
 * pure cost on every frame and invisible wherever it matters most.
 */
export const GLASS_BLUR_PX = 32;
