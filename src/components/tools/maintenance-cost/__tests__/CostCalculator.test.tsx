import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CostCalculator } from "../CostCalculator";
import {
  DEFAULT_INPUTS,
  calculateCost,
} from "@/lib/tools/maintenance-cost/calculate";
import {
  buildCardText,
  buildEmbedSnippet,
} from "@/lib/tools/maintenance-cost/embed-snippet";

const mockReplace = jest.fn();
let mockSearch = "";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/tools/website-maintenance-cost",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

const mockTrack = jest.fn();
jest.mock("@/lib/analytics/google-analytics/gtag", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

const ORIGIN = "https://recopyfa.st";

function setup() {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(<CostCalculator siteOrigin={ORIGIN} />);
  return user;
}

/** The live region: announces the headline figure, debounced. */
const live = () => screen.getByRole("status", { name: "Result" });
/** The visible result panel, which is not a live region. */
const panel = () => screen.getByTestId("result-panel");
const LIVE_DEBOUNCE_MS = 500;
const flushLive = () =>
  act(() => {
    jest.advanceTimersByTime(LIVE_DEBOUNCE_MS);
  });

async function replaceField(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  value: string,
) {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  await user.type(field, value);
}

beforeEach(() => {
  jest.useFakeTimers();
  mockReplace.mockClear();
  mockTrack.mockReset();
  mockTrack.mockReturnValue(true);
  mockSearch = "";
});

afterEach(() => {
  jest.useRealTimers();
});

describe("CostCalculator", () => {
  it("reaches every input by its label, with the defaults", () => {
    setup();

    expect(screen.getByLabelText("Sites you maintain")).toHaveValue(10);
    expect(
      screen.getByLabelText("Copy changes per site, per month"),
    ).toHaveValue(2);
    expect(screen.getByLabelText("Minutes per change")).toHaveValue(20);
    expect(screen.getByLabelText("Hourly rate")).toHaveValue(60);
    expect(screen.getByLabelText("Share of changes you bill (%)")).toHaveValue(
      0,
    );
    expect(screen.getByLabelText("Currency")).toHaveValue("USD");
  });

  it("gives every input numeric entry hints and a described-by hint", () => {
    setup();

    const sites = screen.getByLabelText("Sites you maintain");
    expect(sites).toHaveAttribute("inputmode", "numeric");
    expect(sites).toHaveAttribute("min", "1");
    expect(sites).toHaveAttribute("max", "500");
    expect(sites).toHaveAttribute("step", "1");
    expect(sites).toHaveAccessibleDescription(/\S/);

    const changes = screen.getByLabelText("Copy changes per site, per month");
    expect(changes).toHaveAttribute("inputmode", "decimal");
    expect(changes).toHaveAttribute("step", "0.5");
  });

  it("shows the pinned default result in a polite live region", () => {
    setup();

    expect(live()).toHaveAttribute("aria-live", "polite");
    expect(live()).toHaveTextContent("$4,800");
    expect(within(panel()).getByText("$4,800")).toBeInTheDocument();
    expect(
      within(panel()).getByText(calculateCost(DEFAULT_INPUTS).formula),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Unbilled copy changes, per year"),
    ).toBeInTheDocument();
  });

  it("states the honesty line", () => {
    setup();

    expect(screen.getByText(/Your numbers, not ours\./)).toBeInTheDocument();
  });

  it("updates the result and the live region as the visitor types", async () => {
    const user = setup();

    await replaceField(user, "Sites you maintain", "12");
    await replaceField(user, "Copy changes per site, per month", "3");
    await user.selectOptions(screen.getByLabelText("Currency"), "EUR");

    expect(within(panel()).getByText("€8,640")).toBeInTheDocument();
    expect(panel()).toHaveTextContent(
      "12 sites × 3 changes a month × 20 minutes = 12.0 hours a month.",
    );
    flushLive();
    expect(live()).toHaveTextContent("€8,640");
  });

  it("shows a field message and uses the clamped value when out of range", async () => {
    const user = setup();

    await replaceField(user, "Sites you maintain", "9999");

    const sites = screen.getByLabelText("Sites you maintain");
    expect(sites).toHaveAttribute("aria-invalid", "true");
    expect(sites).toHaveAccessibleDescription(/Between 1 and 500/);
    expect(panel()).toHaveTextContent("500 sites");
    expect(panel()).not.toHaveTextContent("NaN");
  });

  it("shows a neutral placeholder, not a default figure, when a field is emptied", async () => {
    const user = setup();

    await user.clear(screen.getByLabelText("Hourly rate"));

    expect(screen.getByLabelText("Hourly rate")).toHaveAccessibleDescription(
      /Between 0 and 10,000/,
    );
    expect(
      within(panel()).getByText("Fill in all fields to see your number"),
    ).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent("$");
    expect(panel()).not.toHaveTextContent("NaN");
    flushLive();
    expect(live()).toHaveTextContent("Fill in all fields to see your number");
  });

  it("hides the card and its HTML while a field is empty, and restores them", async () => {
    const user = setup();

    await user.clear(screen.getByLabelText("Minutes per change"));
    expect(screen.queryByRole("group", { name: "Card preview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy card HTML" })).toBeNull();

    await user.type(screen.getByLabelText("Minutes per change"), "30");
    expect(
      screen.getByRole("group", { name: "Card preview" }),
    ).toBeInTheDocument();
  });

  it("does not write an incomplete form to the URL", async () => {
    const user = setup();

    await user.clear(screen.getByLabelText("Sites you maintain"));
    act(() => {
      jest.advanceTimersByTime(1_000);
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("announces once, after typing stops, and only the headline figure", async () => {
    const user = setup();
    expect(live()).toHaveTextContent("$4,800");

    const rate = screen.getByLabelText("Hourly rate");
    await user.clear(rate);
    await user.type(rate, "1200");

    // Mid-burst nothing new is announced, although the panel already shows it.
    expect(live()).toHaveTextContent("$4,800");
    expect(within(panel()).getByText("$96,000")).toBeInTheDocument();

    flushLive();
    expect(live()).toHaveTextContent("$96,000");
    expect(live()).not.toHaveTextContent("hours a month");
    expect(live()).not.toHaveTextContent("$4,800");
  });

  it("does not make the visible result panel a live region", () => {
    setup();

    expect(panel().closest("[aria-live]")).toBeNull();
    expect(panel()).not.toHaveAttribute("aria-live");
  });

  it("allows cents in the hourly rate", async () => {
    const user = setup();

    await replaceField(user, "Hourly rate", "59.5");

    expect(screen.getByLabelText("Hourly rate")).toHaveAttribute(
      "step",
      "0.01",
    );
    expect(panel()).toHaveTextContent("At $59.50 an hour");
    expect(screen.queryByText(/^Rounded to/)).not.toBeInTheDocument();
  });

  it("says when a typed value was rounded", async () => {
    const user = setup();

    await replaceField(user, "Sites you maintain", "2.3");
    expect(screen.getByText("Rounded to 2")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Sites you maintain"),
    ).toHaveAccessibleDescription(/Rounded to 2/);
    expect(screen.getByLabelText("Sites you maintain")).not.toHaveAttribute(
      "aria-invalid",
    );

    await replaceField(user, "Copy changes per site, per month", "0.2");
    expect(screen.getByText("Rounded to 0")).toBeInTheDocument();

    await replaceField(user, "Copy changes per site, per month", "2.3");
    expect(screen.getByText("Rounded to 2.5")).toBeInTheDocument();

    await replaceField(user, "Hourly rate", "59.556");
    expect(screen.getByText("Rounded to 59.56")).toBeInTheDocument();
  });

  it("calls router.replace once after the debounce with the canonical params", async () => {
    const user = setup();

    await replaceField(user, "Sites you maintain", "12");
    expect(mockReplace).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(mockReplace).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(
      "/tools/website-maintenance-cost?sites=12&changes=2&minutes=20&rate=60&billed=0&currency=USD",
      { scroll: false },
    );
  });

  /**
   * s107: the free tool's "scan completed" event, once per page view, when the
   * visitor's own inputs produce a settled result — the same moment the URL
   * follows them. Never for the defaults or a shared link nobody touched.
   */
  it("sends tool_scan_completed once, when the visitor's own result settles", async () => {
    const user = setup();

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(mockTrack).not.toHaveBeenCalled();

    await replaceField(user, "Sites you maintain", "12");
    act(() => {
      jest.advanceTimersByTime(300);
    });
    await replaceField(user, "Hourly rate", "80");
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(mockReplace).toHaveBeenCalledTimes(2);
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith("tool_scan_completed", {
      tool_slug: "website-maintenance-cost",
    });
  });

  // PR #94 review (Devin): a result that settles before analytics is active
  // (consent pending, init script still loading) must not use up the page's
  // one event. The first settled result AFTER activation sends it.
  it("keeps the event for later when analytics was not active yet", async () => {
    mockTrack.mockReturnValueOnce(false).mockReturnValue(true);
    const user = setup();

    await replaceField(user, "Sites you maintain", "12");
    act(() => {
      jest.advanceTimersByTime(300);
    });
    await replaceField(user, "Hourly rate", "80");
    act(() => {
      jest.advanceTimersByTime(300);
    });
    await replaceField(user, "Minutes per change", "25");
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(mockTrack).toHaveBeenCalledTimes(2);
  });

  it("sends no event while a field is empty", async () => {
    const user = setup();

    await user.clear(screen.getByLabelText("Sites you maintain"));
    act(() => {
      jest.advanceTimersByTime(1_000);
    });

    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("does not touch the URL when nothing changed", () => {
    setup();

    act(() => {
      jest.advanceTimersByTime(1_000);
    });

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("starts from the parameters in the URL", () => {
    mockSearch = "sites=12&changes=3&minutes=20&rate=60&billed=0&currency=EUR";
    setup();

    expect(screen.getByLabelText("Sites you maintain")).toHaveValue(12);
    expect(screen.getByLabelText("Currency")).toHaveValue("EUR");
    expect(within(panel()).getByText("€8,640")).toBeInTheDocument();
  });

  it("clamps junk in the URL instead of showing it", () => {
    mockSearch = "sites=1e9&rate=abc&currency=JPY";
    setup();

    expect(screen.getByLabelText("Sites you maintain")).toHaveValue(500);
    expect(screen.getByLabelText("Hourly rate")).toHaveValue(60);
    expect(screen.getByLabelText("Currency")).toHaveValue("USD");
  });

  it("shows a card preview whose text equals the snippet's text", async () => {
    const user = setup();
    await replaceField(user, "Sites you maintain", "7");

    const preview = screen.getByRole("group", { name: "Card preview" });
    const expected = buildCardText(
      calculateCost({ ...DEFAULT_INPUTS, sites: 7 }),
    );
    const snippetDoc = new DOMParser().parseFromString(
      buildEmbedSnippet(calculateCost({ ...DEFAULT_INPUTS, sites: 7 }), ORIGIN),
      "text/html",
    );
    const snippetText = Array.from(
      snippetDoc.querySelectorAll("a > span"),
      (node) => node.textContent,
    );

    expect(snippetText).toEqual(Object.values(expected));
    for (const line of Object.values(expected)) {
      expect(within(preview).getByText(line)).toBeInTheDocument();
    }
  });

  it("puts the snippet in a code block with its copy button", async () => {
    const user = setup();
    await replaceField(user, "Sites you maintain", "7");

    const copy = screen.getByRole("button", { name: "Copy card HTML" });
    expect(copy).toBeInTheDocument();
    const block = copy.closest("div")?.parentElement as HTMLElement;
    expect(block.querySelector("pre code")?.textContent).toBe(
      buildEmbedSnippet(calculateCost({ ...DEFAULT_INPUTS, sites: 7 }), ORIGIN),
    );
  });
});
