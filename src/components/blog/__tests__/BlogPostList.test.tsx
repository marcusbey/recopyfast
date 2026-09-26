import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/react";
import { BlogPostList, type BlogPost } from "../BlogPostList";

const POSTS: BlogPost[] = [
  {
    id: 1,
    title: "Featured post",
    slug: "featured-post",
    excerpt: "The one on top.",
    category: "Guides",
    publishedAt: "2024-01-15",
    readTime: "5 min read",
    featured: true,
  },
  {
    id: 2,
    title: "Grid post",
    slug: "grid-post",
    excerpt: "One of the rest.",
    category: "Guides",
    publishedAt: "2024-01-14",
    readTime: "4 min read",
    featured: false,
  },
];

type LocaleMethod =
  | "toLocaleDateString"
  | "toLocaleString"
  | "toLocaleTimeString";
type LocaleFormatter = (
  this: Date,
  locales?: Intl.LocalesArgument,
  options?: Intl.DateTimeFormatOptions,
) => string;

const LOCALE_METHODS: readonly LocaleMethod[] = [
  "toLocaleDateString",
  "toLocaleString",
  "toLocaleTimeString",
];

/**
 * What differs between the machine that prerendered /blog and a visitor's
 * browser is the *default* locale and time zone. Only calls that leave the
 * locale or `timeZone` out pick these up — an explicit argument wins, exactly
 * as it does in a real browser — so a formatter that pins both is untouched.
 */
function emulateEnvironment(locale: string, timeZone: string): () => void {
  const RealDateTimeFormat = Intl.DateTimeFormat;
  const withDefaults = (
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): [Intl.LocalesArgument, Intl.DateTimeFormatOptions] => [
    locales ?? locale,
    { ...options, timeZone: options?.timeZone ?? timeZone },
  ];

  const intlSpy = jest
    .spyOn(Intl, "DateTimeFormat")
    .mockImplementation(
      (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) =>
        new RealDateTimeFormat(...withDefaults(locales, options)),
    );
  const dateSpies = LOCALE_METHODS.map((method) => {
    const real = Date.prototype[method] as LocaleFormatter;
    const emulated: LocaleFormatter = function (locales, options) {
      return real.call(this, ...withDefaults(locales, options));
    };
    return jest
      .spyOn(Date.prototype, method)
      .mockImplementation(emulated as Date[LocaleMethod]);
  });

  return () => {
    intlSpy.mockRestore();
    dateSpies.forEach((spy) => spy.mockRestore());
  };
}

function renderOnServer(): string {
  // The build machine that prerenders /blog: en-US in UTC.
  const restore = emulateEnvironment("en-US", "UTC");
  try {
    return renderToString(<BlogPostList posts={POSTS} />);
  } finally {
    restore();
  }
}

describe("BlogPostList hydration", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
  });

  it("hydrates the prerendered dates unchanged for a visitor in another locale and zone", async () => {
    container.innerHTML = renderOnServer();
    const recoverableErrors: unknown[] = [];

    // React error #418 in production: the server's `1/15/2024` against the
    // visitor's `14/01/2024` (a date-only string is UTC midnight, the day
    // before in Los Angeles).
    const restore = emulateEnvironment("fr-FR", "America/Los_Angeles");
    try {
      await act(async () => {
        root = hydrateRoot(container, <BlogPostList posts={POSTS} />, {
          onRecoverableError: (error) => {
            recoverableErrors.push(error);
          },
        });
      });
    } finally {
      restore();
    }

    expect(recoverableErrors).toEqual([]);
    expect(within(container).getByText("Jan 15, 2024")).toBeInTheDocument();
    expect(within(container).getByText("Jan 14, 2024")).toBeInTheDocument();
  });
});
