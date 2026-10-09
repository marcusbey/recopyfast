interface SoftwareApplicationInput {
  readonly name: string;
  readonly description: string;
  readonly url: string;
}

interface BreadcrumbItem {
  readonly label: string;
  readonly href: string;
}

interface FAQItem {
  readonly question: string;
  readonly answer: string;
}

export function buildSoftwareApplicationLd({
  name,
  description,
  url,
}: SoftwareApplicationInput) {
  return {
    "@context": "https://schema.org" as const,
    "@type": "SoftwareApplication" as const,
    name,
    description,
    url,
    applicationCategory: "BusinessApplication" as const,
    operatingSystem: "Web" as const,
  };
}

export function buildBreadcrumbListLd(items: readonly BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org" as const,
    "@type": "BreadcrumbList" as const,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem" as const,
      position: index + 1,
      name: item.label,
      item: item.href,
    })),
  };
}

export function buildFAQPageLd(faq: readonly FAQItem[]) {
  return {
    "@context": "https://schema.org" as const,
    "@type": "FAQPage" as const,
    mainEntity: faq.map((item) => ({
      "@type": "Question" as const,
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer" as const,
        text: item.answer,
      },
    })),
  };
}
