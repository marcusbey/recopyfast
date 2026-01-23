"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import FontSizeSelector from "./FontSizeSelector";
import ColorPicker from "./ColorPicker";
import TextAlignmentControls from "./TextAlignmentControls";
import {
  FONT_WEIGHTS,
  type FontWeightKey,
  type TypographyStyles,
  type TextAlign,
} from "@/types/editor";

interface TypographyPanelProps {
  isOpen: boolean;
  styles: TypographyStyles;
  onChange: (styles: Partial<TypographyStyles>) => void;
}

/**
 * Dropdown panel for typography styling
 * Contains font size, weight, color, and alignment controls
 */
export default function TypographyPanel({
  isOpen,
  styles,
  onChange,
}: TypographyPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Find current weight key from value
  const currentWeightKey = (Object.entries(FONT_WEIGHTS).find(
    ([, weight]) => weight === styles.fontWeight,
  )?.[0] || "normal") as FontWeightKey;

  const handleFontSizeChange = (fontSize: string) => {
    onChange({ fontSize });
  };

  const handleFontWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const weightValue = e.target.value;
    onChange({ fontWeight: weightValue });
  };

  const handleColorChange = (color: string) => {
    onChange({ color });
  };

  const handleAlignChange = (textAlign: TextAlign) => {
    onChange({ textAlign });
  };

  const handleLineHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ lineHeight: e.target.value });
  };

  const handleLetterSpacingChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    onChange({ letterSpacing: `${e.target.value}em` });
  };

  // Parse letter spacing for input
  const letterSpacingValue = parseFloat(
    styles.letterSpacing?.replace("em", "") || "0",
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          className="absolute top-full left-0 mt-2 w-72 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden z-50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 space-y-4">
            {/* Font Size */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">
                Font size
              </label>
              <FontSizeSelector
                value={styles.fontSize}
                onChange={handleFontSizeChange}
              />
            </div>

            {/* Font Weight Slider */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">
                Font weight
              </label>
              <div className="space-y-2">
                <input
                  type="range"
                  min="100"
                  max="900"
                  step="100"
                  value={styles.fontWeight}
                  onChange={handleFontWeightChange}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Thin</span>
                  <span className="text-gray-300 font-medium">
                    {currentWeightKey}
                  </span>
                  <span>Black</span>
                </div>
              </div>
            </div>

            {/* Color */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">
                Color
              </label>
              <ColorPicker value={styles.color} onChange={handleColorChange} />
            </div>

            {/* Text Align */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">
                Text align
              </label>
              <TextAlignmentControls
                value={styles.textAlign}
                onChange={handleAlignChange}
              />
            </div>

            {/* Divider */}
            <div className="border-t border-gray-800" />

            {/* Advanced Toggle */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              <span>Advanced</span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${
                  showAdvanced ? "rotate-180" : ""
                }`}
              />
            </button>

            {/* Advanced Options */}
            <AnimatePresence>
              {showAdvanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-4 overflow-hidden"
                >
                  {/* Line Height */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">
                      Line height
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="0.1"
                      value={parseFloat(styles.lineHeight || "1.5")}
                      onChange={handleLineHeightChange}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>1</span>
                      <span className="text-gray-300">
                        {styles.lineHeight || "1.5"}
                      </span>
                      <span>3</span>
                    </div>
                  </div>

                  {/* Letter Spacing */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">
                      Letter spacing
                    </label>
                    <input
                      type="range"
                      min="-0.1"
                      max="0.5"
                      step="0.01"
                      value={letterSpacingValue}
                      onChange={handleLetterSpacingChange}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>-0.1em</span>
                      <span className="text-gray-300">
                        {styles.letterSpacing || "0em"}
                      </span>
                      <span>0.5em</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
