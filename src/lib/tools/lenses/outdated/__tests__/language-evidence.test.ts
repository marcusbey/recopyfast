/**
 * @jest-environment node
 */

import {
  extractPage,
  type ExtractedPage,
} from "@/lib/tools/extract/extract-page";
import { languageEvidenceWords } from "../language-evidence";

function page(body: string): ExtractedPage {
  const result = extractPage(`<html><body>${body}</body></html>`, {
    url: "https://example.com/",
    headers: {},
  });
  if (!result.ok) throw new Error("fixture refused");
  return result.page;
}

describe("outdated-copy language evidence", () => {
  it("uses the real tokenizer, so URL and file chunks do not become words", () => {
    expect(
      languageEvidenceWords(
        page(
          "<p>Visit https://example.com and open annual-report.pdf today now</p>",
        ),
      ),
    ).toEqual(["visit", "and", "open", "today", "now"]);
  });

  it("removes digit-touching tokens and reduces contractions", () => {
    expect(
      languageEvidenceWords(
        page("<p>Our company’s team ships abc123 orders every day</p>"),
      ),
    ).toEqual(["our", "company", "team", "ships", "orders", "every", "day"]);
  });

  it("excludes blocks with fewer than four tokens", () => {
    expect(
      languageEvidenceWords(
        page("<p>Short menu label</p><p>Fresh bread arrives here daily</p>"),
      ),
    ).toEqual(["fresh", "bread", "arrives", "here", "daily"]);
  });

  it("keeps Unicode prose words as language evidence", () => {
    expect(
      languageEvidenceWords(page("<p>Café crème brûlée tastes très good</p>")),
    ).toEqual(["café", "crème", "brûlée", "tastes", "très", "good"]);
  });
});
