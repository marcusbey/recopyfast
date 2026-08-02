import { bellaVista } from "./bellaVista";
import { premiumAutoSpa } from "./premiumAutoSpa";
import { sweetDreams } from "./sweetDreams";
import type { DemoSite } from "./types";

/**
 * The three fake customer sites shown in "See It In Action".
 *
 * They are deliberately built on three unrelated palettes and three different
 * typographic voices rather than one template recoloured, because the point of
 * the section is that ReCopyFast drops into somebody else's design without
 * bringing its own.
 */
export const demoSites: readonly DemoSite[] = [
  bellaVista,
  premiumAutoSpa,
  sweetDreams,
];
