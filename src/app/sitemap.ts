import type { MetadataRoute } from "next";
import { getPublishedPosts } from "@/content/blog/posts";

const BASE_URL = "https://voxandra.com";

// Only real public marketing/legal routes. /landing is a duplicate of "/"
// (canonicalized there), /join/[token] is invite-only, and /app/* is the
// authenticated product — none of those belong in the sitemap.
export default function sitemap(): MetadataRoute.Sitemap {
  const blogPostEntries: MetadataRoute.Sitemap = getPublishedPosts().map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: post.updatedDateISO ?? post.publishedDateISO,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [
    {
      url: `${BASE_URL}/`,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/login`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/live-voice-translation`,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/privacy`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/terms`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/acceptable-use`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/compare/microsoft-teams-phone`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/mcp`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/blog`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    ...blogPostEntries,
  ];
}
