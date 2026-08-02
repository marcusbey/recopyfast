import { Utensils } from "lucide-react";
import { editable, photo, type DemoSite } from "./types";

/**
 * Bella Vista — warm, editorial, photography-led.
 *
 * Point of view: a printed restaurant page. Serif display against a paper
 * ground, a full-bleed photograph the type sits inside rather than beside, and
 * a menu set as a menu — name, note, leader rule, price — instead of cards.
 * Depth comes from the photograph and from hairlines at 10% ink; there is no
 * shadow anywhere in this site.
 */
export const bellaVista: DemoSite = {
  id: "restaurant",
  name: "Bella Vista",
  domain: "bellavista.restaurant",
  icon: Utensils,

  images: {
    hero: [
      photo("1514933651103-005eec06c04b", 1800),
      photo("1517248135467-4c7edcad34c4", 1800),
      photo("1414235077428-338989a2e8c0", 1800),
    ],
    room: [
      photo("1552566626-52f8b828add9", 1200),
      photo("1517248135467-4c7edcad34c4", 1200),
      photo("1559339352-11d035aa65de", 1200),
    ],
    plateA: [
      photo("1467003909585-2f8a72700288", 900),
      photo("1600891964092-4316c288032e", 900),
      photo("1574484284002-952d92456975", 900),
    ],
    plateB: [
      photo("1565299624946-b28f40a0ae38", 900),
      photo("1414235077428-338989a2e8c0", 900),
      photo("1600891964092-4316c288032e", 900),
    ],
  },

  textStyles: {
    brand:
      "rounded-sm font-serif text-[15px] font-medium uppercase tracking-[0.3em] text-[#1a1512]",
    "nav-hours":
      "rounded-sm font-mono text-[11px] uppercase tracking-[0.2em] text-[#6b5c4d]",
    // The nav's own type, previously inherited from the <nav> wrapper by plain
    // <span>s. Each item carries it directly now that each is its own editable.
    "nav-link-1":
      "rounded-sm font-mono text-[11px] uppercase tracking-[0.2em] text-[#6b5c4d]",
    "nav-link-2":
      "rounded-sm font-mono text-[11px] uppercase tracking-[0.2em] text-[#6b5c4d]",
    "nav-link-3":
      "rounded-sm font-mono text-[11px] uppercase tracking-[0.2em] text-[#6b5c4d]",
    "nav-link-4":
      "rounded-sm font-mono text-[11px] uppercase tracking-[0.2em] text-[#6b5c4d]",
    headline:
      "rounded-sm font-serif text-[2.5rem] leading-[0.95] tracking-[-0.025em] text-[#f6f1e9] md:text-[3.5rem] lg:text-[4.25rem] [text-shadow:0_2px_24px_rgb(16_12_10/0.55)]",
    subheading:
      "rounded-sm max-w-[27rem] text-[15px] leading-[1.7] text-[#f6f1e9]/85 [text-shadow:0_1px_10px_rgb(16_12_10/0.5)]",
    cta: "rounded-none inline-block bg-[#a8432a] px-7 py-3.5 text-[12px] font-semibold uppercase tracking-[0.22em] text-[#f6f1e9]",
    "about-eyebrow":
      "rounded-sm font-mono text-[11px] uppercase tracking-[0.24em] text-[#a8432a]",
    "about-title":
      "rounded-sm font-serif text-[2rem] leading-[1.05] tracking-[-0.02em] text-[#1a1512] md:text-[2.6rem]",
    "about-text":
      "rounded-sm max-w-[30rem] text-[15px] leading-[1.85] text-[#6b5c4d]",
    "learn-more-btn":
      "rounded-sm inline-block font-mono text-[11px] uppercase tracking-[0.24em] text-[#1a1512] underline decoration-[#a8432a] decoration-2 underline-offset-[6px]",
    "feature-1-title":
      "rounded-sm font-serif text-[1.5rem] leading-tight text-[#1a1512]",
    "feature-2-title":
      "rounded-sm font-serif text-[1.5rem] leading-tight text-[#1a1512]",
    "feature-1-desc":
      "rounded-sm max-w-[22rem] text-[14px] leading-[1.75] text-[#6b5c4d]",
    "feature-2-desc":
      "rounded-sm max-w-[22rem] text-[14px] leading-[1.75] text-[#6b5c4d]",
    "menu-title":
      "rounded-sm font-serif text-[2rem] leading-none tracking-[-0.02em] text-[#1a1512] md:text-[2.6rem]",
    "menu-note":
      "rounded-sm font-mono text-[11px] uppercase tracking-[0.2em] text-[#6b5c4d]",
    "special-1-name":
      "rounded-sm font-serif text-[1.3rem] leading-tight text-[#1a1512]",
    "special-2-name":
      "rounded-sm font-serif text-[1.3rem] leading-tight text-[#1a1512]",
    "special-3-name":
      "rounded-sm font-serif text-[1.3rem] leading-tight text-[#1a1512]",
    "special-1-note": "rounded-sm text-[13px] leading-relaxed text-[#6b5c4d]",
    "special-2-note": "rounded-sm text-[13px] leading-relaxed text-[#6b5c4d]",
    "special-3-note": "rounded-sm text-[13px] leading-relaxed text-[#6b5c4d]",
    "special-1-price":
      "rounded-sm font-mono text-[15px] tabular-nums text-[#1a1512]",
    "special-2-price":
      "rounded-sm font-mono text-[15px] tabular-nums text-[#1a1512]",
    "special-3-price":
      "rounded-sm font-mono text-[15px] tabular-nums text-[#1a1512]",
    "caption-1":
      "rounded-sm font-mono text-[11px] uppercase tracking-[0.2em] text-[#6b5c4d]",
    "caption-2":
      "rounded-sm font-mono text-[11px] uppercase tracking-[0.2em] text-[#6b5c4d]",
    default: "rounded-sm text-[15px] leading-relaxed text-[#6b5c4d]",
  },

  editableTexts: [
    editable("brand", "Bella Vista"),
    editable("nav-link-1", "Menu"),
    editable("nav-link-2", "Wine"),
    editable("nav-link-3", "Private dining"),
    editable("nav-link-4", "Find us"),
    editable("nav-hours", "Tue–Sun · 5 to 10"),
    editable("headline", "Sicilian cooking,\nthree generations deep"),
    editable(
      "subheading",
      "Pasta cut every morning, a wood oven that has not gone cold since 1952, and a short menu that follows the market.",
    ),
    editable("cta", "Reserve a table"),

    editable("about-eyebrow", "Established 1952"),
    editable("about-title", "Our Story"),
    editable(
      "about-text",
      "Antonio and Maria Rossi opened Bella Vista with eleven seats and one oven. Their grandchildren still work the pass. The recipes came over from Palermo; the tomatoes come from the farm out on Route 9.",
    ),
    editable("learn-more-btn", "Read the full story"),

    editable("feature-1-title", "Fresh Pasta"),
    editable(
      "feature-1-desc",
      "Rolled and cut before service, six shapes a day, nothing held over.",
    ),
    editable("feature-2-title", "Fine Wine"),
    editable(
      "feature-2-desc",
      "Ninety labels, all Italian, half of them from growers we have visited.",
    ),

    editable("menu-title", "This week's table"),
    editable("menu-note", "Changes Tuesdays"),
    editable("special-1-name", "Truffle risotto"),
    editable(
      "special-1-note",
      "Carnaroli, wild mushrooms, aged parmigiano, black truffle",
    ),
    editable("special-1-price", "28"),
    editable("special-2-name", "Osso buco alla Milanese"),
    editable("special-2-note", "Veal shank, saffron risotto, gremolata"),
    editable("special-2-price", "32"),
    editable("special-3-name", "Branzino al sale"),
    editable("special-3-note", "Whole sea bass in salt crust, lemon oil"),
    editable("special-3-price", "34"),

    editable("caption-1", "The pass, 6.40pm"),
    editable("caption-2", "Saturday service"),
  ],
};
