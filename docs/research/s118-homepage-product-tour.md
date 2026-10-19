# s118 — verified research

October 19, 2026; isolated from origin/main b848ce7. Current chat checkout main was stale.
Live homepage https://www.recopyfa.st/ matches the user's image. Product implementation follows the subsequently approved plan.

## Hero cause and prototype evidence
`src/components/landing/editorial-homepage.module.css`: `.heroLine` uses overflow-x:auto and
 overflow-y:hidden. `.editWord` fills that line and has 7px outline offset plus 2px outline.
Increasing inherited line-height alone also enlarges the word box. Browser-only 10px block
padding on each line provided 10px clearance for the 9px outline. Six viewport widths
320/390/768/901/1280/1440 retained three lines, no authored-copy clipping or document overflow.
This is browser prototype evidence, not implementation or deployment verification.

## Actual flow
`SiteRegistrationModal.tsx` collects name/domain and returns embedScript.
`SiteInstallationCard.tsx` shows Copy snippet, platform recipes, install status.
`src/lib/sites/install-recipes.ts`: plain HTML before closing body on every relevant page/shared
footer; Next.js after hydration with navigation checks. Initial installation needs site access;
ordinary subsequent edits reuse the snippet. Do not claim every stack has identical setup.
`EditWebsiteButton.tsx` is authenticated editor entry; public InteractiveHero is browser-local.
`changes/ChangesFilterBar.tsx` filters text/page, site, pending/published.
`changes/ChangeDetail.tsx` shows Original, Live now, Draft, dated history; author details depend
on admin permission. Revert to original stages a draft and needs publishing.
`src/app/api/content/changes/route.ts` orders changed_at descending before UI grouping.

## Evidence limits
Existing repository QA screenshots from s66c and s70 show real rendered fixture UI. They are
older, unrelated samples, suitable only for design review. No complete authenticated production
journey was run and no recording exists. Capture one coherent controlled example before release.
Current source verified the named capabilities; signup improvement remains an untested hypothesis.
Historical backlog review does not constitute review of this new story. Complexity remains 3.
