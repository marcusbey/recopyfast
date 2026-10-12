/**
 * @jest-environment node
 */

import { generatePostMarkdown } from "@/lib/blog/generate-post";

const savedKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  jest.restoreAllMocks();
  process.env.OPENAI_API_KEY = savedKey;
});

it("bounds the provider request at the shared 30 second API timeout", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  const timeout = jest.spyOn(AbortSignal, "timeout");
  jest.spyOn(global, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "# Draft\n\nBody" } }],
      }),
      { status: 200 },
    ),
  );

  await generatePostMarkdown({
    topic: "Topic",
    category: "business",
    keywords: "copy",
  });

  expect(timeout).toHaveBeenCalledWith(30_000);
  expect(fetch).toHaveBeenCalledWith(
    "https://api.openai.com/v1/chat/completions",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
