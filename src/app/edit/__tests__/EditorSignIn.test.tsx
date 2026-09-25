/**
 * s39 — `/edit` resumes a live hub session instead of always asking for a code.
 *
 * The return trip was designed and never wired: the hub cookie is SameSite=Lax
 * precisely "so it survives the top-level navigation back from a customer
 * site", and `GET /api/editor/sites` lists sites from it — but nothing called
 * that route, and this component always started at the email step. An invited
 * editor done with one site had to wait for a fresh emailed code to reach the
 * next one. Now the editor bar links back here, and this page has to pick up
 * where the editor left off.
 *
 * Three rules shape the mount:
 *   - no flash of the email form while the session is being checked;
 *   - a failed check is an error, never an empty site list (the same rule as
 *     `useSites` — "no sites" and "couldn't load" must not look alike);
 *   - "Use a different address" really signs out: the cookie is httpOnly, so a
 *     client-only reset would bring the old list straight back on the next load.
 */

import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorSignIn } from "../EditorSignIn";

const EMAIL = "bob@example.com";

const SITES = [
  {
    siteId: "site-1",
    name: "Hello World",
    domain: "helloworld.com",
    permissions: ["view", "edit"],
  },
  {
    siteId: "site-2",
    name: "Second Site",
    domain: "second.example",
    permissions: ["view", "edit", "publish"],
  },
];

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function reply(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

type Route = (init?: RequestInit) => Promise<FakeResponse>;

const mockFetch = jest.fn();

function installRoutes(routes: Record<string, Route>) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route(init);
  });
}

function callsTo(url: string) {
  return mockFetch.mock.calls.filter(([called]) => called === url);
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

describe("EditorSignIn — resuming a live hub session", () => {
  it("shows a loader, not the email form, while it checks — then the site list", async () => {
    const pending = deferred<FakeResponse>();
    installRoutes({ "/api/editor/sites": () => pending.promise });

    render(<EditorSignIn />);

    expect(screen.getByRole("status")).toHaveTextContent(
      /checking your session/i,
    );
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();

    pending.resolve(
      reply(200, { ok: true, email: EMAIL, remembered: true, sites: SITES }),
    );

    expect(await screen.findByText("Hello World")).toBeInTheDocument();
    expect(screen.getByText("Second Site")).toBeInTheDocument();
    expect(screen.getByText(/signed in as/i)).toHaveTextContent(EMAIL);
    expect(
      screen.getByRole("button", { name: "Use a different address" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(callsTo("/api/editor/sites")).toHaveLength(1);
  });

  it("starts at the email step when there is no session", async () => {
    installRoutes({
      "/api/editor/sites": async () =>
        reply(401, {
          error: "not_signed_in",
          message: "Verify your email again.",
        }),
    });

    render(<EditorSignIn />);

    expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
    // No session is the ordinary cold start, not an error.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["a 500", async () => reply(500, { error: "server_error" })],
    [
      "a network failure",
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("shows an error, never an empty list, after %s", async (_label, route) => {
    installRoutes({ "/api/editor/sites": route as Route });

    render(<EditorSignIn />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't check your session/i,
    );
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.queryByText("No sites yet")).not.toBeInTheDocument();
  });

  it("ignores a late answer from a check that was abandoned", async () => {
    // StrictMode mounts, unmounts and remounts once in development, so the
    // effect runs twice. The abandoned first check answers last — and must not
    // overwrite what the live one already put on screen.
    const first = deferred<FakeResponse>();
    const second = deferred<FakeResponse>();
    const pending = [first, second];
    installRoutes({
      "/api/editor/sites": () => pending.shift()!.promise,
    });

    render(
      <StrictMode>
        <EditorSignIn />
      </StrictMode>,
    );
    await waitFor(() => expect(callsTo("/api/editor/sites")).toHaveLength(2));

    second.resolve(
      reply(200, { ok: true, email: EMAIL, remembered: false, sites: SITES }),
    );
    expect(await screen.findByText("Hello World")).toBeInTheDocument();

    // Inside `act`, so any state update the stale answer makes is flushed
    // before the assertions — otherwise this would pass by not looking.
    await act(async () => {
      first.resolve(reply(401, { error: "not_signed_in" }));
      await first.promise;
      await new Promise((settle) => setTimeout(settle, 0));
    });

    expect(screen.getByText("Hello World")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
  });
});

describe("EditorSignIn — Remember this browser", () => {
  async function reachCodeStep() {
    const user = userEvent.setup();
    render(<EditorSignIn />);

    await user.type(await screen.findByLabelText("Email address"), EMAIL);
    await user.click(screen.getByRole("button", { name: "Send me a code" }));
    await screen.findByLabelText("6-digit code");
    return user;
  }

  beforeEach(() => {
    installRoutes({
      "/api/editor/sites": async () => reply(401, { error: "not_signed_in" }),
      "/api/editor/request-code": async () =>
        reply(200, { ok: true, message: "Check your email." }),
      "/api/editor/submit-code": async () =>
        reply(200, {
          ok: true,
          mode: "hub",
          email: EMAIL,
          remembered: true,
          sites: SITES,
        }),
    });
  });

  it("is unticked by default, matching the in-page modal", async () => {
    await reachCodeStep();

    expect(
      screen.getByRole("checkbox", { name: /remember this browser/i }),
    ).not.toBeChecked();
  });

  it("sends the choice with the code, so the session can carry it", async () => {
    const user = await reachCodeStep();

    await user.click(
      screen.getByRole("checkbox", { name: /remember this browser/i }),
    );
    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Hello World")).toBeInTheDocument();
    const [submitted] = callsTo("/api/editor/submit-code");
    expect(bodyOf(submitted)).toEqual({
      email: EMAIL,
      code: "123456",
      rememberDevice: true,
    });
  });

  it("sends false when the box is left alone", async () => {
    const user = await reachCodeStep();

    await user.type(screen.getByLabelText("6-digit code"), "123456");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText("Hello World");
    const [submitted] = callsTo("/api/editor/submit-code");
    expect(bodyOf(submitted).rememberDevice).toBe(false);
  });
});

describe("EditorSignIn — Use a different address", () => {
  function resumedSessionWithSignOut(signOut: Route) {
    installRoutes({
      "/api/editor/sites": async () =>
        reply(200, { ok: true, email: EMAIL, remembered: true, sites: SITES }),
      "/api/editor/sign-out": signOut,
    });
  }

  it("signs out on the server, then returns to an empty email step", async () => {
    resumedSessionWithSignOut(async () => reply(200, { ok: true }));
    const user = userEvent.setup();
    render(<EditorSignIn />);

    await user.click(
      await screen.findByRole("button", { name: "Use a different address" }),
    );

    const emailInput = await screen.findByLabelText("Email address");
    expect(emailInput).toHaveValue("");
    expect(screen.queryByText("Hello World")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const [signOut] = callsTo("/api/editor/sign-out");
    expect(signOut).toBeDefined();
    expect((signOut[1] as RequestInit).method).toBe("POST");
  });

  it.each([
    ["answers 500", async () => reply(500, { error: "server_error" })],
    [
      "cannot be reached",
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])(
    "still leaves the list, and says so, when sign-out %s",
    async (_label, route) => {
      resumedSessionWithSignOut(route as Route);
      const user = userEvent.setup();
      render(<EditorSignIn />);

      await user.click(
        await screen.findByRole("button", { name: "Use a different address" }),
      );

      expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
      expect(screen.queryByText("Hello World")).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(
        /couldn't sign you out/i,
      );
    },
  );
});
