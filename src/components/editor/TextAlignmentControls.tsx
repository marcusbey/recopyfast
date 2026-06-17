"use client";

import { AlignLeft, AlignCenter, AlignRight, AlignJustify } from "lucide-react";
import type { TextAlign } from "@/types/editor";

interface TextAlignmentControlsProps {
  value: TextAlign;
  onChange: (alignment: TextAlign) => void;
}

const alignmentOptions: {
  value: TextAlign;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}[] = [
  { value: "left", icon: AlignLeft, label: "Align left" },
  { value: "center", icon: AlignCenter, label: "Align center" },
  { value: "right", icon: AlignRight, label: "Align right" },
  { value: "justify", icon: AlignJustify, label: "Justify" },
];

/**
 * Button group for text alignment options
 */
export default function TextAlignmentControls({
  value,
  onChange,
}: TextAlignmentControlsProps) {
  return (
    <div className="flex items-center bg-gray-800 rounded-lg p-1">
      {alignmentOptions.map(({ value: alignValue, icon: Icon, label }) => (
        <button
          key={alignValue}
          type="button"
          onClick={() => onChange(alignValue)}
          title={label}
          className={`p-2 rounded transition-colors ${
            value === alignValue
              ? "bg-emerald-500 text-white"
              : "text-gray-400 hover:text-gray-200 hover:bg-gray-700"
          }`}
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}
