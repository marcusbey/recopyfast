/**
 * Every lens, by id — one line each (s96). Server-only by use: the scan route
 * is its only importer, and the Typo Finder's dictionary loads on first use,
 * not on import. The catalogue (`../catalogue.ts`) names a lens id per scan
 * tool; `src/__tests__/app/tools-discovery.test.ts` pins that the two agree.
 *
 * The later tool stories (s97, s99–s101) each add exactly one line here.
 */

import type { Lens } from "@/lib/tools/lens";
import { outdatedLens } from "./outdated/outdated-lens";
import { typoLens } from "./typos/typo-lens";

export const LENSES: Readonly<Record<string, Lens>> = Object.freeze({
  typos: typoLens,
  outdated: outdatedLens,
});

export function getLens(id: string): Lens | undefined {
  return Object.prototype.hasOwnProperty.call(LENSES, id)
    ? LENSES[id]
    : undefined;
}
