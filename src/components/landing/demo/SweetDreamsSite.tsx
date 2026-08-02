"use client";

import { MapPin, Phone } from "lucide-react";
import type { DemoSiteRenderProps } from "./types";

const RULE = "border-[#2a2119]/12";

/**
 * Sweet Dreams' page. Composition only — every string comes back through
 * `text(id)` and every photograph through `image(slot, …)`.
 */
export default function SweetDreamsSite({ text, image }: DemoSiteRenderProps) {
  return (
    <div className="bg-[#fbf7f1] text-[#2a2119]">
      <header
        className={`flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4 md:px-10 ${RULE}`}
      >
        {text("brand")}
        <nav className="hidden items-center gap-7 text-[13px] text-[#7a6a58] lg:flex">
          <span>Bread</span>
          <span>Pastry</span>
          <span>Cakes to order</span>
          <span>Wholesale</span>
        </nav>
        {text("nav-since")}
      </header>

      {/* Hero — type left, two prints tipped off-grid on the right. */}
      <section
        className={`grid items-center gap-10 border-b px-6 py-12 md:grid-cols-12 md:px-10 md:py-16 ${RULE}`}
      >
        <div className="md:col-span-6">
          {text("hero-eyebrow")}
          <div className="mt-3">{text("headline")}</div>
          <div className="mt-6">{text("subheading")}</div>
          <div className="mt-8">{text("cta")}</div>
        </div>

        {/* Two prints, matted in paper-coloured borders and tipped a couple of
            degrees apart. Heights are explicit rather than aspect-driven so the
            collage can never grow past the row it sits in. */}
        <div className="relative h-[360px] md:col-span-6 md:h-[460px]">
          <div className="absolute top-0 left-[2%] h-[84%] w-[50%] rotate-[-3deg]">
            {image("loaf", {
              alt: "A country sourdough loaf, sliced on the bench",
              className: "h-full w-full border-8 border-[#fbf7f1] object-cover",
              wrapperClassName: "relative h-full",
            })}
          </div>
          <div className="absolute right-[2%] bottom-0 h-[64%] w-[48%] rotate-[2.5deg]">
            {image("pastry", {
              alt: "The morning's pastries in the case",
              className: "h-full w-full border-8 border-[#fbf7f1] object-cover",
              wrapperClassName: "relative h-full",
            })}
          </div>
        </div>
      </section>

      {/* What is out today — a ruled band, three entries, no card chrome. */}
      <section className={`border-b bg-[#f2e9dc] ${RULE}`}>
        <div className={`border-b px-6 py-4 md:px-10 ${RULE}`}>
          {text("case-title")}
        </div>
        <div className="grid md:grid-cols-3">
          {["1", "2", "3"].map((n, i) => (
            <div
              key={n}
              className={`border-b px-6 py-7 last:border-b-0 md:border-b-0 md:px-10 ${
                i > 0 ? "md:border-l" : ""
              } ${RULE}`}
            >
              {text(`product-${n}`)}
              <div className="mt-1.5">{text(`product-${n}-note`)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Tradition — photograph tipped the other way, text given the width. */}
      <section
        className={`grid items-center gap-12 border-b px-6 py-14 md:grid-cols-12 md:px-10 md:py-20 ${RULE}`}
      >
        <div className="md:col-span-5">
          <div className="rotate-[-1.5deg]">
            {image("counter", {
              alt: "The counter at Sweet Dreams, first thing in the morning",
              className:
                "aspect-[4/5] w-full border-8 border-[#fbf7f1] object-cover",
            })}
          </div>
        </div>
        <div className="md:col-span-7">
          {text("tradition-eyebrow")}
          <div className="mt-2">{text("tradition-title")}</div>
          <div className="mt-5">{text("tradition-text")}</div>
          <div className={`mt-7 border-l-2 pl-5 ${RULE}`}>
            {text("tradition-note")}
          </div>
        </div>
      </section>

      {/* Hours and address — set as a ruled timetable. */}
      <section className="grid gap-10 px-6 py-14 md:grid-cols-12 md:px-10 md:py-18">
        <div className="md:col-span-5">{text("hours-title")}</div>
        <div className="md:col-span-7">
          {["1", "2"].map((n) => (
            <div
              key={n}
              className={`flex items-baseline justify-between gap-6 border-b py-4 first:border-t ${RULE}`}
            >
              {text(`hours-${n}-days`)}
              {text(`hours-${n}-time`)}
            </div>
          ))}
          <div className="mt-8 flex flex-wrap gap-x-10 gap-y-3">
            <div className="flex items-baseline gap-2.5">
              <MapPin className="h-4 w-4 shrink-0 translate-y-0.5 text-[#c2603f]" />
              {text("contact-address")}
            </div>
            <div className="flex items-baseline gap-2.5">
              <Phone className="h-4 w-4 shrink-0 translate-y-0.5 text-[#c2603f]" />
              {text("contact-phone")}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
