import { Car } from "lucide-react";
import { editable, photo, type DemoSite } from "./types";

/**
 * Premium Auto Spa — precise, dark, technical.
 *
 * Point of view: a workshop job sheet. Near-black ground, one signal colour
 * used only where something is actionable or priced, monospace for anything
 * that behaves like a reading off an instrument, and a services section set as
 * a numbered table rather than three equal cards. Separation is done entirely
 * with 1px hairlines, which is what makes the dark surface read as precise
 * instead of soft.
 */
export const premiumAutoSpa: DemoSite = {
  id: "carwash",
  name: "Premium Auto Spa",
  domain: "premiumautospa.co",
  icon: Car,

  images: {
    hero: [
      photo("1492144534655-ae79c964c9d7", 1400),
      photo("1503376780353-7e6692767b70", 1400),
      photo("1583121274602-3e2820c69888", 1400),
    ],
    bay: [
      photo("1541348263662-e068662d82af", 1800),
      photo("1503376780353-7e6692767b70", 1800),
      photo("1601362840469-51e4d8d58785", 1800),
    ],
  },

  textStyles: {
    brand:
      "rounded-none font-mono text-[12px] font-medium uppercase tracking-[0.3em] text-[#e8eaed]",
    "hero-eyebrow":
      "rounded-none font-mono text-[11px] uppercase tracking-[0.28em] text-[#ff4d17]",
    headline:
      "rounded-none max-w-[17ch] text-[2.1rem] font-semibold uppercase leading-[0.93] tracking-[-0.03em] text-[#e8eaed] md:text-[2.9rem] lg:text-[3.4rem]",
    subheading:
      "rounded-none max-w-[32rem] text-[15px] leading-[1.75] text-[#8d949d]",
    cta: "rounded-none inline-block bg-[#ff4d17] px-7 py-3.5 text-[12px] font-semibold uppercase tracking-[0.2em] text-[#0b0c0e]",
    "view-pricing-btn":
      "rounded-none inline-block bg-[#1b1f24] px-7 py-3.5 text-[12px] font-semibold uppercase tracking-[0.2em] text-[#e8eaed]",
    "satisfaction-title":
      "rounded-none font-mono text-[12px] uppercase tracking-[0.2em] text-[#e8eaed]",
    "satisfaction-subtitle":
      "rounded-none font-mono text-[11px] uppercase tracking-[0.14em] text-[#8d949d]",
    "spec-1":
      "rounded-none font-mono text-[11px] uppercase tracking-[0.2em] text-[#8d949d]",
    "spec-2":
      "rounded-none font-mono text-[11px] uppercase tracking-[0.2em] text-[#8d949d]",
    "spec-3":
      "rounded-none font-mono text-[11px] uppercase tracking-[0.2em] text-[#8d949d]",
    "services-title":
      "rounded-none text-[1.75rem] font-semibold uppercase leading-none tracking-[-0.02em] text-[#e8eaed] md:text-[2.25rem]",
    "service-desc":
      "rounded-none max-w-[34rem] text-[14px] leading-[1.8] text-[#8d949d]",
    "basic-wash-title":
      "rounded-none text-[1.05rem] font-semibold uppercase text-[#e8eaed]",
    "premium-detail-title":
      "rounded-none text-[1.05rem] font-semibold uppercase text-[#e8eaed]",
    "ceramic-coating-title":
      "rounded-none text-[1.05rem] font-semibold uppercase text-[#e8eaed]",
    "basic-wash-desc":
      "rounded-none max-w-[28rem] text-[13.5px] leading-[1.7] text-[#8d949d]",
    "premium-detail-desc":
      "rounded-none max-w-[28rem] text-[13.5px] leading-[1.7] text-[#8d949d]",
    "ceramic-coating-desc":
      "rounded-none max-w-[28rem] text-[13.5px] leading-[1.7] text-[#8d949d]",
    "basic-wash-price":
      "rounded-none font-mono text-[15px] tabular-nums text-[#ff4d17]",
    "premium-detail-price":
      "rounded-none font-mono text-[15px] tabular-nums text-[#ff4d17]",
    "ceramic-coating-price":
      "rounded-none font-mono text-[15px] tabular-nums text-[#ff4d17]",
    "pricing-title":
      "rounded-none text-[1.75rem] font-semibold uppercase leading-none tracking-[-0.02em] text-[#e8eaed] md:text-[2.25rem]",
    "package-1-name":
      "rounded-none text-[1.3rem] font-semibold uppercase tracking-[-0.01em] text-[#e8eaed]",
    "package-1-detail":
      "rounded-none max-w-[26rem] text-[13.5px] leading-[1.75] text-[#8d949d]",
    "package-1-price":
      "rounded-none font-mono text-[2rem] tabular-nums tracking-[-0.03em] text-[#e8eaed]",
    "package-1-unit":
      "rounded-none font-mono text-[11px] uppercase tracking-[0.2em] text-[#8d949d]",
    "package-2-name":
      "rounded-none text-[1.3rem] font-semibold uppercase tracking-[-0.01em] text-[#0b0c0e]",
    "package-2-detail":
      "rounded-none max-w-[26rem] text-[13.5px] leading-[1.75] text-[#0b0c0e]/75",
    "package-2-price":
      "rounded-none font-mono text-[2rem] tabular-nums tracking-[-0.03em] text-[#0b0c0e]",
    "package-2-unit":
      "rounded-none font-mono text-[11px] uppercase tracking-[0.2em] text-[#0b0c0e]/70",
    default: "rounded-none text-[14px] leading-relaxed text-[#8d949d]",
  },

  editableTexts: [
    editable("brand", "Premium Auto Spa"),
    editable("hero-eyebrow", "Appointment only · Bays 01–04"),
    editable("headline", "Detailing held to a body-shop tolerance"),
    editable(
      "subheading",
      "Two-stage paint correction, 9H ceramic, interiors stripped back to the seat rails. Every job opens with a paint-depth reading and closes with a walkaround under 6500K light.",
    ),
    editable("cta", "Book a slot"),
    editable("view-pricing-btn", "See packages"),
    editable("satisfaction-title", "Work guaranteed"),
    editable("satisfaction-subtitle", "Re-done free within seven days"),

    editable("spec-1", "Paint depth logged per panel"),
    editable("spec-2", "6500K inspection light"),
    editable("spec-3", "No queue, no upsell"),

    editable("services-title", "What we do"),
    editable(
      "service-desc",
      "Three levels of work, same process at different depths. We tell you which one your paint actually needs before you book it.",
    ),
    editable("basic-wash-title", "Basic Wash"),
    editable(
      "basic-wash-desc",
      "Foam pre-soak, two-bucket contact wash, dressed tyres, glass in and out.",
    ),
    editable("basic-wash-price", "45"),
    editable("premium-detail-title", "Premium Detail"),
    editable(
      "premium-detail-desc",
      "Interior extraction plus a single-stage machine polish and six-month sealant.",
    ),
    editable("premium-detail-price", "220"),
    editable("ceramic-coating-title", "Ceramic Coating"),
    editable(
      "ceramic-coating-desc",
      "Two-stage correction, panel wipe, 9H coating, two years of check-ins.",
    ),
    editable("ceramic-coating-price", "890"),

    editable("pricing-title", "Packages"),
    editable("package-1-name", "Monthly Maintenance"),
    editable(
      "package-1-detail",
      "Two contact washes a month, interior reset on every visit, priority booking.",
    ),
    editable("package-1-price", "120"),
    editable("package-1-unit", "per month"),
    editable("package-2-name", "Season Reset"),
    editable(
      "package-2-detail",
      "Correction, coating top-up and a full interior once a quarter. Collection included.",
    ),
    editable("package-2-price", "340"),
    editable("package-2-unit", "per quarter"),
  ],
};
