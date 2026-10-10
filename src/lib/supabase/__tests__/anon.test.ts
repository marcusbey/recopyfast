/**
 * s88 — the anon client reads public data as `anon`, with no session at all.
 *
 * It exists so server code with no user (the sitemap) can read rows RLS
 * already makes public — published blog posts — without the cookie client
 * (which reads as whoever's cookies arrive and forces per-request rendering)
 * and without the service role (RLS off: one missing filter publishes drafts).
 * What makes it `anon` is the key it is built from and the absence of any
 * session it could pick up or persist, so that is what these tests pin.
 */

const createClient = jest.fn(() => ({ marker: "supabase-js client" }));

jest.mock("@supabase/supabase-js", () => ({ createClient }));

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
const saved = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  createClient.mockClear();
});

async function load() {
  jest.resetModules();
  return import("../anon");
}

describe("createAnonClient", () => {
  it("is built from the public URL and the anon key, never the service key", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

    const { createAnonClient } = await load();
    createAnonClient();

    expect(createClient).toHaveBeenCalledTimes(1);
    const [url, key] = createClient.mock.calls[0] as unknown as [
      string,
      string,
    ];
    expect(url).toBe("https://project.supabase.test");
    expect(key).toBe("anon-key");
  });

  it("holds no session: nothing persisted, refreshed or read from a URL", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    const { createAnonClient } = await load();
    createAnonClient();

    const options = (createClient.mock.calls[0] as unknown as unknown[])[2];
    expect(options).toEqual({
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"])(
    "throws a named error when %s is missing",
    async (missing) => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
      delete process.env[missing];

      const { createAnonClient } = await load();

      expect(() => createAnonClient()).toThrow(
        /NEXT_PUBLIC_SUPABASE_URL.*NEXT_PUBLIC_SUPABASE_ANON_KEY/,
      );
      expect(createClient).not.toHaveBeenCalled();
    },
  );
});
