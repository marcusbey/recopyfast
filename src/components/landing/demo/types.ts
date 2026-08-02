import type { ComponentType, ReactNode } from "react";

/** One click-to-edit string inside a demo site. */
export interface EditableText {
  id: string;
  text: string;
  isEditing: boolean;
  originalText: string;
}

export interface DemoSite {
  id: string;
  /** Shown on the tab button. */
  name: string;
  /** Shown in the fake browser's address bar. */
  domain: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * Typography for each editable element, keyed by element id, with `default`
   * as the fallback.
   *
   * This is the ONLY place an editable element's type styling is declared.
   * `EditableTextComponent` looks the string up once and hands the same string
   * to both the read branch and the edit branch, which is what keeps edit mode
   * dimensionally identical to read mode. Anything that changes the element's
   * box — size, weight, colour, padding, radius, max-width — belongs here, not
   * inline in one of the two branches.
   */
  textStyles: Record<string, string>;
  /**
   * Photo pools keyed by layout slot. Index 0 is what the site renders on load;
   * the rest are what "Shuffle" cycles through. Every URL is a real
   * `images.unsplash.com` photo — the old `source.unsplash.com` random endpoint
   * was retired by Unsplash and returns nothing.
   */
  images: Record<string, readonly string[]>;
  editableTexts: EditableText[];
}

/**
 * What a site layout gets from `InteractiveHero`. The layouts own composition
 * and never touch editing state: `text(id)` and `image(slot, …)` both route
 * through the single editing engine in the parent.
 */
export interface DemoSiteRenderProps {
  text: (id: string) => ReactNode;
  image: (
    slot: string,
    options: { alt: string; className: string; wrapperClassName?: string },
  ) => ReactNode;
}

/** Builds an editable string whose `originalText` is its starting text. */
export const editable = (id: string, text: string): EditableText => ({
  id,
  text,
  isEditing: false,
  originalText: text,
});

/** Unsplash photo URL, sized and format-negotiated. */
export const photo = (id: string, width = 1400): string =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${width}&q=80`;
