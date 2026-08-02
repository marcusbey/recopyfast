"use client";

import type { DemoSiteRenderProps } from "./types";

const RULE = "border-[#252a30]";

const SERVICES = [
  { n: "01", key: "basic-wash" },
  { n: "02", key: "premium-detail" },
  { n: "03", key: "ceramic-coating" },
] as const;

/**
 * Premium Auto Spa's page. Composition only — every string comes back through
 * `text(id)` and every photograph through `image(slot, …)`.
 */
export default function PremiumAutoSpaSite({
  text,
  image,
}: DemoSiteRenderProps) {
  return (
    <div className="bg-[#0b0c0e] text-[#e8eaed]">
      <header
        className={`flex flex-wrap items-center justify-between gap-4 border-b px-6 py-4 md:px-10 ${RULE}`}
      >
        {text("brand")}
        {/* gap-3 rather than gap-7: each item is now an editable, and those
            carry their own padding, so the smaller gap lands on the same
            rendered spacing the plain spans had. */}
        <nav className="hidden items-center gap-3 lg:flex">
          {text("nav-link-1")}
          {text("nav-link-2")}
          {text("nav-link-3")}
          {/* The status dot stays outside the editable: it is a graphic, not
              copy, and pulling it inside would put markup into a string the
              visitor edits as plain text. */}
          <span className="flex items-center">
            <span className="h-1.5 w-1.5 bg-[#ff4d17]" />
            {text("nav-status")}
          </span>
        </nav>
      </header>

      {/* Hero — 7/5, type left, one photograph held in a hairline frame. */}
      <section className={`grid border-b md:grid-cols-12 ${RULE}`}>
        <div
          className={`border-b px-6 py-12 md:col-span-7 md:border-r md:border-b-0 md:px-10 md:py-16 ${RULE}`}
        >
          {text("hero-eyebrow")}
          <div className="mt-5">{text("headline")}</div>
          <div className="mt-6">{text("subheading")}</div>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            {text("cta")}
            {text("view-pricing-btn")}
          </div>
        </div>
        <div className="relative min-h-[280px] md:col-span-5">
          {image("hero", {
            alt: "A car under inspection light in the detailing bay",
            className: "h-full w-full object-cover",
            wrapperClassName: "absolute inset-0",
          })}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-[#0b0c0e] via-[#0b0c0e]/25 to-transparent"
          />
          <div
            className={`absolute right-5 bottom-5 left-5 border bg-[#0b0c0e]/85 px-5 py-4 backdrop-blur-sm ${RULE}`}
          >
            {text("satisfaction-title")}
            <div className="mt-1">{text("satisfaction-subtitle")}</div>
          </div>
        </div>
      </section>

      {/* Spec rail — three readings, hairline-separated. */}
      <div className={`grid border-b sm:grid-cols-3 ${RULE}`}>
        {["spec-1", "spec-2", "spec-3"].map((id, i) => (
          <div
            key={id}
            className={`border-b px-6 py-5 last:border-b-0 md:px-10 sm:border-b-0 ${
              i > 0 ? "sm:border-l" : ""
            } ${RULE}`}
          >
            {text(id)}
          </div>
        ))}
      </div>

      {/* Services — a numbered job sheet, not three equal cards. */}
      <section className={`border-b px-6 py-14 md:px-10 md:py-18 ${RULE}`}>
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          {text("services-title")}
          {text("service-desc")}
        </div>

        <div className="mt-10">
          {SERVICES.map(({ n, key }) => (
            <div
              key={key}
              className={`grid grid-cols-[2.5rem_1fr] items-baseline gap-x-4 gap-y-2 border-t py-6 md:grid-cols-[3rem_14rem_1fr_auto] ${RULE}`}
            >
              <span className="font-mono text-[12px] tracking-[0.2em] text-[#ff4d17]">
                {n}
              </span>
              {text(`${key}-title`)}
              <div className="col-start-2 md:col-start-3">
                {text(`${key}-desc`)}
              </div>
              <div className="col-start-2 flex items-baseline gap-1 md:col-start-4 md:justify-end">
                <span className="font-mono text-[12px] whitespace-nowrap text-[#8d949d]">
                  from $
                </span>
                {text(`${key}-price`)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Packages — deliberately unequal: one plain, one inverted. */}
      <section className="grid md:grid-cols-5">
        <div
          className={`px-6 py-12 md:col-span-2 md:border-r md:px-10 ${RULE}`}
        >
          {text("pricing-title")}
          <div className="mt-6">{text("package-1-name")}</div>
          <div className="mt-3">{text("package-1-detail")}</div>
          <div className="mt-6 flex items-baseline gap-2">
            <span className="font-mono text-[1.25rem] text-[#8d949d]">$</span>
            {text("package-1-price")}
            {text("package-1-unit")}
          </div>
        </div>
        <div className="bg-[#ff4d17] px-6 py-12 md:col-span-3 md:px-10">
          <span className="font-mono text-[11px] tracking-[0.24em] text-[#0b0c0e]/70">
            MOST BOOKED
          </span>
          <div className="mt-4">{text("package-2-name")}</div>
          <div className="mt-3">{text("package-2-detail")}</div>
          <div className="mt-6 flex items-baseline gap-2">
            <span className="font-mono text-[1.25rem] text-[#0b0c0e]/70">
              $
            </span>
            {text("package-2-price")}
            {text("package-2-unit")}
          </div>
        </div>
      </section>

      <figure className={`border-t ${RULE}`}>
        {image("bay", {
          alt: "Finished paintwork under workshop lighting",
          className: "aspect-[21/9] w-full object-cover",
        })}
      </figure>
    </div>
  );
}
