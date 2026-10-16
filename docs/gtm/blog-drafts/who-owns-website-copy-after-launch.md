---
status: draft
publication: not-approved
title: "Who owns website copy after launch?"
slug: who-owns-website-copy-after-launch
excerpt: "A practical handoff checklist for deciding who can change, approve, publish and maintain a website after the build is done."
category: freelancing
audience: freelance web designers and small studios
---

# Who owns website copy after launch?

> **DRAFT — repository only.** This article has not been inserted into `blog_posts`, approved for
> publication or published. Review product claims, links, title, slug and formatting before using
> the human publish workflow.

The website is live. The invoice is paid. Then, three days later, a message arrives:

> Can you change one sentence on the homepage?

The request is small. The uncertainty behind it is not.

Who decides what the sentence should say? Who is allowed to edit it? Who checks the change? Who
presses Publish? Who fixes it if the new line breaks the layout? If nobody answered those questions
during handoff, the person who built the site often becomes the default owner of every future word.

That arrangement is rarely chosen. It simply happens.

A useful website handoff should separate four operational jobs: deciding, editing, publishing and
maintaining. Once those are explicit, a client can handle routine copy changes without inheriting
the codebase, and a designer can protect the parts of the site that still need design or development
judgment. Here, “ownership” means responsibility for those jobs after launch.

## 1. Separate ownership from access

People often ask “Who owns the copy?” when they are really asking several different questions.

| Question | What it controls | A clear handoff answer sounds like |
| --- | --- | --- |
| Who decides the message? | Positioning, offers, claims and tone | “The client’s marketing lead approves public wording.” |
| Who can edit the website? | Access to the tool used to change content | “These two named people can edit approved areas.” |
| Who can publish? | What becomes visible to visitors | “Editors prepare changes; the owner publishes them.” |
| Who maintains accuracy? | Prices, hours, staff, policies and old offers | “The operations lead reviews these pages each quarter.” |

One person may hold several roles. The point is to name the roles instead of relying on “the client”
or “the developer” as if each were one person with one responsibility.

## 2. Define routine copy before the first request arrives

Not every text change has the same risk.

A useful handoff draws a line between **routine content changes** and **structural changes**.

Routine changes might include:

- opening hours;
- staff names and biographies;
- service descriptions;
- a promotion end date;
- a price that already fits the designed price component;
- image alt text;
- replacing an approved image inside an existing frame.

Structural changes might include:

- adding a new page or section;
- changing navigation;
- rewriting a conversion flow;
- adding a form or integration;
- changing a claim that needs legal or compliance review;
- inserting enough copy to change the layout;
- altering code, analytics, permissions or the data model.

This distinction protects both sides. The client does not need to open a support request for a typo,
and the designer is not expected to treat a new landing page as a five-minute text edit.

Write the boundary down with examples from the actual site. “Minor edits included” is too vague to
help when a request arrives.

## 3. Make a page-by-page content inventory

Before transferring access, list the content that is likely to change. You do not need a complex
spreadsheet. A simple table is enough.

| Page or area | Likely changes | Content owner | Editor | Publisher | Review trigger |
| --- | --- | --- | --- | --- | --- |
| Homepage hero | Offer, headline, seasonal message | Marketing lead | Marketing editor | Founder | New campaign |
| Services | Names, descriptions, prices | Operations lead | Operations editor | Founder | Price or service change |
| Team | Names, roles, portraits | Office manager | Office manager | Marketing lead | Staff change |
| Contact | Hours, phone, address | Operations lead | Operations editor | Operations lead | Any business-detail change |
| Legal pages | Policy wording | Business owner | Approved specialist | Business owner | Legal review |

The value of the inventory is not the document itself. It exposes missing ownership. If a row has no
publisher, no review trigger or no named source of truth, the site will eventually drift.

## 4. Hand over the right level of access

“Full access” is easy to grant and hard to reason about. Give each person the smallest level that
matches their job.

A practical role split is:

- **Owner:** controls billing, domains, recovery and who else gets access.
- **Publisher:** approves and makes reviewed changes public.
- **Editor:** prepares routine content changes in approved areas.
- **Developer or designer:** handles structure, layout, code and integrations.

Also record where recovery lives. The owner should know which email address controls the domain,
hosting, analytics, forms, repository and content tool. Shared credentials in a chat thread are not
a handoff. Use individual accounts where the system supports them, turn on multi-factor
authentication, and keep recovery information with the business owner.

For a static or custom site, a full CMS may be more machinery than the handoff needs. ReCopyFast is
one option for letting an approved editor change visible text, images and alt text in place after the
script is installed. It does not transfer ownership of the domain, hosting or source code, and it
does not turn structural development work into a copy edit. Those boundaries still belong in the
handoff.

## 5. Agree on the publishing path

The safest workflow is easy to explain in one sentence:

> Edit, review, publish, verify.

Define each step:

1. **Edit:** The editor changes only the agreed content.
2. **Review:** The content owner checks facts, spelling, links and the meaning of the change.
3. **Publish:** The authorised publisher makes it public.
4. **Verify:** Someone opens the public page on a small and large screen and checks the result.

For low-risk details, one person may edit and publish. For prices, regulated claims, legal wording or
major campaign copy, keep review separate. The workflow should match the cost of a mistake.

Decide how to reverse a bad change before you need to. That might mean version history, a staging
state, a source-control revert or a written copy of the previous text. “We can probably recreate it”
is not a rollback plan.

## 6. Include the rules that keep the design intact

Copy affects layout. A handoff should give editors practical limits without asking them to become
designers.

Useful rules include:

- the intended length of headlines, buttons and navigation labels;
- words or claims that require approval;
- where links may point;
- image dimensions and cropping expectations;
- alt-text guidance;
- whether a field accepts plain text or rich text;
- what to do when the desired copy does not fit.

The last rule matters most: when content no longer fits the designed container, stop and ask for a
layout decision. Shrinking the font until the sentence fits usually hides the real problem.

## 7. Run a real handoff exercise

Do not finish with a tour of the interface. Ask the future editor to complete one ordinary change
while the builder watches.

Use a harmless example:

1. change a sentence;
2. preview or review it;
3. publish it through the agreed path;
4. verify the public page on phone and desktop widths;
5. restore the original sentence;
6. confirm that the owner can remove the editor’s access.

This exercise reveals unclear permissions, missing recovery details and assumptions hidden by a
screen-share demonstration. It also gives the client a repeatable first task after the project team
steps away.

## Copyable website handoff checklist

Use this list before calling a website complete:

- [ ] Every important page has a named content owner.
- [ ] Editors and publishers are named separately where the risk requires it.
- [ ] Routine content changes are listed with real examples.
- [ ] Structural changes and out-of-scope work are listed with real examples.
- [ ] Domain, hosting, repository, analytics, form and content-tool ownership is recorded.
- [ ] Every person has individual access at the smallest useful permission level.
- [ ] Recovery email, multi-factor authentication and offboarding are covered.
- [ ] Editors have length, link, image, alt-text and approval rules.
- [ ] The edit → review → publish → verify path is written down.
- [ ] A rollback method exists and has been explained.
- [ ] The client completed one real change and restored it.
- [ ] The owner proved they can revoke access.
- [ ] A date or trigger is set for checking stale prices, hours, staff and offers.

## The handoff is a product decision

Website ownership after launch is not solved by sending a folder of files or sharing an admin
password. It is solved by deciding who controls each kind of change, giving them the right access,
and preserving a clear path back when something goes wrong.

The best handoff gives the client enough control to keep facts current and gives the designer enough
boundary to protect the system they built. Routine wording stops becoming an interruption. Real
design and development work remains visible as real work.
