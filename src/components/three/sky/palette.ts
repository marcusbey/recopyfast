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

/** Deep enough that a white cloud has somewhere to be bright against. */
export const SKY_ZENITH = new THREE.Color(0.24, 0.47, 0.86);

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
 * The ZENITH carries this, not the horizon. `skyColor` biases its gradient with
 * `pow(h, 0.62)` and the sky is pitched so the frame samples rd.y well above
 * the horizon line — the visible page is nearly all zenith. Colouring the
 * horizon instead, which is the intuitive way round for a sunset, would tint a
 * band that is mostly off-screen and leave the page still blue.
 * ------------------------------------------------------------------------- */

/** Warm and unambiguous: this is the colour the closing section reads as. */
export const SUNSET_ZENITH = new THREE.Color(0.94, 0.42, 0.16);

/** Lighter and creamier below, so the gradient still has somewhere to go. */
export const SUNSET_HORIZON = new THREE.Color(1.0, 0.79, 0.55);

/** A low sun is redder — it is the same light through more atmosphere. */
export const SUNSET_SUN = new THREE.Color(1.0, 0.84, 0.62);

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

/** Cloud slab in world units. Bottom is flat, top is where billowing tapers. */
export const CLOUD_BOTTOM = 12.0;
export const CLOUD_TOP = 38.0;

/**
 * Blur radius, in CSS pixels, of the `.glass` panes that sit over this sky.
 * Kept here so the sky's detail frequency and the glass blur stay related: if
 * the clouds carry detail far finer than the panes can transmit, that detail is
 * pure cost on every frame and invisible wherever it matters most.
 */
export const GLASS_BLUR_PX = 32;
