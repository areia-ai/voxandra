import { faqItems } from "./faq-data";
import { publicMemoryPlans } from "@/lib/pricing";
import { OPEN_SOURCE_LICENSE_SPDX_URL, OPEN_SOURCE_REPO_URL } from "@/lib/open-source";

const BASE_URL = "https://voxandra.com";

// The one-sentence product definition. Keep identical to the homepage meta
// description's first sentence — AI engines reward one consistent, quotable
// definition across surfaces.
const PRODUCT_DEFINITION =
  "Voxandra is an AI platform for multilingual business calls. It translates both sides of live phone conversations, provides private guidance while people talk, and turns each call into a reviewed Call Record.";

function buildHomeGraph() {
  const offers = publicMemoryPlans
    .filter((plan) => typeof plan.monthlyPriceCents === "number")
    .map((plan) => ({
      "@type": "Offer",
      name: plan.name,
      description: plan.description,
      price: (plan.monthlyPriceCents! / 100).toFixed(2),
      priceCurrency: "USD",
      url: `${BASE_URL}/#pricing`,
    }));

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${BASE_URL}/#organization`,
        name: "Voxandra",
        url: BASE_URL,
        logo: `${BASE_URL}/icon.png`,
        image: `${BASE_URL}/icon.png`,
        description: PRODUCT_DEFINITION,
        email: "contact@voxandra.com",
        // contactPoint and address let AI verify the business and answer
        // "how do I contact them / where are they" queries. Keep the email
        // identical to the one in the footer and the policy pages — a
        // consistent NAP across surfaces is what makes the entity resolvable.
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: "contact@voxandra.com",
            url: `${BASE_URL}/`,
            availableLanguage: ["English"],
          },
          {
            "@type": "ContactPoint",
            contactType: "sales",
            email: "contact@voxandra.com",
            url: `${BASE_URL}/#pricing`,
            availableLanguage: ["English"],
          },
        ],
        address: {
          "@type": "PostalAddress",
          addressLocality: "Lisbon",
          addressCountry: "PT",
        },
        // Only profiles that actually exist and resolve. An unresolvable
        // sameAs is a broken entity signal, so add new ones as they go live
        // (each URL here was loaded in a browser first — X, Instagram, and
        // LinkedIn all serve non-200s to plain curl even for pages that do
        // exist).
        sameAs: [
          "https://www.linkedin.com/company/voxandra/",
          "https://x.com/getvoxandra",
          "https://www.instagram.com/getvoxandra/",
          "https://www.tiktok.com/@getvoxandra",
        ],
        founder: {
          "@type": "Person",
          name: "Carlos Marcial",
          sameAs: ["https://www.linkedin.com/in/carlosmarcial"],
        },
        parentOrganization: {
          "@type": "Organization",
          name: "Areia Labs",
          url: "https://areialabs.org/",
        },
      },
      {
        "@type": "WebSite",
        "@id": `${BASE_URL}/#website`,
        name: "Voxandra",
        url: BASE_URL,
        publisher: { "@id": `${BASE_URL}/#organization` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${BASE_URL}/#software`,
        name: "Voxandra",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web browser",
        description: PRODUCT_DEFINITION,
        url: BASE_URL,
        publisher: { "@id": `${BASE_URL}/#organization` },
        license: OPEN_SOURCE_LICENSE_SPDX_URL,
        offers,
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${BASE_URL}/#source-code`,
        name: "Voxandra",
        codeRepository: OPEN_SOURCE_REPO_URL,
        license: OPEN_SOURCE_LICENSE_SPDX_URL,
        programmingLanguage: "TypeScript",
        runtimePlatform: "Node.js",
        targetProduct: { "@id": `${BASE_URL}/#software` },
        publisher: { "@id": `${BASE_URL}/#organization` },
      },
      {
        "@type": "FAQPage",
        "@id": `${BASE_URL}/#faq`,
        mainEntity: faqItems.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      },
    ],
  };
}

export function HomeStructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(buildHomeGraph()).replace(/</g, "\\u003c"),
      }}
    />
  );
}
