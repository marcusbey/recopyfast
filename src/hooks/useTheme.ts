"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Theme preference.
 *
 * globals.css drives every colour through `light-dark()`, keyed off the
 * `color-scheme` property. `:root` declares `color-scheme: light dark` (follow
 * the OS) and `[data-theme="light|dark"]` pins one. So switching themes means
 * setting or clearing one attribute on <html> — there is no class list to
 * toggle and no second stylesheet.
 */

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "recopyfast-theme";

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

/** Read the stored preference, tolerating disabled/blocked storage. */
export function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}

export function useTheme() {
  // Server render has no storage, so start at the documented default and
  // reconcile on mount. The inline script in the root layout has already
  // applied the real value to <html> by then, so nothing flashes.
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    setThemeState(readStoredTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode, blocked cookies). The theme
      // still applies for this session; only persistence is lost.
    }
  }, []);

  return { theme, setTheme };
}
