/**
 * ReCopyFast Editing Rules — app-facing surface.
 *
 * The rules themselves live in `./editingRules.core`, which is the single
 * implementation shared with the embeddable widget: `scripts/build-embed.mjs`
 * compiles that file straight into `public/embed/recopyfast.js`. Everything
 * colour-, contrast- and backdrop-related in this file is a thin adapter over
 * it, so the widget and the app can never drift apart on what "readable" means.
 *
 * CONSISTENT RULE FOR TEXT COLOR:
 * - ALWAYS preserve the original text color during editing
 * - DO NOT automatically change colors based on background detection
 * - The editing experience should match the original design exactly
 * - Users expect to see the same color they originally designed
 */

import {
  assessReadability,
  BLACK,
  compositeOver,
  contrastRatio,
  parseCssColor,
  readEditableText,
  relativeLuminance,
  resolveBackdrop,
  WHITE,
  type Rgba,
} from "./editingRules.core";

export * from "./editingRules.core";

export interface EditingRules {
  text: TextEditingRules;
  image: ImageEditingRules;
  container: ContainerRules;
}

export interface TextEditingRules {
  // Preserve original formatting
  preserveOriginalFormat: boolean;
  preserveBackgroundColor: boolean;
  preserveFontFamily: boolean;
  preserveFontSize: boolean;
  preserveTextAlign: boolean;
  preservePadding: boolean;
  preserveMargin: boolean;

  // Container behavior
  maintainContainerDimensions: boolean;
  allowTextOverflow: boolean;
  scrollBehavior: "hidden" | "auto" | "visible";

  // Editing states
  editingBackgroundColor: string;
  editingBorderStyle: string;
  focusRingColor: string;
}

export interface ImageEditingRules {
  // Preserve container
  preserveContainerSize: boolean;
  preserveAspectRatio: boolean;
  preserveBorderRadius: boolean;

  // Editing options
  allowRandomGeneration: boolean;
  allowPromptGeneration: boolean;
  allowUnsplashSearch: boolean;

  // Modal behavior
  showEditingModal: boolean;
  modalPosition: "center" | "overlay" | "sidebar";
}

export interface ContainerRules {
  // Dimension preservation
  lockWidth: boolean;
  lockHeight: boolean;
  lockPosition: boolean;

  // Overflow handling
  textOverflow: "ellipsis" | "clip" | "visible";
  overflowWrap: "normal" | "break-word" | "anywhere";
}

/**
 * Default editing rules applied to all editable content
 */
export const DEFAULT_EDITING_RULES: EditingRules = {
  text: {
    // Preserve all original formatting
    preserveOriginalFormat: true,
    preserveBackgroundColor: true,
    preserveFontFamily: true,
    preserveFontSize: true,
    preserveTextAlign: true,
    preservePadding: true,
    preserveMargin: true,

    // Container behavior - maintain original dimensions
    maintainContainerDimensions: true,
    allowTextOverflow: true,
    scrollBehavior: "visible",

    // Subtle editing indicators
    editingBackgroundColor: "transparent", // No background change
    editingBorderStyle: "2px solid #3b82f6",
    focusRingColor: "#3b82f6",
  },

  image: {
    // Preserve container properties
    preserveContainerSize: true,
    preserveAspectRatio: true,
    preserveBorderRadius: true,

    // Enable all editing options
    allowRandomGeneration: true,
    allowPromptGeneration: true,
    allowUnsplashSearch: true,

    // Show overlay modal for image editing
    showEditingModal: true,
    modalPosition: "overlay",
  },

  container: {
    // Lock all dimensions during editing
    lockWidth: true,
    lockHeight: false, // Allow height to grow for longer text
    lockPosition: true,

    // Handle text overflow gracefully
    textOverflow: "visible",
    overflowWrap: "break-word",
  },
};

/**
 * Generate CSS styles for text editing that preserve original formatting
 */
export function getTextEditingStyles(
  originalElement: HTMLElement,
): React.CSSProperties {
  const computedStyle = window.getComputedStyle(originalElement);

  return {
    // Preserve all visual properties EXACTLY
    fontFamily: computedStyle.fontFamily,
    fontSize: computedStyle.fontSize,
    fontWeight: computedStyle.fontWeight,
    fontStyle: computedStyle.fontStyle,
    lineHeight: computedStyle.lineHeight,
    letterSpacing: computedStyle.letterSpacing,
    color: computedStyle.color,
    textAlign: computedStyle.textAlign as React.CSSProperties["textAlign"],
    textDecoration: computedStyle.textDecoration,
    textTransform:
      computedStyle.textTransform as React.CSSProperties["textTransform"],

    // Preserve spacing EXACTLY
    padding: computedStyle.padding,
    paddingTop: computedStyle.paddingTop,
    paddingRight: computedStyle.paddingRight,
    paddingBottom: computedStyle.paddingBottom,
    paddingLeft: computedStyle.paddingLeft,
    margin: computedStyle.margin,
    marginTop: computedStyle.marginTop,
    marginRight: computedStyle.marginRight,
    marginBottom: computedStyle.marginBottom,
    marginLeft: computedStyle.marginLeft,

    // Maintain dimensions EXACTLY
    width: computedStyle.width,
    minWidth: computedStyle.minWidth,
    maxWidth: computedStyle.maxWidth,
    minHeight: computedStyle.height,
    boxSizing: computedStyle.boxSizing as React.CSSProperties["boxSizing"],

    // Preserve background (no change during editing)
    backgroundColor: computedStyle.backgroundColor,
    backgroundImage: computedStyle.backgroundImage,
    backgroundSize: computedStyle.backgroundSize,
    backgroundPosition: computedStyle.backgroundPosition,
    backgroundRepeat: computedStyle.backgroundRepeat,

    // Preserve border radius and other visual elements
    borderRadius: computedStyle.borderRadius,
    borderTopLeftRadius: computedStyle.borderTopLeftRadius,
    borderTopRightRadius: computedStyle.borderTopRightRadius,
    borderBottomLeftRadius: computedStyle.borderBottomLeftRadius,
    borderBottomRightRadius: computedStyle.borderBottomRightRadius,

    // Preserve shadows and effects
    boxShadow: computedStyle.boxShadow,
    textShadow: computedStyle.textShadow,

    // Editing-specific styles (minimal override)
    border: "2px solid #3b82f6", // Blue editing indicator
    outline: "none",
    resize: "none",

    // Text overflow handling - preserve original or allow natural growth
    overflow: "visible",
    overflowWrap: "break-word",
    wordWrap: "break-word",
    whiteSpace:
      computedStyle.whiteSpace === "nowrap"
        ? "normal"
        : computedStyle.whiteSpace,
  };
}

/**
 * Enhanced rules for maintaining text consistency during editing
 */
export const TEXT_EDITING_CONSISTENCY_RULES = {
  // Always preserve these properties exactly
  preserveExactly: [
    "fontSize",
    "fontFamily",
    "fontWeight",
    "fontStyle",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "color",
    "padding",
    "margin",
    "backgroundColor",
    "borderRadius",
    "boxShadow",
    "textShadow",
    "textDecoration",
    "textTransform",
  ],

  // Handle these properties with special logic
  handleSpecially: {
    width: "maintain", // Keep original width
    height: "auto-expand", // Allow height to grow naturally
    whiteSpace: "normalize-if-nowrap", // Allow text wrapping if originally nowrap
    overflow: "make-visible", // Ensure text is always visible
  },

  // Minimal editing indicators
  editingIndicators: {
    border: "2px solid #3b82f6",
    outline: "none",
    cursor: "text",
  },
};

/**
 * Generate CSS styles for image containers during editing
 */
export function getImageEditingStyles(
  originalElement: HTMLElement,
): React.CSSProperties {
  const computedStyle = window.getComputedStyle(originalElement);

  return {
    width: computedStyle.width,
    height: computedStyle.height,
    borderRadius: computedStyle.borderRadius,
    objectFit: computedStyle.objectFit as React.CSSProperties["objectFit"],
    objectPosition: computedStyle.objectPosition,
    transition: "all 0.2s ease",
  };
}

/**
 * Unsplash categories for different image types
 */
export const UNSPLASH_CATEGORIES = {
  restaurant: ["food", "restaurant", "cuisine", "dining", "chef", "kitchen"],
  car: [
    "car",
    "automobile",
    "vehicle",
    "luxury-car",
    "sports-car",
    "automotive",
  ],
  bakery: ["bakery", "bread", "pastry", "cake", "baking", "dessert"],
  general: ["business", "office", "modern", "professional", "abstract"],
} as const;

/**
 * Generate random Unsplash image URL based on category
 */
export function generateUnsplashUrl(
  category: keyof typeof UNSPLASH_CATEGORIES,
  width: number = 400,
  height: number = 300,
): string {
  const keywords = UNSPLASH_CATEGORIES[category];
  const randomKeyword = keywords[Math.floor(Math.random() * keywords.length)];
  return `https://source.unsplash.com/${width}x${height}/?${randomKeyword}&${Date.now()}`;
}

/**
 * Universal Text Color Detection Utilities
 *
 * These are the legacy names the app already imports. Each one now delegates to
 * `editingRules.core`, which is the same code the embed widget runs, so there is
 * exactly one implementation of colour parsing, alpha compositing, luminance,
 * contrast and backdrop resolution in the product.
 */

/** @deprecated Prefer `Rgba` from editingRules.core. */
export type ColorRGBA = Rgba;

/**
 * Parse a colour string. Unlike the core parser this never returns null — the
 * historical callers expect a colour, and black is the safe default.
 */
export const parseColor = (color: string): ColorRGBA =>
  parseCssColor(color) ?? { r: 0, g: 0, b: 0, a: 1 };

/** Relative luminance of a colour (WCAG 2.1). */
export const getLuminance = (color: ColorRGBA): number =>
  relativeLuminance(color);

/**
 * Contrast ratio between two *luminances*.
 *
 * Note the signature: this takes luminances, not colours, because that is what
 * the existing callers pass. `contrastRatio(a, b)` from the core takes colours.
 */
export const getContrastRatio = (
  luminance1: number,
  luminance2: number,
): number => {
  const lighter = Math.max(luminance1, luminance2);
  const darker = Math.min(luminance1, luminance2);
  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * Effective background colour behind an element, compositing translucent
 * ancestors. Falls back to white when nothing opaque is found.
 */
export const getEffectiveBackgroundColor = (
  element: HTMLElement,
): ColorRGBA => {
  const backdrop = resolveBackdrop(element);
  return backdrop.color.a >= 1
    ? backdrop.color
    : compositeOver(backdrop.color, WHITE);
};

/**
 * Text colour that stays legible on the resolved background.
 *
 * The embed widget deliberately does NOT use this: recolouring text is a
 * visible design change, so the widget keeps the author's colour and puts a
 * scrim behind it instead (see `assessReadability`). This remains for the
 * in-app demo surfaces that were built around it.
 */
export const getOptimalTextColor = (element: HTMLElement): string => {
  const computedStyle = window.getComputedStyle(element);
  const originalColor = computedStyle.color;
  const verdict = assessReadability(element);

  if (verdict.ratio === null || verdict.ratio >= verdict.required) {
    return originalColor;
  }

  // Measure both candidates and take the winner rather than thresholding the
  // background's luminance.
  //
  // The obvious `luminance > 0.5 ? black : white` is wrong: the luminance at
  // which white and black give equal contrast is 0.1791 (solve
  // (L+0.05)^2 = 0.0525), not 0.5. A 0.5 pivot therefore picks white across the
  // whole 0.179..0.5 band — every mid-tone background. At L=0.45 that is
  // 2.10:1, a hard WCAG AA failure, where black would have given 10.00:1.
  // Picking the higher of the two measured ratios is exact and needs no pivot.
  return contrastRatio(BLACK, verdict.backdrop.color) >=
    contrastRatio(WHITE, verdict.backdrop.color)
    ? "#000000"
    : "#ffffff";
};

/**
 * Get text shadow for better visibility
 */
export const getTextShadow = (textColor: string): string => {
  const parsed = parseCssColor(textColor);
  const isDark = parsed ? relativeLuminance(parsed) < 0.5 : false;
  return isDark
    ? "0 1px 2px rgba(255, 255, 255, 0.5)"
    : "0 1px 2px rgba(0, 0, 0, 0.5)";
};

/**
 * Full editable text for an element.
 *
 * Reads `textContent`, never `innerText`: innerText returns the *rendered*
 * string, so `text-transform: uppercase` would round-trip "Ship fast" back as
 * "SHIP FAST" and overwrite the author's copy.
 */
export const getFullElementText = (element: HTMLElement): string => {
  if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
    const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
    return (inputElement.value || inputElement.placeholder || "").trim();
  }

  const text = readEditableText(element);

  // Visually truncated copy sometimes stashes the full string out of band.
  if (text.endsWith("...") || text.endsWith("…")) {
    return element.title || element.getAttribute("data-full-text") || text;
  }

  return text;
};

/**
 * Validation rules for editing content
 */
export const VALIDATION_RULES = {
  text: {
    maxLength: 500,
    minLength: 1,
    allowedCharacters: /^[\w\s\-.,!?()'"\/&@#$%:;+=]*$/,
  },
  image: {
    allowedDomains: [
      "unsplash.com",
      "source.unsplash.com",
      "images.unsplash.com",
    ],
    maxPromptLength: 100,
    minPromptLength: 3,
  },
};
