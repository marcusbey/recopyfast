import { ALTERNATIVE_SLUGS } from "@/content/alternatives";

const mockOrder = jest.fn().mockResolvedValue({ data: [], error: null });
const mockEq = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({ from: mockFrom })),
}));

import sitemap from "../sitemap";

describe("generated sitemap", () => {
  it("includes every typed comparison URL without a separate route list", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.recopyfa.st";

    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);

    for (const slug of ALTERNATIVE_SLUGS) {
      const url = `https://www.recopyfa.st/alternatives/${slug}`;
      expect(urls).toContain(url);
      expect(entries.find((entry) => entry.url === url)).not.toHaveProperty(
        "lastModified",
      );
    }
  });
});
