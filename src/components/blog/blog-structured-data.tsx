import type { BlogPostData } from "@/content/blog/types";

const BASE_URL = "https://voxandra.com";

// BlogPosting + BreadcrumbList graph for a single post, linked to the
// Organization/WebSite entities already declared on the homepage
// (landing/structured-data.tsx) via their stable @id fragments.
function buildBlogPostingGraph(data: BlogPostData) {
  const pageUrl = `${BASE_URL}/blog/${data.slug}`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${pageUrl}/#blogposting`,
        mainEntityOfPage: { "@type": "WebPage", "@id": `${pageUrl}/#webpage` },
        url: pageUrl,
        headline: data.title,
        description: data.metaDescription,
        datePublished: data.publishedDateISO,
        dateModified: data.updatedDateISO ?? data.publishedDateISO,
        author: { "@type": "Organization", name: data.author },
        publisher: { "@id": `${BASE_URL}/#organization` },
        isPartOf: { "@id": `${BASE_URL}/blog/#blog` },
        ...(data.featuredImage && {
          image: `${BASE_URL}${data.featuredImage.src}`,
        }),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${pageUrl}/#breadcrumb`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Voxandra", item: BASE_URL },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${BASE_URL}/blog` },
          { "@type": "ListItem", position: 3, name: data.title, item: pageUrl },
        ],
      },
    ],
  };
}

export function BlogPostingStructuredData({ data }: { data: BlogPostData }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(buildBlogPostingGraph(data)).replace(/</g, "\\u003c"),
      }}
    />
  );
}

// Blog/CollectionPage graph for the /blog index, listing only published
// posts (drafts are never linked or crawlable).
function buildBlogIndexGraph(posts: BlogPostData[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Blog",
        "@id": `${BASE_URL}/blog/#blog`,
        url: `${BASE_URL}/blog`,
        name: "Voxandra Blog",
        publisher: { "@id": `${BASE_URL}/#organization` },
        blogPost: posts.map((post) => ({
          "@type": "BlogPosting",
          headline: post.title,
          url: `${BASE_URL}/blog/${post.slug}`,
          datePublished: post.publishedDateISO,
          dateModified: post.updatedDateISO ?? post.publishedDateISO,
        })),
      },
      {
        "@type": "CollectionPage",
        "@id": `${BASE_URL}/blog/#webpage`,
        url: `${BASE_URL}/blog`,
        name: "Voxandra Blog",
        isPartOf: { "@id": `${BASE_URL}/#website` },
        about: { "@id": `${BASE_URL}/blog/#blog` },
      },
    ],
  };
}

export function BlogIndexStructuredData({ posts }: { posts: BlogPostData[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(buildBlogIndexGraph(posts)).replace(/</g, "\\u003c"),
      }}
    />
  );
}
