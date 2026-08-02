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
