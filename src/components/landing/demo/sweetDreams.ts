import { Croissant } from "lucide-react";
import { editable, photo, type DemoSite } from "./types";

/**
 * Sweet Dreams — light, soft, playful, still premium.
 *
 * Point of view: a small bakery that prints its own packaging. Warm neutrals
 * rather than pink, an italic serif used only for asides so the voice sounds
 * spoken, and photographs tipped a couple of degrees off-grid and matted in
 * paper-coloured borders. The tilt is the charm; it replaces the drop shadow
 * that would normally do that job, and there are no emoji anywhere.
 */
export const sweetDreams: DemoSite = {
  id: "bakery",
  name: "Sweet Dreams",
  domain: "sweetdreams.bakery",
  icon: Croissant,

  images: {
    loaf: [
      photo("1549931319-a545dcf3bc73", 1000),
      photo("1608198093002-ad4e005484ec", 1000),
      photo("1509440159596-0249088772ff", 1000),
    ],
    pastry: [
      photo("1568254183919-78a4f43a2877", 1000),
      photo("1558961363-fa8fdf82db35", 1000),
      photo("1555507036-ab1f4038808a", 1000),
    ],
    counter: [
      photo("1517433670267-08bbd4be890f", 1100),
      photo("1568254183919-78a4f43a2877", 1100),
      photo("1608198093002-ad4e005484ec", 1100),
    ],
  },

  textStyles: {
    brand:
      "rounded-sm text-[1.15rem] font-semibold tracking-[-0.02em] text-[#2a2119]",
    "nav-since": "rounded-sm font-serif text-[13px] italic text-[#7a6a58]",
    "hero-eyebrow": "rounded-sm font-serif text-[15px] italic text-[#c2603f]",
    headline:
      "rounded-sm max-w-[14ch] text-[2.5rem] font-semibold leading-[1.0] tracking-[-0.035em] text-[#2a2119] md:text-[3.2rem] lg:text-[3.8rem]",
    subheading:
      "rounded-sm max-w-[27rem] text-[15px] leading-[1.8] text-[#7a6a58]",
    cta: "rounded-md inline-block bg-[#2a2119] px-7 py-3.5 text-[13px] font-semibold text-[#fbf7f1]",
    "case-title": "rounded-sm font-serif text-[14px] italic text-[#7a6a58]",
    "product-1":
      "rounded-sm text-[1.05rem] font-semibold tracking-[-0.01em] text-[#2a2119]",
    "product-2":
      "rounded-sm text-[1.05rem] font-semibold tracking-[-0.01em] text-[#2a2119]",
    "product-3":
      "rounded-sm text-[1.05rem] font-semibold tracking-[-0.01em] text-[#2a2119]",
    "product-1-note": "rounded-sm text-[13px] leading-relaxed text-[#7a6a58]",
    "product-2-note": "rounded-sm text-[13px] leading-relaxed text-[#7a6a58]",
    "product-3-note": "rounded-sm text-[13px] leading-relaxed text-[#7a6a58]",
    "tradition-eyebrow":
      "rounded-sm font-serif text-[15px] italic text-[#c2603f]",
    "tradition-title":
      "rounded-sm text-[1.9rem] font-semibold leading-[1.05] tracking-[-0.03em] text-[#2a2119] md:text-[2.4rem]",
    "tradition-text":
      "rounded-sm max-w-[32rem] text-[15px] leading-[1.9] text-[#7a6a58]",
    "tradition-note":
      "rounded-sm max-w-[26rem] font-serif text-[15px] italic leading-[1.7] text-[#2a2119]",
    "hours-title":
      "rounded-sm text-[1.9rem] font-semibold leading-none tracking-[-0.03em] text-[#2a2119] md:text-[2.4rem]",
    "hours-1-days": "rounded-sm text-[14px] font-medium text-[#2a2119]",
    "hours-2-days": "rounded-sm text-[14px] font-medium text-[#2a2119]",
    "hours-1-time":
      "rounded-sm font-mono text-[13px] tabular-nums text-[#7a6a58]",
    "hours-2-time":
      "rounded-sm font-mono text-[13px] tabular-nums text-[#7a6a58]",
    "contact-address": "rounded-sm text-[14px] leading-relaxed text-[#2a2119]",
    "contact-phone": "rounded-sm text-[14px] leading-relaxed text-[#2a2119]",
    default: "rounded-sm text-[15px] leading-relaxed text-[#7a6a58]",
  },

  editableTexts: [
    editable("brand", "Sweet Dreams"),
    editable("nav-since", "On Main Street since 1985"),
    editable("hero-eyebrow", "Ovens on at four"),
    editable("headline", "Baked before you wake up"),
    editable(
      "subheading",
      "Sourdough, laminated pastry and celebration cakes, made from scratch every morning and sold until they are gone.",
    ),
    editable("cta", "Order for pickup"),

    editable("case-title", "In the case today"),
    editable("product-1", "Country sourdough"),
    editable("product-1-note", "48-hour levain, stone-milled flour"),
    editable("product-2", "Kouign-amann"),
    editable("product-2-note", "Twelve folds, caramelised in the tin"),
    editable("product-3", "Cardamom bun"),
    editable("product-3-note", "Spice ground the morning it is baked"),

    editable("tradition-eyebrow", "Three generations"),
    editable("tradition-title", "Family Tradition"),
    editable(
      "tradition-text",
      "Ilse Bauer opened with one deck oven and a Viennese recipe book. Her daughter added the sourdough programme, and her grandson works the early shift. Nothing here is proofed off-site or finished from frozen.",
    ),
    editable(
      "tradition-note",
      "Whatever is left at four goes down the road to the shelter kitchen.",
    ),

    editable("hours-title", "Visit Us Today"),
    editable("hours-1-days", "Monday to Friday"),
    editable("hours-1-time", "6:00 – 19:00"),
    editable("hours-2-days", "Saturday & Sunday"),
    editable("hours-2-time", "7:00 – 18:00"),
    editable("contact-address", "123 Main Street, Downtown"),
    editable("contact-phone", "(555) 123-4567"),
  ],
};
