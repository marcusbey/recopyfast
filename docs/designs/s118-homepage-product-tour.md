# s118 — proposed walkthrough and recording script

Draft. Source: existing editorial CSS and docs/design/editorial-website-guide.md. Cream #f7f3e9,
ink #142024, teal #287f7c, Georgia headings, sans controls; actual dashboard retains app styling.
Review: `.lavish/homepage-product-tour.html`.

Hero: preserve type scale/line-height; add 10px block padding and include it in min-height.
Secondary CTA: “See how it works”. Immediately below, six selectable chapters around a large
real UI capture. Heading: “From one script to your next update.” Existing hands-on editor follows
with its browser-local disclosure. Mobile stacks controls/capture; offer full-screen image view.

## Suggested 1:50 recording: one restaurant, one opening-hours change
1. 0:00–0:15 Add website → generated snippet. “Add the website you already have. ReCopyFast
   prepares its install snippet.” Show name/domain and copy action.
2. 0:15–0:35 Install once. Show Plain HTML/shared footer insertion, load site, detected status.
   “Your developer can do this initial setup. Add it to the pages you want to edit.”
3. 0:35–0:55 Edit opening hours → save draft. “When the hours change, open the page and edit
   the words in place.” Use actual authenticated editor, not public demo as publish proof.
4. 0:55–1:15 Publish → reload as visitor. “Publish when ready. Ordinary copy updates reuse
   the installed script.” Benefit: accurate hours without another code change.
5. 1:15–1:30 Changes → same site/page → pending/published. “See what is waiting and what is live.”
6. 1:30–1:50 Expand same row → original/live/draft and dated history. “Compare exactly what
   changed. Site admins can see who changed it.” Optional restore must show draft then publish.

Benefits: fewer routine handoffs, current information, deliberate publishing, traceability.
No invented revenue, conversion uplift or measured savings. Fresh captures must share the same
site/change; review images are historical QA references, not final release assets.

## States
No autoplay or auto-advance. Native buttons, selected state, focus, captions/alt text and
previous/next controls. Reserve image dimensions; lazy-load later frames. Failed image leaves
caption/navigation usable. Screenshot tour ships complete without recording. Later video uses
native controls, preload=none, poster, captions/transcript, chapter seeking and screenshot fallback.
No empty play button. Clean recording browser, sample identities, redact credentials/editor URLs.
