"use client";

import { Label } from "@/components/ui/label";
import { Check } from "lucide-react";
import { useTheme, THEMES, type Theme } from "@/hooks/useTheme";

const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/** Swatch approximating each theme's canvas, so the tile previews the choice. */
const THEME_SWATCHES: Record<Theme, string> = {
  light: "bg-white",
  dark: "bg-slate-900",
  system: "bg-gradient-to-br from-white to-slate-900",
};

export function ThemePicker() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-2">
      <Label id="theme-picker-label">Theme</Label>
      {/*
        These were bare <div className="cursor-pointer"> tiles: they looked
        interactive, did nothing, and were invisible to keyboard and screen
        reader users. A radiogroup is the correct pattern — one choice out of
        three, arrow keys move between options.
      */}
      <div
        role="radiogroup"
        aria-labelledby="theme-picker-label"
        className="grid grid-cols-3 gap-4"
      >
        {THEMES.map((option) => {
          const isSelected = theme === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setTheme(option)}
              className={`rounded-lg border-2 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isSelected
                  ? "border-primary"
                  : "border-border hover:border-line-strong"
              }`}
            >
              <div
                className={`mb-2 h-20 w-full rounded border border-border ${THEME_SWATCHES[option]}`}
              />
              <p className="flex items-center justify-center gap-1 text-sm font-medium">
                {THEME_LABELS[option]}
                {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
              </p>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Applied immediately and remembered on this device.
      </p>
    </div>
  );
}
