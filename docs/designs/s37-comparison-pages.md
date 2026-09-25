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
server-side with no interaction dependency. The only state is static published content.
Unknown routes use the inherited 404. No new design-system gap is introduced.

The operator already specified the screen sections and existing marketing patterns;
this compact design record is the implementation reference (no new visual direction).
