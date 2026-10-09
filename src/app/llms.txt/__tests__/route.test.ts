import { ALTERNATIVE_SLUGS } from "@/content/alternatives";
import { GET } from "../route";

describe("GET /llms.txt", () => {
  it("returns a generated plain-text inventory of every comparison page", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://www.recopyfa.st";

    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    for (const slug of ALTERNATIVE_SLUGS) {
      expect(body).toContain(`https://www.recopyfa.st/alternatives/${slug}`);
    }
    expect(body).toContain(
      "This inventory does not guarantee indexing, ranking, or citation.",
    );
  });
});
