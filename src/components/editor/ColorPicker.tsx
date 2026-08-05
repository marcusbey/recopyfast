"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { DEFAULT_COLOR_PRESETS } from "@/types/editor";

/**
 * Converts an rgb/rgba string returned by getComputedStyle (e.g. "rgb(255, 0, 0)")
 * to a lowercase 6-digit hex string (e.g. "#ff0000").
 * Returns the original string unchanged when it is already in hex or any other format.
 */
function rgbToHex(color: string): string {
  const match = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return color;
  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  presets?: typeof DEFAULT_COLOR_PRESETS;
}

/**
 * Color picker with preset colors and custom hex input
 */
export default function ColorPicker({
  value,
  onChange,
  presets = DEFAULT_COLOR_PRESETS,
}: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customColor, setCustomColor] = useState(value);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Normalize value to hex so the trigger and custom input always show hex
  const hexValue = rgbToHex(value);

  // Update custom color when value changes
  useEffect(() => {
    setCustomColor(rgbToHex(value));
  }, [value]);

  const handlePresetClick = (color: string) => {
    onChange(color);
    setCustomColor(color);
  };

  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setCustomColor(newColor);
    // Only trigger onChange if it's a valid hex color
    if (/^#[0-9A-Fa-f]{6}$/.test(newColor)) {
      onChange(newColor);
    }
  };

  const handleNativeColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setCustomColor(newColor);
    onChange(newColor);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between gap-2 w-full px-3 py-2 bg-surface-2 hover:bg-surface-3 text-foreground rounded-lg transition-colors text-sm"
      >
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded border border-border"
            style={{ backgroundColor: hexValue }}
          />
          <span className="font-mono text-xs uppercase">{hexValue}</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-md overflow-hidden z-50 p-3"
          >
            {/* Color presets grid */}
            <div className="grid grid-cols-5 gap-2 mb-3">
              {presets.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => handlePresetClick(preset.value)}
                  className={`w-8 h-8 rounded-lg border-2 transition hover:scale-110 ${
                    hexValue === preset.value
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-muted-foreground"
                  }`}
                  style={{ backgroundColor: preset.value }}
                  title={preset.name}
                />
              ))}
            </div>

            {/* Divider */}
            <div className="border-t border-border my-3" />

            {/* Custom color input */}
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={customColor}
                onChange={handleNativeColorChange}
                className="w-10 h-10 rounded border border-border cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={customColor}
                onChange={handleCustomColorChange}
                placeholder="#000000"
                className="flex-1 px-3 py-2 bg-surface-2 border border-border rounded-lg text-foreground font-mono text-xs uppercase focus:outline-none focus:border-primary"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
