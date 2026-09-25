# Design — s37-comparison-pages

Marketing surface per ADR 020 and existing `/try`: pinned light (`data-theme="light"`),
white/slate-50 backgrounds, sky links, slate body copy, Bricolage display headings.
Reuse Header and Footer. No new animation, images, logos, testimonials or metrics.

Index: eyebrow, h1, short orientation, four linked cards describing different jobs,
then signup/try links. Detail: breadcrumb, h1 and short answer first; dated source
notice; semantic table with row/column headers in a labeled scroll region; two
best-fit sections; integration limitations; visible FAQ; official source links;
signup/try CTAs; related comparisons. Generous vertical spacing, readable prose width.

Use native semantic elements and existing Link/button styling patterns. Grid children
use min-width:0; tables remain contained on narrow screens. All content is available
server-side with no interaction dependency. Competitor content is dated editorial
material; ReCopyFast pricing and offer availability must read the live catalogue
and Agency switch.
Unknown routes use the inherited 404. The Marketing exception is extended to
`/compare` and `/compare/*` in ADR 020 and the design system. These replace the planned `/alternatives/*` cluster.

The operator already specified the screen sections and existing marketing patterns;
this compact design record is the implementation reference (no new visual direction).

Fix-mode requirements: show the competitors' served-HTML publishing advantage in
each table and competitor-choice section, including no-JavaScript/crawler behavior
and the recommendation to update SEO-critical copy in the site source. Use an
absolute title, BreadcrumbList with the visible current-page breadcrumb, and
source-specific signup UTM tags. Keep the existing layout and mobile table behavior.
