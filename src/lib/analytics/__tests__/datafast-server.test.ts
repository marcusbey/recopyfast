/**
 * @jest-environment node
 */

/**
 * Server-side DataFast goals: inert without DATAFAST_API_KEY, bounded, never
 * throwing, and never reporting the key or a person.
 */

const mockCaptureMessage = jest.fn();
const mockAddBreadcrumb = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
}));

type Result = { data: unknown; error: unknown; count?: number | null };
const mockFrom = jest.fn();
jest.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}));

/** A chainable PostgREST stand-in resolving to `result`. */
function chain(result: Result) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of [
    "select",
    "eq",
    "order",
    "limit",
    "upsert",
    "abortSignal",
  ]) {
    builder[method] = jest.fn(() => builder);
  }
  builder.maybeSingle = jest.fn(() => Promise.resolve(result));
  (builder as unknown as PromiseLike<Result>).then = ((
    resolve: (value: Result) => unknown,
  ) => Promise.resolve(result).then(resolve)) as never;
  return builder;
}

import {
  DATAFAST_GOALS_API_URL,
  dataFastVisitorForSiteOwner,
  recordDataFastSession,
  rememberDataFastVisitor,
  sendDataFastGoal,
  sendFirstPublishGoal,
  sendSiteOwnerGoal,
} from "@/lib/analytics/datafast-server";

const VISITOR = "a3ab2331-989f-4cfa-91c6-2461c9e3c6bd";
const KEY = "df_test_key_never_logged";
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  process.env.DATAFAST_API_KEY = KEY;
  delete process.env.NEXT_PUBLIC_DATAFAST_DISABLED;
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  delete process.env.DATAFAST_API_KEY;
});

describe("sendDataFastGoal", () => {
  it("posts the documented body with the bearer key and a timeout", async () => {
    await expect(
      sendDataFastGoal({
        visitorId: VISITOR,
        name: "app_trial_started",
        metadata: { offer: "standard" },
      }),
    ).resolves.toBe("sent");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DATAFAST_GOALS_API_URL);
    expect(url).toBe("https://datafa.st/api/v1/goals");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      datafast_visitor_id: VISITOR,
      name: "app_trial_started",
      metadata: { offer: "standard" },
    });
  });

  it("omits metadata when there is none", async () => {
    await sendDataFastGoal({ visitorId: VISITOR, name: "site_created" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      datafast_visitor_id: VISITOR,
      name: "site_created",
    });
  });

  it("is inert without DATAFAST_API_KEY", async () => {
    delete process.env.DATAFAST_API_KEY;
    await expect(
      sendDataFastGoal({ visitorId: VISITOR, name: "signup" }),
    ).resolves.toBe("disabled");
    process.env.DATAFAST_API_KEY = "   ";
    await expect(
      sendDataFastGoal({ visitorId: VISITOR, name: "signup" }),
    ).resolves.toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is inert when DataFast is disabled for the build", async () => {
    process.env.NEXT_PUBLIC_DATAFAST_DISABLED = "true";
    await expect(
      sendDataFastGoal({ visitorId: VISITOR, name: "signup" }),
    ).resolves.toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends nothing for a missing or forged visitor id", async () => {
    await expect(
      sendDataFastGoal({ visitorId: null, name: "signup" }),
    ).resolves.toBe("invalid");
    await expect(
      sendDataFastGoal({ visitorId: 'x"};', name: "signup" }),
    ).resolves.toBe("invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws: a transport failure is reported without the key or visitor", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      sendDataFastGoal({ visitorId: VISITOR, name: "signup" }),
    ).resolves.toBe("failed");
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const reported = JSON.stringify([
      mockCaptureMessage.mock.calls,
      mockAddBreadcrumb.mock.calls,
      (console.warn as jest.Mock).mock.calls,
    ]);
    expect(reported).toContain("transport");
    expect(reported).not.toContain(KEY);
    expect(reported).not.toContain(VISITOR);
  });

  it("names a timeout as such", async () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);
    await sendDataFastGoal({ visitorId: VISITOR, name: "signup" });
    expect(mockCaptureMessage.mock.calls[0][1].tags.datafast_code).toBe(
      "timeout",
    );
  });

  it("treats DataFast's 404 (visitor never seen) as a breadcrumb, not an error", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    await expect(
      sendDataFastGoal({ visitorId: VISITOR, name: "signup" }),
    ).resolves.toBe("failed");
    expect(mockAddBreadcrumb).toHaveBeenCalled();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("captures any other non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));
    await sendDataFastGoal({ visitorId: VISITOR, name: "signup" });
    expect(mockCaptureMessage.mock.calls[0][1].tags.datafast_code).toBe(
      "http_400",
    );
  });
});

describe("rememberDataFastVisitor", () => {
  it("upserts the account's latest visitor id", async () => {
    const builder = chain({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    await rememberDataFastVisitor("user-1", VISITOR);
    expect(mockFrom).toHaveBeenCalledWith("datafast_visitors");
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", visitor_id: VISITOR }),
      { onConflict: "user_id" },
    );
  });

  it("writes nothing while server goals are off", async () => {
    delete process.env.DATAFAST_API_KEY;
    await rememberDataFastVisitor("user-1", VISITOR);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("swallows a database failure", async () => {
    mockFrom.mockImplementation(() => {
      throw new Error("down");
    });
    await expect(
      rememberDataFastVisitor("user-1", VISITOR),
    ).resolves.toBeUndefined();
  });
});

describe("dataFastVisitorForSiteOwner / sendSiteOwnerGoal", () => {
  it("resolves the owner's stored visitor and sends the milestone", async () => {
    const owner = chain({ data: { user_id: "owner-1" }, error: null });
    const visitor = chain({ data: { visitor_id: VISITOR }, error: null });
    mockFrom.mockReturnValueOnce(owner).mockReturnValueOnce(visitor);

    await expect(sendSiteOwnerGoal("site-1", "script_installed")).resolves.toBe(
      "sent",
    );
    expect(owner.eq).toHaveBeenCalledWith("permission", "admin");
    expect(visitor.eq).toHaveBeenCalledWith("user_id", "owner-1");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      datafast_visitor_id: VISITOR,
      name: "script_installed",
    });
  });

  it("is null when the owner never had a visitor id, so nothing is sent", async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: { user_id: "owner-1" }, error: null }))
      .mockReturnValueOnce(chain({ data: null, error: null }));
    await expect(
      sendSiteOwnerGoal("site-1", "first_edit_published"),
    ).resolves.toBe("invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is null on a lookup error", async () => {
    mockFrom.mockReturnValueOnce(chain({ data: null, error: { code: "x" } }));
    await expect(dataFastVisitorForSiteOwner("site-1")).resolves.toBeNull();
  });

  it("reads nothing while server goals are off", async () => {
    delete process.env.DATAFAST_API_KEY;
    await expect(sendSiteOwnerGoal("site-1", "script_installed")).resolves.toBe(
      "disabled",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("sendFirstPublishGoal", () => {
  const history = (count: number | null, error: unknown = null) =>
    chain({ data: null, error, count } as Result);

  it("sends first_edit_published when this publish wrote the site's only publish rows", async () => {
    const counted = history(2);
    mockFrom
      .mockReturnValueOnce(counted)
      .mockReturnValueOnce(chain({ data: { user_id: "owner-1" }, error: null }))
      .mockReturnValueOnce(
        chain({ data: { visitor_id: VISITOR }, error: null }),
      );

    await expect(sendFirstPublishGoal("site-1", 2)).resolves.toBe("sent");
    expect(mockFrom).toHaveBeenNthCalledWith(1, "staging_history");
    expect(counted.select).toHaveBeenCalledWith(
      "content_element_id, content_elements!inner(site_id)",
      { count: "exact", head: true },
    );
    expect(counted.eq).toHaveBeenCalledWith("action", "publish");
    expect(counted.eq).toHaveBeenCalledWith(
      "content_elements.site_id",
      "site-1",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).name).toBe(
      "first_edit_published",
    );
  });

  it("sends nothing for a later publish or an unknown count", async () => {
    mockFrom.mockReturnValueOnce(history(5));
    await expect(sendFirstPublishGoal("site-1", 2)).resolves.toBe("invalid");
    mockFrom.mockReturnValueOnce(history(null, { code: "x" }));
    await expect(sendFirstPublishGoal("site-1", 2)).resolves.toBe("invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads nothing while server goals are off", async () => {
    delete process.env.DATAFAST_API_KEY;
    await expect(sendFirstPublishGoal("site-1", 2)).resolves.toBe("disabled");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("swallows a database throw", async () => {
    mockFrom.mockImplementationOnce(() => {
      throw new Error("down");
    });
    await expect(sendFirstPublishGoal("site-1", 2)).resolves.toBe("failed");
  });
});

describe("recordDataFastSession", () => {
  beforeEach(() => {
    mockFrom.mockReturnValue(chain({ data: null, error: null }));
  });

  const sentNames = () =>
    fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).name);

  it("a session that started the trial is the signup: signup + app_trial_started", async () => {
    await recordDataFastSession({
      userId: "user-1",
      visitorId: VISITOR,
      trial: "founding",
    });
    expect(sentNames()).toEqual(["signup", "app_trial_started"]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).metadata).toEqual({
      offer: "founding",
    });
  });

  it("a returning sign-in only refreshes the stored visitor", async () => {
    await recordDataFastSession({
      userId: "user-1",
      visitorId: VISITOR,
      trial: null,
    });
    await recordDataFastSession({
      userId: "user-1",
      visitorId: VISITOR,
      trial: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith("datafast_visitors");
  });

  it("does nothing without a visitor cookie", async () => {
    await recordDataFastSession({
      userId: "user-1",
      visitorId: null,
      trial: "standard",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
