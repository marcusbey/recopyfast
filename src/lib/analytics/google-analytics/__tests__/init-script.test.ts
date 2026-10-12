/**
 * @jest-environment node
 */

/**
 * s107 — the first-party init script, executed the way a browser would.
 *
 * Marketing pages run a static CSP with no nonce (ADR 059), and this story
 * adds no inline script: the gtag queue and the Consent Mode defaults are a
 * same-origin external file, `/analytics/gtag-init.js`. It must put the
 * defaults on the dataLayer before gtag.js exists, so the component only
 * requests gtag.js after this has run. Executed here in a bare V8 context with
 * a fake `window`, because the property under test is what the browser ends
 * up holding, not the text.
 */

import vm from "node:vm";
import {
  CONSENT_REQUIRED_REGIONS,
  consentDefaults,
} from "@/lib/analytics/google-analytics/consent";
import { buildGtagInitScript } from "@/lib/analytics/google-analytics/init-script";

interface FakeWindow {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  __rcfAnalytics?: { consentRequired: boolean };
}

function execute(script: string, window: FakeWindow = {}): FakeWindow {
  vm.runInNewContext(script, { window });
  return window;
}

/** dataLayer entries are `arguments` objects, exactly as gtag.js expects. */
function commands(window: FakeWindow): unknown[][] {
  return (window.dataLayer ?? []).map((entry) =>
    Array.from(entry as ArrayLike<unknown>),
  );
}

describe("buildGtagInitScript", () => {
  it.each([true, false])(
    "queues the region defaults, the visitor's default and the ad settings, in that order (consentRequired %s)",
    (consentRequired) => {
      const window = execute(buildGtagInitScript({ consentRequired }));
      const [regional, visitor] = consentDefaults({ consentRequired });

      expect(commands(window)).toEqual([
        ["consent", "default", regional],
        ["consent", "default", visitor],
        ["set", "url_passthrough", false],
        ["set", "ads_data_redaction", true],
      ]);
    },
  );

  it("pushes real `arguments` objects, not arrays — gtag.js ignores arrays", () => {
    const window = execute(buildGtagInitScript({ consentRequired: true }));

    for (const entry of window.dataLayer ?? []) {
      expect(Array.isArray(entry)).toBe(false);
      expect(Object.prototype.toString.call(entry)).toBe("[object Arguments]");
    }
  });

  it("names every consent-required region in the regional default", () => {
    const window = execute(buildGtagInitScript({ consentRequired: false }));
    const regional = commands(window)[0][2] as { region: string[] };

    expect(regional.region).toEqual([...CONSENT_REQUIRED_REGIONS]);
  });

  it("defines window.gtag as the queue, and later calls land on the same dataLayer", () => {
    const window = execute(buildGtagInitScript({ consentRequired: false }));

    window.gtag?.("event", "probe");

    expect(commands(window).at(-1)).toEqual(["event", "probe"]);
  });

  it("keeps a dataLayer and a gtag that already exist", () => {
    const existing: unknown[] = ["earlier"];
    const gtag = jest.fn();
    const window = execute(buildGtagInitScript({ consentRequired: true }), {
      dataLayer: existing,
      gtag,
    });

    expect(window.dataLayer).toBe(existing);
    expect(window.dataLayer?.[0]).toBe("earlier");
    expect(window.gtag).toBe(gtag);
  });

  it("exposes the hint to the page as a frozen boolean, and nothing else", () => {
    const required = execute(buildGtagInitScript({ consentRequired: true }));
    const notRequired = execute(
      buildGtagInitScript({ consentRequired: false }),
    );

    expect(required.__rcfAnalytics).toEqual({ consentRequired: true });
    expect(notRequired.__rcfAnalytics).toEqual({ consentRequired: false });
    expect(Object.isFrozen(required.__rcfAnalytics)).toBe(true);
  });

  it("is strict, self-contained, and has no network or DOM writes of its own", () => {
    const script = buildGtagInitScript({ consentRequired: true });

    expect(script).toContain('"use strict"');
    expect(script).not.toMatch(
      /document\.write|eval\(|new Function|fetch\(|XMLHttpRequest|createElement|googletagmanager/,
    );
  });

  it("differs between the two hints only by the visitor default and the flag", () => {
    const required = buildGtagInitScript({ consentRequired: true });
    const notRequired = buildGtagInitScript({ consentRequired: false });

    expect(required.length).toBeLessThan(2_000);
    expect(
      required
        .replace('"analytics_storage":"denied"}]', "")
        .replace("consentRequired:true", ""),
    ).toBe(
      notRequired
        .replace('"analytics_storage":"granted"}]', "")
        .replace("consentRequired:false", ""),
    );
  });
});
