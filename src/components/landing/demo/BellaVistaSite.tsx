"use client";

import type { DemoSiteRenderProps } from "./types";

const RULE = "border-[#1a1512]/12";

/**
 * Bella Vista's page. Composition only — every string comes back through
 * `text(id)` and every photograph through `image(slot, …)`, so this file never
 * touches editing state.
 */
export default function BellaVistaSite({ text, image }: DemoSiteRenderProps) {
  return (
    <div className="bg-[#f6f1e9] text-[#1a1512]">
      <header
        className={`flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4 md:px-10 ${RULE}`}
      >
        {text("brand")}
        <nav className="hidden items-center gap-7 font-mono text-[11px] uppercase tracking-[0.2em] text-[#6b5c4d] lg:flex">
          <span>Menu</span>
          <span>Wine</span>
          <span>Private dining</span>
          <span>Find us</span>
        </nav>
        {text("nav-hours")}
      </header>

      {/* Hero — one photograph, type set inside it, anchored bottom-left. */}
      <section className="relative h-[420px] overflow-hidden md:h-[500px]">
        {image("hero", {
          alt: "The dining room at Bella Vista during evening service",
          className: "h-full w-full object-cover",
          wrapperClassName: "absolute inset-0",
        })}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-[#100c0a] via-[#100c0a]/55 to-[#100c0a]/10"
        />
        <div className="relative flex h-full flex-col justify-end px-6 pb-8 md:px-10 md:pb-12">
          {text("headline")}
          <div className="mt-5 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            {text("subheading")}
            {text("cta")}
          </div>
        </div>
      </section>

      {/* Story — 5/7 split, text narrow, photograph given the long side. */}
      <section
        className={`grid gap-10 border-b px-6 py-14 md:grid-cols-12 md:px-10 md:py-20 ${RULE}`}
      >
        <div className="md:col-span-5">
          {text("about-eyebrow")}
          <div className="mt-3">{text("about-title")}</div>
          <div className="mt-5">{text("about-text")}</div>
          <div className="mt-8">{text("learn-more-btn")}</div>
        </div>
        <div className="md:col-span-7">
          {image("room", {
            alt: "The dining room, laid up before the doors open",
            className: `aspect-[4/3] w-full border object-cover ${RULE}`,
          })}
        </div>
      </section>

      {/* Two hallmarks as full-bleed bands, not a card grid. */}
      <section className={`grid border-b md:grid-cols-2 ${RULE}`}>
        <div
          className={`border-b px-6 py-10 md:border-r md:border-b-0 md:px-10 ${RULE}`}
        >
          <span className="font-mono text-[11px] tracking-[0.24em] text-[#a8432a]">
            01
          </span>
          <div className="mt-3">{text("feature-1-title")}</div>
          <div className="mt-2">{text("feature-1-desc")}</div>
        </div>
        <div className="px-6 py-10 md:px-10">
          <span className="font-mono text-[11px] tracking-[0.24em] text-[#a8432a]">
            02
          </span>
          <div className="mt-3">{text("feature-2-title")}</div>
          <div className="mt-2">{text("feature-2-desc")}</div>
        </div>
      </section>

      {/* Menu — typeset as a menu: name, note, leader rule, price. */}
      <section className="px-6 py-14 md:px-10 md:py-20">
        <div
          className={`flex flex-wrap items-baseline justify-between gap-3 border-b pb-5 ${RULE}`}
        >
          {text("menu-title")}
          {text("menu-note")}
        </div>
        <ul>
          {["1", "2", "3"].map((n) => (
            <li
              key={n}
              className={`grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-b py-6 ${RULE}`}
            >
              <div className="min-w-0">
                {text(`special-${n}-name`)}
                <div className="mt-1.5">{text(`special-${n}-note`)}</div>
              </div>
              <div className="flex items-baseline gap-3">
                <span
                  aria-hidden
                  className={`hidden w-16 border-b border-dotted sm:block ${RULE}`}
                />
                <span className="font-mono text-[15px] text-[#a8432a]">$</span>
                {text(`special-${n}-price`)}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Closing plates, full-bleed, captioned. */}
      <section className="grid md:grid-cols-2">
        <figure className={`border-t md:border-r ${RULE}`}>
          {image("plateA", {
            alt: "A plated dish from the current menu",
            className: "aspect-[5/4] w-full object-cover",
          })}
          <figcaption className={`border-t px-6 py-4 md:px-10 ${RULE}`}>
            {text("caption-1")}
          </figcaption>
        </figure>
        <figure className={`border-t ${RULE}`}>
          {image("plateB", {
            alt: "A second plated dish from the current menu",
            className: "aspect-[5/4] w-full object-cover",
          })}
          <figcaption className={`border-t px-6 py-4 md:px-10 ${RULE}`}>
            {text("caption-2")}
          </figcaption>
        </figure>
      </section>
    </div>
  );
}
