import {
  buildBreadcrumbListLd,
  buildFAQPageLd,
  buildSoftwareApplicationLd,
} from "../json-ld";

describe("SEO JSON-LD builders", () => {
  it("builds a software application description without invented ratings or prices", () => {
    const result = buildSoftwareApplicationLd({
      name: "ReCopyFast",
      description: "Inline editing for an existing website.",
      url: "https://www.recopyfa.st/alternatives/tinacms",
    });

    expect(result).toEqual({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "ReCopyFast",
      description: "Inline editing for an existing website.",
      url: "https://www.recopyfa.st/alternatives/tinacms",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
    });
    expect(result).not.toHaveProperty("aggregateRating");
    expect(result).not.toHaveProperty("review");
    expect(result).not.toHaveProperty("offers");
  });

  it("numbers breadcrumb items in the same order they are rendered", () => {
    expect(
      buildBreadcrumbListLd([
        { label: "Home", href: "https://www.recopyfa.st/" },
        {
          label: "Alternatives",
          href: "https://www.recopyfa.st/alternatives",
        },
        {
          label: "TinaCMS",
          href: "https://www.recopyfa.st/alternatives/tinacms",
        },
      ]),
    ).toMatchObject({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home" },
        { "@type": "ListItem", position: 2, name: "Alternatives" },
        { "@type": "ListItem", position: 3, name: "TinaCMS" },
      ],
    });
  });

  it("uses the visible FAQ questions and answers as the schema source", () => {
    const faq = [
      {
        question: "Where does content live?",
        answer: "It depends on the product.",
      },
      {
        question: "Can clients edit?",
        answer: "Both products support editing.",
      },
    ];

    const result = buildFAQPageLd(faq);

    expect(result["@type"]).toBe("FAQPage");
    expect(result.mainEntity).toEqual([
      {
        "@type": "Question",
        name: faq[0].question,
        acceptedAnswer: { "@type": "Answer", text: faq[0].answer },
      },
      {
        "@type": "Question",
        name: faq[1].question,
        acceptedAnswer: { "@type": "Answer", text: faq[1].answer },
      },
    ]);
  });
});
