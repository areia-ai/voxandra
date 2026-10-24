import type { BlogPostData } from "./types";
import { whatIsACallRecord } from "./posts/what-is-a-call-record";
import { callDetailsWithoutAnEcosystem } from "./posts/call-details-without-an-ecosystem";

// Every blog post, published or draft, in one place. /blog, sitemap.ts, and
// the [slug] route all import from here — adding or publishing a post never
// requires touching those files by hand.
export const allBlogPosts: BlogPostData[] = [
  callDetailsWithoutAnEcosystem,
  whatIsACallRecord,
];

// Newest first. This is what /blog and the sitemap show.
export function getPublishedPosts(): BlogPostData[] {
  return allBlogPosts
    .filter((post) => post.status === "published")
    .sort((a, b) => b.publishedDateISO.localeCompare(a.publishedDateISO));
}

// Looks up any post regardless of status, so a draft is still viewable at
// its real /blog/[slug] URL for local review before publishing.
export function getPostBySlug(slug: string): BlogPostData | undefined {
  return allBlogPosts.find((post) => post.slug === slug);
}
