/**
 * Editor Types for Framer-like Edit Mode UI
 */

// Typography styles for text elements
export interface TypographyStyles {
  fontSize: string;
  fontWeight: string;
  color: string;
  textAlign: "left" | "center" | "right" | "justify";
  lineHeight?: string;
  letterSpacing?: string;
}

// Font size mapping (Tailwind-like)
export const FONT_SIZES = {
  xs: "0.75rem", // 12px
  sm: "0.875rem", // 14px
  base: "1rem", // 16px (Body)
  lg: "1.125rem", // 18px
  xl: "1.25rem", // 20px
  "2xl": "1.5rem", // 24px
  "3xl": "1.875rem", // 30px
  "4xl": "2.25rem", // 36px
  "5xl": "3rem", // 48px
  "6xl": "3.75rem", // 60px
  "7xl": "4.5rem", // 72px
} as const;

export type FontSizeKey = keyof typeof FONT_SIZES;

// Font size labels for display
export const FONT_SIZE_LABELS: Record<FontSizeKey, string> = {
  xs: "XS",
  sm: "Small",
  base: "Body",
  lg: "Large",
  xl: "XL",
  "2xl": "2XL",
  "3xl": "3XL",
  "4xl": "4XL",
  "5xl": "5XL",
  "6xl": "6XL",
  "7xl": "7XL",
};

// Font weight options
export const FONT_WEIGHTS = {
  thin: "100",
  extralight: "200",
  light: "300",
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
  black: "900",
} as const;

export type FontWeightKey = keyof typeof FONT_WEIGHTS;

// Text alignment options
export type TextAlign = "left" | "center" | "right" | "justify";

// Selection state for editor
export interface EditorSelectionState {
  elementId: string | null;
  elementBounds: DOMRect | null;
  elementTag: string;
  elementStyles: TypographyStyles | null;
}

// Pending change tracking
export interface PendingChange {
  original: string;
  current: string;
  originalStyles?: TypographyStyles;
  currentStyles?: TypographyStyles;
}

// Floating toolbar position
export interface ToolbarPosition {
  top: number;
  left: number;
  placement: "above" | "below";
}

// Typography panel state
export interface TypographyPanelState {
  isOpen: boolean;
  activeTab: "basic" | "advanced";
}

// Color preset for color picker
export interface ColorPreset {
  name: string;
  value: string;
}

// Default color presets
export const DEFAULT_COLOR_PRESETS: ColorPreset[] = [
  { name: "Black", value: "#000000" },
  { name: "White", value: "#ffffff" },
  { name: "Gray", value: "#6b7280" },
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Yellow", value: "#eab308" },
  { name: "Lime", value: "#84cc16" },
  { name: "Green", value: "#22c55e" },
  { name: "Emerald", value: "#10b981" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Sky", value: "#0ea5e9" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Fuchsia", value: "#d946ef" },
  { name: "Pink", value: "#ec4899" },
  { name: "Rose", value: "#f43f5e" },
];

// Editor toolbar action types
export type ToolbarAction =
  | "typography"
  | "expand"
  | "save"
  | "delete"
  | "ai-suggest";

// Element metadata for tag badge
export interface ElementMetadata {
  tagName: string;
  className?: string;
  id?: string;
}

// Editor context state
export interface EditorContextState {
  // Selection
  selectedElementId: string | null;
  selectedElementBounds: DOMRect | null;
  selectedElementTag: string;

  // Styles
  elementStyles: Record<string, TypographyStyles>;

  // Changes
  pendingChanges: Map<string, PendingChange>;
  hasUnsavedChanges: boolean;

  // UI State
  isTypographyPanelOpen: boolean;
  isAIInputFocused: boolean;
}

// Editor actions
export type EditorAction =
  | { type: "SELECT_ELEMENT"; payload: EditorSelectionState }
  | { type: "DESELECT_ELEMENT" }
  | {
      type: "UPDATE_STYLES";
      payload: { elementId: string; styles: Partial<TypographyStyles> };
    }
  | {
      type: "ADD_PENDING_CHANGE";
      payload: { elementId: string; change: PendingChange };
    }
  | { type: "SAVE_CHANGES" }
  | { type: "DISCARD_CHANGES" }
  | { type: "TOGGLE_TYPOGRAPHY_PANEL"; payload?: boolean }
  | { type: "SET_AI_INPUT_FOCUSED"; payload: boolean };
