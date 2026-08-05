/**
 * Where an auth callback is allowed to redirect to.
 *
 * Two defects meet in this one function, and a fix for either can reintroduce
 * the other. The original: following `x-forwarded-host` handed a user who had
 * just been given a session cookie to whatever origin the request asked for.
 * The register's F-14: always preferring NEXT_PUBLIC_APP_URL sent preview
 * deployments to production, because a Vercel project defines that variable
 * once, every environment inherits it, and `NEXT_PUBLIC_*` is inlined at build
 * time — so a preview literally ships the production origin in its bundle.
 *
 * The cases below pin both directions: which origins must be preferred, and
 * which request-supplied hostnames must still never be followed.
 */

import { resolvePublicOrigin } from "@/app/auth/public-origin";

const ORIGINAL_ENV = process.env;

/**
 * Every variable the function branches on, cleared by default.
 *
 * This suite runs under `next/jest`, which loads the developer's own `.env` and
 * `.env.local` — and this project's `.env` sets both NEXT_PUBLIC_APP_URL and
 * VERCEL_URL to the production domain. Without this reset the assertions would
 * pass or fail depending on whose laptop ran them.
 */
const UNSET = {
  VERCEL_ENV: undefined,
  VERCEL_URL: undefined,
  VERCEL_BRANCH_URL: undefined,
  VERCEL_PROJECT_PRODUCTION_URL: undefined,
  NEXT_PUBLIC_APP_URL: undefined,
} as const;

function setEnv(overrides: Record<string, string | undefined>): void {
  process.env = { ...ORIGINAL_ENV, ...UNSET, ...overrides };
}

function callbackRequest(forwardedHost?: string): Request {
  // The internal origin Vercel's proxy forwards to, which is why redirecting to
  // `request.url` is not an option in the first place.
  return new Request("https://internal.vercel-internal.app/auth/callback", {
    headers: forwardedHost ? { "x-forwarded-host": forwardedHost } : {},
  });
}

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.restoreAllMocks();
});

describe("resolvePublicOrigin", () => {
  it("prefers the configured app URL over the request's internal origin", () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://www.recopyfa.st" });
    expect(resolvePublicOrigin(callbackRequest())).toBe(
      "https://www.recopyfa.st",
    );
  });

  it("reduces a configured URL with a path to its origin", () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "https://www.recopyfa.st/dashboard" });
    expect(resolvePublicOrigin(callbackRequest())).toBe(
      "https://www.recopyfa.st",
    );
  });

  it("falls through a malformed configured URL rather than redirecting to it", () => {
    setEnv({ NEXT_PUBLIC_APP_URL: "not a url" });
    expect(resolvePublicOrigin(callbackRequest())).toBe(
      "https://internal.vercel-internal.app",
    );
  });

  it("uses the request origin locally, where there is no proxy", () => {
    setEnv({});
    const local = new Request("http://localhost:3000/auth/callback");
    expect(resolvePublicOrigin(local)).toBe("http://localhost:3000");
  });

  describe("x-forwarded-host", () => {
    it("is never followed to an origin the platform did not name", () => {
      // The whole reason this module exists. The redirect happens after the
      // session cookie is set, so an attacker-supplied host is a handover.
      setEnv({ VERCEL_URL: "recopyfast-abc123.vercel.app" });
      expect(resolvePublicOrigin(callbackRequest("evil.example"))).toBe(
        "https://internal.vercel-internal.app",
      );
    });

    it("is not followed even when it is the only hostname on offer", () => {
      setEnv({});
      expect(resolvePublicOrigin(callbackRequest("evil.example"))).toBe(
        "https://internal.vercel-internal.app",
      );
    });

    it("loses to the configured app URL", () => {
      setEnv({
        NEXT_PUBLIC_APP_URL: "https://www.recopyfa.st",
        VERCEL_ENV: "production",
        VERCEL_URL: "recopyfast-abc123.vercel.app",
      });
      expect(
        resolvePublicOrigin(callbackRequest("recopyfast-abc123.vercel.app")),
      ).toBe("https://www.recopyfa.st");
    });

    it("is followed when nothing is configured and Vercel named that hostname", () => {
      setEnv({ VERCEL_PROJECT_PRODUCTION_URL: "recopyfa.st" });
      expect(resolvePublicOrigin(callbackRequest("recopyfa.st"))).toBe(
        "https://recopyfa.st",
      );
    });

    it("is compared case-insensitively, as hostnames are", () => {
      setEnv({ VERCEL_URL: "recopyfast-abc123.vercel.app" });
      expect(
        resolvePublicOrigin(callbackRequest("ReCopyFast-ABC123.vercel.app")),
      ).toBe("https://recopyfast-abc123.vercel.app");
    });
  });

  // F-14. Everything below fails on the previous ordering.
  describe("on a preview deployment", () => {
    const PREVIEW = {
      VERCEL_ENV: "preview",
      VERCEL_URL: "recopyfast-abc123.vercel.app",
      VERCEL_BRANCH_URL: "recopyfast-git-fix-auth.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "recopyfa.st",
      // Inherited from the project's production environment, which is the
      // whole defect: the preview never asked for this value.
      NEXT_PUBLIC_APP_URL: "https://www.recopyfa.st",
    };

    it("keeps the user on the preview host instead of bouncing them to production", () => {
      setEnv(PREVIEW);
      expect(
        resolvePublicOrigin(callbackRequest("recopyfast-abc123.vercel.app")),
      ).toBe("https://recopyfast-abc123.vercel.app");
    });

    it("keeps the user on the branch host too", () => {
      setEnv(PREVIEW);
      expect(
        resolvePublicOrigin(
          callbackRequest("recopyfast-git-fix-auth.vercel.app"),
        ),
      ).toBe("https://recopyfast-git-fix-auth.vercel.app");
    });

    it("uses the deployment URL when no forwarded host arrived at all", () => {
      setEnv(PREVIEW);
      expect(resolvePublicOrigin(callbackRequest())).toBe(
        "https://recopyfast-abc123.vercel.app",
      );
    });

    it("still refuses an untrusted forwarded host", () => {
      // Preferring the platform's hostnames must not become "prefer whatever
      // hostname the request claims because this is only a preview".
      setEnv(PREVIEW);
      expect(resolvePublicOrigin(callbackRequest("evil.example"))).toBe(
        "https://www.recopyfa.st",
      );
    });

    it("leaves a deliberately configured preview alias alone", () => {
      // An alias pointed at previews is not one of Vercel's generated
      // hostnames, so the configured value is the more specific answer and
      // keeps its precedence — otherwise this fix would move the cookie-loss
      // bug rather than remove it.
      setEnv({
        ...PREVIEW,
        NEXT_PUBLIC_APP_URL: "https://staging.recopyfa.st",
      });
      expect(resolvePublicOrigin(callbackRequest("staging.recopyfa.st"))).toBe(
        "https://staging.recopyfa.st",
      );
    });

    it("falls back to the configured URL when Vercel named no hostname", () => {
      setEnv({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_APP_URL: "https://www.recopyfa.st",
      });
      expect(resolvePublicOrigin(callbackRequest())).toBe(
        "https://www.recopyfa.st",
      );
    });
  });

  describe("on a production deployment", () => {
    it("keeps the configured production URL, which is the point of configuring it", () => {
      setEnv({
        VERCEL_ENV: "production",
        VERCEL_URL: "recopyfast-xyz789.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "recopyfa.st",
        NEXT_PUBLIC_APP_URL: "https://www.recopyfa.st",
      });
      // The generated deployment hostname is reachable but is not the canonical
      // origin; `www` is where cookies, CORS and the Stripe dashboard expect us.
      expect(
        resolvePublicOrigin(callbackRequest("recopyfast-xyz789.vercel.app")),
      ).toBe("https://www.recopyfa.st");
    });
  });

  describe("under `vercel dev`", () => {
    it("does not force https onto localhost", () => {
      // VERCEL_ENV=development is a laptop, and its VERCEL_URL is
      // `localhost:3000` served over http. Treating it as a deployment would
      // break local sign-in in the name of fixing previews.
      setEnv({
        VERCEL_ENV: "development",
        VERCEL_URL: "localhost:3000",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      });
      expect(
        resolvePublicOrigin(
          new Request("http://localhost:3000/auth/callback", {
            headers: { "x-forwarded-host": "localhost:3000" },
          }),
        ),
      ).toBe("http://localhost:3000");
    });
  });

  describe("off Vercel entirely", () => {
    it("ignores a hand-set VERCEL_URL when VERCEL_ENV is absent", () => {
      // This project's local `.env` sets `VERCEL_URL=https://recopyfa.st` by
      // hand. Inferring "this is a deployment" from VERCEL_URL alone would send
      // every local sign-in to production — the same bounce, one env var over.
      setEnv({
        VERCEL_URL: "https://recopyfa.st",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      });
      expect(
        resolvePublicOrigin(new Request("http://localhost:3000/auth/callback")),
      ).toBe("http://localhost:3000");
    });
  });
});
