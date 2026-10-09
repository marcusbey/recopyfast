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
});
