# RecopyFast: what people search, and free tools to catch it

> **Committed by s96** from the 2026-10-11 GTM research. The raw Google autocomplete output
> (`ac/*.txt`) the demand ratings cite stayed with the research and is not committed. What was
> decided from this page is in `docs/stories.md` (s96–s101) and their plans; where a
> recommendation here differs (the CTA, the limits, Turnstile), the plans win.

Researched 2026-10-11. **Demand ratings are relative.** They are based on the breadth of Google autocomplete (AC) across a–z and question expansions (raw output in `ac/*.txt` beside this file) and on how many free tools hold page 1. No search-volume source was available.

**Constraints on every recommendation:**
- A/B testing and translation are not customer features (launch kit §11).
- Edits are applied by JS, so crawlers that don't run JS see the original HTML ([llms.txt](https://www.recopyfa.st/llms.txt)). AI crawlers don't run JS ([Vercel](https://vercel.com/blog/the-rise-of-the-ai-crawler)), so "fix your GEO live" would be a false promise.
- The embed edits text, images and **alt text** (`recopyfast.src.js:5045-5310`). It does not edit `<title>` or meta tags.

## 1. Keyword map

| Query | Evidence | Demand | Owner |
|---|---|---|---|
| **A. "Change my site's text" (owners/agencies)** ||||
| how to change text on a website permanently | SERP: YouTube, Instructables, [Permanent Inspect Element](https://chromewebstore.google.com/detail/permanent-inspect-element/alfgclaljdbleenfjjnkefddlgbknllp). WordPress owners ask it on [r/code](https://www.reddit.com/r/code/comments/qg7r4w/) | Med | `/try` |
| how to edit website text · edit website text extension | AC ~35, mostly prank intent | Med, low intent | `/try` |
| how do i edit an existing html website · edit html website in cpanel | AC 48 | Med | `/cms-for/plain-html` |
| add cms to html website · cms for html website | AC thin. SERP: [r/webdev](https://www.reddit.com/r/webdev/comments/sbor5h/), ButterCMS, [Sitecake](https://sitecake.com/blog/cms-for-static-site.html) | Med | `/cms-for/plain-html` |
| let client edit static site · update hours/prices myself | Lives in threads, not AC: [r/webdev](https://www.reddit.com/r/webdev/comments/1114ag9/), [r/webdev](https://www.reddit.com/r/webdev/comments/ruqxp2/), [r/website](https://www.reddit.com/r/website/comments/1w2x1ga/), [r/cms](https://www.reddit.com/r/cms/comments/1w52py2/), [r/Wordpress](https://www.reddit.com/r/Wordpress/comments/kmhdkp/) ("only edit text"), [r/website](https://www.reddit.com/r/website/comments/1uhvxby/) ("pain starts… opening hours") | Low search, high community | `/agencies/client-content-updates` + thread replies |
| how to handover wordpress website to client · wordpress client portal | AC 32 | Med | `/cms-for/wordpress` |
| webflow editor for clients · webflow editor legacy | AC 22. Legacy Editor [retired 2026-08-04](https://webflow.com/blog/legacy-editor-deprecation); [r/webflow](https://www.reddit.com/r/webflow/comments/1vlcyi4/) | Med-High, time-bound | `/compare/webflow-editor` |
| tinacms / cloudcannon / decap cms (reddit) / storyblok free alternative | AC thin. SERPs held by aggregators ([openalternative](https://openalternative.co/alternatives/tinacms), alternativeto) | Low volume, high intent | `/compare/*` |
| **B. Copy quality** ||||
| landing page analyzer free / ai | AC 21, including "unbounce/vwo/fibr…". SERP: [Fibr](https://fibr.ai/tools/landing-page-analyzer), [Web Anatomy](https://www.webanatomy.ai/landing-page-analyzer), Leadpages, [VWO](https://vwo.com/tools/website-ux-audit/), [roast.page](https://roast.page/tools/landing-page-analyzer) | High, crowded | Tool 8 |
| website copy checker · ai website copy generator | AC yes; "website copy grader" returns nothing | Med | Tool 8 |
| 5 second test website · grunt test website | AC yes. **No automated grunt-test tool on page 1** | Med, gap | Tool 9 |
| headline analyzer free | AC 46. SERP: [OptinMonster](https://optinmonster.com/headline-analyzer/), CoSchedule, IsItWP | High, saturated | Don't build |
| meta description / title generator from url | AC yes. SERP: [SE Ranking](https://seranking.com/free-tools/ai/meta-description-generator.html), Koala | High, saturated | Don't build (embed can't edit meta) |
| website readability checker free / score | AC 18. SERP: [WebFX](https://www.webfx.com/tools/read-able/), Sitechecker, Experte | Med | Tool 6 |
| website spell checker free · check my website for spelling errors | AC 35. SERP: [Spling](https://www.spl.ing/spellcheck), [SiteSpellChecker](https://sitespellchecker.com/) (1 page free), Sapling | Med-High | Tool 1 |
| ai slop checker website · website ai detector free · ai words to avoid list | AC yes, rising. SERP: [ikigai](https://www.ikigai.je/labs/ai-slop-checker), dooza (paste-only). [r/AskMarketing](https://www.reddit.com/r/AskMarketing/comments/1q5hvhs/): "every brand sounds the same" | Med, rising | Tool 4 |
| **C. Accessibility** ||||
| alt text checker free · missing alt text webflow | AC 23 + 53 generator variants. SERP: [AltText.ai](https://alttext.ai/crawl-analyzer), Pixellize, Filikod | Med-High | Tool 2 |
| european accessibility act website test / 2026 | AC 33. [Enforcement live](https://atyantik.com/blog/european-accessibility-act-enforcement/) | Med-High (EU) | Content 2 |
| ada website compliance checker free · deadline extended | AC 46. Title II [moved to 2027/28](https://www.duanemorris.com/alerts/doj_extends_ada_title_ii_digital_accessibility_deadlines_one_year_0426.html) | High, overlay vendors | Content 2 |
| **D. AI search** ||||
| free ai search visibility checker · chatgpt visibility checker · geo score checker | AC 38+. SERP: [Semrush](https://www.semrush.com/free-tools/ai-search-visibility-checker/), [Frase](https://www.frase.io/tools), Readdy, Topify, Geoptie | High, saturated | Don't build |
| llms.txt generator / validator · does llms txt work | AC 80 | High | Content 3 |
| can chatgpt see my website · test website without javascript | AC yes. [r/TechSEO](https://www.reddit.com/r/TechSEO/comments/1lcr3vv/), [Contentsquare](https://contentsquare.com/blog/is-your-site-visible-to-ai-crawlers/) | Med | Tool 10, Content 4 |
| **E. Stale sites, agency economics, install blockers** ||||
| copyright year on website · free website content audit tool | AC 8 + 22 | Low-Med | Tool 5 |
| how much to charge for website maintenance / updates | AC 9 | Med | Tool 7 |
| csp checker · content security policy test online · what platform is my website built on | AC 30 (Google CSP Evaluator owns it) | Med | Tool 3 |
| **Parked:** translate my website (AC 124, high) · a b test headlines (AC 2) | Features not shipped | — | Later |

## 2. Ten free tools, ranked

**Score = Demand (1–3) × Fit (1–3) ÷ Effort (S=1, M=2, L=3).** Fit measures how directly the result ends in "install the script and fix it live".

**Shared pipeline (build once, M; each tool after it is S):** `POST /api/tools/scan`:
1. URL goes through the existing SSRF guard, `src/lib/security/webhook-url-safety.ts`.
2. Fetch with an 8 s timeout and a 2 MB cap.
3. Extract visible text by block.
4. Run the tool's lens.
5. Save a shareable report at `/tools/<slug>/r/<id>`, cached by normalised URL for 24 h.

Abuse control: `RedisRateLimiter` (`src/lib/security/rate-limiter.ts`), 10 scans per IP per day, Turnstile from the 3rd.

**Every result has the same CTA:** "Fix these lines on your page" opens `/try` with the fixes applied in the visitor's tab, nothing saved. "Keep them" leads to the trial.

| # | Tool, slug | Input → output · hook | Competitors → our edge | Effort / LLM | SEO / sharing | Score |
|---|---|---|---|---|---|---|
| 1 | **Website Typo Finder** `/tools/website-spell-checker` | URL (≤10 pages via sitemap) → each typo in its sentence. Hook: "This typo is live on your homepage. Fix it now" | Spling needs a sitemap; SiteSpellChecker is 1 page free, then $29; Sapling caps at 4k chars → no signup, proper-noun allowlist, the fix is on the page | S, no LLM (dictionary) | "0 typos" badge; agencies send prospects "your site has 4 typos" | **7.5** |
| 2 | **Alt Text Checker & Fixer** `/tools/alt-text-checker` | URL → missing, empty or filename alts, thumbnails, coverage %. Hook: write the alt on the live page (screen readers read the live DOM) | AltText.ai (25 pages, sells generation), Pixellize, Filikod → only one that writes the fix without a CMS | S. Optional vision suggestions: ≤5 images per scan, cached by image hash | EAA/ADA tie-in, coverage badge. **Never claim compliance** | **6.25** |
| 3 | **Will a script run on my site?** `/tools/csp-checker` | URL → platform detected, CSP verdict for a third-party script, the exact header line, the install recipe for that stack. Hook: the install itself; answers launch-kit objection 5 | Google CSP Evaluator (dev jargon, no verdict); BuiltWith (no next step) → plain-English yes/no plus fix | S, no LLM | Feeds `/cms-for/<stack>`; dev-forum links | **6** |
| 4 | **Does your homepage sound like AI?** `/tools/ai-slop-checker` | URL → AI-cliché phrases highlighted ("seamless", "elevate", "in today's fast-paced…") plus a density score. Hook: rewrite them live (AI rewrite ships) | ikigai, dooza (paste only), Pangram/QuillBot ("83% AI" false positives) → deterministic, explainable, on your page | S, no LLM to score | Shareable score card (LinkedIn/X) | **6** |
| 5 | **Is your website out of date?** `/tools/outdated-website-checker` | URL → stale © year, past dates, expired seasonal promos, dated prices. Hook: the PRD's core pain (hours, prices, promos) | Content-audit tools are spreadsheets → one click, built for local businesses | S, no LLM (date rules). Later (M): compare against Google Business Profile hours | **Agency prospecting:** "your client's site says © 2022" | **4.5** |
| 6 | **Website Readability Checker** `/tools/website-readability-checker` | URL → score per section, 5 hardest sentences. Hook: the "clearer" AI preset on that sentence | WebFX, Sitechecker score the whole page → per section, fix in place | S, no LLM (Flesch) | Report URL | **4** |
| 7 | **Free-copy-change cost calculator** `/tools/website-maintenance-cost` | Client sites, edits per month, minutes, hourly rate → unbilled €/yr. Hook: the launch wedge, "stop doing free copy changes" | Pricing blog posts only, no calculator | S, no LLM | Embeddable widget; r/web_design, r/freelance | **4** |
| 8 | **Landing Page Copy Review** `/tools/landing-page-copy-review` | URL → per-section critique, 2 rewrites per weak line. Hook: "apply" in `/try`, then keep | Fibr, Web Anatomy, VWO, roast.page (PDF-style reports) → rewrites seen on your own page | M. One LLM call: input ≤3k tokens, output ~600; 3 per IP per day | OG report card | **3.75** |
| 9 | **Homepage Grunt Test** `/tools/homepage-clarity-test` | URL → does the first screen answer what / why care / next step? Plus 3 rewritten lines. Hook: rewrite the hero live | Only explainers rank ([example](https://marketingtoolshq.com/2025/11/03/the-grunt-test-can-visitors-understand-your-website-in-5-seconds/)) | M. LLM on first-screen text only (<800 tokens) | Pass badge | **3** |
| 10 | **What AI crawlers read** `/tools/what-ai-crawlers-see` | URL → raw-HTML text vs rendered text, with the lines AI misses highlighted. Hook is weak: our edits are JS too, so the honest advice is "keep this copy in source" | Devs Core, Contentsquare → line-level diff | S, no LLM | Earns links; LLM-citable | **2** |

Not built: headline analyzer, meta generator and GEO score (saturated, no live fix); translation preview (not shipped).

## 3. Five hot-topic pieces to publish now

1. **"Webflow's legacy Editor is gone: how clients edit now, and a no-account option"**
   - **Targets:** "webflow editor legacy", "webflow editor for clients"
   - **Angle:** the `?edit` overlay and white-labeling were retired 2026-08-04, and clients now need an account and a seat. Admit where free client seats win, and link `/compare/webflow-editor`.
   - **Why now:** the cutoff was nine weeks ago ([Webflow](https://webflow.com/blog/legacy-editor-deprecation), [r/webflow](https://www.reddit.com/r/webflow/comments/1vlcyi4/), [agency guide](https://www.paddlecreative.co.uk/blog/webflow-edit-mode-client-seats-guide)).
2. **"Accessibility deadlines in 2026: EAA enforcement and the ADA Title II delay, for agencies with small-business clients"**
   - **Targets:** "european accessibility act website test", "ada website compliance deadline extended"
   - **Angle:**
     - The microenterprise exemption (<10 staff and ≤€2M).
     - Alt and link text are copy you can fix in an afternoon.
     - Overlays lose in court.
     - CTA: Tool 2.
   - **Why now:**
     - EAA enforcement and first French court orders ([atyantik](https://atyantik.com/blog/european-accessibility-act-enforcement/), [Level Access](https://www.levelaccess.com/compliance-overview/european-accessibility-act-eaa/)).
     - DOJ interim rule of 2026-04-20 moved Title II, but private suits continue ([Duane Morris](https://www.duanemorris.com/alerts/doj_extends_ada_title_ii_digital_accessibility_deadlines_one_year_0426.html)).
     - Check each fine and ruling at its primary source before publishing.
3. **"Does llms.txt work? What Google said on June 15, 2026, and why we ship one anyway"**
   - **Targets:** "does llms txt work", "llms.txt generator"
   - **Angle:** first-hand and honest. Search ignores it; agents and coding assistants read it. Show our file.
   - **Why now:**
     - Google's clarification plus Lighthouse 13.3's new audit ([Digital Applied](https://www.digitalapplied.com/blog/google-llms-txt-no-seo-value-lighthouse-audit-2026)).
     - Ahrefs found 97% of 137k files got zero traffic ([WebYes](https://www.webyes.com/blogs/does-llms-txt-improve-rankings/)).
4. **"ChatGPT can't see half your website: the JavaScript problem, tested"**
   - **Targets:** "can chatgpt see my website", "why can't chatgpt read my website"
   - **Angle:** state our own caveat openly; candour is what LLMs cite. CTA: Tool 10.
   - **Why now:** [Vercel](https://vercel.com/blog/the-rise-of-the-ai-crawler); a 2025 retest found only Gemini renders JS ([recap](https://desses.co/insights/ai-crawlers-javascript-2026)).
5. **"The 40 AI phrases that make every small-business homepage sound the same"**
   - **Targets:** "ai words to avoid list", "ai slop checker website"
   - **Angle:** real homepage lines with human rewrites. CTA: Tool 4.
   - **Why now:** AC shows "ai slop word of the year 2025"; [r/AskMarketing](https://www.reddit.com/r/AskMarketing/comments/1q5hvhs/), [r/marketing](https://www.reddit.com/r/marketing/comments/1ay6j1w/).

## 4. Pages already on the site to re-point

The live sitemap has 12 URLs and no blog posts.

- **`/try`:** re-point at cluster A ("Inspect-element edits vanish on refresh. This one can be kept.") and make it every tool's CTA target (`?fixes=<reportId>`).
- **`/compare/webflow-editor`:** already explains the retirement (`src/lib/compare/comparisons.ts:63`). Retitle it toward "Webflow Editor alternative for clients" and link Content 1 to it.
- **`/compare` hub:** add Decap CMS (AC: "decap cms alternative reddit") and Sitecake (ranks for "CMS for static HTML").
- **`/docs/install`:** until `/cms-for/*` exists, add per-stack H2s (plain HTML/cPanel, WordPress, Webflow) to catch cluster A. Tool 3 links here.
- **`/blog`:** it is in the sitemap (daily, 0.7) but has no posts, so it is a thin page. Publish the 5 pieces, or drop it from the sitemap until the first one is live.
- **`/llms.txt`:** add the tools once they ship.
- **Homepage:** link the "stop doing free copy changes" line to Tool 7.
