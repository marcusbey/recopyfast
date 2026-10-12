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

const ORIGIN = "https://recopyfa.st";

function setup() {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(<CostCalculator siteOrigin={ORIGIN} />);
  return user;
}

const result = () => screen.getByRole("status", { name: "Result" });

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

    expect(result()).toHaveAttribute("aria-live", "polite");
    expect(within(result()).getByText("$4,800")).toBeInTheDocument();
    expect(
      within(result()).getByText(calculateCost(DEFAULT_INPUTS).formula),
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

    expect(within(result()).getByText("€8,640")).toBeInTheDocument();
    expect(result()).toHaveTextContent(
      "12 sites × 3 changes a month × 20 minutes = 12.0 hours a month.",
    );
  });

  it("shows a field message and uses the clamped value when out of range", async () => {
    const user = setup();

    await replaceField(user, "Sites you maintain", "9999");

    const sites = screen.getByLabelText("Sites you maintain");
    expect(sites).toHaveAttribute("aria-invalid", "true");
    expect(sites).toHaveAccessibleDescription(/Between 1 and 500/);
    expect(result()).toHaveTextContent("500 sites");
    expect(result()).not.toHaveTextContent("NaN");
  });

  it("never shows NaN when a field is emptied", async () => {
    const user = setup();

    await user.clear(screen.getByLabelText("Hourly rate"));

    expect(screen.getByLabelText("Hourly rate")).toHaveAccessibleDescription(
      /Between 0 and 10,000/,
    );
    expect(result()).not.toHaveTextContent("NaN");
    expect(within(result()).getByText("$4,800")).toBeInTheDocument();
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
    expect(within(result()).getByText("€8,640")).toBeInTheDocument();
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
