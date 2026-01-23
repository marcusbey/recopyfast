"use client";

import { motion, useInView } from "framer-motion";
import { useRef, useState } from "react";
import { Check, Sparkles, Building2, Rocket } from "lucide-react";
import Link from "next/link";

const plans = [
  {
    name: "Starter",
    description: "For personal projects and small sites",
    price: { monthly: 0, yearly: 0 },
    icon: Sparkles,
    features: [
      "1 website",
      "Up to 10,000 views/month",
      "Click-to-edit interface",
      "Basic version history",
      "Community support",
    ],
    cta: "Start for free",
    highlight: false,
  },
  {
    name: "Pro",
    description: "For teams that ship fast",
    price: { monthly: 29, yearly: 23 },
    icon: Rocket,
    features: [
      "5 websites",
      "Unlimited page views",
      "AI content suggestions",
      "Multi-language support",
      "Team collaboration (3 users)",
      "Full version history",
      "Priority support",
      "Custom domains",
    ],
    cta: "Start free trial",
    highlight: true,
    badge: "Most popular",
  },
  {
    name: "Enterprise",
    description: "For agencies and large teams",
    price: { monthly: 99, yearly: 79 },
    icon: Building2,
    features: [
      "Unlimited websites",
      "Unlimited team members",
      "SSO & advanced security",
      "Audit logs & compliance",
      "Dedicated account manager",
      "Custom integrations",
      "SLA guarantee",
      "White-label options",
    ],
    cta: "Contact sales",
    highlight: false,
  },
];

export default function Pricing() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [isYearly, setIsYearly] = useState(false);

  return (
    <section
      id="pricing"
      ref={ref}
      className="py-32 px-6 bg-transparent relative overflow-hidden"
    >
      {/* Subtle background */}
      <div className="absolute inset-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-sky-100 rounded-full blur-3xl opacity-30" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-100 rounded-full blur-3xl opacity-30" />
      </div>

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <span className="inline-block px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-sky-600 bg-sky-50 rounded-full mb-6">
            Pricing
          </span>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold text-slate-900 tracking-tight mb-6">
            Simple pricing,
            <br />
            <span className="text-slate-400">no surprises</span>
          </h2>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto mb-8">
            Start free. Upgrade when you need more power.
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
              <span className="text-xs px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">
                Save 20%
              </span>
            </button>
          </div>
        </motion.div>

        {/* Pricing cards */}
        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 40 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.1 * i }}
              className={`relative bg-white rounded-3xl p-8 ${
                plan.highlight
                  ? "ring-2 ring-sky-500 shadow-xl shadow-sky-500/10"
                  : "border border-sky-100"
              }`}
            >
              {/* Badge */}
              {plan.badge && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="px-4 py-1.5 bg-gradient-to-r from-sky-500 to-emerald-500 text-white text-sm font-semibold rounded-full shadow-lg">
                    {plan.badge}
                  </span>
                </div>
              )}

              {/* Header */}
              <div className="mb-8">
                <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center mb-4">
                  <plan.icon className="w-6 h-6 text-sky-500" />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 mb-2">
                  {plan.name}
                </h3>
                <p className="text-slate-500 text-sm">{plan.description}</p>
              </div>

              {/* Price */}
              <div className="mb-8">
                <div className="flex items-baseline gap-1">
                  <span className="text-5xl font-bold text-slate-900">
                    ${isYearly ? plan.price.yearly : plan.price.monthly}
                  </span>
                  <span className="text-slate-500">/month</span>
                </div>
                {isYearly && plan.price.monthly > 0 && (
                  <p className="text-sm text-emerald-600 mt-1">
                    ${(plan.price.monthly - plan.price.yearly) * 12} saved
                    yearly
                  </p>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-3 mb-8">
                {plan.features.map((feature, j) => (
                  <li key={j} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span className="text-slate-600 text-sm">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Link
                href={plan.name === "Enterprise" ? "/contact" : "/signup"}
                className={`block w-full py-3 px-6 rounded-xl font-semibold text-center transition-all ${
                  plan.highlight
                    ? "bg-gradient-to-r from-sky-500 to-emerald-500 text-white hover:shadow-lg hover:shadow-sky-500/25"
                    : "bg-sky-50 text-sky-700 hover:bg-sky-100"
                }`}
              >
                {plan.cta}
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Trust indicators */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-16 text-center"
        >
          <div className="flex flex-wrap justify-center items-center gap-6 text-sm text-slate-500">
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500" />
              14-day free trial
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500" />
              No credit card required
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500" />
              Cancel anytime
            </span>
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-500" />
              30-day money-back guarantee
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
