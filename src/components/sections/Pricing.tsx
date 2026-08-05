"use client";

import { motion, useInView } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Infinity as InfinityIcon,
  Rocket,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

/**
 * Prices, feature bullets and the overage rate all come from `/api/pricing`,
 * which reads the `plans` table. Nothing on this page is a second, hand-typed
 * copy of the billing config — that duplication is what let the landing page
 * advertise "Up to 3 websites, +$6 per additional" while billing granted 5 at $5.
 */

interface PricingPlan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  highlight: boolean;
  badge: string | null;
  cta: string;
}

interface PricingOneTimeProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  features: string[];
  grantsPlanId: string | null;
}

interface PricingResponse {
  plans: PricingPlan[];
  oneTimeProducts: PricingOneTimeProduct[];
}

const PLAN_ICONS: Record<string, LucideIcon> = {
  starter: Sparkles,
  pro: Rocket,
  lifetime_pro: InfinityIcon,
};

const FALLBACK_ICON = Sparkles;

// No trial is offered and subscription Checkout always collects a card, so the
// "14-day free trial" and "No credit card required" claims that used to sit here
// were commercial promises the product did not honour.
const TRUST_POINTS = ["Cancel anytime", "30-day money-back guarantee"];

export default function Pricing() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [isYearly, setIsYearly] = useState(false);
  const [pricing, setPricing] = useState<PricingResponse | null>(null);
  const [hasFailed, setHasFailed] = useState(false);

  const loadPricing = useCallback(async () => {
    setHasFailed(false);
    try {
      const response = await fetch("/api/pricing");
      if (!response.ok) {
        throw new Error(`Pricing request failed with ${response.status}`);
      }
      setPricing((await response.json()) as PricingResponse);
    } catch {
      // No hardcoded price list to fall back on: showing a stale number here is
      // worse than asking the visitor to retry, because it is a number we would
      // then have to honour.
      setHasFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadPricing();
  }, [loadPricing]);

  // Lifetime Pro sits alongside the subscriptions: it is the same catalogue,
  // and a one-time plan is a pricing choice a visitor makes on this page.
  const lifetime = pricing?.oneTimeProducts.find(
    (product) => product.grantsPlanId !== null,
  );
  const cardCount = (pricing?.plans.length ?? 0) + (lifetime ? 1 : 0);

  return (
    <section
      id="pricing"
      ref={ref}
      className="glass-sheet relative overflow-hidden border-y border-white/40 py-24 sm:py-32 px-6"
    >
      {/* Subtle background */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-sky-100 rounded-full blur-3xl opacity-30" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-teal-100 rounded-full blur-3xl opacity-30" />
      </div>

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <span className="mb-6 inline-block text-sm font-semibold uppercase tracking-[0.075em] text-sky-700">
            Pricing
          </span>
          <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 mb-6">
            Simple pricing,
            <br />
            <span className="text-slate-400">no surprises</span>
          </h2>
          <p className="text-lg sm:text-xl text-slate-600 leading-relaxed max-w-2xl mx-auto mb-8">
            Choose the plan that fits your needs. Upgrade anytime.
          </p>

          {/* Billing toggle */}
          <div className="inline-flex items-center gap-4 p-1 bg-white rounded-full border border-sky-200 shadow-sm">
            <button
              onClick={() => setIsYearly(false)}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                !isYearly
                  ? "bg-sky-500 text-white shadow-md"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsYearly(true)}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                isYearly
                  ? "bg-sky-500 text-white shadow-md"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Yearly
              <span className="text-xs px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full">
                Save 17%
              </span>
            </button>
          </div>
        </motion.div>

        {hasFailed && (
          <div className="text-center">
            <p className="text-slate-600 mb-4">
              We could not load our plans just now.
            </p>
            <button
              onClick={() => void loadPricing()}
              className="pressable rounded-xl bg-sky-600 px-6 py-3 font-semibold text-white hover:bg-sky-700"
            >
              Try again
            </button>
          </div>
        )}

        {!hasFailed && !pricing && (
          <div
            className="grid md:grid-cols-3 gap-6 lg:gap-8"
            role="status"
            aria-label="Loading pricing"
          >
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-[32rem] animate-pulse rounded-3xl border border-sky-100 bg-white/60"
              />
            ))}
          </div>
        )}

        {/* Pricing cards */}
        {pricing && (
          <div
            className={`grid gap-6 lg:gap-8 ${
              cardCount >= 3 ? "md:grid-cols-3" : "md:grid-cols-2"
            }`}
          >
            {pricing.plans.map((plan, i) => {
              const Icon = PLAN_ICONS[plan.id] ?? FALLBACK_ICON;
              const price = isYearly ? plan.yearlyPrice : plan.monthlyPrice;
              // toFixed(2) is load-bearing, not cosmetic. The prices are
              // binary-inexact decimals, so (9 - 7.47) * 12 evaluates to
              // 18.359999999999996 and was rendering to customers verbatim.
              const saving = (
                (plan.monthlyPrice - plan.yearlyPrice) *
                12
              ).toFixed(2);

              return (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 40 }}
                  animate={isInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.6, delay: 0.1 * i }}
                  className={`relative bg-white rounded-3xl p-8 ${
                    plan.highlight
                      ? "ring-2 ring-sky-500 shadow-xl shadow-sky-500/10"
                      : "border border-sky-100"
                  }`}
                >
                  {plan.badge && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-teal-700 px-4 py-1.5 text-sm font-semibold text-white">
                        {plan.badge}
                      </span>
                    </div>
                  )}

                  <div className="mb-8">
                    <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center mb-4">
                      <Icon className="w-6 h-6 text-sky-500" />
                    </div>
                    <h3 className="text-2xl font-semibold text-slate-900 mb-2">
                      {plan.name}
                    </h3>
                    <p className="text-slate-500 text-sm">{plan.description}</p>
                  </div>

                  <div className="mb-8">
                    <div className="flex items-baseline gap-1">
                      <span className="text-5xl font-bold text-slate-900">
                        ${price}
                      </span>
                      <span className="text-slate-500">/month</span>
                    </div>
                    {isYearly && plan.monthlyPrice > 0 && (
                      <p className="text-sm text-teal-700 mt-1">
                        ${saving} saved yearly
                      </p>
                    )}
                  </div>

                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <Check className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
                        <span className="text-slate-600 text-sm">
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/signup"
                    className={`block w-full py-3 px-6 rounded-xl font-semibold text-center transition-all ${
                      plan.highlight
                        ? "pressable bg-sky-600 text-white hover:bg-sky-700"
                        : "bg-sky-50 text-sky-700 hover:bg-sky-100"
                    }`}
                  >
                    {plan.cta}
                  </Link>
                </motion.div>
              );
            })}

            {lifetime && (
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{
                  duration: 0.6,
                  delay: 0.1 * pricing.plans.length,
                }}
                className="relative bg-white rounded-3xl p-8 border border-sky-100"
              >
                <div className="mb-8">
                  <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center mb-4">
                    <InfinityIcon className="w-6 h-6 text-sky-500" />
                  </div>
                  <h3 className="text-2xl font-semibold text-slate-900 mb-2">
                    {lifetime.name}
                  </h3>
                  <p className="text-slate-500 text-sm">
                    {lifetime.description}
                  </p>
                </div>

                <div className="mb-8">
                  <div className="flex items-baseline gap-1">
                    <span className="text-5xl font-bold text-slate-900">
                      ${lifetime.price}
                    </span>
                    <span className="text-slate-500">once</span>
                  </div>
                  <p className="text-sm text-teal-700 mt-1">No renewal, ever</p>
                </div>

                <ul className="space-y-3 mb-8">
                  {lifetime.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
                      <span className="text-slate-600 text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/*
                  Straight to the page that can actually take the $199, not to
                  /signup. Middleware bounces an unauthenticated visitor from
                  /dashboard/billing to /login?redirectedFrom=/dashboard/billing
                  — where they can sign up as well as sign in, and land back on
                  the offer — while an already-signed-in visitor arrives at it
                  directly. /signup is a dead end for the latter: middleware
                  redirects a logged-in session off the auth routes to
                  /dashboard, which is nowhere near this purchase.
                */}
                <Link
                  href="/dashboard/billing"
                  className="block w-full py-3 px-6 rounded-xl font-semibold text-center transition-all bg-sky-50 text-sky-700 hover:bg-sky-100"
                >
                  Buy once
                </Link>
              </motion.div>
            )}
          </div>
        )}

        {/* Trust indicators */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-16 text-center"
        >
          <div className="flex flex-wrap justify-center items-center gap-6 text-sm text-slate-500">
            {TRUST_POINTS.map((point) => (
              <span key={point} className="flex items-center gap-2">
                <Check className="w-4 h-4 text-teal-600" />
                {point}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
