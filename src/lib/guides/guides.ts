import {
  defineGuideRegistry,
  getGuideFromRegistry,
  guidePath,
  type Guide,
  type GuideSource,
} from "./guide-registry";

/**
 * The owner guides (s123). Copy rules, read before changing a sentence:
 *
 * - Answer first. Each guide is meant to help an owner who never buys:
 *   platform steps come before ReCopyFast, and where the built-in editor is
 *   enough (Squarespace, Wix, Shopify), the guide says so.
 * - External facts come only from the sources listed on the same guide, and
 *   the validator enforces it for inline links. The sources are the research
 *   brief's (.omc/gtm/research/site-owner-angle-2026-10-22.md) plus the
 *   vendor help pages checked on 2026-10-25 (docs/research/s123-owner-seo-guides.md).
 *   Platform UI is described at the level those pages state it; anything the
 *   vendor varies by theme or editor version is said to vary.
 * - Money: "$50–150" (freelance hourly / per change) and "$100–250 a month"
 *   (care plans with 1–2 hours of edits) are the brief's cited typical ranges,
 *   labelled as typical ranges. "$75" appears only as an example inside the
 *   range, in arithmetic the reader can redo. No ReCopyFast price is typed
 *   here (AGENTS.md non-negotiable 7): the guides link to /#pricing.
 * - ReCopyFast claims are the /for/owners claims (s120): one line added once,
 *   words and existing photos only, applied after the page loads, no SEO
 *   promise, no warning yet when a redesign stops an edit showing (PR #119),
 *   drafts-for-approval only when the developer holds a Pro account.
 */

const SOURCES = {
  gbpSpecialHours: {
    label: "Google Business Profile Help: set special hours",
    href: "https://support.google.com/business/answer/6303076?hl=en",
  },
  gbpMenu: {
    label: "Google Business Profile Help: about the menu editor",
    href: "https://support.google.com/business/answer/9455840?hl=en",
  },
  gbpServices: {
    label: "Google Business Profile Help: manage your services",
    href: "https://support.google.com/business/answer/9455399?hl=en",
  },
  squarespaceText: {
    label: "Squarespace Help: text blocks",
    href: "https://support.squarespace.com/hc/en-us/articles/205813798-Text-blocks",
  },
  wixText: {
    label: "Wix Help: adding and customizing text",
    href: "https://support.wix.com/en/article/wix-harmony-editor-adding-and-customizing-text",
  },
  shopifyProducts: {
    label: "Shopify Help: adding and updating products",
    href: "https://help.shopify.com/en/manual/products/add-update-products",
  },
  shopifySale: {
    label: "Shopify Help: sale pricing",
    href: "https://help.shopify.com/en/manual/products/details/product-pricing/sale-pricing",
  },
  shopifySections: {
    label: "Shopify Help: sections and blocks",
    href: "https://help.shopify.com/en/manual/online-store/themes/theme-structure/sections-and-blocks",
  },
  wordpressRevisions: {
    label: "WordPress documentation: revisions",
    href: "https://wordpress.org/documentation/article/revisions/",
  },
  webflowContentEditor: {
    label: "Webflow Help: edit site content as a content editor",
    href: "https://help.webflow.com/hc/en-us/articles/33961251014931-Edit-site-content-as-a-content-editor",
  },
  webflowLegacyEditor: {
    label: "Webflow Help: legacy Editor deprecation FAQ",
    href: "https://help.webflow.com/hc/en-us/articles/48412420902675-Legacy-Editor-deprecation-FAQ",
  },
  elementorSwitching: {
    label: "Elementor Help: my changes do not appear online",
    href: "https://elementor.com/help/changes-dont-appear-online/",
  },
  maintenanceCost: {
    label: "WebsiteMaintenance.com: how much does website maintenance cost",
    href: "https://websitemaintenance.com/articles/how-much-does-website-maintenance-cost",
  },
  fatlabPackages: {
    label: "FatLab: website maintenance packages compared",
    href: "https://fatlabwebsupport.com/blog/website-maintenance/website-maintenance-packages-compared-your-complete-buyers-guide/",
  },
  fiverrEditing: {
    label: "Fiverr: website editing gigs",
    href: "https://www.fiverr.com/gigs/website-editing",
  },
  bekeeGhosted: {
    label: "Bekee: my web guy ghosted me",
    href: "https://bekee.com/notes/my-web-guy-ghosted-me/",
  },
  yextHours: {
    label: "Yext research on inaccurate business hours (2022)",
    href: "https://www.prnewswire.com/news-releases/yext-research-finds-that-nearly-half-of-us-consumers-experience-inaccurate-business-hours-301555524.html",
  },
  googleJavaScriptSeo: {
    label: "Google Search Central: JavaScript SEO basics",
    href: "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics",
  },
} as const satisfies Record<string, GuideSource>;

const link = (source: GuideSource, label: string = source.label) => ({
  label,
  href: source.href,
});

const REVIEWED_ON = "2026-10-25";

export const guides = defineGuideRegistry({
  "update-website-hours-without-a-developer": {
    slug: "update-website-hours-without-a-developer",
    title: "How to update your website hours without a developer",
    description:
      "Change opening and holiday hours yourself: Google Business Profile first, then your site on Squarespace, Wix, Shopify, WordPress, Webflow or a custom build.",
    hubDescription:
      "Opening and holiday hours: Google Business Profile first, then your website, platform by platform, with a holiday checklist.",
    shortAnswer:
      "Update your Google Business Profile first: it holds the hours Google Search and Maps show, and you can change it yourself in a few minutes. Then change the hours on your website. On Squarespace, Wix and Shopify you can do that yourself in the built-in editor, and usually on WordPress and Webflow too if you have a login. If someone else built the site and there is no editor you can use, ask your developer once to add ReCopyFast's line, then change the hours yourself from then on.",
    reviewedOn: REVIEWED_ON,
    sections: [
      {
        id: "google-business-profile",
        heading: "Start with Google Business Profile",
        blocks: [
          {
            kind: "paragraph",
            text: "When someone searches for your business or looks it up on Maps, the hours in Google's business panel come from your Google Business Profile, not from your website. Fix them there first, signed in to the Google account that manages the profile.",
          },
          {
            kind: "steps",
            items: [
              "Go to your Business Profile and select Edit profile, then Hours.",
              "To change a holiday or one-off day, select Edit next to Special hours. Review a suggested date, or choose Add a date.",
              "If you're open, uncheck Closed and enter the hours. If you're closed all day, leave Closed checked.",
              "Select Save.",
            ],
          },
          {
            kind: "note",
            text: [
              "Google's help says special hours only show when your regular hours are set to Open with main hours, suggests confirming official holidays even when your hours don't change, and recommends marking the business temporarily closed for closures of 7 days or more (",
              link(SOURCES.gbpSpecialHours, "Google's special hours help"),
              ").",
            ],
          },
          {
            kind: "paragraph",
            text: [
              "Wrong hours cost visits: in a 2022 survey commissioned by Yext, a listings company, 44% of US consumers said they had gone to a closed business because the hours online were wrong (",
              link(SOURCES.yextHours, "Yext, 2022"),
              ").",
            ],
          },
        ],
      },
      {
        id: "squarespace-wix-shopify",
        heading: "Squarespace, Wix or Shopify: you can do this yourself",
        blocks: [
          {
            kind: "paragraph",
            text: "These platforms come with their own editor, and hours are usually ordinary text on a page or in the footer. If you can log in, you don't need a developer, or us.",
          },
          {
            kind: "list",
            items: [
              [
                "Squarespace: edit the page, click into the text block that holds your hours, type the new hours and Save (",
                link(SOURCES.squarespaceText, "Squarespace text blocks"),
                ").",
              ],
              [
                "Wix: open the editor, double-click the text box with your hours, type, then publish. Wix has more than one editor, so the menus differ a little (",
                link(SOURCES.wixText, "Wix text help"),
                ").",
              ],
              [
                "Shopify: in the admin, go to Online Store, then Edit theme, open the section that shows your hours (often the footer or a contact page), edit its text and Save. Which sections you have depends on your theme (",
                link(SOURCES.shopifySections, "Shopify sections and blocks"),
                ").",
              ],
            ],
          },
          {
            kind: "paragraph",
            text: [
              "Can't log in? The account may be in your developer's or agency's name. Start with ",
              {
                label: "how to edit a website someone else built",
                href: guidePath("edit-a-website-someone-else-built"),
              },
              ".",
            ],
          },
        ],
      },
      {
        id: "wordpress",
        heading: "WordPress: Pages, then the editor",
        blocks: [
          {
            kind: "steps",
            items: [
              "Log in to your site's WordPress admin.",
              "Go to Pages and open the page that shows your hours. If they're in the footer, look under Appearance; where exactly depends on your theme.",
              "Click the text, type the new hours, then select Update (or Save).",
              "Open the live page on your phone to check it.",
            ],
          },
          {
            kind: "paragraph",
            text: [
              "If the page opens with a big Edit with Elementor or Divi button instead of your text, it was built with a page builder. See ",
              {
                label: "how to edit WordPress text without Elementor",
                href: guidePath("edit-wordpress-text-without-elementor"),
              },
              ".",
            ],
          },
        ],
      },
      {
        id: "webflow",
        heading: "Webflow: the Content editor seat",
        blocks: [
          {
            kind: "paragraph",
            text: [
              "Webflow has retired its legacy Editor. Clients now edit as a Content editor, signed in to a Webflow account with a seat on the site's Workspace (",
              link(SOURCES.webflowLegacyEditor, "Webflow's deprecation FAQ"),
              "). Open the page, click the text, use the pencil icon and type; Webflow's help also lets you open a page for editing by adding ?update to the end of its address (",
              link(SOURCES.webflowContentEditor, "Webflow content editor help"),
              ").",
            ],
          },
          {
            kind: "paragraph",
            text: "If your designer never gave you a seat, ask for one. Whether you can publish, and on which plan, is set in their Workspace.",
          },
        ],
      },
      {
        id: "someone-else-built-it",
        heading: "A site someone else built, with no editor you can use",
        blocks: [
          {
            kind: "paragraph",
            text: "Custom-built sites, sites made with AI tools and sites where only your developer has the login often give you no editor at all. Each change of hours becomes an email and, often, an invoice.",
          },
          {
            kind: "list",
            items: [
              "Ask your developer for your own login to whatever editor the site has, if it has one.",
              "Or ask them once to add ReCopyFast's line. After that you click the hours on your own site, type, and publish.",
              [
                "If your developer has disappeared and nobody can change the site, get access first: the domain, the hosting and the logins should be in your name. ",
                {
                  label: "Here's how to check who owns your website",
                  href: guidePath("edit-a-website-someone-else-built"),
                },
                ".",
              ],
            ],
          },
        ],
      },
      {
        id: "holiday-hours-checklist",
        heading: "Holiday hours checklist",
        blocks: [
          {
            kind: "checklist",
            items: [
              "Google Business Profile: add special hours for each day that differs, and confirm official holidays even if your hours stay the same.",
              "Website: a short dated notice at the top of the homepage, plus the hours on your contact page and in the footer.",
              "Every other place that lists your hours: maps apps, review sites and your social pages.",
              "Online ordering or booking: block the closed days there too, or customers can still book them.",
              "Phone: update your voicemail greeting.",
              "Door: a printed sign with the dates.",
              "The day after: take the notice down and check the regular hours came back.",
            ],
          },
        ],
      },
    ],
    recopyfastFit: [
      "ReCopyFast is for the last case: a site someone else built, where you have no editor, or one you'd rather not touch. Your developer adds one line to the site, once. Then you open your own website, click the hours, type the new ones and publish.",
      "If you can already change your hours in Squarespace, Wix, Shopify or WordPress and it feels fine, keep doing that. You don't need us.",
    ],
    faqs: [
      {
        question:
          "Which hours does Google show: my website's or my Business Profile's?",
        answer:
          "The business panel in Google Search and Maps shows the hours in your Google Business Profile. Keep your website and your profile the same; when they disagree, customers don't know which to trust.",
      },
      {
        question:
          "Do I need a developer to change my hours on Squarespace, Wix or Shopify?",
        answer:
          "No. If you can log in, the built-in editor lets you change the text that shows your hours. You need someone else only if the account isn't in your name.",
      },
      {
        question: "How should I show holiday hours on my website?",
        answer:
          "Put a short notice with the dates where people look first, at the top of the homepage and next to your regular hours, and take it down the day after.",
      },
      {
        question: "Can I change my hours from my phone?",
        answer:
          "Often. Google Business Profile can be edited from Google Search and the Maps app, and the Squarespace app can edit existing text blocks. Most other website editors are easier on a computer.",
      },
    ],
    sources: [
      SOURCES.gbpSpecialHours,
      SOURCES.yextHours,
      SOURCES.squarespaceText,
      SOURCES.wixText,
      SOURCES.shopifySections,
      SOURCES.webflowLegacyEditor,
      SOURCES.webflowContentEditor,
    ],
    related: [
      "change-prices-on-your-website-yourself",
      "edit-a-website-someone-else-built",
      "edit-wordpress-text-without-elementor",
    ],
  },

  "edit-wordpress-text-without-elementor": {
    slug: "edit-wordpress-text-without-elementor",
    title: "How to edit WordPress text without opening Elementor",
    description:
      "Change words on a WordPress site safely: block editor pages, revisions, staging, why Elementor and Divi feel risky, and editing the text on the live page.",
    hubDescription:
      "For WordPress owners afraid of Elementor or Divi: the safe ways to change text, and how to undo a mistake.",
    shortAnswer:
      "If the page was built in the WordPress block editor, change the text under Pages: click it, type, Update. Revisions let you go back. If it was built with Elementor or Divi, the text lives inside the builder: edit it there one field at a time, try bigger changes on a staging copy, and don't switch the page between editors. Or add ReCopyFast's line once, with the free WPCode plugin if you have admin access, and change the words by clicking them on your live page.",
    reviewedOn: REVIEWED_ON,
    sections: [
      {
        id: "how-was-it-built",
        heading: "First, check how the page was built",
        blocks: [
          {
            kind: "paragraph",
            text: "In WordPress admin, go to Pages and open the page you want to change. If you see your text in blocks you can click, it was built in the block editor. If you see a big Edit with Elementor or Divi button instead, it was built with a page builder, and the text lives inside that builder.",
          },
        ],
      },
      {
        id: "block-editor",
        heading: "Pages built in the block editor: edit them directly",
        blocks: [
          {
            kind: "steps",
            items: [
              "Go to Pages and open the page.",
              "Click the heading or paragraph you want to change and type. Don't drag blocks around or delete ones you don't recognise.",
              "Select Update.",
              "Check the live page, on your phone too.",
            ],
          },
          {
            kind: "paragraph",
            text: [
              "Made a mistake? WordPress saves a revision every time you update. Open the page's revisions, drag the slider to the version you want and select Restore (",
              link(SOURCES.wordpressRevisions, "WordPress revisions"),
              ").",
            ],
          },
        ],
      },
      {
        id: "why-builders-feel-risky",
        heading: "Why Elementor and Divi feel risky",
        blocks: [
          {
            kind: "list",
            items: [
              "The text sits inside nested sections, columns and widgets, and one wrong drag moves the layout.",
              "Spacing, fonts and mobile settings sit right beside the text field, one click away.",
              [
                "Switching a builder page back to the WordPress editor is risky in itself: Elementor's own help recommends not switching back and forth between the two editors, because it can lead to content issues (",
                link(SOURCES.elementorSwitching, "Elementor help"),
                ").",
              ],
            ],
          },
        ],
      },
      {
        id: "editing-inside-the-builder",
        heading: "If you do edit inside the builder",
        blocks: [
          {
            kind: "list",
            items: [
              "Change one thing at a time: click the text widget, edit the words in its text field, then Update.",
              "Leave the style, layout and advanced settings alone.",
              "Check the page on your phone afterwards; page builders can lay a page out differently on mobile.",
              "For anything bigger than a few words, ask your host whether they offer a staging copy of your site, and try the change there first.",
              "Know where your backups are before you start.",
            ],
          },
        ],
      },
      {
        id: "click-the-live-page",
        heading: "Or change the words on the live page",
        blocks: [
          {
            kind: "paragraph",
            text: [
              "ReCopyFast works on WordPress sites built with Elementor and Divi. With admin access you can add its line yourself in about five minutes with the free WPCode plugin; ",
              {
                label: "the WordPress install guide",
                href: "/docs/install/wordpress",
              },
              " walks through it. Then open your own site, click the words you want to change, type and publish.",
            ],
          },
          {
            kind: "paragraph",
            text: "Layout, fonts and widgets can't be edited through it, so there's nothing to knock out of place, and your Elementor pages themselves are never changed.",
          },
        ],
      },
    ],
    recopyfastFit: [
      "ReCopyFast fits WordPress owners who can log in but would rather not open a page builder to change a sentence. You add the line once (or your developer does), then edit words and swap existing photos on the live page. Every change you publish is kept in your history, and you can revert one.",
      "If the block editor already feels comfortable, use it. It's free and the text goes straight into your page.",
    ],
    faqs: [
      {
        question: "Can I edit Elementor text without Elementor?",
        answer:
          "Not safely through the WordPress editor: Elementor advises against switching a page between its editor and WordPress's. Your options are editing inside Elementor carefully, or a tool that changes the words on the live page, such as ReCopyFast.",
      },
      {
        question: "Will changing text break my WordPress site?",
        answer:
          "Typing new words into an existing text field rarely breaks anything. The risk is in dragging, deleting or changing settings. In the block editor, revisions let you go back to an earlier version.",
      },
      {
        question: "Do I need a staging site to change a few words?",
        answer:
          "No. Staging is worth it for layout changes, plugin or theme updates and redesigns. For a sentence, edit, update and check the page.",
      },
      {
        question: "Does ReCopyFast change my Elementor pages?",
        answer:
          "No. It doesn't touch your WordPress pages or Elementor data. Published changes are applied in the visitor's browser just after the page loads, so the original text stays in the page itself. Keep the text that matters most for search in WordPress too.",
      },
    ],
    sources: [SOURCES.wordpressRevisions, SOURCES.elementorSwitching],
    related: [
      "update-website-hours-without-a-developer",
      "change-prices-on-your-website-yourself",
    ],
  },

  "change-prices-on-your-website-yourself": {
    slug: "change-prices-on-your-website-yourself",
    title: "How to change prices on your website yourself",
    description:
      "Update menu, service and product prices yourself: where the price really lives, platform by platform, the PDF menu trap, and keeping Google in sync.",
    hubDescription:
      "Menus, service prices and sold-out items: where each price lives, the PDF menu trap and keeping Google in sync.",
    shortAnswer:
      "Change the price where it really lives: in the product settings if you sell online, or in the page text if it's a menu or price list. On Squarespace, Wix and Shopify you can do it yourself. Avoid menus that exist only as a PDF or an image, because every change means a new file. Then update the same prices on your Google Business Profile so the two match.",
    reviewedOn: REVIEWED_ON,
    sections: [
      {
        id: "where-the-price-lives",
        heading: "Find where the price lives",
        blocks: [
          {
            kind: "list",
            items: [
              "Products in an online store: the price is a product setting. Change it in the product, not in the page text, or the page and the checkout will disagree.",
              "Menus, service lists and rate cards: usually ordinary text on a page.",
              "A PDF or an image of your menu: the price is inside a file (see below).",
              "A booking or ordering system shown on your site: the price lives in that system's own dashboard.",
            ],
          },
        ],
      },
      {
        id: "platform-by-platform",
        heading: "Platform by platform",
        blocks: [
          {
            kind: "list",
            items: [
              [
                "Shopify: in the admin, go to Products, open the product, change the price and Save. Prices for sizes or options are on each variant, and for a sale you put the old price in Compare-at price (",
                link(SOURCES.shopifyProducts, "Shopify products"),
                ", ",
                link(SOURCES.shopifySale, "sale pricing"),
                ").",
              ],
              [
                "Squarespace and Wix pages: edit the text block or text box that holds the price, the same way you'd change any text (",
                link(SOURCES.squarespaceText, "Squarespace"),
                ", ",
                link(SOURCES.wixText, "Wix"),
                "). Store products have their own price fields in each platform's product settings.",
              ],
              "WordPress: price lists on a page are edited under Pages; if you sell with an online shop plugin such as WooCommerce, each product's price is on the product itself.",
              [
                "Webflow: as a Content editor, click the price on the page; prices kept in a CMS collection are edited on that collection item (",
                link(
                  SOURCES.webflowContentEditor,
                  "Webflow content editor help",
                ),
                ").",
              ],
            ],
          },
        ],
      },
      {
        id: "pdf-menus",
        heading: "The PDF and image menu trap",
        blocks: [
          {
            kind: "list",
            items: [
              "Every change means editing the design file, exporting a new PDF and uploading it, often by whoever made it.",
              "Old copies linger: links in emails and posts can keep pointing at last year's file.",
              "On a phone, a PDF means pinching and zooming, and text inside an image can't be read aloud by a screen reader, copied or searched.",
            ],
          },
          {
            kind: "paragraph",
            text: "If you can, put the menu on the page as text, and keep the PDF as a printable extra.",
          },
        ],
      },
      {
        id: "sold-out-and-temporary",
        heading: "Sold out, seasonal and temporary prices",
        blocks: [
          {
            kind: "list",
            items: [
              "Online stores mark items sold out from their inventory settings, so update the stock rather than typing “sold out” into the page.",
              "For a menu item, a short note next to it (“sold out today”) is clearer than deleting it. Set yourself a reminder to remove the note.",
              "Give temporary prices an end date in the wording (“until 30 November”), so an old offer can't quietly outlive itself.",
            ],
          },
        ],
      },
      {
        id: "google-business-profile",
        heading: "Keep Google Business Profile in sync",
        blocks: [
          {
            kind: "paragraph",
            text: [
              "Google Business Profile has its own menu editor for food and drink businesses and a services editor where available, both with prices (",
              link(SOURCES.gbpMenu, "menu editor"),
              ", ",
              link(SOURCES.gbpServices, "services"),
              "). Google says menu changes can take 24 to 48 hours to show on Maps and Search, so change both on the same day.",
            ],
          },
        ],
      },
    ],
    recopyfastFit: [
      "ReCopyFast helps when the prices are text on a site someone else built and you can't change them yourself. After your developer adds the line once, you click a price on your own site, type and publish. It can also swap an existing photo, such as a menu image, for a new one in its place.",
      "It doesn't change store product settings or checkout. Prices that customers pay at checkout stay in your shop system, and that's where you change them.",
    ],
    faqs: [
      {
        question: "Do I need to change prices in more than one place?",
        answer:
          "Usually. An online store's product price, any page that repeats it, and your Google Business Profile menu or services are separate. Change them together.",
      },
      {
        question: "Should my menu be a PDF?",
        answer:
          "As an extra for printing, fine. As the only menu, it's slower to update and harder to read on a phone. Text on the page is easier for you and for customers.",
      },
      {
        question: "Can I change a price without touching the layout?",
        answer:
          "Yes. In any of the built-in editors you only change the text of the price. With ReCopyFast, the layout can't be edited at all, only the words and existing photos.",
      },
      {
        question: "What if my prices are inside an image?",
        answer:
          "Then someone has to make a new image. Better still, ask for the prices to be put on the page as text the next time it's updated.",
      },
    ],
    sources: [
      SOURCES.shopifyProducts,
      SOURCES.shopifySale,
      SOURCES.squarespaceText,
      SOURCES.wixText,
      SOURCES.webflowContentEditor,
      SOURCES.gbpMenu,
      SOURCES.gbpServices,
    ],
    related: [
      "update-website-hours-without-a-developer",
      "how-much-does-a-small-website-change-cost",
    ],
  },

  "edit-a-website-someone-else-built": {
    slug: "edit-a-website-someone-else-built",
    title: "How to edit a website someone else built",
    description:
      "Check who owns your domain, hosting and logins first, then the ways to edit a site someone else built, and a developer handoff that takes one favour.",
    hubDescription:
      "Whose site is it? An ownership checklist first, then the ways to edit it, and a one-time developer handoff.",
    shortAnswer:
      "First make sure the site is really yours: the domain, the hosting and the logins should be in your name, or at least shared with you. Then use the editor the site already has, if it has one you can use. If it doesn't, or you'd rather not touch it, ask the person who built it to add ReCopyFast's line once; after that you change the words yourself, and they only hear from you for real changes.",
    reviewedOn: REVIEWED_ON,
    sections: [
      {
        id: "whose-site-is-it",
        heading: "First: whose website is it?",
        blocks: [
          {
            kind: "checklist",
            items: [
              "The domain: which company is it registered with, and is the account in your name and email?",
              "The hosting, or the platform account on Squarespace, Wix, Shopify or Webflow: who pays the bill, and can you log in?",
              "The website login: do you have your own account, rather than a shared password?",
              "The DNS settings: whoever controls them controls where your website and business email point.",
              "A copy: do you have, or can you get, a backup or export of the site?",
              "The agreement: what does it say about who owns the site and its content?",
            ],
          },
          {
            kind: "paragraph",
            text: [
              "If the answers are mostly no and the person who built it has stopped answering, sort out access before anything else. Ask in writing for the domain and accounts to be moved into your name; your registrar and host can explain their own recovery process. ",
              link(
                SOURCES.bekeeGhosted,
                "Bekee's guide for owners whose web person disappeared",
              ),
              " is a good place to start.",
            ],
          },
          {
            kind: "note",
            text: "ReCopyFast can't help with this part. Someone has to be able to change the site once, so access comes first.",
          },
        ],
      },
      {
        id: "ways-to-edit",
        heading: "Ways to edit it, once you have access",
        blocks: [
          {
            kind: "list",
            items: [
              "Squarespace, Wix or Shopify: log in and use the built-in editor yourself.",
              "WordPress: ask for your own account rather than a shared admin password, then change text under Pages.",
              "Webflow: ask your designer for a Content editor seat on their Workspace.",
              "A custom or AI-built site with no editor: every text change goes through whoever can edit the code, or through a tool added on top.",
              [
                "Paying per change or for a care plan: fine for occasional changes. See ",
                {
                  label: "what a small website change typically costs",
                  href: guidePath("how-much-does-a-small-website-change-cost"),
                },
                ".",
              ],
            ],
          },
        ],
      },
      {
        id: "developer-handoff",
        heading: "The developer handoff with ReCopyFast",
        blocks: [
          {
            kind: "steps",
            items: [
              "Sign up and add your site. When asked who will add the line, choose “My developer will”.",
              "You get a ready-to-send email with your site's line, where to paste it on WordPress, Webflow, Framer or a custom site, and a short security note. You send it from your own email; ReCopyFast sends nothing.",
              "Your developer pastes the line once. Nobody shares a password.",
              "When your site first checks in, we email you that it's connected.",
              "Open your site, click the words you want to change, type and publish.",
            ],
          },
          {
            kind: "paragraph",
            text: [
              "Want your developer to check your changes first? If they hold the account on the Pro plan, they can invite you to edit without publishing: you save drafts, they publish. ",
              {
                label: "The developer guide",
                href: "/docs/install/for-developers",
              },
              " answers their technical questions.",
            ],
          },
        ],
      },
      {
        id: "asking-your-developer",
        heading: "How to ask without souring the relationship",
        blocks: [
          {
            kind: "list",
            items: [
              "Say what you want to change yourself (hours, prices, specials) and what stays with them (design, new pages, anything technical).",
              "Ask for your own login, not theirs.",
              "Agree how bigger changes will be quoted, so neither side is surprised.",
            ],
          },
        ],
      },
    ],
    recopyfastFit: [
      "ReCopyFast fits when the site is yours and your developer still answers, but every change of wording goes through them. They add one line, once; you change the words and existing photos from then on. Layout, new pages, forms and code stay with them.",
      "It doesn't give you the domain, the hosting or the logins. If you don't have those, get them first.",
    ],
    faqs: [
      {
        question:
          "My developer says I can't change the site myself. Is that normal?",
        answer:
          "Some developers lock sites down so nothing breaks, others because changes are how they bill. It's reasonable to ask for your own editor login or another way to change your own text.",
      },
      {
        question: "What if I can't reach the person who built my site?",
        answer:
          "Get the domain, hosting and logins into your name first, with your registrar's and host's help. Until someone can change the site once, no editing tool can help, ReCopyFast included.",
      },
      {
        question: "Do I have to give ReCopyFast my website password?",
        answer:
          "No, and we never ask for it. Your developer pastes one line; you sign in to ReCopyFast with your own email address.",
      },
      {
        question: "What can I change once ReCopyFast is on the site?",
        answer:
          "Headings, paragraphs, prices, hours, button labels, and existing photos swapped for new ones. Not the layout, colours, new pages, forms, checkout or code.",
      },
    ],
    sources: [SOURCES.bekeeGhosted],
    related: [
      "update-website-hours-without-a-developer",
      "how-much-does-a-small-website-change-cost",
      "edit-wordpress-text-without-elementor",
    ],
  },

  "how-much-does-a-small-website-change-cost": {
    slug: "how-much-does-a-small-website-change-cost",
    title: "How much does a small website change cost?",
    description:
      "Typical costs of small website edits: per-change freelance rates, care plans and marketplaces, what drives the price, and when doing it yourself is cheaper.",
    hubDescription:
      "Typical per-change and care-plan prices, what drives them, and when paying is worth it.",
    shortAnswer:
      "Typically $50–150 an hour when you pay a freelancer as you go, and about $100–250 a month for a maintenance plan that includes an hour or two of edits; cheaper basic plans often include no content edits at all. Those are typical published ranges, not quotes. Paying is worth it for design and technical work. For words that change often, doing it yourself is usually cheaper.",
    reviewedOn: REVIEWED_ON,
    sections: [
      {
        id: "typical-ranges",
        heading: "Typical ranges",
        blocks: [
          {
            kind: "list",
            items: [
              [
                "Paying your developer as you go: about $50–150 an hour for freelance website work (",
                link(SOURCES.maintenanceCost, "WebsiteMaintenance.com"),
                ").",
              ],
              [
                "A maintenance or care plan: basic plans at about $35–100 a month often include no content edits; plans with one or two hours of edits run about $100–250 a month (",
                link(SOURCES.maintenanceCost, "WebsiteMaintenance.com"),
                ", ",
                link(SOURCES.fatlabPackages, "FatLab"),
                ").",
              ],
              [
                "Freelance marketplaces: small edits are listed from around $10–30, but you usually have to hand a stranger your admin login (",
                link(SOURCES.fiverrEditing, "Fiverr listings"),
                ").",
              ],
            ],
          },
          {
            kind: "note",
            text: "These are typical ranges from published pricing guides and listings, not a survey or a quote. Your area and your developer will differ.",
          },
        ],
      },
      {
        id: "what-drives-the-cost",
        heading: "What drives the cost",
        blocks: [
          {
            kind: "list",
            items: [
              "How your developer bills: per change, per hour, or a monthly plan.",
              "Waiting: a change that takes a minute can still wait days for a slot in their schedule.",
              "How the site was built: a platform with an editor you can use costs you nothing per change; a custom site needs whoever can edit the code.",
              "How often your content changes: weekly specials add up quickly, a yearly update doesn't.",
            ],
          },
        ],
      },
      {
        id: "do-the-arithmetic",
        heading: "Do the arithmetic for your business",
        blocks: [
          {
            kind: "paragraph",
            text: "Multiply the changes you make in a year by what each one costs you. For example, ten changes at $75 is $750 a year, while a care plan at $150 a month is $1,800 a year whether or not anything changes.",
          },
          {
            kind: "paragraph",
            text: [
              "Our free ",
              {
                label: "website maintenance cost calculator",
                href: "/tools/website-maintenance-cost",
              },
              " was built for freelancers pricing their own time, but the sum is the same from your side: changes a year, times time per change, times the hourly rate.",
            ],
          },
        ],
      },
      {
        id: "when-paying-is-worth-it",
        heading: "When paying is worth it",
        blocks: [
          {
            kind: "list",
            items: [
              "Design changes, new pages, and anything that touches forms, checkout or code.",
              "Security updates, backups and plugin updates on WordPress, which is what a basic care plan is for.",
              "When you'd rather not touch the site at all and the cost suits you.",
            ],
          },
        ],
      },
      {
        id: "when-doing-it-yourself-is-cheaper",
        heading: "When doing it yourself is cheaper",
        blocks: [
          {
            kind: "list",
            items: [
              "Words that change often: hours, prices, specials, staff names and announcements.",
              [
                "Your site has an editor you can log in to: Squarespace, Wix, Shopify, or WordPress pages built in the block editor. See ",
                {
                  label: "how to update your hours yourself",
                  href: guidePath("update-website-hours-without-a-developer"),
                },
                ".",
              ],
              "It costs you a few minutes instead of an invoice, and the change is live when you need it.",
            ],
          },
        ],
      },
    ],
    recopyfastFit: [
      [
        "ReCopyFast is a monthly subscription for changing the words on a site you already have, after your developer adds one line once. It doesn't replace a care plan for security updates, backups or design work. ",
        { label: "See current pricing", href: "/#pricing" },
        ".",
      ],
    ],
    faqs: [
      {
        question: "Is $100 an hour normal for website changes?",
        answer:
          "It sits inside the typical published range for freelance website work, about $50–150 an hour. Ask whether they bill a minimum per change.",
      },
      {
        question: "Does a website maintenance plan include content changes?",
        answer:
          "Not always. Basic plans often cover updates, backups and monitoring only. Ask how many hours of edits a month are included.",
      },
      {
        question: "Is it cheaper to rebuild my site on Squarespace or Wix?",
        answer:
          "Sometimes, if you want to make most changes yourself. A rebuild is a project with its own cost, time and risk to how your site shows up in search, so compare it with keeping the site you have.",
      },
    ],
    sources: [
      SOURCES.maintenanceCost,
      SOURCES.fatlabPackages,
      SOURCES.fiverrEditing,
    ],
    related: [
      "edit-a-website-someone-else-built",
      "update-website-hours-without-a-developer",
    ],
  },
});

export type GuideSlug = keyof typeof guides;

export const guideList: readonly Guide[] = Object.values(guides);

export function getGuide(slug: string): Guide | null {
  return getGuideFromRegistry(guides, slug);
}

/** Exported for the honesty note the guide template renders under every guide. */
export const GUIDE_DELIVERY_SOURCE = SOURCES.googleJavaScriptSeo;
