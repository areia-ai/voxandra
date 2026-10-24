import type { ComparisonPageData } from "./types";

const BASE_URL = "https://voxandra.com";

// Minimal WebPage + BreadcrumbList graph, linked to the Organization/WebSite
// entities already declared on the homepage (structured-data.tsx) via their
// stable @id fragments — no need to redeclare Organization here.
function buildComparisonGraph(data: ComparisonPageData) {
  const pageUrl = `${BASE_URL}/compare/${data.slug}`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${pageUrl}/#webpage`,
        url: pageUrl,
        name: data.metaTitle,
        description: data.metaDescription,
        isPartOf: { "@id": `${BASE_URL}/#website` },
        about: {
          "@type": "Organization",
          name: data.competitorName,
        },
        dateModified: data.lastVerifiedISO,
        publisher: { "@id": `${BASE_URL}/#organization` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}/#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Voxandra", item: BASE_URL },
          { "@type": "ListItem", position: 2, name: "Compare", item: `${BASE_URL}/compare` },
          {
            "@type": "ListItem",
            position: 3,
            name: `Voxandra vs ${data.competitorName}`,
            item: pageUrl,
          },
        ],
      },
    ],
  };
}

export function ComparisonStructuredData({ data }: { data: ComparisonPageData }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(buildComparisonGraph(data)).replace(/</g, "\\u003c"),
      }}
    />
  );
}
