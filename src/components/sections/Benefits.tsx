"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import {
  MousePointerClick,
  Globe2,
  UserPlus,
  Wand2,
  History,
  Shield,
  ImagePlus,
  Upload,
} from "lucide-react";

/**
 * Until s50 the two cards were Translate and Test, and this comment claimed
 * both had shipped. Neither had a customer surface: the A/B page sits in the
 * unrouted `src/app/dashboard/_ab-tests` folder and its lifecycle cron is not in
 * vercel.json; the only translation UI is imported by tests alone, and visitors
 * are always served `en`. A visitor could buy on the strength of either and
 * find nothing behind it.
 *
 * Each card now points at the code behind it: Invite at the invite form and
 * the editor's one-time sign-in code, Rewrite at `POST /api/ai/suggest`. A/B
 * testing and translation stay off this page until a customer can reach them.
 *
 * The Invite card first said "Publish stays off unless you grant it, so their
 * edits wait as drafts for you", on the strength of `InviteEditorForm`'s View
 * and Edit default. The dashboard's own "Invite a client" dialog
 * (ActivationChecklist) pre-selects Publish, so on the first-run path the
 * client published directly (s50 review). What holds on every path is that
 * Publish is a per-editor permission, so the card says that and no more.
 */
const headline = [
  {
    icon: UserPlus,
    eyebrow: "Invite",
    title: "Hand a client the words, not the site",
    description:
      "Invite someone by email. They sign in with a one-time code, no account and no password, and change the words on the page, never the layout or the code. You choose, per editor, who can publish.",
  },
  {
    icon: Wand2,
    eyebrow: "Rewrite",
    title: "AI rewrites, in place",
    description:
      "Select any text and ask for a clearer, shorter, more professional or more casual version. Keep it, edit it, or keep yours.",
  },
];

const supporting = [
  {
    icon: MousePointerClick,
    title: "Click. Edit. Done.",
    // "Click any text on your live site" skipped the one precondition that
    // matters: the widget only enters edit mode behind an edit-session link
    // (`rcf_edit_token`), which the dashboard mints. A visitor to the live URL
    // gets a normal page, which is the whole point of the design.
    description:
      "Open your site from the dashboard and edit in place. No CMS screens to learn.",
  },
  {
    icon: ImagePlus,
    title: "Swap images too",
    description:
      "Replace a photo by pasting a link or uploading a file, right on the page.",
  },
  {
    icon: Upload,
    title: "Draft, then publish",
    description:
      "Edits stay a draft until someone with Publish access sets them live. Visitors only ever see published copy.",
  },
  {
    icon: Globe2,
    title: "Two small script placements",
    description:
      "On the site you already built: React, Vue, WordPress, Webflow or plain HTML. Its Content Security Policy has to allow our script.",
  },
  {
    icon: History,
    title: "Save and restore",
    description:
      "Save a version of the site's copy before a big change, and restore it in one click.",
  },
  {
    icon: Shield,
    title: "Secure by default",
    description:
      "Per-site tokens, per-site API keys, and per-editor permissions.",
  },
];

export default function Benefits() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      ref={ref}
      // Header.tsx (twice) and Footer.tsx link to "#features", but no element
      // in the app carried that id — all three "Features" links were dead.
      // This is the features section, so it takes the anchor, matching how
      // Pricing.tsx:66 already carries id="pricing".
      id="features"
      className="solid-sheet relative overflow-hidden border-y border-slate-200/80 py-24 sm:py-32 px-6"
    >
      <div className="relative z-10 mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="mb-16 text-center"
        >
          <span className="mb-6 inline-block text-sm font-semibold uppercase tracking-[0.075em] text-sky-700">
            Features
          </span>
          <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 mb-6">
            Changing the words should be the easy part
          </h2>
          <p className="text-lg sm:text-xl text-slate-600 leading-relaxed max-w-2xl mx-auto">
            With ReCopyFast it is: the people who own the copy change it on the
            live page, and you decide who can publish.
          </p>
        </motion.div>

        {/* The two differentiated capabilities, at twice the size of everything
            else. Deliberately unequal weighting — six identical cards told a
            visitor that all six mattered the same, which was never true. */}
        <div className="mb-20 grid gap-6 md:grid-cols-2">
          {headline.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 32 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.1 + i * 0.1 }}
              className="surface-interactive rounded-3xl border border-white/60 bg-white/70 p-9"
            >
              <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-600">
                <item.icon className="h-6 w-6 text-white" />
              </div>
              <span className="text-sm font-semibold uppercase tracking-[0.075em] text-sky-700">
                {item.eyebrow}
              </span>
              <h3 className="mt-3 text-2xl font-semibold leading-snug text-slate-900">
                {item.title}
              </h3>
              <p className="mt-4 leading-relaxed text-slate-700">
                {item.description}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Everything else, compressed. These are table stakes — real, worth
            listing, not worth a card each. */}
        <div className="grid gap-x-10 gap-y-9 border-t border-slate-900/10 pt-14 sm:grid-cols-2 lg:grid-cols-3">
          {supporting.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.06 }}
              className="flex gap-4"
            >
              <item.icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-sky-700" />
              <div>
                <h3 className="font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                  {item.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
