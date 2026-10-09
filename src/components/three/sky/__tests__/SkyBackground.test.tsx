import { render } from "@testing-library/react";
import SkyBackground from "../SkyBackground";
import { installBrowser } from "./webgl-browsers";

/* The real Canvas needs a WebGL context and three's ESM build; what this suite
   asserts is whether the sky asks for one at all. The mock renders a plain
   <canvas> so the assertion reads the way the E2E test (E2E-019) does. */
const mockCanvas = jest.fn();
jest.mock("@react-three/fiber", () => ({
  Canvas: (props: unknown) => {
    mockCanvas(props);
    return <canvas />;
  },
  useFrame: jest.fn(),
  useThree: jest.fn(),
}));
jest.mock("../SkyLayered", () => ({ __esModule: true, default: () => null }));
jest.mock("../SkyVolumetric", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/lib/hooks/useLenis", () => ({
  readScrollProgress: () => null,
  subscribeScrollProgress: () => () => {},
}));

/* jsdom answers every media query with "no". This visitor answers the
   reduced-motion query with what they asked for, and every other with "no". */
function prefersReducedMotion(isReduced: boolean): void {
  jest.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: isReduced && query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }) as MediaQueryList,
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  mockCanvas.mockClear();
});

describe("SkyBackground", () => {
  it("shows the static sky, and starts no WebGL, when the browser can only draw it in software", () => {
    installBrowser("software-only");

    const { container } = render(<SkyBackground />);

    expect(mockCanvas).not.toHaveBeenCalled();
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector(".bg-gradient-to-b")).not.toBeNull();
    // E2E-019 waits on this attribute to know the sky has mounted.
    expect(container.querySelector('[data-sky="static"]')).not.toBeNull();
  });

  it("shows the static sky when there is no WebGL at all", () => {
    installBrowser("no-webgl");

    const { container } = render(<SkyBackground />);

    expect(mockCanvas).not.toHaveBeenCalled();
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.querySelector(".bg-gradient-to-b")).not.toBeNull();
  });

  it("draws the shader sky on a GPU, as before", () => {
    installBrowser("gpu");

    const { container } = render(<SkyBackground />);

    expect(mockCanvas).toHaveBeenCalled();
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(container.querySelector('[data-sky="shader"]')).not.toBeNull();
  });

  it("draws the shader sky on demand, not on a running loop, for a GPU visitor who asked for reduced motion", () => {
    installBrowser("gpu");
    prefersReducedMotion(true);

    render(<SkyBackground />);

    expect(mockCanvas).toHaveBeenLastCalledWith(
      expect.objectContaining({ frameloop: "demand" }),
    );
  });

  it("runs the shader sky's loop for a GPU visitor who did not ask for reduced motion", () => {
    installBrowser("gpu");
    prefersReducedMotion(false);

    render(<SkyBackground />);

    expect(mockCanvas).toHaveBeenLastCalledWith(
      expect.objectContaining({ frameloop: "always" }),
    );
  });
});
