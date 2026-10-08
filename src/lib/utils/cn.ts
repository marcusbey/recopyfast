import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only recognises Tailwind's T-shirt radius sizes. ADR 050
 * adds two semantic radius tokens (`rounded-control`, `rounded-container`);
 * without this extension `cn("rounded-container", "rounded-2xl")` keeps both
 * classes and CSS source order, not the call site, decides which radius wins.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["control", "container"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
